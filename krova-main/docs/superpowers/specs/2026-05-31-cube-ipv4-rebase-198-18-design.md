# Cube internal IPv4 rebase: `10.0.0.0/8` → `198.18.0.0/15`

**Date:** 2026-05-31
**Status:** Design — approved for spec; pending implementation plan
**Author:** brainstormed with the operator (rohit) following the 2026-05-30/31 Docker-Swarm collision incident

## Summary

Move every cube's **internal IPv4** off `10.0.0.0/8` onto **`198.18.0.0/15`**, keeping the dual-stack model (IPv6 `fd00:c0be:<S>::/64` is **unchanged**) and the per-server `bridge_subnet` (S) scheme. This is a **full-fleet re-IP** to a clean end state. It eliminates the class of failure where a cube's own `eth0` subnet collides with the IPv4 ranges that customer software (Docker Swarm overlays, Kubernetes, etc.) uses *inside* the cube.

## Problem (proven root cause)

Krova's current scheme puts each cube on `10.<S>>8>.<S&0xff>.<octet>/24` — i.e. inside `10.0.0.0/8`. Docker Swarm's default overlay/ingress address pool is **also `10.0.0.0/8`** (carved into `/24`s: ingress `10.0.0.0/24`, first user overlay `10.0.1.0/24`, …), and Kubernetes/k3s/Cilium default their pod/service CIDRs into `10.x` as well.

When a Docker overlay subnet equals the cube's own `eth0` subnet (observed live: a Dokploy cube on `eth0 10.0.1.16/24` whose `dokploy-network` overlay was allocated the identical `10.0.1.0/24`), the container's reply to any client whose IP falls in that subnet — including the cube's own gateway `10.0.1.1` (the host's `br0`, which is what Caddy connects from) — routes **into the overlay** instead of back out. The reply is lost; external/proxy access to the container times out, while a plain non-overlay process on the same port works. **Verified live:** on the same cube, a throwaway overlay on the non-colliding `172.31.0.0/24` was reachable via the `eth0`→DNAT path (`200`) where the `10.0.1.0/24` overlay was not (`000`); moving the cube's overlays off `10/8` (`172.20.x`) made `eth0:3000` reachable (`307`) immediately.

The collision is structural: **any** cube subnet inside `10.0.0.0/8` will eventually be hit by a customer's Docker/k8s network. The fix is to move the cube's internal IPv4 out of `10.0.0.0/8` entirely.

## Decision

- **Range:** cubes move to **`198.18.0.0/15`**.
- **Dual-stack retained:** IPv4 (new range) + IPv6 (`fd00:c0be:<S>::/64`, unchanged). IPv6-only was considered and rejected (would require NAT64/DNS64 for IPv4-only egress + a userspace IPv4→IPv6 proxy for raw-TCP inbound — more moving parts than it removes; see Out of scope).
- **Per-server scheme retained:** `bridge_subnet` S still drives both address families; globally-unique-per-cube IPv4 is preserved (just off `10/8`).
- **Rollout = ATOMIC, worker-quiesced cutover (revised 2026-05-31).** A single conversion command re-IPs the **entire** fleet to `198.18` — every server + **every** cube, including **force-converting paused (frozen-RAM) cubes** (power off → loop-mount re-IP → leave powered-off; they cold-boot on next wake, disk intact). It runs with the **worker stopped**, so no runtime path ever meets a `10.x` cube. After it reports **zero `10.x` / zero null `bridge_subnet`**, the legacy code is genuinely dead and is removed in the same change — the runtime becomes **`198.18`-only with fail-loud guards** (a stray un-converted `10.x` surfaces a clear actionable error, never a silent break or crash-loop). This replaces the original "host-by-host transition" idea, which the implementation review showed would require permanent dual-scheme code across the whole fleet's runtime callers; the atomic cutover is cleaner (no legacy cruft) and safe (exhaustive forced conversion + fail-loud guards).
- **No per-space isolation:** explicitly out of scope (a customer's cubes can span multiple servers, so a per-space internal network has little value without a heavy cross-server overlay — YAGNI).

### Why the atomic cutover (vs host-by-host transition-aware code)

The first implementation pass exposed the real hazard: changing the shared primitives — `subnetOf()` now THROWS on any non-`198.18` address, and `cubeIpv4Address(0,…)` now means `198.18.0.x` instead of the legacy `10.0.0.x` fallback — breaks **fleet-wide runtime callers** the moment they meet a `10.x` cube during a migration window. A host-by-host rollout would therefore need permanent dual-scheme support in every caller (a legacy guest-config writer, dual `subnetOf`, dual provisioning). Instead we eliminate the window: stop the worker, convert everything at once (including paused cubes), verify zero `10.x`, restart. No runtime path ever sees a mixed state, so the code stays clean `198.18`-only.

### Complete list of affected runtime callers (audited 2026-05-31 — none may be left unhandled)

- `subnetOf()` callers: `lib/ssh/cube-guest-network.ts:49` (the chokepoint — every guest-net write: createCube, snapshot-restore, cube-from-snapshot, import, transfer, redeploy, reip), `lib/worker/handlers/cube-wake.ts:105`, `lib/worker/handlers/cube-error-recovery-scan.ts:71` (already guarded), `scripts/migrate-cube-network.ts` (the conversion tool).
- `cubeIpv4Address(S ?? 0, octet)` legacy-fallback provisioning: `lib/worker/cube-boot.ts:200`, `lib/worker/handlers/cube-from-snapshot.ts:195`, `lib/worker/handlers/cube-import-rootfs.ts:219`, `lib/worker/handlers/cube-transfer.ts:505`, `lib/worker/handlers/backup-redeploy.ts:223`.
- Vestigial migration logic to retire: `cube-wake.ts` cold-convert-on-wake (the skip-paused convert path), `reip.ts` `isLegacyIp` (kept only as a conversion-tool helper), the migration script's `skip-paused` + legacy-`br0`-drop.

## Why `198.18.0.0/15` (the range choice)

**There is no conflict-free IPv4 range.** Deep research (IANA IPv4 Special-Purpose Registry, RFCs, moby source, k8s/CNI/VPN docs, adversarially verified) confirmed that every sizable block is *some* tool's default:

| Range | Disqualifier |
|---|---|
| `10.0.0.0/8` | Docker Swarm overlay pool; Cilium cluster-pool; k3s `10.42/10.43`; kubeadm `10.96/12` — **the live bug** |
| `172.16.0.0/12` | Docker `docker0`/`gwbridge` + local IPAM pool; Calico roams `172.16–172.31` |
| `192.168.0.0/16` | Docker secondary local pool; Calico effective default; ubiquitous home/office LANs |
| `100.64.0.0/10` (CGNAT) | **Tailscale/headscale** assign every node from this block, and hard-route the whole `/10` — common on cloud servers, **not** easily escapable |
| `240.0.0.0/4` (Class E) | `Reserved-by-Protocol = True`; rejected by Windows/non-Linux stacks and many IP-validation libraries |
| `198.51.100/24`, `203.0.113/24`, `192.0.2/24` (TEST-NET) | `Forwardable = False`; only one `/24` each (1 server) — too small |

So the decision is a **risk trade-off**, not a search for a clean range. `198.18.0.0/15` (RFC 2544 benchmarking) is the **lowest realistic risk for Krova's workloads**:

- **The "benchmarking reserved" label is harmless here.** IANA marks `198.18.0.0/15` `Forwardable = True, Reserved-by-Protocol = False` — the same load-bearing properties as RFC 1918. No kernel/stack special-cases it; it is fully usable on Linux/systemd-networkd/iptables for a bridged + NAT'd internal network, and egress is NAT'd so the range never appears on the public internet.
- **Its one real collision is narrow and rare for our use case.** `198.18.0.0/15` is the default **Fake-IP** range for the Clash / Mihomo / sing-box / Surge TUN-mode proxy family. But Fake-IP only triggers in **TUN mode** (a personal-device/transparent-proxy pattern) — uncommon on a *production cloud server* (a proxy *exit node* doesn't use Fake-IP). And if a customer ever hits it, the fix is a **one-line `fake-ip-range` / `inet4_range` change on their side**.
- By contrast the alternatives' residual risks (`100.64/10` Tailscale, `240/4` library rejection) are both **more common** on cloud servers **and harder to escape**.

**Residual-risk hedge:** the range is expressed as a **config constant**, so if a specific customer ever collides, the operator can relocate that one server's cubes without a code change.

> Honest caveat captured at design time: this is *lowest-risk*, not *zero-risk* — IPv4 cannot offer zero. The operator accepted this trade-off.

## Addressing scheme

`198.18.0.0/15` = `198.18.0.0`–`198.19.255.255` = **512 `/24`s**.

- Per-server subnet `S` maps to the S-th `/24`: subnet base = `198.18.0.0 + S×256`, i.e. `198.<18 + (S>>8)>.<S&0xff>.0/24`.
- `S ∈ [1, 511]` (reserve `S=0`), gateway `= base + 1`, cube host octets `2–254`.
- **Capacity: 511 servers × 253 cubes ≈ 129k cubes; spaces unlimited.** Far beyond foreseeable scale for a bare-metal fleet. (Headroom note: if Krova ever approaches 511 servers, options are a smaller per-server block — `/25` → 1024 servers — or a second range; neither needed now.)
- **IPv6 unchanged:** `fd00:c0be:<S>::/64`, suffix = the cube's host octet (hex). S is now capped at 511 by the IPv4 range (was `0xffff`); IPv6 simply uses the same capped S.
- **Globally-unique-per-cube IPv4 preserved** (operator-only; not customer-exposed, per existing policy).

### Math change (single source of truth: `lib/server/cube-network.ts`)

The current octet-concatenation (`${CUBE_IPV4_PREFIX}.${hi}.${lo}.${octet}` with `CUBE_IPV4_PREFIX="10"`) is replaced by **base + offset integer math** so the range is expressed cleanly and is relocatable:

- `cubeIpv4Address(S, octet)` = `intToIp(ipToInt(CUBE_IPV4_BASE) + S*256 + octet)`
- `cubeIpv4Subnet(S)` / `cubeIpv4Gateway(S)` derive from the same base.
- `subnetOf(ip)` = `(ipToInt(ip) - ipToInt(CUBE_IPV4_BASE)) >> 8`; `octetOf(ip)` = last octet (unchanged).
- IPv6 helpers (`cubeIpv6Address/Subnet/Gateway`) **unchanged** (use S directly).
- The `S=0 reproduces legacy 10.0.0.x` special-case is **removed** (no `10.x` cube survives the migration).

## Host networking

`applyHostNetworking(client, S, …)` already derives **every** address from S via `cube-network.ts`, so once the IPv4 math points at `198.18`, the host side follows automatically with no logic change:

- `br0` IPv4 gateway → `198.<…>.1/24`; IPv4 MASQUERADE/NAT on the new subnet; IPv4 forwarding sysctls — all derived.
- The default-deny INPUT firewall, egress-only FORWARD, NAT66/IPv6, the dedicated `98-krova-forwarding.conf`, and `bridge_subnet` allocation are **unchanged**.

## Migration (full-fleet re-IP)

Reuse the existing `pnpm cubes:migrate-network` per-server cutover, **retargeted `10.x → 198.18.x`** (the prior `; &&` sysctl bug is already fixed). Per server:

1. Re-apply host networking on the new subnet (`br0` + NAT + firewall).
2. Re-IP each cube: **running** → in-guest `networkctl reconfigure`; **stopped/error** → loop-mount rewrite; **paused** → **skip** (converts on its next cold wake — a resume must not reload a new IP).
3. Rebuild `status='active'` port-mapping DNAT against the new IP + refresh Caddy routes.
4. New cubes provision on `198.18` immediately once the config lands.

**⚠️ Key consequence — in-guest cluster software (call out prominently):** re-IPing a cube that runs **Docker Swarm / k8s** breaks its in-guest **advertise-addr / node IP** (the exact symptom from this incident — the cluster pins the old IP). The *end state is clean* — once on `198.18`, a normal `docker swarm init` uses the default `10/8` pool with **zero collision** — but each affected swarm/k8s cube needs a **one-time post-re-IP recovery** (`docker swarm init --force-new-cluster --advertise-addr <new IP>` for Dokploy/swarm; equivalent for k8s). Krova cannot reliably auto-fix in-guest cluster state, so the migration must **detect swarm/k8s cubes and surface the recovery step** (do not silently auto-run it). This per-cube disruption is the price of the clean full-fleet end state — flagged here for the plan and for the operator's final acceptance.

**Interim:** until a given server is migrated, the proven per-cube workaround (`DOCKER_SWARM_INIT_ARGS="--default-addr-pool …"` at Dokploy install) keeps affected swarm cubes working; it becomes unnecessary once the cube is on `198.18`.

**Transition correctness:** during migration the fleet is mixed (`10.x` + `198.18.x`). The new `subnetOf()` parses against the `198.18` base, so the migration must compute new IPs explicitly from the old ones and **not** round-trip `10.x` addresses through the new parser. (Implementation detail for the plan.)

## Code touch points

- `config/platform.ts` — replace `CUBE_IPV4_PREFIX="10"` with `CUBE_IPV4_BASE="198.18.0.0"`; set `CUBE_BRIDGE_SUBNET_MAX = 511` (was `0xffff`); `CUBE_BRIDGE_SUBNET_MIN` stays `1`.
- `lib/server/cube-network.ts` — IPv4 math → base+offset (above); drop the S=0 legacy comment; IPv6 helpers unchanged.
- `lib/server/cube-network.test.ts` — update expected addresses for the new base.
- `scripts/migrate-cube-network.ts` — retarget `10.x → 198.18.x`; add swarm/k8s detection + the surfaced recovery step.
- `applyHostNetworking` (`lib/server/cube-network-host.ts`) — no logic change (follows the math); add to the shell-syntax test guard if any new command strings appear.
- Docs + `CLAUDE.md` (Rule 22) — document the range, the rationale, the residual Clash/sing-box caveat + the operator escape-hatch, and the new capacity ceiling.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Clash/sing-box TUN-mode customer collides with `198.18/15` | Rare on production servers; one-line `fake-ip-range` fix; range is a config constant so the operator can relocate a server. Documented. |
| Full-fleet re-IP breaks in-guest Swarm/k8s advertise-addr | Migration detects + surfaces the one-time `force-new-cluster` recovery; interim per-cube workaround keeps cubes up until migrated. |
| Capacity ceiling 511 servers | Far beyond foreseeable scale; `/25`-per-server or a second range available if ever needed. |
| Mixed-scheme parsing during migration | Migration computes new IPs from old explicitly; never round-trips `10.x` through the `198.18`-based parser. |

## Out of scope

- **Per-space isolation / private networks** — dropped (overkill; cubes span servers).
- **IPv6 changes** — none; `fd00:c0be:<S>::/64` is retained as-is.
- **IPv6-only internal** — rejected (NAT64/DNS64 + userspace TCP proxy burden; IPv4-literal breakage).
- **The `DOCKER_SWARM_INIT_ARGS` per-customer workaround** — superseded by the rebase (kept only as an interim during migration).

## Success criteria / verification

- A freshly-provisioned cube boots on `198.18.x`; reachable via Caddy (HTTP) **and** raw-TCP port mappings.
- A Docker Swarm / Dokploy install on a `198.18` cube works with Docker's **default** `10/8` overlay pool — **no collision, no customer config** (reproduce the live proof: `eth0:<port>` returns the app, not a timeout).
- Plain (non-overlay) services still work (regression check).
- Every existing cube migrated to `198.18`; no `10.x` internal IP remains; IPv6 unchanged.
- `pnpm test` (cube-network unit tests), `pnpm typecheck`, `pnpm lint`, `bash -n setup/images/build-all-images.sh` green.

## References

- Live root-cause diagnosis + the `172.31` vs `10.0.1` overlay proof (2026-05-30/31 incident, this session).
- Range research (adversarially verified): IANA IPv4 Special-Purpose Registry; moby `libnetwork/ipamutils` default pools; k3s `10.42/10.43`, kubeadm `10.96/12`, Cilium `10/8`, Calico `192.168/172.16`; Tailscale `100.64/10`; Clash/Mihomo `fake-ip-range 198.18.0.1/16`, sing-box FakeIP `inet4_range 198.18.0.0/15`; Google Cloud Class-E Windows caveat.
