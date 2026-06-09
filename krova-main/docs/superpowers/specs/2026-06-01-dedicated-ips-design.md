# Dedicated IPs — design

**Status:** approved design (brainstorm complete) — ready for implementation plan
**Date:** 2026-06-01
**Supersedes:** the earlier skeleton in this file (pool details + decisions now finalized)

## 1. Summary

Give a customer's cube a **dedicated public IPv4 + IPv6** — a true 1:1 static IP
(all inbound to that IP reaches the cube on any port, AND the cube's outbound
traffic egresses from that same IP). Assignment is **operator-only** from Orbit,
**billed hourly** for as long as it's assigned, implemented **purely host-side**
with iptables/ip6tables NAT (no guest changes, works in any cube state).

This is Krova's analogue of an AWS Elastic IP / DigitalOcean reserved IP: the
guest keeps its private internal address; the public IP is NAT'd in + out, and
we surface the public IP to the customer (read-only) so they can point DNS at it.

### Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Behaviour | **True 1:1 static IP** — inbound (all ports) + outbound on the dedicated IP |
| 2 | Families | **IPv4 + IPv6**, both via host-side 1:1 NAT (NAT44 + NAT66) |
| 3 | Control | **Operator-only** from Orbit. No customer self-service, no plan gating (v1) |
| 4 | Billing | **Billed while assigned**, any cube state (running/sleeping/error). Flat hourly rate |
| 5 | Supply | **Block-derive**: paste the provider allocation per server; Krova derives free IPs |
| 6 | Portability | IPs are **statically pinned** to their server — no cross-server move, no provider API |
| 7 | Transfer | **Release + flag for re-assign** — IP returns to the source pool; operator assigns a fresh one on the destination |
| 8 | v6 mechanism | **NAT66 1:1** (host-only), NOT a real GUA on the guest |

### Out of scope (v1)

- Customer self-service / plan-tier gating of dedicated IPs.
- Cross-server IP relocation + any hosting-provider API integration.
- Giving the guest a real routable GUA on `eth0` (we NAT v6 instead).
- More than one dedicated IPv4 (or IPv6) per cube.
- Per-port whitelist / host-side firewall on the dedicated IP (it is intentionally
  all-ports open; the cube's in-guest firewall is the security boundary).
- Scattered, non-contiguous spare IPv4s (the supply model assumes one contiguous
  provider allocation per server; both current servers are clean `/29`s).

## 2. Background — the current networking model

(verified against the codebase 2026-06-01)

- `servers.public_ip` is a single, `notNull` IPv4 ([db/schema/servers.ts:56](../../../db/schema/servers.ts#L56)).
  There is **no** public-IPv6 column and **nothing** for floating / secondary /
  dedicated IPs anywhere.
- Every cube gets a **private, NAT'd** internal IPv4 (`198.18.0.0/15`, derived
  from `servers.bridge_subnet`) and a private ULA IPv6 (`fd00:c0be:<S>::<octet>`).
  Both NAT'd; v6 is currently outbound + DNS only (no inbound v6 at all).
- Inbound to a cube today: a customer reaches `<server public_ip>:<allocated host
  port>` via a port-mapping DNAT rule
  `PREROUTING -p tcp --dport <hostPort> -j DNAT --to <cubeIp>:<cubePort>`
  ([lib/ssh/network.ts:104](../../../lib/ssh/network.ts#L104)). The DNAT has **no
  `-d` match**, so it catches that port on every IP the host holds.
- Outbound: every cube on a server shares the host's primary IP via a shared
  `POSTROUTING -s <v4subnet> ! -o br0 -j MASQUERADE` (and the v6 ULA equivalent),
  set up by `applyHostNetworking` ([lib/server/cube-network-host.ts](../../../lib/server/cube-network-host.ts)).
- The host `FORWARD` policy is **default-ACCEPT** (only `INPUT` is default-DROP) —
  inbound DNAT'd packets pass `FORWARD` and reach `br0`
  ([lib/ssh/network.ts:215-217](../../../lib/ssh/network.ts#L215-L217)). So an
  all-ports 1:1 DNAT needs **no new FORWARD rule**.

This means a dedicated IP is a **purely additive** host-side change: claim the
extra address on the WAN iface, add a `-d <dedicatedIP>` DNAT (all ports) and a
per-cube SNAT (egress), both inserted **ahead of** the shared rules.

## 3. Supply model (block-derive)

The operator pastes the provider's IP-allocation panel onto the server. Real
example (SynergyCP, banana):

```
IP Allocation   167.160.91.120/29
Usable IP(s)    167.160.91.122 - 126
Gateway IP      167.160.91.121
Subnet Mask     255.255.255.248
IPv6 Address    2605:9f80:1000:446::2/64
IPv6 Gateway    2605:9f80:1000:446::1
```

Krova **derives** the assignable set:

- **IPv4 assignable** = `hosts(allocation_cidr) − network − broadcast − gateway −
  public_ip − excludes − already-assigned`.
  banana `167.160.91.120/29` → network `.120`, gateway `.121`, broadcast `.127`,
  primary `.122` ⇒ **`.123 .124 .125 .126` (4 assignable)**.
- **IPv6 assignable** = sequential `::N` from the `/64` (derived from
  `ipv6_address`), skipping gateway (`::1`), host (`::2`), excludes, and
  already-assigned ⇒ **`::3 ::4 ::5 …`**.

mango (`162.251.165.88/29`, gw `.89`, host `.90`; `2605:9f80:1000:21::/64`)
derives `.91–.94` + `::3…` the same way.

### New `servers` columns (all nullable — a server with these unset simply cannot offer dedicated IPs)

| column | type | example | notes |
|--------|------|---------|-------|
| `ipv4_allocation_cidr` | text | `167.160.91.120/29` | provider allocation block |
| `ipv4_gateway` | text | `167.160.91.121` | excluded from assignable; the secondary-addr gateway |
| `ipv6_address` | text | `2605:9f80:1000:446::2/64` | host's own v6; the `/64` block + host-exclude derive from it |
| `ipv6_gateway` | text | `2605:9f80:1000:446::1` | excluded from assignable |
| `dedicated_ip_excludes` | text | `167.160.91.126` | optional comma-separated carve-outs (IPs used outside Krova) |

Primary v4 is the existing `servers.public_ip`. **No new pool table** — v4 and v6
availability are both derived; assignment is tracked on the cube (§4). This is the
key change from the earlier skeleton (which had a `server_dedicated_ips` pool
table): with a clean contiguous allocation per server, derivation is simpler and
self-documenting.

### Validation at save (Orbit server action)

- `public_ip` and `ipv4_gateway` must be inside `ipv4_allocation_cidr`.
- `ipv6_gateway` must be inside the `/64` derived from `ipv6_address`.
- `dedicated_ip_excludes` entries must be valid addresses inside the respective
  block (warn, don't hard-fail, if outside).
- Compute + display the derived assignable list (so the operator sees exactly
  what Krova will hand out, mirroring the provider panel).

## 4. Data model — cube assignment

### New `cubes` columns

| column | type | notes |
|--------|------|-------|
| `dedicated_ipv4` | text, nullable | partial-unique `WHERE dedicated_ipv4 IS NOT NULL AND status <> 'deleted'` |
| `dedicated_ipv6` | text, nullable | partial-unique `WHERE dedicated_ipv6 IS NOT NULL AND status <> 'deleted'` |
| `dedicated_ip_assigned_at` | timestamptz, nullable | when the assignment was made (display/audit) |
| `dedicated_ip_needs_reassign` | boolean, default false | set true by transfer-release; surfaced in Orbit with an "Assign" CTA |

A cube has at most one dedicated v4 and one dedicated v6 (assigned together).
There is no per-cube pool FK — the v4/v6 belong to the cube's current `server_id`
and are validated against that server's derived assignable set.

### Allocation (pure + locked)

Pure helpers in **`lib/server/dedicated-ip.ts`** (single source of truth,
unit-tested — Rule 59):

- `parseIpv4Allocation(cidr, gateway, primaryIp, excludes): string[]` — the
  sorted assignable v4 list (network/broadcast/gateway/primary/excludes removed).
- `ipv6BlockOf(ipv6Address): string` — the `/64` base.
- `nextFreeIpv4(assignable, usedByCubes): string | null`.
- `nextFreeIpv6(block, gateway, hostAddr, excludes, used): string` — lowest free
  `::N` (mirrors `allocateInternalOctet` / `lowestFreeUid`).

Allocation runs inside a **per-server advisory lock** (new disjoint seed `4` —
seeds 0/1/2/3 are taken by `acquireSpaceLock` / per-user / jailer-uid /
bridge-subnet; see [lib/server/jailer-uids.ts](../../../lib/server/jailer-uids.ts)
for the pattern). Read the in-use set (`cubes.dedicated_ipv4/ipv6` for that
server, `status <> 'deleted'`), pick lowest-free, write to the cube row. The
partial-unique indexes are the belt-and-suspenders backstop.

## 5. Host mechanism

New module **`lib/ssh/dedicated-ip.ts`** — uses the **legacy** iptables/ip6tables
backend (`iptables-legacy` / `ip6tables-legacy`, resolved exactly like
[lib/ssh/network.ts](../../../lib/ssh/network.ts) and `cube-network-host.ts`) so
rules land in the same table the cube-DNAT path uses and persist together.
Everything idempotent (`-C` guards; grep-guarded `ip addr`).

WAN iface = the host's default-route device (auto-detected, like
`applyHostNetworking`'s WAN detection). Both families are **on-link** (the
provider gateway lives inside the block), so we claim the address as a secondary
on the WAN iface and NAT to the cube.

### `assignDedicatedIp(client, { wan, v4?, v6?, cubeIpv4, cubeIpv6 })`

**IPv4** (`v4 = { address, prefix }`):
```
ip addr show dev <wan> | grep -qF '<v4>/<prefix>' || ip addr add <v4>/<prefix> dev <wan>
iptables -t nat -C PREROUTING  -d <v4> -j DNAT --to-destination <cubeIpv4> 2>/dev/null \
  || iptables -t nat -I PREROUTING 1 -d <v4> -j DNAT --to-destination <cubeIpv4>
iptables -t nat -C POSTROUTING -s <cubeIpv4> ! -o br0 -j SNAT --to-source <v4> 2>/dev/null \
  || iptables -t nat -I POSTROUTING 1 -s <cubeIpv4> ! -o br0 -j SNAT --to-source <v4>
```

**IPv6** (`v6 = { address }`, ULA target = the cube's `internal_ipv6`):
```
ip -6 addr show dev <wan> | grep -qF '<v6>/64' || ip -6 addr add <v6>/64 dev <wan>
ip6tables -t nat -C PREROUTING  -d <v6> -j DNAT --to-destination <cubeIpv6> 2>/dev/null \
  || ip6tables -t nat -I PREROUTING 1 -d <v6> -j DNAT --to-destination <cubeIpv6>
ip6tables -t nat -C POSTROUTING -s <cubeIpv6> ! -o br0 -j SNAT --to-source <v6> 2>/dev/null \
  || ip6tables -t nat -I POSTROUTING 1 -s <cubeIpv6> ! -o br0 -j SNAT --to-source <v6>
```
then persist (`netfilter-persistent save` / `rules.v4` + `rules.v6`).

**Why `-I … 1` (the key correctness point):**
- The dedicated DNAT `-d <ip>` must precede the shared `--dport <hostPort>` DNATs
  (which have no `-d` match) so a packet to `<dedicatedIP>:<port>` reaches the
  IP's owner cube — while a packet to `<public_ip>:<hostPort>` still hits the
  shared rule for whichever cube owns that host port.
- The per-cube SNAT must precede the shared `-s <v4subnet>/24 … MASQUERADE` (and
  the v6 ULA MASQUERADE) — otherwise egress matches the broad MASQUERADE first
  and leaves from the host's primary IP instead of the dedicated IP.
- No new `FORWARD` rule needed — inbound post-DNAT passes the default-ACCEPT
  `FORWARD` policy, same as the shared port-mapping path.

### `unassignDedicatedIp(client, { wan, v4?, v6?, cubeIpv4, cubeIpv6 })`

Idempotent `-C && -D` of the DNAT + SNAT (both families), then
`ip addr del <v4>/<prefix> dev <wan>` / `ip -6 addr del <v6>/64 dev <wan>`, then
persist. Safe to call when rules are already absent.

### Persistence & reboot

`netfilter-persistent save` persists the iptables rules across reboot, but the
**secondary `ip addr` does not** (it's runtime-only). Therefore the host rules
are **re-asserted on every cube (re)start** — `cube.provision`, `cube.wake`,
`cube.cold-restart`, `cube.auto-relaunch`, and **`server.reboot-recovery`** call
`assignDedicatedIp` for the cube if it has a dedicated IP (idempotent). After a
host reboot, a cube and its dedicated IP come back together in reboot-recovery.
Sleeping cubes don't need live host rules (no VM to receive traffic) — they're
re-applied on wake.

## 6. Billing

- New `platform_settings.dedicated_ip_rate_per_month` — `numeric(12, 6)`, default
  e.g. `"4.00"`, operator-tunable in Orbit → Platform settings (mirrors
  `backup_storage_rate_per_gb_per_month` shape at
  [db/schema/platform-settings.ts:81](../../../db/schema/platform-settings.ts#L81)).
  One rate per assigned cube (v6 bundled with v4; a single knob in v1).
- New billing-event type **`dedicated_ip_charge`** added to the
  `billing_event_type` pgEnum ([db/schema/billing.ts:14](../../../db/schema/billing.ts#L14)),
  to `BILLING_DEBIT_TYPES` ([lib/billing-events.ts](../../../lib/billing-events.ts) —
  Rule 54), and (deriving from the pgEnum) it flows automatically into
  `lib/status-display.ts` (Rule 44).
- New pass in [lib/worker/handlers/billing-hourly.ts](../../../lib/worker/handlers/billing-hourly.ts),
  modeled on the **sleep-storage pass** (the always-on, state-independent
  pattern at `billing-hourly.ts:~1184`): for every cube with
  `dedicated_ipv4 IS NOT NULL OR dedicated_ipv6 IS NOT NULL` (any status except
  `deleted`), charge `rate / 730` for the tick, routed through
  `applyOverageCascadeTx` (prepaid → overage → refused), writing a
  `dedicated_ip_charge` `billing_events` row + a `billing.dedicated_ip_charge`
  audit row. A refused charge participates in the same auto-sleep / zero-balance
  path as the other passes.
  - Flat per-tick (no prorated-on-unassign charge) — consistent with
    sleep-storage; amounts are small and the cron hour-cap (Rule 55) is N/A for a
    flat per-tick rate.
- Burn-rate: [lib/billing.ts](../../../lib/billing.ts) `getSpaceBurnRate` gains a
  5th pillar (`dedicatedIp`) so the customer's runway projection matches what the
  worker actually charges; the billing page renders the pillar.

## 7. Lifecycle

| Event | Action |
|-------|--------|
| **Assign** (Orbit) | per-server-locked tx: allocate v4 + v6, write cube columns + `assigned_at`, clear `needs_reassign`; enqueue a worker job to apply host rules; lifecycle + audit log |
| **Unassign** (Orbit) | worker removes host rules; clear cube columns; billing stops (no columns → not charged); lifecycle + audit log |
| **Cube (re)start** | `assignDedicatedIp` re-asserted (idempotent) — provision / wake / cold-restart / auto-relaunch / reboot-recovery |
| **Cube delete** | unassign host rules + clear columns as part of delete cleanup; IP returns to the derived pool |
| **Transfer** | in the **source-teardown phase, after destination cutover**: remove host rules on the source, clear cube columns, set `needs_reassign = true`, stop billing, lifecycle-log "dedicated IP released — re-assign on <dest>". A **pre-cutover** transfer failure leaves the assignment untouched. Release is hoisted to top level (not nested under an unrelated guard) per **Rule 57** |
| **Server pool edit** | shrinking/removing an allocation that still has assigned IPs is refused (or warns) — never silently strand a live cube's IP |

All worker host-side ops go through pg-boss jobs, never inline in routes (Rule 1).
A new `dedicated-ip.apply` / `dedicated-ip.remove` job (or fold into existing cube
jobs) — decided in the plan; must have an explicit `QUEUE_OPTIONS` entry (Rule 56)
and a guarded SSH connect with Rule-58 preflight.

## 8. Orbit UI (operator)

- **Server detail → "Dedicated IPs" section** (new): form to paste/edit the
  allocation fields (v4 CIDR + gateway, v6 address + gateway, excludes); a
  read-only **derived availability** list (assignable + which cube holds each
  assigned IP), mirroring the provider panel.
- **Orbit cube detail → "Dedicated IP" card** (new): Assign (allocates lowest-free
  v4 + v6 from the cube's server) / Unassign; shows the assigned addresses; shows
  the `needs_reassign` flag (after a transfer) with an **Assign** CTA. Atomic
  claim guards against double-assign. Refuse assign when the server has no free v4
  or no allocation configured.

## 9. Customer visibility + security

- **Customer cube detail** shows the assigned **public** IPv4 + IPv6 **read-only**
  (they need them to set DNS A/AAAA and to connect directly on 22/80/443). Unlike
  `internal_ip` (operator-only, dropped from the summary), the dedicated public IP
  is meant for the customer.
- Add `dedicatedIpv4` / `dedicatedIpv6` to `buildCubeSummary`
  ([lib/webhook-payloads.ts](../../../lib/webhook-payloads.ts)) → flows into the
  v1 API cube payload and outbound `cube.*` webhooks.
- **Security:** the dedicated IP exposes **all ports** of the cube to the internet
  (no host-side whitelist — that's the point of a static IP). The cube's own
  in-guest firewall is the boundary. Documented in
  [docs/security/shared-responsibility.md](../../security/shared-responsibility.md),
  with a one-line warning in both the Orbit assign UI and the customer cube detail
  ("All ports of this cube are reachable on its dedicated IP — secure it with your
  in-guest firewall").

## 10. Edge cases & invariants

- **Uniqueness** — a dedicated v4/v6 is assigned to at most one cube (partial-
  unique indexes + per-server advisory-lock allocation).
- **Idempotent host helpers** — `-C` guards + grep-guarded `ip addr`; safe under
  pg-boss at-least-once retries (Rule 7).
- **Legacy backend** — match the cube-DNAT path or rules don't persist (the
  2026-05-30 v6-persist lesson in `cube-network-host.ts`).
- **Rule 58 preflight** — validate (server has allocation, free IP exists, cube on
  an active server, cube `transferState='idle'`) BEFORE any host side effect;
  guarded SSH connect.
- **Server config change** — never hand out the host's own primary v4/v6 or the
  gateway; never strand an assigned IP by editing the allocation out from under it.
- **`needs_reassign`** is informational only — it never blocks the cube; it drives
  an Orbit badge + CTA.

## 11. Testing (Rule 59)

- **Unit (`pnpm test`)** — `lib/server/dedicated-ip.ts` derivation (banana/mango
  fixtures: `/29` → 4 assignable, gateway/primary/broadcast excluded; `/64` v6
  suffix allocation skipping `::1`/`::2`/excludes); host-rule **arg builders** in
  `lib/ssh/dedicated-ip.ts` asserting the exact `-I PREROUTING 1 -d … DNAT` and
  `-I POSTROUTING 1 -s … SNAT` strings + insertion order for both families;
  billing math (`rate/730`); `BILLING_DEBIT_TYPES` includes `dedicated_ip_charge`;
  burn-rate pillar.
- **Integration (`pnpm test:integration`)** — per-server-locked allocation under
  contention (no double-assign), assign writes columns + clears `needs_reassign`,
  unassign clears columns, transfer-release frees + flags + stops billing,
  partial-unique indexes enforced, cube-delete cleanup, billing pass charges a
  dedicated-IP cube in `sleeping`/`error` state.
- **Host smoke (manual, pre-release)** — real `ip addr` + iptables/ip6tables on a
  dev host (rule ordering, persistence across a reboot, in/out from the dedicated
  IP). Not in `test:all`.
- `pnpm test:all` green before "done".

## 12. Migration & rollout (Rule 6, Rule 40)

- One additive migration via `pnpm db:generate`: new nullable `servers` columns,
  new nullable `cubes` columns + two partial-unique indexes, new
  `platform_settings.dedicated_ip_rate_per_month` (default), and the
  `billing_event_type` enum value `dedicated_ip_charge` (`ALTER TYPE … ADD VALUE`,
  additive). All additive/non-locking; `pnpm test:migrations` after generate.
- Deploy order: migrate → deploy code (Rule 40). The feature is inert until an
  operator fills a server's allocation fields and assigns an IP.
- No fleet backfill — existing cubes have null dedicated columns and behave
  exactly as today.
