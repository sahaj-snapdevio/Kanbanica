# Cube IPv6 — Operator Rollout Runbook

> The code for IPv6 + globally-unique networking is built, tested, and committed on
> `feat/cube-ipv6-networking` (all gates green). This runbook is the **operator-gated
> production rollout** — the steps that touch the live DB + bare-metal hosts and must run
> with an operator present in maintenance windows. Do them IN ORDER. Spec:
> `docs/superpowers/specs/2026-05-30-cube-ipv6-design.md` (Deploy ordering §).

## Pre-flight (before deploying the code)

- [ ] **Pick the legacy host** — the busiest/oldest active server. It keeps `bridge_subnet = 0`
  → its cubes keep their `10.0.0.x` IPv4 (no v4 re-IP) but DO gain IPv6. Note its server id.
- [ ] Confirm every active host has working **global IPv6 egress** (operator guarantee).

## Step 1 — Deploy the code + apply the additive migration

- [ ] Merge/deploy `feat/cube-ipv6-networking`. The worker's `worker:deploy` runs
  `pnpm db:migrate`, which applies **`0069`** — additive `ADD COLUMN IF NOT EXISTS`
  (`servers.bridge_subnet`, `cubes.internal_ipv6`) only. No locks, no index build.
- [ ] **Effect of the deploy alone:** NEW servers allocate a `bridge_subnet` at create; NEW
  cubes get dual-stack networking immediately. EXISTING servers/cubes are unchanged until
  Step 3 (their `bridge_subnet`/`internal_ipv6` are still NULL — the allocation sites read
  the server's `bridge_subnet`, so **back-fill it before creating new cubes on a legacy host**, Step 2).

## Step 2 — Back-fill `bridge_subnet` (out-of-band SQL, one-time)

- [ ] Set the legacy host's subnet to 0 (substitute its id):
  ```sql
  UPDATE servers SET bridge_subnet = 0 WHERE bridge_subnet IS NULL AND id = '<LEGACY_SERVER_ID>';
  ```
- [ ] Assign every OTHER existing active server a distinct subnet ≥ 1. The migration script
  (Step 3) does this automatically per host if left null, but doing it up-front avoids a
  new-cube-before-migration landing on a null subnet. Simplest: let the script handle it, and
  do NOT create cubes on a not-yet-migrated, still-null host in the interim.

## Step 3 — Build the unique indexes (out-of-band, AFTER dedup)

The `CREATE UNIQUE INDEX CONCURRENTLY` statements are commented in `0069`'s SQL (they can't run
inside drizzle's migration transaction). Run them by hand, in order:

- [ ] **Dedup preflight** — MUST report zero before building the v4 composite index:
  ```
  pnpm cubes:check-dup-ips
  ```
  If it lists duplicate `(server_id, internal_ip)` pairs (from the historical unlocked-alloc
  race, now fixed), re-IP one of each pair on its host first.
- [ ] Build the three partial unique indexes, each in its own `psql` session (NOT in a tx):
  ```sql
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "servers_bridge_subnet_unq"
    ON "servers" USING btree ("bridge_subnet") WHERE bridge_subnet IS NOT NULL;
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "cubes_internal_ipv6_unq"
    ON "cubes" USING btree ("internal_ipv6") WHERE internal_ipv6 IS NOT NULL AND status <> 'deleted';
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "cubes_server_id_internal_ip_unq"
    ON "cubes" USING btree ("server_id","internal_ip") WHERE internal_ip IS NOT NULL AND status <> 'deleted';
  ```
  (`CONCURRENTLY` doesn't lock writes; a residual dup surfaces as an `INVALID` index, not a failure.)

## Step 4 — Per-host migration cutover (one maintenance window per host)

Do ONE host at a time. The migration applies the host firewall + dual-stack bridge/NAT, then
re-IPs the host's cubes. Brief connectivity blip on that host (live SSH + browser-terminal
sessions drop and must be reopened; the customer endpoint `connect.<hostname>:<port>` is unchanged).

For each active server `<id>`:

- [ ] **Quiesce** customer port-mapping mutations on that host for the window. Optionally pause
  the `server.reconcile` + `cube.error-recovery-scan` crons for the host (a defensive
  mid-re-IP skip is already coded, but pausing is cleanest).
- [ ] **Dry-run** and review the plan (target S, per-cube action, any cube blocking the legacy-br0 drop):
  ```
  pnpm cubes:migrate-network --server <id>
  ```
- [ ] **Apply:**
  ```
  pnpm cubes:migrate-network --server <id> --apply
  ```
  Per cube: running → live `networkctl reconfigure`; powered-off/error → loop-mount rewrite;
  paused → SKIPPED (stays on old IP, converts on its next cold start or a later re-run once
  running). Active port-mappings are re-pointed; Caddy custom-domain routes are rebuilt
  (awaited, fails loudly). Legacy `br0` v4 is dropped only when no cube on the host is still
  on `10.0.0.x`.
- [ ] **Verify** the host (the `server.verify` checks + manually): host keeps its OWN IPv6
  default route; `ip -6 addr show br0` has `fd00:c0be:<S>::1`; `ip6tables -t nat -S` has the
  cube `/64` MASQUERADE; `ip6tables -S INPUT` shows `-P INPUT DROP`. In a cube: `ip -6 addr`
  shows `fd00:c0be:<S>::<octet>`, `getent ahostsv6 cloudflare.com` resolves, `curl -6` egresses,
  every mapped port reachable on its unchanged `connect.<hostname>:<port>`.
- [ ] Re-enable any paused crons.

Repeat for all hosts (legacy host included — it gets IPv6 + the firewall; its v4 stays `10.0.0.x`).

## Step 5 — Finalize global IPv4 uniqueness (after the WHOLE fleet is migrated)

- [ ] Confirm no host is still on the legacy `10.0.0.x` scheme except the intended S=0 host.
- [ ] Add the global `UNIQUE(internal_ip)` index (a normal `pnpm db:generate`'d follow-up
  migration, or by hand):
  ```sql
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "cubes_internal_ip_unq"
    ON "cubes" USING btree ("internal_ip") WHERE internal_ip IS NOT NULL AND status <> 'deleted';
  ```
  (Only valid once every host's cubes are globally unique — i.e. no two hosts both on `10.0.0.x`.)

## Step 6 — Refresh images (so cold boots + new cubes use the v6-first baked default)

- [ ] `pnpm build:images` (rebuilds rootfs with the v6-first `/etc/resolv.conf` default + the
  current agent), then click **Update Images** on each server (only affects NEW cubes / fresh
  cold-boots; the migration already rewrote in-guest config for existing running/stopped cubes).

## Rollback notes

- The schema is additive — the columns can stay even if the rollout is paused.
- A per-host cutover that fails mid-way is **resumable**: re-run `--server <id> --apply`
  (commits are last-write, idempotent; the resume guard skips cubes that already have
  `internal_ipv6`).
- The firewall step has a 60s cancel-on-success auto-rollback on the retrofit path; host SSH
  (IPv4 2822) is explicitly allowed before the `-P DROP`, so a mistake can't lock you out.
