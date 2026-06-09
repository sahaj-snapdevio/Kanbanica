# Cube IPv4 Rebase — Operator Runbook (`10.0.0.0/8` → `198.18.0.0/15`)

> Companion to the design (`2026-05-31-cube-ipv4-rebase-198-18-design.md`) and plan
> (`2026-05-31-cube-ipv4-rebase-198-18.md`). This is the step-by-step cutover for a
> production fleet. Read the **Model** section before touching anything.

## TL;DR — the cutover is ONE command

```bash
pnpm cubes:migrate-network --apply --all      # run worker-quiesced; converts the WHOLE fleet
```

Everything else below is **optional** — a dry-run preflight before it and a verify after.
The single `--apply --all` command converts every server + every cube (force-converting
paused ones), rebuilds DNAT + Caddy, and scrubs all legacy `10.x` host networking. It is
idempotent + fails loud, so if it stops, fix the cause and re-run the same command.

## Model — why this is a single worker-quiesced window

The rebase code ships with **fail-loud guards**: once it is live, any cube still on a
legacy `10.x` IP (or any host with a `null` `bridge_subnet`) throws a clear, actionable
error on its next lifecycle op (wake, provision, guest-network rewrite) instead of
silently minting a broken address. That is by design — but it means **the fleet must not
sit half-converted while the worker is processing jobs**. So the cutover is one window:

1. Deploy the new code.
2. **Quiesce** the pg-boss worker (no cube lifecycle job runs).
3. Run the one-shot conversion `pnpm cubes:migrate-network --apply --all` to a verified
   **zero-`10.x`** state.
4. Restore the worker.

The conversion is **idempotent + resumable** (commit-last; already-`198.18` cubes are
no-ops) and **fails loud** (non-zero exit) if any cube can't convert, so a partial run is
safe to re-run.

This branch adds **no DB migration** — `servers.bridge_subnet` and `cubes.internal_ipv6`
already exist from the IPv6 work, so there is no `pnpm db:migrate` step tied to the rebase.

## Where to run the commands

`pnpm cubes:*` run from the **worker image** (it carries the env, DB access, and
`APP_SECRET` to decrypt the per-server SSH keys) and **must run on the new code** — they
use the `198.18` math. The migration connects to the DB and SSHes to each host directly,
and **refreshes Caddy inline over its own SSH** — it does **not** need the pg-boss worker
process running.

Because the worker service is scaled to **0** during the window (Step 2), run the command
as a **one-off container from the worker image**, e.g.:

```bash
# illustrative — use your Dokploy worker service's image + env file
docker run --rm --env-file <worker.env> <worker-image> \
  pnpm cubes:migrate-network --apply --all
```

(Or keep a single non-job-processing shell container of the same image around and
`docker exec` into it. Do **not** run it from a replica that is also processing pg-boss
jobs.)

## Step 0 — Ship the branch

Merge `feat/cube-ipv4-rebase-198-18` → main → Dokploy build/deploy (Next.js + worker).
No rebase-specific `db:migrate` step. Confirm the gate is green on the branch first:

```bash
pnpm typecheck && pnpm lint && pnpm test && bash -n setup/images/build-all-images.sh
```

## Step 1 — Preflight (DRY RUN, zero changes)

```bash
pnpm cubes:check-dup-ips       # must report ZERO duplicate (server_id, internal_ip) pairs; exits non-zero otherwise
pnpm cubes:migrate-network     # DRY RUN (default) — per-cube plan + "legacy br0 drop: WOULD proceed / BLOCKED" per server
```

- If `check-dup-ips` reports duplicates, remediate (re-IP one of each pair) before cutover —
  the transitional `UNIQUE(server_id, internal_ip)` index can't build while a pair exists.
- Review the dry-run plan per server. **Quiesce any `pending` / `booting` / `stopping`
  cube** before the window — those are skipped, and a skip blocks that host's legacy-br0
  drop (so the host counts as a failure and the run exits non-zero).

## Step 2 — Cutover (worker-quiesced)

1. **Quiesce the worker:** in Dokploy, scale the pg-boss worker service to **0 replicas**.
   Next.js stays up — customers can browse; any wake/provision job they trigger just
   **queues** and is processed (on `198.18`) once the worker returns.
2. **Run the one-shot** (from the worker image, per "Where to run"):

   ```bash
   pnpm cubes:migrate-network --apply --all
   ```

   Per server it: allocates a `bridge_subnet` for any `null` host → applies dual-stack
   host networking (`br0` + NAT66 + egress FORWARD + stateful default-deny INPUT, with the
   60s cancel-on-success firewall rollback net) → re-IPs every cube:
   - **running** → in-guest `networkctl reconfigure`
   - **powered-off / killed / error** → loop-mount rewrite
   - **paused (frozen RAM)** → **force-convert**: power off → loop-mount re-IP → leave
     powered-off (cold-boots on next wake; disk intact, frozen RAM lost — accepted)
   - **pending / booting / stopping** → skipped (quiesce these out beforehand)

   …then rebuilds `status='active'` port-mapping DNAT + refreshes Caddy inline, and drops
   the **legacy `10.x/24` br0 address(es) + MASQUERADE** (scans for whatever `10.x` the host
   actually carries — covers both the original `10.0.0.x` single-subnet hosts and the
   IPv6-era `10.<S_hi>.<S_lo>.x` per-host hosts) **only** once the host has zero `10.x`
   cubes left.

3. **If it exits non-zero** (host down, a transient cube, a conversion failure): fix the
   cause and **re-run the same command**. It's idempotent — already-`198.18` cubes are
   no-ops; it converges to zero-`10.x`.
4. **Restore the worker:** scale the worker service back to **1+** replicas.

## Step 3 — Verify

```bash
pnpm cubes:migrate-network     # dry run again
```

- Every server should report `legacy br0 drop: WOULD proceed (no cube stays on 10.x)` and
  every cube `skip (already on 198.18 S=…)`.
- Smoke a **fresh** cube: boots on `198.18.x`, reachable via Caddy (HTTP) **and** raw-TCP
  port mappings.
- Smoke a **Docker Swarm / Dokploy** cube: works on Docker's **default `10/8`** overlay
  pool — no collision, no customer config (the live-incident repro: `eth0:<port>` returns
  the app, not a timeout).
- Regression: a plain (non-overlay) service still works.

## Step 4 — Per-cube cluster recovery (only where flagged)

Re-IPing a cube that runs **Docker Swarm / k8s** breaks its pinned advertise-addr / node
IP. The migration **detects and surfaces** (never auto-runs) the one-time recovery in its
output. For each flagged cube, run inside the guest:

```bash
# Dokploy / Swarm:
docker swarm init --force-new-cluster --advertise-addr <new 198.18 IP>
# k8s: the equivalent node-IP reconfiguration for your distro
```

The end state is clean — once on `198.18`, the cube's own overlays use Docker's default
`10/8` pool with zero collision. The interim `DOCKER_SWARM_INIT_ARGS="--default-addr-pool …"`
workaround becomes **unnecessary** once a cube is on `198.18`.

## Failure handling & rollback posture

- **Resumable:** a crash after power-off but before the commit-last re-IP leaves the cube
  on its old IP, powered-off; the next run re-derives the identical target and re-converts.
  With the worker stopped, a briefly-powered-off-but-still-`10.x` cube is harmless.
- **No host snapshot / rollback** (Rule 36) — recovery is "fix and re-run," not "roll back."
  The host-networking retrofit arms a 60s `-P INPUT ACCEPT` cancel-on-success net so a
  mistaken firewall allow-list can't lock the worker out.
- **Capacity guard:** a host whose pre-rebase `bridge_subnet` exceeds `511` (the `/15`
  ceiling) is refused loudly — reallocate a smaller subnet for that host first.

## Post-cutover code cleanup (dev follow-up — do NOT do before the cutover)

Once Step 3 confirms the fleet is **zero-`10.x`** (and a `bridge_subnet` is set on every
active server), the runtime is `198.18`-only and the transition-only code is dead. Delete
it as a single follow-up PR. **None of this may be removed before the cutover** — the
migration needs the `10.x`-recognition to convert, and the guards protect a stray
un-converted cube during the window.

**REMOVE (one-shot migration tooling — pure dead code post-cutover):**

- [ ] `scripts/migrate-cube-network.ts` (incl. `dropLegacyBridge`, `migrateCube`,
      `toToolAction`, `refreshCaddyAwaited`, `verifyMigratedReachable`) + the
      `cubes:migrate-network` `package.json` script.
- [ ] `scripts/check-duplicate-cube-ips.ts` + the `cubes:check-dup-ips` script (its only
      purpose was gating the transitional unique index during the IPv6/rebase rollout).
- [ ] `lib/cubes/reip.ts` (`planCubeReIpAction`, `reIpRunningCube`, `reIpStoppedCube`,
      `isLegacyIp`, `detectClusterRecoveryNeeded`) + `lib/cubes/reip.test.ts` — used ONLY
      by the migration script.
- [ ] The `cubes:migrate-network` / `cubes:check-dup-ips` rows in the CLAUDE.md command
      table + this runbook + the design/plan docs' migration sections (mark completed,
      dated).

**SIMPLIFY (the fail-loud guards — keep the guard, drop the `10.x` framing):**

- [ ] `lib/worker/handlers/cube-wake.ts` — the `subnetOf` try/catch guard becomes a plain
      invariant assert (no cube can be on `10.x` anymore); keep it as a defensive check but
      drop the "legacy 10.x — run migrate-network" wording.
- [ ] The null-`bridge_subnet` throws in `cube-boot.ts`, `cube-from-snapshot.ts`,
      `cube-import-rootfs.ts`, `cube-transfer.ts`, `backup-redeploy.ts` — **KEEP** (a
      mis-provisioned server with null `bridge_subnet` must still fail loud rather than
      mint a broken address); just drop any "run migrate-network" hint that implies a
      migration is pending.

**KEEP PERMANENTLY (not legacy — correctness guards):**

- `subnetOf()` throwing on a non-`198.18` IPv4 (`lib/server/cube-network.ts`) — a
  permanent fail-fast on bad data, not transition code.
- The dual-stack host networking, `cube-network.ts` math, IPv6 helpers, `bridge_subnet`
  allocation, the `S ≤ 511` capacity guard.

**Verify after removal:** `pnpm typecheck && pnpm lint && pnpm test` green, and
`grep -rn "10\.0\.0\|migrate-network\|isLegacyIp\|reIp" lib/ scripts/ app/` returns only
intended hits (e.g. the SSRF blocklist's `10.0.0.0/8`, which stays).
