# Cube IPv6 + globally-unique networking — design spec (v2, post-audit)

- **Date:** 2026-05-30
- **Status:** Draft v2 — revised after a 12-dimension multi-agent code audit + gap-fill
  (every finding re-verified against live code). Awaiting review before `/make-plan`.
- **Scope:** Add outbound IPv6 + IPv6 DNS to every cube; make **both** the IPv4 and
  IPv6 cube addresses **globally unique and stored in the DB**; harden the host
  firewall posture; across new and existing cubes — one combined change with a
  server-by-server operational rollout. **Two pre-existing production bugs (the
  `99-krova.conf` reboot clobber and the unlocked IP-allocation race) are fixed as
  part of this work** (operator decision).
- **Audit traceability:** finding IDs (C#/H#/M#/N-*) from
  `tasks/wg0wnz722` + `tasks/wed1htswl` are cited inline so each fix traces to its audit item.

## Summary

Cubes today get only a per-host private IPv4 (`10.0.0.<n>/24`) NAT'd to the host's
public IPv4 — no IPv6, and IPv4 is unique only *within* a host. A per-server
**`servers.bridge_subnet`** (16-bit) drives BOTH families so every cube is globally
unique fleet-wide:

```text
IPv4 : 10.<S_hi>.<S_lo>.<octet>/24    gateway 10.<S_hi>.<S_lo>.1
IPv6 : fd00:c0be:<S-hex>::<octet>/64  gateway fd00:c0be:<S-hex>::1   (NAT66/ULA)
```

IPv6 is greenfield (additive). IPv4 is load-bearing (DNAT, SSH, reachability,
Caddy dial), so its globally-unique form requires a **per-server re-IP cutover** of
existing cubes. The host always has global IPv6 egress (operator guarantee).

## Goals

- Every cube reaches the IPv6 internet (egress) + resolves DNS over IPv6.
- Both `internal_ip` + `internal_ipv6` are stored and globally unique.
- New + existing cubes covered; jailed and bare cubes identical (see Jailer §).
- The host firewall is a proper stateful default-deny on both families (no service
  is newly exposed over the host's IPv6).
- Production-safe: additive schema, idempotent + resumable ops, no lock-on-hot-path
  migrations; per-server maintenance-window cutover.

## Non-goals (YAGNI)

- **Inbound IPv6** (no AAAA, no `servers.public_ipv6`, no `ip6tables` DNAT). Inbound
  stays IPv4 via the existing port-mapping DNAT.
- Routed global IPv6 prefixes; per-cube IPv6 firewalling beyond bridge MASQUERADE;
  systemd-resolved; cross-host cube↔cube routing.

## Locked decisions

1. **NAT66 + ULA** `fd00:c0be::/32`, outbound + DNS only.
2. Both families **globally unique** via one per-server `bridge_subnet`; cube 4th
   octet preserved **across the per-server re-IP only** (NOT across transfers — N-M1).
3. **resolv.conf, v6-first, exactly 3 entries** (glibc `MAXNS=3`):

   ```text
   nameserver 2606:4700:4700::1111   # Cloudflare IPv6
   nameserver 2001:4860:4860::8888   # Google IPv6
   nameserver 1.1.1.1                # Cloudflare IPv4 fallback
   ```

4. `internal_ipv6` **stored** (derived at write-time); `bridge_subnet` stored on servers.
5. Port mappings + SSH **IPv4-inbound only**; re-IP re-points DNAT internally.
6. **`internal_ip` + `internal_ipv6` are Orbit-admin-only** (operator decision, N-H2).
   Today `internal_ip` ships to customers via `buildCubeSummary` (outbound webhooks +
   v1 API create response); this change **removes** it from those surfaces and does NOT
   add `internal_ipv6` there. **Confirmed safe to drop outright** — no customers consume
   the internal IP (operator confirmation), so no back-compat / deprecation window is needed.
7. **Host firewall: stateful default-deny `INPUT` on BOTH IPv4 and IPv6** (operator
   delegated "best setup"; resolves C1/H5). Applied allow-list-first then `-P DROP`,
   with a retrofit auto-rollback net + verify-phase assertion (Host firewall §).
8. **One combined change**, server-by-server rollout; the two pre-existing bugs
   (C2 `99-krova.conf` clobber, C4 unlocked allocation) are fixed here.
9. **A `node --test` suite for the address math is a hard prerequisite** (no other
   guardrail exists on the hex/subnet arithmetic).

## Unified addressing

`bridge_subnet = S` (integer, **1..65535** — `0` reserved for the legacy server,
H8) drives both families. The cube's 4th octet is preserved across the re-IP, so
TAP (`fc<octet>`) + vsock CID (`octet+3`) are stable (L9 invariant: TAP/vsock/`ip.txt`
derive **only** from the IPv4 `internal_ip`, never `internal_ipv6`).

```text
IPv4 /24 : 10.<S>>8>.<S&0xff>.0/24    gateway 10.<S>>8>.<S&0xff>.1    cube .<octet>
IPv6 /64 : fd00:c0be:<S-hex>::/64     gateway fd00:c0be:<S-hex>::1    cube ::<octet-hex>
```

`S=0` reproduces the legacy `10.0.0.x` / `fd00:c0be::x`; assign `S=0` to the
busiest/oldest existing host so it needs **no** v4 re-IP. Octet→hextet is
`octet.toString(16)` (10→`a`, 16→`10`, 254→`fe`); `octetOf(ip)` is base-10 parse of
the last label (M10/N-L2).

## Schema changes (`db/schema/`)

Additive, nullable, backfilled (Rule 40); generated via `pnpm db:generate` (Rule 6).
`cubeStatus` includes `deleted` (verified — `cube-boot.ts:165` uses `ne(status,'deleted')`),
so partial predicates `status <> 'deleted'` are valid.

> **Current baseline (re-verified at HEAD):** the latest migration is `0068` (a new
> server-reboot setup phase landed concurrently and also added a `servers` column), so
> `pnpm db:generate` will produce `0069+` — read the **live** `db/schema/servers.ts` before
> adding `bridge_subnet`. That new reboot phase *verifies host config persists across a
> reboot*, which makes the C2 `99-krova.conf` fix more important, not less (the clobber
> would surface on exactly that reboot). No conflict.

1. `servers.bridge_subnet integer` + partial `UNIQUE(bridge_subnet) WHERE … NOT NULL`.
2. `cubes.internal_ipv6 text` + partial `UNIQUE(internal_ipv6) WHERE … NOT NULL AND status <> 'deleted'`.
3. **Transitional** partial `UNIQUE(server_id, internal_ip) WHERE … NOT NULL AND status <> 'deleted'`.
4. **Finalization** (after the whole fleet is migrated): global partial
   `UNIQUE(internal_ip) WHERE … NOT NULL AND status <> 'deleted'`. A normal second
   `pnpm db:generate`'d migration (Rule 6, L8) — only the generated SQL body may be
   edited for `IF NOT EXISTS`/`CONCURRENTLY`, never the journal/snapshot.

**Index build = `CONCURRENTLY`, out-of-band (not in the drizzle tx).** Do NOT assume
the `cubes` table is small (audit corrected this). A residual duplicate then surfaces
as a non-blocking `INVALID` index instead of a locking deploy failure.

**N-C2 / C4 — mandatory dedup preflight BEFORE the transitional index:** prod may
already hold duplicate `(server_id, internal_ip)` rows from the unlocked-allocation
race (C4). Run a read-only audit
`SELECT server_id, internal_ip, count(*) … WHERE status<>'deleted' GROUP BY 1,2 HAVING count(*)>1`
and re-IP one of each colliding pair (rebuild its iptables/TAP) until zero, OR the
`CREATE UNIQUE INDEX` errors. Partial unique indexes with `WHERE` are db:generate-supported
(`plans.ts:80`, `domains.ts:110`).

Drizzle partial unique indexes are confirmed supported (`uniqueIndex(...).where(sql\`...\`)`).

## Config constants (`config/platform.ts`, Rule 30)

```ts
export const CUBE_IPV4_PREFIX = "10";
export const CUBE_IPV6_PREFIX = "fd00:c0be";
export const CUBE_BRIDGE_SUBNET_MIN = 1;              // 0 reserved for legacy host (H8)
export const CUBE_BRIDGE_SUBNET_MAX = 0xffff;
export const CUBE_DNS_SERVERS = [
  "2606:4700:4700::1111", "2001:4860:4860::8888", "1.1.1.1",
] as const;
```

`build-all-images.sh:865` hardcodes the same 3 resolv.conf entries with a comment
pointing to `CUBE_DNS_SERVERS` (Rule 14 cross-language note; Rule 39 `bash -n` after).

## Helpers

**`lib/server/cube-network.ts`** (pure): `cubeIpv4Subnet/Gateway/Address(S[,octet])`,
`cubeIpv6Subnet/Gateway/Address(S[,octet])`, `octetOf(ip): number` (base-10).

**`lib/server/bridge-subnets.ts`** — `lowestFreeSubnet(min,max,inUse)` **with an
explicit `> MAX → throw` ceiling** (N-L1 — do NOT blind-copy `lowestFreeUid`, which
has none) + `allocateBridgeSubnet(tx)`. Global allocation: serialize on a single
global advisory lock, new disjoint seed `3` (`pg_advisory_xact_lock(hashtextextended('bridge_subnet_alloc', 3))`
— seeds 0/1/2 confirmed taken at `usage.ts:36,51`, `jailer-uids.ts:59`). Its tx holds
ONLY the seed-3 lock — never `servers FOR UPDATE` (deadlock-order safety, alloc-conc).

**`lib/ssh/network.ts` `allocateInternalIp` (line 244, NOT `lib/server/ports.ts`)**
→ `allocateInternalOctet(existingOctets)`; update the barrel re-export `lib/ssh/index.ts:21`.
**All 5 call sites must build the in-use set as octets** via `octetOf` (N-L2) — mixing
full-IP strings with octets mis-judges "free" across migrated/legacy hosts.

## Host networking — `applyHostNetworking(client, S)`

**`lib/server/cube-network-host.ts`** is the single source for the host bridge, NAT,
and firewall for both families, shared by the setup phase and the retrofit (Rule 14).
The spec REPLACES the entire `server-network.ts` STEPS bridge/NAT/persist block with
this call (M8); `bridge_subnet` MUST be non-null before the network phase runs (see
Allocation §). Steps, each idempotent + `-C`/`grep`-guarded:

1. **Forwarding sysctls in a DEDICATED file** `/etc/sysctl.d/98-krova-forwarding.conf`
   (C2 — NEVER touch `99-krova.conf`): `net.ipv4.ip_forward=1`,
   `net.ipv6.conf.all.forwarding=1`, `net.ipv6.conf.<wan>.accept_ra=2` (H3 — persisted
   here, not just runtime), `net.ipv6.conf.br0.accept_ra=0` (L6). Full-rewrite `>`,
   then `sysctl --system`.
2. **WAN detection (H4):** `ip -6 route show default | grep -oP 'dev \K\S+' | sort -u`
   (iface follows the `dev` token); set `accept_ra=2` on EVERY distinct iface returned;
   **no-op silently when empty** (static host IPv6).
3. **br0 addresses, each guarded INDEPENDENTLY (M9 — not behind `ip link show br0`):**
   `ip -6 addr show dev br0 | grep -q 'fd00:c0be:<S>::1/64' || ip -6 addr add …`; same
   for the v4 `10.<S>.1/24`. Persist both `Address=` lines in `br0.network`.
4. **iptables backend resolution (H1):** resolve BOTH `iptables`/`ip6tables` via the
   same `getIptables`-style resolver (`command -v <bin>-legacy 2>/dev/null || echo <bin>`)
   so v4 + v6 share one backend; the cube-DNAT path (`network.ts`) already prefers
   `iptables-legacy` — `applyHostNetworking` must match it or v6 rules land in the wrong
   table and don't persist.
5. **NAT:** `iptables -t nat POSTROUTING -s 10.<S>.0/24 ! -o br0 MASQUERADE` +
   `ip6tables -t nat POSTROUTING -s fd00:c0be:<S>::/64 ! -o br0 MASQUERADE`.
6. **FORWARD — egress-only over br0 (H_fw / former blanket-ACCEPT downgrade):**
   `-i br0 ! -o br0 ACCEPT` + `-o br0 -m conntrack --ctstate ESTABLISHED,RELATED ACCEPT`
   for BOTH families — NOT a blanket `-o br0 ACCEPT` (that would open unsolicited inbound
   IPv6 to every cube port, bypassing the IPv4 whitelist).
7. **INPUT firewall (Host firewall § — C1/H5).**
8. **QUIC UDP-443 INPUT ACCEPT carried into the helper (N-H1):**
   `iptables -C/-A INPUT -p udp --dport 443 -j ACCEPT` — this rule lives only in the old
   STEPS and would vanish in the refactor.
9. **Persist BOTH families (H1/H2):** Debian → `iptables-save > rules.v4` +
   `ip6tables-save > rules.v6` (or route both through `netfilter-persistent save`);
   RHEL → `/etc/sysconfig/{iptables,ip6tables}` + `systemctl enable iptables` **AND
   `ip6tables` (H2 — the `ip6tables.service` unit is separate and never enabled today)**.
   `ip6tables` ships with the `iptables` package (no new package).

Firecracker config is unchanged (TAP on br0 only).

## Host firewall posture (C1 / H5 — operator chose "best setup")

`applyHostNetworking` installs a **stateful default-deny `INPUT` on both families**,
allow-list-first then policy DROP (order matters — never DROP before the allows):

- `INPUT -i lo ACCEPT`
- `INPUT -m conntrack --ctstate ESTABLISHED,RELATED ACCEPT` (keeps the worker's live
  SSH session up through the change)
- `INPUT -p icmp ACCEPT` (v4) / `INPUT -p ipv6-icmp ACCEPT` (v6 — **mandatory NDP/PMTUD
  or IPv6 breaks**)
- `INPUT -p tcp --dport 2822 ACCEPT` (host SSH — IPv4), `--dport 80/443 ACCEPT`,
  `-p udp --dport 443 ACCEPT` (HTTP/3)
- then `-P INPUT DROP` on both `iptables` and `ip6tables`.

**Retrofit safety net (mirrors bootstrap's sshd rollback):** before flipping policy on
an existing live host, schedule a backgrounded `sleep 60 && iptables -P INPUT ACCEPT &&
ip6tables -P INPUT ACCEPT` that the handler **cancels on success** — so a mistaken
allow-list can't lock the worker out. New servers get the firewall in the `network`
phase. `docs/security/host-hardening.md` is updated to document this posture (and the
misleading "where INPUT policy is DROP" comment at `server-network.ts:51` is removed —
the assumption is now true). This makes the IPv4 posture coherent for the first time.

## Guest-side config — `writeCubeGuestNetworkConfig(client, mountDir, internalIp)`

**Signature is UNCHANGED.** The writer derives `S = subnetOf(internalIp)` (the middle two
octets) + `octet = octetOf(internalIp)` from `internalIp` itself, so there is **no
`bridgeSubnet` param, no `createCube` opts change, and no caller threading** — this
obsoletes L2/L3 and keeps `internalIp` as the single source. (`internalIp` is always the
new-scheme `10.<S>.<octet>` form by the time the writer runs — set by the allocation sites /
the migration before any rewrite.) Add a pure `subnetOf(ip): number` to `cube-network.ts`.

Dual-stack `10-eth0.network` (systemd-networkd accepts repeated `Address=`/`Gateway=` —
verified valid):

```ini
[Network]
Address=10.<hi>.<lo>.<octet>/24
Gateway=10.<hi>.<lo>.1
Address=fd00:c0be:<S>::<octetHex>/64
Gateway=fd00:c0be:<S>::1
DNS=2606:4700:4700::1111
DNS=2001:4860:4860::8888
DNS=1.1.1.1
```

- **v4 gateway = `cubeIpv4Gateway(S)`, NOT literal `10.0.0.1` (H7)** — gated on the same
  `S` as the host br0 v4 address so they cannot drift.
- **`/etc/resolv.conf` write is UNCONDITIONAL inside this helper (H7)** from `CUBE_DNS_SERVERS`
  — so no rootfs-mutating caller can write `.network` without fixing DNS. (resolved is
  off, so resolv.conf is the only DNS source; the `DNS=` lines are otherwise inert.)
- Wipe legacy `/etc/netplan/99-krova.yaml` (unchanged).
- **No caller/opts changes (L2/L3 obsoleted):** because the writer derives everything from
  `internalIp`, the existing 5 callers (`createCube` firecracker.ts:535, cube-from-snapshot:296,
  cube-import-rootfs:343, cube-transfer:544, backup-redeploy:347) need NO signature change —
  they already pass `internalIp`. No `conn.server` capture, no opts field.

**Callers (all 6):** `createCube`, `cube.from-snapshot`, `cube.transfer`,
`backup.redeploy`, `cube.import-rootfs`, **and NEW `snapshot.restore`** — `snapshot-restore.ts`
overwrites the rootfs then `startCube`s with no guest-net rewrite today; post-re-IP a
pre-re-IP snapshot would boot stale `10.0.0.x`. Add a loop-mount + rewrite inside the
existing `withCubeHeartbeat` span (Rule 34) with a guaranteed umount; do NOT rewrite the
`.bak` rollback path (it's the pre-restore live rootfs, already correct).

Update the baked default `build-all-images.sh:865` to the 3 entries.

## Allocation write-sites

At each of the 5 `allocateInternalIp` sites: allocate the octet (octet-keyed in-use
set), then set `internal_ip = cubeIpv4Address(S, octet)` + `internal_ipv6 =
cubeIpv6Address(S, octet)`. **C4 — `cube-boot.ts:164` AND `backup-redeploy.ts:187` must
be wrapped in the same advisory-locked (`hashtext(serverId)`) transaction the other
three already use** (`cube-from-snapshot`/`cube-import-rootfs`/`cube-transfer`) — they
are unlocked today and are the source of the duplicate-IP race. `create-server`
(`app/api/orbit/servers/route.ts:144`) wraps its insert in `db.transaction` and calls
`allocateBridgeSubnet(tx)` so `bridge_subnet` is never null at the network phase (N-M3/H8).

## Address visibility — Orbit-admin-only (decision 6 / M7 / N-H2)

`internal_ip` + `internal_ipv6` are operator-only. Concretely:

- **REMOVE `internalIp` from `buildCubeSummary`** (`lib/webhook-payloads.ts:42,50`) — it
  currently ships to customer webhooks + the v1 create response (`v1/.../cubes/route.ts:285`).
  Do NOT add `internalIpv6` there. Safe to drop outright — no customers consume it.
- **`app/api/v1/openapi.json/route.ts`** already documents `internalIp` + `publicIp`
  which `formatCube` never returns (`v1-cube-format.ts` returns `publicIpv4`). Fix this
  pre-existing lie: drop `internalIp`, rename `publicIp`→`publicIpv4`; do NOT add `internalIpv6`.
- **Add `internal_ipv6` ONLY to the Orbit surfaces** that already show `internal_ip`:
  `app/(orbit)/orbit/cubes/[cubeId]/page.tsx`, `components/cube-detail-sidebar.tsx`
  (the `orbit &&`-gated row), `components/cube-detail-shell.tsx`, `lib/cube-actions/cube-list-create.ts`.
- `docs/api/v1.md:453` example currently shows `"internalIp":"10.0.0.2"` — remove it
  (matches the webhook removal) (Rule 22).

## Port mappings & SSH (IPv4-inbound, re-IP)

- `tcp_port_mappings` stores no IP (only `cube_port`/`host_port`/`allocated_port_id`/`is_ssh`).
  Customer endpoint `connect.<hostname>:<host_port>` unchanged.
- **Re-IP rebuilds ONLY `status='active'` mappings (M1)** — `disabled` had its rule removed
  (re-adding re-exposes a port the customer disabled — security), `pending`/`failed` have
  no rule. For each: `removeTcpPortForward(oldIp,…)` then `addTcpPortForward(newIp,…,cidrsFromDb)`,
  CIDRs re-read from `tcp_mapping_whitelisted_ips`.
- **M2 correction:** the whitelist FORWARD rules do NOT "survive" — `removeTcpPortForward`
  → `clearTcpWhitelist` deletes them; `addTcpPortForward` re-creates from DB. The migration
  MUST pass DB CIDRs.
- **H9 cutover race:** customer port-mapping jobs snapshot `cube.internalIp` into the
  pg-boss payload at enqueue (`ssh-port.ts:129`, `tcp-mapping-{add,enable,disable,update-cube-port}`).
  A job in flight across the cutover re-points DNAT at the OLD IP. Mitigation: the migration
  refuses/​warn-skips a cube with any mapping in a transient state (`pending`/`stopping`),
  and the maintenance window quiesces customer port-mapping mutations on that host.
- Pre-existing (flagged, not fixed here): the per-mapping whitelist DROP is shadowed by the
  blanket br0 FORWARD ACCEPT + a `--dport host_port` vs post-DNAT `cube_port` mismatch, so
  TCP whitelisting is effectively inert today. The egress-only FORWARD (Host networking §6)
  removes the blanket `-o br0 ACCEPT`; a full whitelist-enforcement fix (insert before any
  ACCEPT, match `-d cubeIP --dport cubePort`) is **out of scope** — noted for a follow-up.

## Migration / re-IP procedure (per server, `pnpm cubes:migrate-network [--apply] [--server <id>]`)

Dry-run default; `--apply` commits; `--server` = one host per maintenance window;
per-server concurrency 5; audit-logged; idempotent + resumable (commit-last, derive from
`bridge_subnet`+octet). Refuse fleet-wide `--apply` without `--server`/`--all`.

Per server:

1. Allocate `bridge_subnet = S` (idempotent; legacy host = 0).
2. **Backfill cube rows — `WHERE status <> 'deleted'` (N-H3)** (deleted rows keep their
   `internal_ip` and must be excluded). Compute `internal_ip`/`internal_ipv6` from S + the
   cube's current octet.
3. `applyHostNetworking(client, S)` (br0 dual-homed v4 + v6 during cutover).
4. **Per cube, state-aware (`getCubeStatus`):**
   - **running** → `guestExec`: write dual-stack `.network` + resolv.conf, then
     **`networkctl reload && networkctl reconfigure eth0`** (M6 — bare `reload` does NOT
     re-apply an address change; verify old addr gone before the L2 probe). Rebuild
     `status='active'` port-mapping iptables (M1) + Caddy after commit. Commit row LAST.
   - **powered-off / sleeping-killed / error** (Firecracker dead, rootfs free) →
     loop-mount + rewrite both files inline + rebuild iptables + commit. **C3 — these MUST
     be handled inline, NOT deferred to "next start"** (`startCube` never rewrites guest
     net, so they'd boot stale).
   - **paused** (Firecracker alive, frozen, rootfs held) → **N-C1: SKIP ENTIRELY** — do
     NOT commit the new IP, do NOT re-point host rules; leave the cube fully on the old IP.
     A paused cube woken via `cube.wake` *resumes in place* (never reloads the kernel/eth0),
     so committing its new IP would brick it. Convert it only on a real **cold restart**.
     Add a guard in `cube-wake.ts`: on resume, if the cube's guest config / `internal_ip`
     is stale vs its host's `bridge_subnet`, force the `startCube` cold path instead of
     `PATCH Resumed`.
5. **`server.refresh-caddy` — AWAIT to terminal state, FAIL the per-server run loudly on
   failure (M3 — the queue is `retryLimit:0`; enqueue-and-forget would 502 customer domains).**
   `reconcileCaddyRoutes` re-points every `customDomainRoute` dial to the new IP. **Add
   `If-Match` optimistic concurrency to its PATCH (M4)** so a concurrent `domain.add` forces
   a 412+rebuild instead of a silent route clobber.
6. **Verify** each cube reachable on its new IP (L2 probe); rewrite host-side `ip.txt`
   (L5, operator-display).
7. **Drop legacy br0 v4** once **zero non-deleted cubes on the host still carry a `10.0.0.x`
   `internal_ip`** (M9 predicate) — i.e. no paused cube is still on the old IP. Persist.
8. **Observer crons during the window:** `cube.reachability`/`cube.state-sync` are
   observer-only (safe). **Confirm `server.reconcile` does not email a ghost/orphan alert,
   and `cube.error-recovery-scan` does not race `startCube`, for a mid-cutover cube** — if
   needed, set a short `transfer_state`-style guard or pause those crons per-host during the
   window (reip-deep).

## Jailer interaction (DEFAULT PATH — `JAILER_ENABLED = true` fleet-wide)

⚠️ **As of commit 033b009, `JAILER_ENABLED = true` fleet-wide (empty allowlist) — EVERY
cube is now jailed.** So jailed is not an edge case: the migration's loop-mount + guest-net
rewrite, `ip.txt`, and every host-path resolution MUST go through `cubePaths(id, launchMode)`
(read each cube's `launch_mode`; it will be `jailed`), per the CLAUDE.md jailer rule. Re-IP
still works with **no mechanism change** because of these verified invariants:

- **No `--netns`** — `buildJailerArgs` uses `--new-pid-ns` + cgroup-v2 only, so TAP/br0/NAT/
  the new IPv6 sysctls + `ip6tables` all live in the **host** network namespace → `applyHostNetworking`
  is mode-agnostic; the TAP is created on br0 before `launchJailed`.
- **Octet→TAP/CID stable** in both modes (derive from `internal_ip.split('.').pop()`).
- **Loop-mount hits the canonical inode** `/var/lib/krova/cubes/<id>/rootfs.ext4`, which is
  **hardlinked** into the chroot — writing it is visible to the jailed guest; cold start
  re-hardlinks. Use `cubePaths(id, mode)` for every host path (CLAUDE.md jailer rule).
- **`guestExec` is already mode-aware** (`vsockResolvePrelude` probes both sockets).
- **Paused jailed cube:** same N-C1 skip — for a jailed cube the only safe conversion is a
  cold restart (rebuilds the chroot), never a resume; the loop-mount path is also unavailable
  while paused (inode in use).
- C1's IPv6-INPUT concern applies equally to jailed + bare hosts (cgroup/PID-ns isolation
  does not extend to netfilter).

Add an explicit "jailer unaffected — these invariants" section so an implementer never
touches the chroot.

## Transfer path IPv6 (N-M1 / N-M2)

- Derive BOTH `internal_ip` + `internal_ipv6` from the **single freshly-picked destination
  octet** inside the existing `cube-transfer.ts:453-483` locked tx, reusing the existing
  **OR-filter** (`eq(serverId,dest) OR eq(transferDestinationServerId,dest)`) — NOT the
  jailer-uid union. **Octet is NOT preserved across a transfer** (fresh dest octet); the
  "octet preserved" invariant is re-IP-migration-only — add a comment so no one derives v6
  from the source octet.
- **Rollback v6 (N-M2):** capture `oldInternalIpv6` next to `oldInternalIp` (`:108`); restore
  both in the rollback (`:1284`); set both in the success flip (`:936`) — else a failed
  transfer leaves v6 split-brained on the dead destination + a lingering unique claim.

## Pre-existing bugs fixed here (decision 8)

- **C2 — `99-krova.conf` clobber:** the install phase writes `vm.overcommit_memory`/`vm.swappiness`
  to `99-krova.conf`; the network phase `>`-overwrites it with only `ip_forward`, silently
  dropping the vm tuning on reboot. Fix: move ALL forwarding sysctls to the new
  `98-krova-forwarding.conf`; the network phase no longer touches `99-krova.conf`.
- **C4 — unlocked allocation:** wrap `cube-boot.ts` + `backup-redeploy.ts` IP allocation in
  the advisory-locked tx (see Allocation §). Independent of IPv6 but it's the source of the
  duplicate rows that would block the migration index.

## Verify phase (`server-verify.ts` — Rule 58 / H6 / N-M4)

Add coded CHECKS (critical unless noted): `sysctl -n net.ipv6.conf.all.forwarding == 1`;
`ip -6 addr show br0` contains `fd00:c0be:`; `ip6tables -t nat -S POSTROUTING` has the cube
`/64` MASQUERADE; the **IPv6 INPUT policy baseline** (`ip6tables -S INPUT` head == `-P INPUT DROP`)
— forwarding-on + INPUT-ACCEPT must FAIL; `ss -lun 'sport = :443'` listener present (QUIC,
non-critical) (N-M4); host's own IPv6 default route present (non-critical — v4-only host valid).
**Rule 46:** add `ip6tables:iptables` to the `verify host tools` REQUIRED list in
**`server-install.ts:789`** AND **`scripts/install-host-tools.ts:76`** (NOT `server-verify.ts` —
M5); on RHEL also assert `ip6tables.service` enabled.

## Tests (BLOCKER — decision 9)

`node --test` (zero new deps) + `pnpm test`, table-driven over `cube-network.ts`: the
`S → hi/lo` split, `octet.toString(16)` (10→a, 16→10, 254→fe), subnet/gateway formatting,
`octetOf` (base-10, mixed-subnet inputs), `lowestFreeSubnet` (min, max, exhaustion-throw,
gap-fill). This is the only guardrail on the arithmetic.

## Deploy ordering (Rule 40)

1. `pnpm db:migrate` — add `bridge_subnet` + `internal_ipv6` + the v6 global + transitional
   v4 partial unique indexes (built `CONCURRENTLY` out-of-band). **Backfill the legacy host's
   `bridge_subnet=0` in this migration** (before any allocator is live, H8). Run the **dedup
   preflight** first.
2. Deploy code (new servers/cubes allocate + set both addresses; new cubes dual-stack; setup
   phase applies host networking + firewall; webhooks/v1 drop `internalIp`).
3. `pnpm cubes:migrate-network --server <id> --apply` per host, in maintenance windows.
4. **Finalization migration** — global `UNIQUE(internal_ip)` once the whole fleet is migrated.

## Third-party verification (CLAUDE.md research discipline — do before coding M6/guest cfg)

Fetch CURRENT docs for: systemd-networkd repeated `Address=`/`Gateway=` + `networkctl
reconfigure` live-link semantics; NAT66 PMTUD/ICMPv6 over a ULA with `forwarding=1`;
confirm Cloudflare needs no AAAA. Pin versions in the plan.

## No-regression summary (per the audit's verdict, with all fixes)

Landing page, Cloudflare origin leg, billing, restic/snapshots, custom-domain routing,
SSH, QUIC, host-own IPv6, and host security are all SAFE **with** the fixes above; WITHOUT
them the change regresses host security (C1), host IPv6 on reboot (C2/H2/H3), and bricks
non-running/paused cubes (C3/N-C1). The only intended customer-visible effect is a brief
per-host cutover blip (live SSH + up-to-4h browser-terminal sessions drop, must reopen).

## Files touched (checklist)

- `db/schema/{servers,cubes}.ts` — `bridge_subnet`, `internal_ipv6`, partial unique indexes.
- `db/migrations/*` — main + finalization (db:generate; CONCURRENTLY/IF NOT EXISTS SQL-body edits only).
- `config/platform.ts` — prefixes, subnet range (MIN=1), `CUBE_DNS_SERVERS`.
- `lib/server/cube-network.ts` (new, pure), `lib/server/bridge-subnets.ts` (new, +ceiling),
  `lib/server/cube-network-host.ts` (new — `applyHostNetworking` incl. firewall).
- `lib/ssh/network.ts` (`allocateInternalIp`→`allocateInternalOctet`), `lib/ssh/index.ts` (barrel).
- `lib/worker/handlers/server-network.ts` (STEPS block replaced), `server-verify.ts` (IPv6 + INPUT + QUIC checks).
- `lib/ssh/cube-guest-network.ts` (+`bridgeSubnet`, unconditional resolv.conf, gateway(S)),
  `lib/ssh/firecracker.ts` (`createCube` opts `bridgeSubnet`).
- `lib/worker/cube-boot.ts` + `backup-redeploy.ts` (C4 lock + both addresses),
  `cube-from-snapshot.ts`, `cube-import-rootfs.ts`, `cube-transfer.ts` (+ rollback v6), `snapshot-restore.ts` (new writer).
- `app/api/orbit/servers/route.ts` (tx + `allocateBridgeSubnet`), `lib/worker/handlers/cube-wake.ts` (stale-config cold-restart guard).
- `lib/webhook-payloads.ts` (REMOVE `internalIp`), `app/api/v1/openapi.json/route.ts` (fix lie),
  `lib/api/v1-cube-format.ts` (unchanged — already omits), `docs/api/v1.md` (remove example IP).
- Orbit surfaces: `orbit/cubes/[cubeId]/page.tsx`, `cube-detail-sidebar.tsx`, `cube-detail-shell.tsx`, `cube-list-create.ts` (+`internal_ipv6`).
- `server-install.ts` + `scripts/install-host-tools.ts` (Rule 46 `ip6tables`).
- `setup/images/build-all-images.sh` (resolv.conf), `setup/server/setup-server.sh` (annotate legacy v4+v6 lines 137/138/332/348-350).
- `scripts/migrate-cube-network.ts` (new) + `package.json` (`cubes:migrate-network`, `test`).
- `docs/security/host-hardening.md` (firewall posture), `CLAUDE.md` + `README.md` (Rule 22), `lib/worker/handlers/cube-reachability.ts:73` (cosmetic comment).
- Tests: `*.test.ts` for `cube-network.ts` + allocators.
