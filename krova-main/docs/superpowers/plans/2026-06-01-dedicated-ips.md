# Dedicated IPs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator assign a customer's cube a dedicated public IPv4 + IPv6 (true 1:1 static IP, in + out, all ports), billed hourly while assigned, implemented purely host-side with iptables/ip6tables NAT.

**Architecture:** Per server, the operator pastes the provider's IP allocation (a `/29` v4 block + gateway, a `/64` v6 + gateway); Krova **derives** the assignable addresses (no pool table). Assignment is tracked on the cube (`dedicated_ipv4` / `dedicated_ipv6`) under a per-server advisory lock, applied to the host by a pg-boss worker job that aliases the address on the WAN NIC and inserts a `-d <ip> DNAT` (inbound, all ports) + a per-cube `SNAT` (egress) **ahead of** the shared NAT rules. Billed every hour while assigned (any cube state) via a new pass in `billing-hourly.ts`. Transfer releases the IP back to the source and flags the cube for re-assign.

**Tech Stack:** PostgreSQL + Drizzle ORM, pg-boss worker, `ssh2` host exec, Next.js 16 App Router (Orbit + customer UI), `node:test` (unit) + DB-backed integration tests.

**Spec:** [docs/superpowers/specs/2026-06-01-dedicated-ips-design.md](../specs/2026-06-01-dedicated-ips-design.md)

---

## Pre-flight read (do this once before Task 1)

Read these so the edits land in the right place with the right conventions:

- Spec: [docs/superpowers/specs/2026-06-01-dedicated-ips-design.md](../specs/2026-06-01-dedicated-ips-design.md)
- Pure-helper + test pattern: [lib/server/cube-network.ts](../../../lib/server/cube-network.ts), [lib/server/cube-network.test.ts](../../../lib/server/cube-network.test.ts)
- Advisory-lock allocation pattern: [lib/server/jailer-uids.ts](../../../lib/server/jailer-uids.ts) (`pg_advisory_xact_lock(hashtextextended('jailer_uid:<id>', 2))`; we use seed **4**, namespace `dedicated_ip:<id>`)
- Host iptables pattern (idempotent `-C` guards, legacy backend): [lib/ssh/network.ts](../../../lib/ssh/network.ts), [lib/server/cube-network-host.ts](../../../lib/server/cube-network-host.ts)
- Worker wiring: [lib/worker/job-types.ts](../../../lib/worker/job-types.ts) (`JOB_NAMES`), [lib/worker/ensure-queues.ts](../../../lib/worker/ensure-queues.ts) (`QUEUE_OPTIONS` — Rule 56 full record), [lib/worker/boss.ts](../../../lib/worker/boss.ts) (`workMonitored`), [lib/worker/enqueue.ts](../../../lib/worker/enqueue.ts) (`enqueueJob`)
- Billing pass to mirror: [lib/worker/handlers/billing-hourly.ts](../../../lib/worker/handlers/billing-hourly.ts) sleep-storage pass (~line 1180), `applyOverageCascadeTx`, `getSpacePlanRowTx`, `getSpaceOverridesTx`, `effectiveLimits`
- Billing classification: [lib/billing-events.ts](../../../lib/billing-events.ts) (`BILLING_DEBIT_TYPES`); burn rate: [lib/billing.ts](../../../lib/billing.ts) `getSpaceBurnRate`
- Settings: [lib/platform-settings/index.ts](../../../lib/platform-settings/index.ts), [app/actions/orbit-platform-settings.ts](../../../app/actions/orbit-platform-settings.ts), [app/(orbit)/orbit/platform-settings/_components/platform-settings-form.tsx](../../../app/(orbit)/orbit/platform-settings/_components/platform-settings-form.tsx)
- Cube summary: [lib/webhook-payloads.ts](../../../lib/webhook-payloads.ts) `buildCubeSummary`; v1 cube route: [app/api/v1/spaces/[spaceId]/cubes/[cubeId]/route.ts](../../../app/api/v1/spaces/[spaceId]/cubes/[cubeId]/route.ts)
- Lifecycle hooks: [lib/worker/handlers/cube-transfer.ts](../../../lib/worker/handlers/cube-transfer.ts) (source teardown), [lib/worker/handlers/server-reboot-recovery.ts](../../../lib/worker/handlers/server-reboot-recovery.ts), [lib/worker/handlers/cube-delete.ts](../../../lib/worker/handlers/cube-delete.ts)

## Conventions for every task

- **TDD where there is logic:** write the test, run it red, implement, run it green, commit. Pure helpers, arg builders, and billing math are all test-first.
- **Commit after every task** (frequent commits). Commit message style: `feat(dedicated-ip): <what>`. End worker/commit messages without trailers unless the repo asks.
- **Run `pnpm typecheck` before committing any TS edit.** Run `pnpm lint` before committing.
- **Drizzle only** — no raw `sql` except DDL / advisory locks (Rule 4).
- **Never hardcode an IP, prefix, or gateway** outside the helpers (mirror Rule on `cube-network.ts`).
- Final gate (end of plan): `pnpm test:all` green + `pnpm test:migrations` green.

## Risks this plan explicitly defends against

1. **Rule ordering** — a per-cube `SNAT`/`DNAT` appended *after* the shared `MASQUERADE`/`--dport` rules silently does nothing. Every insert uses `-I <chain> 1`. Unit-tested in Task 3.
2. **Persistence across reboot** — iptables persists (`netfilter-persistent`), the secondary `ip addr` does NOT → re-asserted on every cube (re)start incl. reboot-recovery (Task 14–15).
3. **Double-assign race** — per-server advisory lock + partial-unique indexes (Task 1, Task 2).
4. **Host-down stranding** — guarded SSH connect + Rule-58 preflight in the apply handler (Task 11).
5. **Transfer leaves a dangling IP** — release hoisted to top level in source teardown (Rule 57), billing stops, cube flagged (Task 16).
6. **Billing leak** — flat per-tick charge routed through `applyOverageCascadeTx` like sleep-storage; classified as a debit (Rule 54). Tested in Task 13.
7. **Stranding an assigned IP via a server-config edit** — the server pool action refuses to remove an allocation that still has assigned cubes (Task 17).
8. **Migration safety** — one additive migration via `pnpm db:generate` (Rule 6); all columns nullable / defaulted; enum value added with `ALTER TYPE … ADD VALUE` (Rule 40).

---

## Phase 0 — Schema & migration

### Task 1: Add schema columns, indexes, settings column, and the billing enum value

**Files:**
- Modify: `db/schema/servers.ts` (add 5 columns)
- Modify: `db/schema/cubes.ts` (add 4 columns + 2 partial-unique indexes)
- Modify: `db/schema/platform-settings.ts` (add `dedicatedIpRatePerMonth`)
- Modify: `db/schema/billing.ts` (add `dedicated_ip_charge` enum value)
- Generate: `db/migrations/<NNNN>_*.sql` (via `pnpm db:generate`)

- [ ] **Step 1: Add `servers` columns.** In `db/schema/servers.ts`, inside the `servers` table object, after the `bridgeSubnet` column (around line 127), add:

```ts
    /**
     * Dedicated-IP supply (block-derive). Operator pastes the provider IP
     * allocation; assignable addresses are DERIVED (no pool table) — see
     * lib/server/dedicated-ip.ts. All nullable: a server with these unset
     * cannot offer dedicated IPs. v4 primary = `public_ip`.
     */
    ipv4AllocationCidr: text("ipv4_allocation_cidr"),
    ipv4Gateway: text("ipv4_gateway"),
    /** The host's own /64 v6 address, e.g. `2605:9f80:1000:446::2/64`. The
     * /64 block + the host-exclude derive from it. */
    ipv6Address: text("ipv6_address"),
    ipv6Gateway: text("ipv6_gateway"),
    /** Optional comma-separated addresses to exclude from assignment (IPs the
     * operator uses outside Krova). */
    dedicatedIpExcludes: text("dedicated_ip_excludes"),
```

- [ ] **Step 2: Add `cubes` columns.** In `db/schema/cubes.ts`, inside the `cubes` table object, after `internalIpv6` (around line 103), add:

```ts
    /**
     * Operator-assigned dedicated public IPv4 / IPv6 (1:1 NAT, in + out, all
     * ports). Belong to the cube's current server (statically pinned). Billed
     * hourly while assigned (any cube state) — see billing-hourly.ts. Released
     * + re-flagged on cross-server transfer. Both partial-unique below.
     */
    dedicatedIpv4: text("dedicated_ipv4"),
    dedicatedIpv6: text("dedicated_ipv6"),
    dedicatedIpAssignedAt: timestamp("dedicated_ip_assigned_at", {
      withTimezone: true,
    }),
    /** Set true by transfer-release; surfaced in Orbit with an "Assign" CTA.
     * Informational only — never blocks the cube. */
    dedicatedIpNeedsReassign: boolean("dedicated_ip_needs_reassign")
      .notNull()
      .default(false),
```

- [ ] **Step 3: Add `cubes` partial-unique indexes.** In the same file, inside the `(t) => [ ... ]` index array (after `cubes_server_id_internal_ip_unq`, around line 255), add:

```ts
    uniqueIndex("cubes_dedicated_ipv4_unq")
      .on(t.dedicatedIpv4)
      .where(sql`dedicated_ipv4 IS NOT NULL AND status <> 'deleted'`),
    uniqueIndex("cubes_dedicated_ipv6_unq")
      .on(t.dedicatedIpv6)
      .where(sql`dedicated_ipv6 IS NOT NULL AND status <> 'deleted'`),
```

(`uniqueIndex` and `sql` are already imported in this file.)

- [ ] **Step 4: Add the platform-settings rate column.** In `db/schema/platform-settings.ts`, after the `backupStorageRatePerGbPerMonth` block (around line 89), add:

```ts
  /**
   * Operator-set monthly price for a cube's dedicated IP (v4 + v6 bundled).
   * Charged hourly as `rate / 730` per assigned cube by billing-hourly.ts,
   * for as long as the IP is assigned (any cube state). Operator-tunable in
   * Orbit → Platform settings. Default $4.00/mo; nothing is charged until an
   * operator assigns an IP.
   */
  dedicatedIpRatePerMonth: numeric("dedicated_ip_rate_per_month", {
    precision: 12,
    scale: 6,
  })
    .notNull()
    .default("4.00"),
```

> **NOTE — the `billing_event_type` enum value is intentionally NOT added here.** Adding `dedicated_ip_charge` to the pgEnum immediately breaks the exhaustive `Record<BillingEventType, string>` `BILLING_EVENT_TYPE_CLASSES` in [lib/status-display.ts:341](../../../lib/status-display.ts#L341) (a compile error) and the `lib/status-display.test.ts` enum-coverage test. So the enum value + its compile-coupled consumers live together in **Task 8**, with their own standalone migration (matching the `0034`/`0036`/`0058` precedent of one-enum-value-per-migration). Keeping it out of Task 1 means Task 1's typecheck stays green.

- [ ] **Step 5: Generate the columns migration.**

Run: `pnpm db:generate`
Expected: a new `db/migrations/<NNNN>_*.sql` + `meta/<NNNN>_snapshot.json` + a `_journal.json` entry. The SQL adds the nullable `servers` + `cubes` columns, the two partial-unique indexes, and the `dedicated_ip_rate_per_month` column with default — **no `ALTER TYPE`** (the enum is Task 8). All additive/non-locking (Rule 40). **Do not hand-edit the journal/snapshot (Rule 6).**

- [ ] **Step 6: Verify the migration chain.**

Run: `pnpm test:migrations`
Expected: PASS (applied count == journal count, re-run is a no-op).

- [ ] **Step 7: Typecheck + commit.**

Run: `pnpm typecheck`
Expected: PASS (no enum change yet → `BILLING_EVENT_TYPE_CLASSES` is still exhaustive).

```bash
git add db/schema/servers.ts db/schema/cubes.ts db/schema/platform-settings.ts db/migrations
git commit -m "feat(dedicated-ip): schema — server allocation, cube assignment, rate setting"
```

---

## Phase 1 — Pure derivation helpers

### Task 2: `lib/server/dedicated-ip.ts` — derive + allocate (pure, test-first)

**Files:**
- Create: `lib/server/dedicated-ip.ts`
- Test: `lib/server/dedicated-ip.test.ts`

- [ ] **Step 1: Write the failing test.** Create `lib/server/dedicated-ip.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignableIpv4,
  ipv6BlockOf,
  nextFreeIpv4,
  nextFreeIpv6,
} from "./dedicated-ip";

// banana: 167.160.91.120/29, gw .121, primary .122 → assignable .123–.126
test("assignableIpv4 derives /29 minus network/broadcast/gateway/primary", () => {
  const got = assignableIpv4({
    cidr: "167.160.91.120/29",
    gateway: "167.160.91.121",
    primaryIp: "167.160.91.122",
    excludes: null,
  });
  assert.deepEqual(got, [
    "167.160.91.123",
    "167.160.91.124",
    "167.160.91.125",
    "167.160.91.126",
  ]);
});

test("assignableIpv4 honours excludes", () => {
  const got = assignableIpv4({
    cidr: "167.160.91.120/29",
    gateway: "167.160.91.121",
    primaryIp: "167.160.91.122",
    excludes: "167.160.91.126, 167.160.91.124",
  });
  assert.deepEqual(got, ["167.160.91.123", "167.160.91.125"]);
});

test("nextFreeIpv4 returns lowest free, null when exhausted", () => {
  const all = ["167.160.91.123", "167.160.91.124"];
  assert.equal(nextFreeIpv4(all, ["167.160.91.123"]), "167.160.91.124");
  assert.equal(nextFreeIpv4(all, all), null);
});

test("ipv6BlockOf normalises the /64 base from a host address", () => {
  assert.equal(ipv6BlockOf("2605:9f80:1000:446::2/64"), "2605:9f80:1000:446::");
  assert.equal(ipv6BlockOf("2605:9f80:1000:21::2/64"), "2605:9f80:1000:21::");
});

// gw ::1, host ::2 → first free is ::3, then ::4, skipping used + excludes
test("nextFreeIpv6 picks lowest free suffix, skipping gw/host/used/excludes", () => {
  const opts = {
    block: "2605:9f80:1000:446::",
    gateway: "2605:9f80:1000:446::1",
    hostAddr: "2605:9f80:1000:446::2/64",
    excludes: "2605:9f80:1000:446::4",
  };
  assert.equal(nextFreeIpv6({ ...opts, used: [] }), "2605:9f80:1000:446::3");
  assert.equal(
    nextFreeIpv6({ ...opts, used: ["2605:9f80:1000:446::3"] }),
    "2605:9f80:1000:446::5" // ::4 excluded
  );
});
```

- [ ] **Step 2: Run it red.**

Run: `pnpm test -- lib/server/dedicated-ip.test.ts` (or `node --env-file=.env.unit --import tsx --test lib/server/dedicated-ip.test.ts`)
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Implement.** Create `lib/server/dedicated-ip.ts`:

```ts
/**
 * Pure derivation + allocation math for operator-assigned dedicated public IPs
 * (spec: docs/superpowers/specs/2026-06-01-dedicated-ips-design.md). Single
 * source of truth — never hardcode a prefix/gateway/range elsewhere. No DB,
 * no SSH; unit-tested in dedicated-ip.test.ts.
 */

function ipv4ToInt(ip: string): number {
  const labels = ip.trim().split(".");
  if (labels.length !== 4) throw new Error(`bad IPv4: "${ip}"`);
  let n = 0;
  for (const label of labels) {
    const o = Number.parseInt(label, 10);
    if (!Number.isInteger(o) || String(o) !== label || o < 0 || o > 255) {
      throw new Error(`bad IPv4: "${ip}"`);
    }
    n = n * 256 + o;
  }
  return n >>> 0;
}

function intToIpv4(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(
    "."
  );
}

/** Split a comma/space-separated exclude string into a trimmed, lower-cased set. */
function parseExcludes(excludes: string | null | undefined): Set<string> {
  return new Set(
    (excludes ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** The /29 (or any v4 CIDR) prefix length, e.g. 29. */
export function ipv4PrefixOf(cidr: string): number {
  const prefix = Number.parseInt(cidr.split("/")[1] ?? "", 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`bad IPv4 CIDR: "${cidr}"`);
  }
  return prefix;
}

export interface AssignableIpv4Opts {
  cidr: string; // "167.160.91.120/29"
  gateway: string; // "167.160.91.121"
  primaryIp: string; // servers.public_ip
  excludes: string | null;
}

/**
 * The sorted list of assignable IPv4 addresses in `cidr`, with network,
 * broadcast, gateway, primary, and excludes removed.
 */
export function assignableIpv4(opts: AssignableIpv4Opts): string[] {
  const prefix = ipv4PrefixOf(opts.cidr);
  const base = ipv4ToInt(opts.cidr.split("/")[0]);
  const size = 2 ** (32 - prefix);
  const network = base & (size === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
  const broadcast = (network + size - 1) >>> 0;
  const reserved = new Set<string>([
    intToIpv4(network),
    intToIpv4(broadcast),
    opts.gateway.trim(),
    opts.primaryIp.trim(),
    ...parseExcludes(opts.excludes),
  ]);
  const out: string[] = [];
  for (let n = network + 1; n < broadcast; n++) {
    const ip = intToIpv4(n);
    if (!reserved.has(ip) && !reserved.has(ip.toLowerCase())) out.push(ip);
  }
  return out;
}

/** Lowest assignable IPv4 not already used, or null when exhausted. */
export function nextFreeIpv4(
  assignable: string[],
  usedByCubes: string[]
): string | null {
  const used = new Set(usedByCubes.map((s) => s.trim()));
  for (const ip of assignable) if (!used.has(ip)) return ip;
  return null;
}

/** Normalise the /64 base from a host v6 address ("…::2/64" → "…::"). */
export function ipv6BlockOf(ipv6Address: string): string {
  const addr = ipv6Address.split("/")[0].trim().toLowerCase();
  // Take the first four hextets (the /64) and re-append "::".
  // Works for the compressed "<a>:<b>:<c>:<d>::<suffix>" provider form.
  const head = addr.split("::")[0];
  const hextets = head.split(":").filter(Boolean).slice(0, 4);
  if (hextets.length !== 4) {
    throw new Error(`bad /64 host address: "${ipv6Address}"`);
  }
  return `${hextets.join(":")}::`;
}

export interface NextFreeIpv6Opts {
  block: string; // "2605:9f80:1000:446::"
  gateway: string; // "…::1"
  hostAddr: string; // "…::2/64"
  excludes: string | null;
  used: string[];
}

/**
 * Lowest free `<block><N-hex>` (N >= 3 by construction — ::1 gw, ::2 host are
 * skipped), avoiding used + excludes. We allocate sequentially from ::3; the
 * /64 is effectively inexhaustible for operator-scale assignment.
 */
export function nextFreeIpv6(opts: NextFreeIpv6Opts): string {
  const taken = new Set<string>([
    opts.gateway.split("/")[0].trim().toLowerCase(),
    opts.hostAddr.split("/")[0].trim().toLowerCase(),
    ...parseExcludes(opts.excludes),
    ...opts.used.map((s) => s.split("/")[0].trim().toLowerCase()),
  ]);
  for (let n = 3; n < 0xffff; n++) {
    const addr = `${opts.block}${n.toString(16)}`;
    if (!taken.has(addr.toLowerCase())) return addr;
  }
  throw new Error("dedicated v6 suffix space exhausted");
}
```

- [ ] **Step 4: Run it green.**

Run: `pnpm test -- lib/server/dedicated-ip.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Typecheck + commit.**

```bash
pnpm typecheck
git add lib/server/dedicated-ip.ts lib/server/dedicated-ip.test.ts
git commit -m "feat(dedicated-ip): pure derive/allocate helpers + tests"
```

---

### Task 3: `lib/ssh/dedicated-ip.ts` — host rule builders (test-first) + apply/remove

**Files:**
- Create: `lib/ssh/dedicated-ip.ts`
- Test: `lib/ssh/dedicated-ip.test.ts`

The arg builders are pure (return command strings) so they can be unit-tested without SSH. `assignDedicatedIp` / `unassignDedicatedIp` run them over an `ssh2` client using the existing `execCommand`.

- [ ] **Step 1: Write the failing test.** Create `lib/ssh/dedicated-ip.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAssignCommands, buildUnassignCommands } from "./dedicated-ip";

test("v4 assign: addr alias + DNAT/SNAT inserted at position 1", () => {
  const cmds = buildAssignCommands({
    wan: "eth0",
    ipt: "iptables-legacy",
    ip6t: "ip6tables-legacy",
    v4: { address: "167.160.91.123", prefix: 29 },
    v6: null,
    cubeIpv4: "198.18.1.5",
    cubeIpv6: "fd00:c0be:1::5",
  });
  assert.ok(
    cmds.some((c) =>
      c.includes("ip addr add 167.160.91.123/29 dev eth0")
    )
  );
  // DNAT all-ports, inserted at 1, guarded by -C
  assert.ok(
    cmds.some(
      (c) =>
        c.includes("-C PREROUTING -d 167.160.91.123 -j DNAT --to-destination 198.18.1.5") &&
        c.includes("-I PREROUTING 1 -d 167.160.91.123 -j DNAT --to-destination 198.18.1.5")
    )
  );
  // SNAT egress, inserted at 1, before the shared MASQUERADE
  assert.ok(
    cmds.some(
      (c) =>
        c.includes("-I POSTROUTING 1 -s 198.18.1.5 ! -o br0 -j SNAT --to-source 167.160.91.123")
    )
  );
});

test("v6 assign uses ip6tables + cube ULA target", () => {
  const cmds = buildAssignCommands({
    wan: "eth0",
    ipt: "iptables-legacy",
    ip6t: "ip6tables-legacy",
    v4: null,
    v6: { address: "2605:9f80:1000:446::3" },
    cubeIpv4: "198.18.1.5",
    cubeIpv6: "fd00:c0be:1::5",
  });
  assert.ok(cmds.some((c) => c.includes("ip -6 addr add 2605:9f80:1000:446::3/64 dev eth0")));
  assert.ok(
    cmds.some((c) =>
      c.includes("ip6tables-legacy -t nat") &&
      c.includes("-I PREROUTING 1 -d 2605:9f80:1000:446::3 -j DNAT --to-destination fd00:c0be:1::5")
    )
  );
  assert.ok(
    cmds.some((c) =>
      c.includes("-I POSTROUTING 1 -s fd00:c0be:1::5 ! -o br0 -j SNAT --to-source 2605:9f80:1000:446::3")
    )
  );
});

test("unassign deletes the same rules + the addr", () => {
  const cmds = buildUnassignCommands({
    wan: "eth0",
    ipt: "iptables-legacy",
    ip6t: "ip6tables-legacy",
    v4: { address: "167.160.91.123", prefix: 29 },
    v6: { address: "2605:9f80:1000:446::3" },
    cubeIpv4: "198.18.1.5",
    cubeIpv6: "fd00:c0be:1::5",
  });
  assert.ok(cmds.some((c) => c.includes("-D PREROUTING -d 167.160.91.123 -j DNAT")));
  assert.ok(cmds.some((c) => c.includes("-D POSTROUTING -s 198.18.1.5 ! -o br0 -j SNAT")));
  assert.ok(cmds.some((c) => c.includes("ip addr del 167.160.91.123/29 dev eth0")));
  assert.ok(cmds.some((c) => c.includes("ip -6 addr del 2605:9f80:1000:446::3/64 dev eth0")));
});
```

- [ ] **Step 2: Run it red.**

Run: `pnpm test -- lib/ssh/dedicated-ip.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement.** Create `lib/ssh/dedicated-ip.ts`:

```ts
/**
 * Host-side 1:1 NAT for operator-assigned dedicated public IPs (spec:
 * docs/superpowers/specs/2026-06-01-dedicated-ips-design.md §5). Claims the
 * extra address as a secondary on the WAN iface (on-link), then DNAT (inbound,
 * all ports) + per-cube SNAT (egress) inserted AHEAD of the shared NAT rules.
 *
 * Uses the LEGACY iptables/ip6tables backend (matches lib/ssh/network.ts and
 * cube-network-host.ts) so rules persist alongside the cube-DNAT path. Every
 * rule is idempotent (`-C` guard); the addr alias is grep-guarded. Pure builders
 * (buildAssignCommands / buildUnassignCommands) are unit-tested.
 */
import type { Client } from "ssh2";
import { execCommand } from "./exec";

export interface DedicatedIpV4 {
  address: string;
  prefix: number;
}
export interface DedicatedIpV6 {
  address: string;
}

export interface DedicatedIpRuleInput {
  wan: string;
  ipt: string; // resolved iptables binary (legacy preferred)
  ip6t: string; // resolved ip6tables binary
  v4: DedicatedIpV4 | null;
  v6: DedicatedIpV6 | null;
  cubeIpv4: string; // cubes.internal_ip (DNAT target / SNAT source)
  cubeIpv6: string; // cubes.internal_ipv6 (ULA, DNAT target / SNAT source)
}

/** Resolve the legacy binaries (mirror cube-network-host.ts resolveBins). */
export async function resolveDedicatedBins(
  client: Client
): Promise<{ ipt: string; ip6t: string }> {
  const v4 = await execCommand(
    client,
    "command -v iptables-legacy 2>/dev/null || echo iptables"
  );
  const v6 = await execCommand(
    client,
    "command -v ip6tables-legacy 2>/dev/null || echo ip6tables"
  );
  return {
    ipt: v4.stdout.trim() || "iptables",
    ip6t: v6.stdout.trim() || "ip6tables",
  };
}

/** Resolve the WAN iface = the host's default-route device. */
export async function resolveWan(client: Client): Promise<string> {
  const r = await execCommand(
    client,
    "ip route show default 2>/dev/null | grep -oP 'dev \\K\\S+' | head -1"
  );
  const wan = r.stdout.trim();
  if (!wan) throw new Error("dedicated-ip: could not resolve WAN interface");
  return wan;
}

// idempotent add: -C (check) || -I <chain> 1 (insert at top, highest precedence)
function idemInsert(bin: string, table: string, rule: string): string {
  return `${bin} -t ${table} -C ${rule} 2>/dev/null || ${bin} -t ${table} -I ${rule.replace(
    /^(PRE|POST)ROUTING /,
    "$1ROUTING 1 "
  )}`;
}
// idempotent delete: -C && -D || true
function idemDelete(bin: string, table: string, rule: string): string {
  return `${bin} -t ${table} -C ${rule} 2>/dev/null && ${bin} -t ${table} -D ${rule} || true`;
}

export function buildAssignCommands(i: DedicatedIpRuleInput): string[] {
  const cmds: string[] = [];
  if (i.v4) {
    const { address: a, prefix } = i.v4;
    cmds.push(
      `ip addr show dev ${i.wan} | grep -qF '${a}/${prefix}' || ip addr add ${a}/${prefix} dev ${i.wan}`
    );
    cmds.push(
      idemInsert(i.ipt, "nat", `PREROUTING -d ${a} -j DNAT --to-destination ${i.cubeIpv4}`)
    );
    cmds.push(
      idemInsert(
        i.ipt,
        "nat",
        `POSTROUTING -s ${i.cubeIpv4} ! -o br0 -j SNAT --to-source ${a}`
      )
    );
  }
  if (i.v6) {
    const { address: a } = i.v6;
    cmds.push(
      `ip -6 addr show dev ${i.wan} | grep -qF '${a}/64' || ip -6 addr add ${a}/64 dev ${i.wan}`
    );
    cmds.push(
      idemInsert(i.ip6t, "nat", `PREROUTING -d ${a} -j DNAT --to-destination ${i.cubeIpv6}`)
    );
    cmds.push(
      idemInsert(
        i.ip6t,
        "nat",
        `POSTROUTING -s ${i.cubeIpv6} ! -o br0 -j SNAT --to-source ${a}`
      )
    );
  }
  return cmds;
}

export function buildUnassignCommands(i: DedicatedIpRuleInput): string[] {
  const cmds: string[] = [];
  if (i.v4) {
    const { address: a, prefix } = i.v4;
    cmds.push(
      idemDelete(i.ipt, "nat", `PREROUTING -d ${a} -j DNAT --to-destination ${i.cubeIpv4}`)
    );
    cmds.push(
      idemDelete(
        i.ipt,
        "nat",
        `POSTROUTING -s ${i.cubeIpv4} ! -o br0 -j SNAT --to-source ${a}`
      )
    );
    cmds.push(
      `ip addr show dev ${i.wan} | grep -qF '${a}/${prefix}' && ip addr del ${a}/${prefix} dev ${i.wan} || true`
    );
  }
  if (i.v6) {
    const { address: a } = i.v6;
    cmds.push(
      idemDelete(i.ip6t, "nat", `PREROUTING -d ${a} -j DNAT --to-destination ${i.cubeIpv6}`)
    );
    cmds.push(
      idemDelete(
        i.ip6t,
        "nat",
        `POSTROUTING -s ${i.cubeIpv6} ! -o br0 -j SNAT --to-source ${a}`
      )
    );
    cmds.push(
      `ip -6 addr show dev ${i.wan} | grep -qF '${a}/64' && ip -6 addr del ${a}/64 dev ${i.wan} || true`
    );
  }
  return cmds;
}

async function runAll(client: Client, cmds: string[]): Promise<void> {
  for (const cmd of cmds) {
    const r = await execCommand(client, cmd, 15_000);
    if (r.exitCode !== 0) {
      throw new Error(
        `dedicated-ip cmd failed (${r.exitCode}): ${(r.stderr || r.stdout).slice(-300)}`
      );
    }
  }
  // Persist (mirror lib/ssh/network.ts persistIptables — best-effort).
  await execCommand(client, "netfilter-persistent save 2>/dev/null || true");
}

export async function assignDedicatedIp(
  client: Client,
  input: Omit<DedicatedIpRuleInput, "ipt" | "ip6t" | "wan"> &
    Partial<Pick<DedicatedIpRuleInput, "wan" | "ipt" | "ip6t">>
): Promise<void> {
  const wan = input.wan ?? (await resolveWan(client));
  const bins = await resolveDedicatedBins(client);
  await runAll(
    client,
    buildAssignCommands({ ...input, wan, ipt: bins.ipt, ip6t: bins.ip6t })
  );
}

export async function unassignDedicatedIp(
  client: Client,
  input: Omit<DedicatedIpRuleInput, "ipt" | "ip6t" | "wan"> &
    Partial<Pick<DedicatedIpRuleInput, "wan" | "ipt" | "ip6t">>
): Promise<void> {
  const wan = input.wan ?? (await resolveWan(client));
  const bins = await resolveDedicatedBins(client);
  await runAll(
    client,
    buildUnassignCommands({ ...input, wan, ipt: bins.ipt, ip6t: bins.ip6t })
  );
}
```

- [ ] **Step 4: Run it green.**

Run: `pnpm test -- lib/ssh/dedicated-ip.test.ts`
Expected: PASS (3 tests). Note the test passes `ipt`/`ip6t`/`wan` directly to the builders, so no SSH is touched.

- [ ] **Step 5: Typecheck + commit.**

```bash
pnpm typecheck
git add lib/ssh/dedicated-ip.ts lib/ssh/dedicated-ip.test.ts
git commit -m "feat(dedicated-ip): host iptables/ip6tables 1:1 NAT module + arg-builder tests"
```

---

## Phase 2 — Allocation (DB + advisory lock)

### Task 4: `lib/server/dedicated-ip-allocate.ts` — claim + release under the per-server lock

**Files:**
- Create: `lib/server/dedicated-ip-allocate.ts`
- Test: `tests/integration/dedicated-ip-allocate.test.ts`

- [ ] **Step 1: Implement the allocator.** Create `lib/server/dedicated-ip-allocate.ts`:

```ts
/**
 * Allocate / release a cube's dedicated v4 + v6 under a per-server advisory
 * lock (disjoint seed 4 — acquireSpaceLock=0, per-user=1, jailer-uid=2,
 * bridge-subnet=3). Must run inside a transaction. Mirrors
 * lib/server/jailer-uids.ts. The partial-unique indexes
 * (cubes_dedicated_ipv4_unq / _ipv6_unq) are the belt-and-suspenders backstop.
 */
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  assignableIpv4,
  ipv4PrefixOf,
  ipv6BlockOf,
  nextFreeIpv4,
  nextFreeIpv6,
} from "@/lib/server/dedicated-ip";

type Tx = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

export interface AllocatedDedicatedIp {
  v4: { address: string; prefix: number } | null;
  v6: { address: string } | null;
}

export class DedicatedIpError extends Error {}

/**
 * Allocate the lowest-free dedicated v4 (+ a v6 if the server has a v6 block)
 * for `cubeId` on `serverId`, write the cube columns, and return the picked
 * addresses for host-rule application. Throws DedicatedIpError when the server
 * has no v4 allocation configured or no free v4.
 */
export async function allocateDedicatedIp(
  tx: Tx,
  serverId: string,
  cubeId: string
): Promise<AllocatedDedicatedIp> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dedicated_ip:${serverId}`}, 4))`
  );

  const [server] = await tx
    .select({
      publicIp: schema.servers.publicIp,
      ipv4AllocationCidr: schema.servers.ipv4AllocationCidr,
      ipv4Gateway: schema.servers.ipv4Gateway,
      ipv6Address: schema.servers.ipv6Address,
      ipv6Gateway: schema.servers.ipv6Gateway,
      dedicatedIpExcludes: schema.servers.dedicatedIpExcludes,
    })
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .limit(1);

  if (!server?.ipv4AllocationCidr || !server.ipv4Gateway) {
    throw new DedicatedIpError(
      "Server has no IPv4 allocation configured for dedicated IPs"
    );
  }

  // In-use sets for this server (exclude this cube + deleted cubes).
  const used = await tx
    .select({
      v4: schema.cubes.dedicatedIpv4,
      v6: schema.cubes.dedicatedIpv6,
    })
    .from(schema.cubes)
    .where(
      and(
        eq(schema.cubes.serverId, serverId),
        ne(schema.cubes.id, cubeId),
        ne(schema.cubes.status, "deleted")
      )
    );

  const v4Address = nextFreeIpv4(
    assignableIpv4({
      cidr: server.ipv4AllocationCidr,
      gateway: server.ipv4Gateway,
      primaryIp: server.publicIp,
      excludes: server.dedicatedIpExcludes,
    }),
    used.map((u) => u.v4).filter((x): x is string => !!x)
  );
  if (!v4Address) {
    throw new DedicatedIpError("No free dedicated IPv4 on this server");
  }
  const v4 = { address: v4Address, prefix: ipv4PrefixOf(server.ipv4AllocationCidr) };

  let v6: { address: string } | null = null;
  if (server.ipv6Address && server.ipv6Gateway) {
    v6 = {
      address: nextFreeIpv6({
        block: ipv6BlockOf(server.ipv6Address),
        gateway: server.ipv6Gateway,
        hostAddr: server.ipv6Address,
        excludes: server.dedicatedIpExcludes,
        used: used.map((u) => u.v6).filter((x): x is string => !!x),
      }),
    };
  }

  await tx
    .update(schema.cubes)
    .set({
      dedicatedIpv4: v4.address,
      dedicatedIpv6: v6?.address ?? null,
      dedicatedIpAssignedAt: new Date(),
      dedicatedIpNeedsReassign: false,
    })
    .where(eq(schema.cubes.id, cubeId));

  return { v4, v6 };
}

/** Clear a cube's dedicated-IP columns. Returns what was set (for host cleanup).
 *  Idempotent. `flagReassign` sets dedicated_ip_needs_reassign (transfer path). */
export async function releaseDedicatedIp(
  tx: Tx,
  cubeId: string,
  opts: { flagReassign?: boolean } = {}
): Promise<{ v4: string | null; v6: string | null }> {
  const [row] = await tx
    .select({
      v4: schema.cubes.dedicatedIpv4,
      v6: schema.cubes.dedicatedIpv6,
    })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);

  await tx
    .update(schema.cubes)
    .set({
      dedicatedIpv4: null,
      dedicatedIpv6: null,
      dedicatedIpAssignedAt: null,
      dedicatedIpNeedsReassign: opts.flagReassign ?? false,
    })
    .where(eq(schema.cubes.id, cubeId));

  return { v4: row?.v4 ?? null, v6: row?.v6 ?? null };
}
```

- [ ] **Step 2: Write the integration test.** Create `tests/integration/dedicated-ip-allocate.test.ts`. Use the seed helper `tests/integration/_seed.ts` (read it first to match its API for creating a space/server/cube). Skeleton:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import {
  allocateDedicatedIp,
  releaseDedicatedIp,
  DedicatedIpError,
} from "@/lib/server/dedicated-ip-allocate";
import { seedSpace, seedServer, seedCube } from "./_seed";

test("allocate picks lowest-free v4 + v6, writes columns; release clears", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    publicIp: "167.160.91.122",
    ipv4AllocationCidr: "167.160.91.120/29",
    ipv4Gateway: "167.160.91.121",
    ipv6Address: "2605:9f80:1000:446::2/64",
    ipv6Gateway: "2605:9f80:1000:446::1",
  });
  const cube = await seedCube(space.id, server.id, {
    internalIp: "198.18.1.5",
    internalIpv6: "fd00:c0be:1::5",
  });
  const { id: serverId } = server;
  const { id: cubeId } = cube;

  const got = await db.transaction((tx) =>
    allocateDedicatedIp(tx, serverId, cubeId)
  );
  assert.equal(got.v4?.address, "167.160.91.123");
  assert.equal(got.v4?.prefix, 29);
  assert.equal(got.v6?.address, "2605:9f80:1000:446::3");

  const [row] = await db
    .select({ v4: schema.cubes.dedicatedIpv4, v6: schema.cubes.dedicatedIpv6 })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId));
  assert.equal(row.v4, "167.160.91.123");

  await db.transaction((tx) => releaseDedicatedIp(tx, cubeId, { flagReassign: true }));
  const [cleared] = await db
    .select({
      v4: schema.cubes.dedicatedIpv4,
      flag: schema.cubes.dedicatedIpNeedsReassign,
    })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId));
  assert.equal(cleared.v4, null);
  assert.equal(cleared.flag, true);
});

test("allocate throws when no allocation configured", async () => {
  const space = await seedSpace();
  const server = await seedServer({ publicIp: "203.0.113.5" }); // no allocation columns
  const cube = await seedCube(space.id, server.id, {
    internalIp: "198.18.2.5",
    internalIpv6: "fd00:c0be:2::5",
  });
  await assert.rejects(
    () => db.transaction((tx) => allocateDedicatedIp(tx, server.id, cube.id)),
    DedicatedIpError
  );
});
```

> `seedSpace()` / `seedServer(overrides)` / `seedCube(spaceId, serverId, overrides)` are the real exports in [tests/integration/_seed.ts](../../../tests/integration/_seed.ts) — `seedServer` auto-creates a region + ssh key; `overrides` is `Partial<schema.servers.$inferInsert>` / `Partial<schema.cubes.$inferInsert>`.

- [ ] **Step 3: Run integration tests.**

Run: `pnpm test:integration -- tests/integration/dedicated-ip-allocate.test.ts` (or run the full `pnpm test:integration` if per-file filtering isn't wired)
Expected: PASS.

- [ ] **Step 4: Typecheck + commit.**

```bash
pnpm typecheck
git add lib/server/dedicated-ip-allocate.ts tests/integration/dedicated-ip-allocate.test.ts
git commit -m "feat(dedicated-ip): per-server-locked allocate/release + integration test"
```

---

## Phase 3 — Worker jobs (apply / remove host rules)

### Task 5: Register the two jobs (`JOB_NAMES`, payload types, `QUEUE_OPTIONS`)

**Files:**
- Modify: `lib/worker/job-types.ts`
- Modify: `lib/worker/ensure-queues.ts`

- [ ] **Step 1: Add the job names + payloads.** In `lib/worker/job-types.ts`, add to the `JOB_NAMES` object (near the cube entries):

```ts
  DEDICATED_IP_APPLY: "dedicated-ip.apply",
  DEDICATED_IP_REMOVE: "dedicated-ip.remove",
```

Then add the payload types near the other cube payloads (e.g. after `CubeSleepPayload`):

```ts
export type DedicatedIpApplyPayload = {
  cubeId: string;
};
export type DedicatedIpRemovePayload = {
  cubeId: string;
  serverId: string; // explicit — the cube may have moved/cleared by the time this runs
  v4: string | null; // dedicated public IPv4 to remove
  v6: string | null; // dedicated public IPv6 to remove
  cubeIpv4: string | null; // cube internal IPv4 — needed to delete the egress SNAT precisely
  cubeIpv6: string | null; // cube internal IPv6 — same, for the v6 SNAT
};
```

- [ ] **Step 2: Add `QUEUE_OPTIONS` entries (Rule 56 — full record).** In `lib/worker/ensure-queues.ts`, add inside `QUEUE_OPTIONS`:

```ts
  // Apply/remove host iptables for a dedicated IP. Idempotent (-C guards), so
  // retry is safe. Exclusive + singletonKey=cubeId so back-to-back assigns for
  // one cube collapse.
  [JOB_NAMES.DEDICATED_IP_APPLY]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 300,
    policy: "exclusive",
  },
  [JOB_NAMES.DEDICATED_IP_REMOVE]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 300,
    policy: "exclusive",
  },
```

- [ ] **Step 3: Typecheck (Rule 56 guard).**

Run: `pnpm typecheck`
Expected: PASS (the `Record<JobName, …>` would fail if an entry were missing — proves both jobs are wired).

- [ ] **Step 4: Commit.**

```bash
git add lib/worker/job-types.ts lib/worker/ensure-queues.ts
git commit -m "feat(dedicated-ip): register apply/remove jobs + queue options"
```

### Task 6: Apply/remove handlers + boss wiring

**Files:**
- Create: `lib/worker/handlers/dedicated-ip-apply.ts`
- Create: `lib/worker/handlers/dedicated-ip-remove.ts`
- Modify: `lib/worker/boss.ts`

- [ ] **Step 1: Implement the apply handler.** Create `lib/worker/handlers/dedicated-ip-apply.ts`. Model the guarded SSH connect on `backup-create.ts` (Rule 58). It re-derives the v4 prefix from the server allocation and applies host rules for whatever the cube currently has assigned:

```ts
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { ipv4PrefixOf } from "@/lib/server/dedicated-ip";
import { connectToServer } from "@/lib/ssh"; // returns { client }
import { assignDedicatedIp } from "@/lib/ssh/dedicated-ip";
import type { DedicatedIpApplyPayload } from "@/lib/worker/job-types";

export async function handleDedicatedIpApply(payload: DedicatedIpApplyPayload) {
  const [cube] = await db
    .select({
      id: schema.cubes.id,
      serverId: schema.cubes.serverId,
      internalIp: schema.cubes.internalIp,
      internalIpv6: schema.cubes.internalIpv6,
      dedicatedIpv4: schema.cubes.dedicatedIpv4,
      dedicatedIpv6: schema.cubes.dedicatedIpv6,
    })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, payload.cubeId))
    .limit(1);

  if (!cube || (!cube.dedicatedIpv4 && !cube.dedicatedIpv6)) {
    return; // nothing assigned — no-op (idempotent on a cleared cube)
  }

  const [server] = await db
    .select({ ipv4AllocationCidr: schema.servers.ipv4AllocationCidr })
    .from(schema.servers)
    .where(eq(schema.servers.id, cube.serverId))
    .limit(1);
  if (!server?.ipv4AllocationCidr || !cube.internalIp || !cube.internalIpv6) {
    return;
  }

  const prefix = ipv4PrefixOf(server.ipv4AllocationCidr);
  // Guarded connect (Rule 58): if the host is unreachable, let it throw so
  // pg-boss retries (rules are also re-asserted on the next cube start).
  const { client } = await connectToServer(cube.serverId);
  try {
    await assignDedicatedIp(client, {
      v4: cube.dedicatedIpv4 ? { address: cube.dedicatedIpv4, prefix } : null,
      v6: cube.dedicatedIpv6 ? { address: cube.dedicatedIpv6 } : null,
      cubeIpv4: cube.internalIp,
      cubeIpv6: cube.internalIpv6,
    });
  } finally {
    client.end();
  }
}
```

> `connectToServer(serverId)` returns `{ client }` (see `backup-create.ts:279` — `const result = await connectToServer(serverId); client = result.client;`). Close with `client.end()`.

- [ ] **Step 2: Implement the remove handler.** Create `lib/worker/handlers/dedicated-ip-remove.ts` (takes explicit addresses so it works even after the cube columns were cleared):

```ts
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { ipv4PrefixOf } from "@/lib/server/dedicated-ip";
import { connectToServer } from "@/lib/ssh"; // returns { client }
import { unassignDedicatedIp } from "@/lib/ssh/dedicated-ip";
import type { DedicatedIpRemovePayload } from "@/lib/worker/job-types";

export async function handleDedicatedIpRemove(payload: DedicatedIpRemovePayload) {
  if (!payload.v4 && !payload.v6) return;

  // Prefix for the v4 addr alias removal. The cube row may already be gone
  // (delete), so the internal IPs come from the PAYLOAD (captured at enqueue
  // time) — never re-read here — so the egress SNAT (`-s <internalIp>`) is
  // always removed precisely, with no orphaned rule that could mis-SNAT a
  // future cube that reuses the octet.
  const [server] = await db
    .select({ ipv4AllocationCidr: schema.servers.ipv4AllocationCidr })
    .from(schema.servers)
    .where(eq(schema.servers.id, payload.serverId))
    .limit(1);
  const prefix = server?.ipv4AllocationCidr
    ? ipv4PrefixOf(server.ipv4AllocationCidr)
    : 32;

  const { client } = await connectToServer(payload.serverId);
  try {
    await unassignDedicatedIp(client, {
      v4: payload.v4 ? { address: payload.v4, prefix } : null,
      v6: payload.v6 ? { address: payload.v6 } : null,
      cubeIpv4: payload.cubeIpv4 ?? "0.0.0.0",
      cubeIpv6: payload.cubeIpv6 ?? "::",
    });
  } finally {
    client.end();
  }
}
```

- [ ] **Step 3: Wire into boss.** In `lib/worker/boss.ts`, follow the existing **dynamic-import** pattern (handlers are loaded via `await import(...)` inside the registration function — see `const { handleCubeWake } = await import("@/lib/worker/handlers/cube-wake")` at boss.ts:85, then `workMonitored(...)` at boss.ts:274). Add, near the other cube `workMonitored` calls:

```ts
  const { handleDedicatedIpApply } = await import(
    "@/lib/worker/handlers/dedicated-ip-apply"
  );
  const { handleDedicatedIpRemove } = await import(
    "@/lib/worker/handlers/dedicated-ip-remove"
  );
  await workMonitored(JOB_NAMES.DEDICATED_IP_APPLY, handleDedicatedIpApply);
  await workMonitored(JOB_NAMES.DEDICATED_IP_REMOVE, handleDedicatedIpRemove);
```

- [ ] **Step 4: Typecheck + commit.**

```bash
pnpm typecheck
git add lib/worker/handlers/dedicated-ip-apply.ts lib/worker/handlers/dedicated-ip-remove.ts lib/worker/boss.ts
git commit -m "feat(dedicated-ip): apply/remove worker handlers + boss wiring"
```

---

## Phase 4 — Billing

### Task 7: Add the rate to platform settings (reader + write path + form)

**Files:**
- Modify: `lib/platform-settings/index.ts` (type + reader)
- Modify: `app/actions/orbit-platform-settings.ts` (zod schema + update)
- Modify: `app/(orbit)/orbit/platform-settings/_components/platform-settings-form.tsx` (form field)

- [ ] **Step 1: Extend the type + reader.** In `lib/platform-settings/index.ts`: add `dedicatedIpRatePerMonth: number;` to the `PlatformSettings` interface (alongside `backupStorageRatePerGbPerMonth`), and in the `getPlatformSettings()` return mapping add (match the `Number.parseFloat(row.backupStorageRatePerGbPerMonth)` line exactly):

```ts
    dedicatedIpRatePerMonth: Number.parseFloat(row.dedicatedIpRatePerMonth),
```

- [ ] **Step 2: Extend the write action.** In `app/actions/orbit-platform-settings.ts`, read how `backupStorageRatePerGbPerMonth` is validated + written, then mirror it for `dedicatedIpRatePerMonth`: add a field to the Zod schema (`z.number().min(0)`), include it in the `db.update(schema.platformSettings).set({ … })` call as `.toString()` / `.toFixed(6)` (match the existing numeric write), keep the existing `requireActionAdmin()` guard + `invalidatePlatformSettingsCache()` call at the end (the action already calls it — do not remove). The cache invalidation is why the reader picks up the new value immediately.

- [ ] **Step 3: Add the form field.** In `platform-settings-form.tsx`, add a "Dedicated IP rate ($/month)" number input bound to `dedicatedIpRatePerMonth`, following the exact react-hook-form pattern of the `backupStorageRatePerGbPerMonth` field already in that form (same `FormField` / `FormItem` / `FormControl` / `FormMessage` structure, `valueAsNumber` onChange per Rule 19). Add it to the form's `defaultValues` + the Zod resolver schema.

- [ ] **Step 4: Typecheck + lint + commit.**

```bash
pnpm typecheck && pnpm lint
git add lib/platform-settings/index.ts app/actions/orbit-platform-settings.ts "app/(orbit)/orbit/platform-settings/_components/platform-settings-form.tsx"
git commit -m "feat(dedicated-ip): operator-tunable dedicated_ip_rate_per_month (reader, action, form)"
```

### Task 8: Billing-event enum value + classification + status-display (compile-coupled)

Adding the enum value forces TWO same-commit consumer edits or the build breaks: the exhaustive `Record<BillingEventType, string>` `BILLING_EVENT_TYPE_CLASSES` ([lib/status-display.ts:341](../../../lib/status-display.ts#L341)) and (for correctness + the enum-coverage test) `BILLING_DEBIT_TYPES` ([lib/billing-events.ts](../../../lib/billing-events.ts)). The enum gets its OWN standalone migration (precedent: `0034` plan_credit, `0036` overage_charge, `0058` sleep_storage_charge — each a lone `ALTER TYPE … ADD VALUE IF NOT EXISTS`).

**Files:**
- Modify: `db/schema/billing.ts` (enum value)
- Modify: `lib/status-display.ts` (`BILLING_EVENT_TYPE_CLASSES` — required for typecheck)
- Modify: `lib/billing-events.ts` (`BILLING_DEBIT_TYPES` — Rule 54)
- Test: `lib/billing-events.test.ts`
- Generate: `db/migrations/<NNNN>_*.sql`

- [ ] **Step 1: Add the enum value.** In `db/schema/billing.ts`, inside the `billingEventType` pgEnum array, after `"overage_charge",` (line 46), add:

```ts
  // Dedicated-IP charge: one row per hourly tick a cube has a dedicated public
  // IP assigned. Flat rate from platform_settings.dedicated_ip_rate_per_month
  // (/730 per hour), billed in ANY cube state while assigned. Routed through
  // applyOverageCascadeTx like sleep/backup storage. A debit (Rule 54).
  "dedicated_ip_charge",
```

- [ ] **Step 2: Generate the standalone enum migration.**

Run: `pnpm db:generate`
Expected: a new migration whose only DDL is `ALTER TYPE "public"."billing_event_type" ADD VALUE IF NOT EXISTS 'dedicated_ip_charge';` (drizzle-kit 0.31 emits the `IF NOT EXISTS` form — idempotent, Rule 40). On PG 18 this is safe inside the migrator's transaction because the new label is not USED in the same migration.

- [ ] **Step 3: Verify migrations.** Run: `pnpm test:migrations` → PASS.

- [ ] **Step 4: Add the status-display class (REQUIRED — typecheck gate).** In `lib/status-display.ts`, add to `BILLING_EVENT_TYPE_CLASSES` (the exhaustive `Record`), matching the red charge styling of `overage_charge`/`hourly_charge`:

```ts
  dedicated_ip_charge: "bg-red-500/10 text-red-600 dark:text-red-400",
```

- [ ] **Step 5: Classify as a debit (Rule 54).** In `lib/billing-events.ts`, add `"dedicated_ip_charge",` to `BILLING_DEBIT_TYPES`.

- [ ] **Step 6: Test.** Add to (or create) `lib/billing-events.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isBillingDebit } from "./billing-events";

test("dedicated_ip_charge is a debit", () => {
  assert.equal(isBillingDebit("dedicated_ip_charge"), true);
});
```

Run: `pnpm test -- lib/billing-events.test.ts lib/status-display.test.ts` → PASS (the existing `status-display.test.ts` enum-coverage loop now sees a class for the new value).

- [ ] **Step 7: Typecheck + commit.**

```bash
pnpm typecheck
git add db/schema/billing.ts db/migrations lib/status-display.ts lib/billing-events.ts lib/billing-events.test.ts
git commit -m "feat(dedicated-ip): billing_event_type dedicated_ip_charge + classification + status display"
```

### Task 9: Billing-hourly dedicated-IP pass

**Files:**
- Modify: `lib/worker/handlers/billing-hourly.ts`

- [ ] **Step 0: Add the missing imports.** At the top of `billing-hourly.ts`: the drizzle import is `import { and, eq, gte, inArray } from "drizzle-orm";` — change it to `import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";`. Add `import { getPlatformSettings } from "@/lib/platform-settings";`. (`cubes`, `spaces`, `billingEvents`, `applyOverageCascadeTx`, `prepaidChargeSplit`, `getSpacePlanRowTx`, `getSpaceOverridesTx`, `effectiveLimits`, `reportOverageEventNow`, `audit`, `enqueueJob`, `JOB_NAMES` are ALREADY imported — verified.)

- [ ] **Step 1: Add the pass.** The handler is **void** (no return) and ends with the sleep-storage pass loop, then a final summary `console.log`, then the closing brace. Insert the new pass **after the sleep-storage `for` loop closes and before that final `console.log`**. It selects every cube with a dedicated IP (`isNotNull(cubes.dedicatedIpv4)` + `ne(cubes.status, "deleted")` — every assigned cube has a v4, since `allocateDedicatedIp` always assigns v4), groups by space, charges `rate/730` per assigned cube through `applyOverageCascadeTx`, and writes `dedicated_ip_charge` rows + audit rows:

```ts
  // ── Dedicated-IP pass ───────────────────────────────────────────────────
  // Flat hourly charge for every cube with a dedicated public IP assigned,
  // in ANY state (running/sleeping/error) — the IP occupies a scarce slot the
  // whole time it's assigned (spec §6). Mirrors the sleep-storage pass:
  // grouped per space, routed through applyOverageCascadeTx (prepaid → overage
  // → refused-auto-sleep). Rate from platform_settings (operator-tunable).
  const { dedicatedIpRatePerMonth } = await getPlatformSettings();
  const dedicatedHourly =
    Math.round((dedicatedIpRatePerMonth / 730) * 10_000) / 10_000;

  const dedicatedCubes =
    dedicatedHourly > 0
      ? await db
          .select({
            id: cubes.id,
            spaceId: cubes.spaceId,
            name: cubes.name,
            dedicatedIpv4: cubes.dedicatedIpv4,
          })
          .from(cubes)
          .where(
            and(
              ne(cubes.status, "deleted"),
              isNotNull(cubes.dedicatedIpv4)
            )
          )
      : [];

  if (dedicatedCubes.length > 0) {
    const bySpace = new Map<string, typeof dedicatedCubes>();
    for (const c of dedicatedCubes) {
      const arr = bySpace.get(c.spaceId) ?? [];
      arr.push(c);
      bySpace.set(c.spaceId, arr);
    }

    for (const [dSpaceId, spaceCubes] of bySpace) {
      try {
        const totalCost =
          Math.round(spaceCubes.length * dedicatedHourly * 10_000) / 10_000;
        if (totalCost <= 0) continue;

        const txResult = await db.transaction(async (tx) => {
          const [sp] = await tx
            .select({
              creditBalance: spaces.creditBalance,
              overageEnabled: spaces.overageEnabled,
              overageCapUsd: spaces.overageCapUsd,
              thisPeriodOverageUsd: spaces.thisPeriodOverageUsd,
              subscriptionStatus: spaces.subscriptionStatus,
            })
            .from(spaces)
            .where(eq(spaces.id, dSpaceId))
            .for("update")
            .limit(1);
          if (!sp) return null;

          const planRow = await getSpacePlanRowTx(tx, dSpaceId);
          const overrides = await getSpaceOverridesTx(tx, dSpaceId);
          const limits = effectiveLimits(planRow, overrides);

          const { result: cascade, overageEventId } =
            await applyOverageCascadeTx({
              tx,
              input: {
                space: {
                  id: dSpaceId,
                  creditBalance: sp.creditBalance ?? "0",
                  allowOverage: limits.allowOverage,
                  overageEnabled: sp.overageEnabled,
                  overageCapUsd: sp.overageCapUsd,
                  thisPeriodOverageUsd: sp.thisPeriodOverageUsd,
                  subscriptionStatus: sp.subscriptionStatus,
                },
                totalCost,
              },
              billedAt: new Date(),
            });

          // Per-cube dedicated_ip_charge rows for the prepaid-funded share.
          const prepaidSplit = prepaidChargeSplit(
            spaceCubes.map(() => dedicatedHourly),
            cascade.fromPrepaid,
            totalCost
          );
          const rows = spaceCubes
            .map((c, i) => ({ c, amount: prepaidSplit[i] }))
            .filter((r) => r.amount > 0)
            .map(({ c, amount }) => ({
              spaceId: dSpaceId,
              cubeId: c.id,
              amount: amount.toFixed(4),
              type: "dedicated_ip_charge" as const,
              description: `Dedicated IP: "${c.name}" (${c.dedicatedIpv4} @ $${dedicatedHourly.toFixed(4)}/h)`,
            }));
          if (rows.length > 0) await tx.insert(billingEvents).values(rows);

          return { cascade, overageEventId };
        });

        if (!txResult) continue;
        if (txResult.overageEventId) {
          await reportOverageEventNow(txResult.overageEventId);
        }

        for (const c of spaceCubes) {
          audit({
            action: "billing.dedicated_ip_charge",
            category: "billing",
            actorType: "system",
            entityType: "cube",
            entityId: c.id,
            spaceId: dSpaceId,
            description: `Dedicated IP charge for "${c.name}"`,
            metadata: { cubeId: c.id, amount: dedicatedHourly.toFixed(4), ipv4: c.dedicatedIpv4 },
            source: "worker",
          });
        }
        console.log(
          `[billing-hourly] dedicated-ip space=${dSpaceId} cubes=${spaceCubes.length} charged=${totalCost.toFixed(4)}`
        );
      } catch (err) {
        console.error(`[billing-hourly] dedicated-ip pass failed space=${dSpaceId}`, err);
      }
    }
  }
```

> `audit({ category: "billing", actorType: "system", source: "worker", … })` — `"billing"` is a valid `audit_category` value (verified against the `auditCategory` pgEnum). `applyOverageCascadeTx` is imported from `@/lib/billing/overage`; `prepaidChargeSplit` from `@/lib/billing/overage-cascade` (both already in the file).

- [ ] **Step 2: Typecheck.** `pnpm typecheck` → PASS.

- [ ] **Step 3: Integration test.** Create `tests/integration/dedicated-ip-billing.test.ts`: seed a space with a small credit balance + a cube with `dedicatedIpv4` set and status `sleeping`; run the hourly handler (or the extracted pass if callable); assert a `dedicated_ip_charge` `billing_events` row exists and `creditBalance` decreased by `rate/730`. (Mirror an existing billing integration test for the harness shape.)

- [ ] **Step 4: Run + commit.**

```bash
pnpm test:integration
git add lib/worker/handlers/billing-hourly.ts tests/integration/dedicated-ip-billing.test.ts
git commit -m "feat(dedicated-ip): hourly billing pass (always-on, overage cascade) + test"
```

### Task 10: Burn-rate pillar

**Files:**
- Modify: `lib/billing.ts` (`getSpaceBurnRate`)

> **Reality check (verified):** `getSpaceBurnRate(spaceId, rates, tiers)` runs TWO separate queries (`runningCubeRows` for `status='running'`, `sleepingCubeRows` for `status='sleeping'`) — there is **no** `cubeRows` variable, and a dedicated-IP cube can be in ANY non-deleted state (running/sleeping/error/booting). So the dedicated-IP count needs its OWN query. The function takes `rates` as a param and does NOT currently read platform settings — so we import `getPlatformSettings` here.

- [ ] **Step 0: Imports.** In `lib/billing.ts`, the drizzle import is `import { and, count, eq, inArray, sum } from "drizzle-orm";` → add `isNotNull, ne`. Add `import { getPlatformSettings } from "@/lib/platform-settings";`.

- [ ] **Step 1: Add the interface field.** In the `BurnRate` interface, add (mirroring `hourlySleepStorageBurn`):

```ts
  /** Dedicated-IP cost component of `hourlyBurn` (cubes with a dedicated IP, any non-deleted state). */
  hourlyDedicatedIpBurn: number;
```

- [ ] **Step 2: Add the count query + the burn.** In `getSpaceBurnRate`, after `hourlyBurn += hourlySleepStorageBurn;` (and before the final `hourlyBurn = Math.round(...)`), add:

```ts
  // Dedicated-IP burn — flat per assigned cube, billed in ANY non-deleted
  // state (matches billing-hourly.ts). Own count query: a dedicated-IP cube
  // is not necessarily running OR sleeping.
  const { dedicatedIpRatePerMonth } = await getPlatformSettings();
  const dedicatedHourlyRate =
    Math.round((dedicatedIpRatePerMonth / 730) * 10_000) / 10_000;
  const [dedicatedRow] = await db
    .select({ n: count() })
    .from(schema.cubes)
    .where(
      and(
        eq(schema.cubes.spaceId, spaceId),
        isNotNull(schema.cubes.dedicatedIpv4),
        ne(schema.cubes.status, "deleted")
      )
    );
  const hourlyDedicatedIpBurn =
    Math.round((dedicatedRow?.n ?? 0) * dedicatedHourlyRate * 10_000) / 10_000;
  hourlyBurn += hourlyDedicatedIpBurn;
```

- [ ] **Step 3: Add to the return object.** Add `hourlyDedicatedIpBurn,` to the returned object literal (alongside `hourlySleepStorageBurn`). Adding a field to `BurnRate` is additive — existing callers that destructure specific fields are unaffected.

- [ ] **Step 2: Surface in the billing page.** In `components/space-billing.tsx`, where the burn pillars render (Hourly / Prorated / Sleep storage / Backup storage), add a "Dedicated IP" pillar reading `hourlyDedicatedIpBurn`. Match the existing pillar markup exactly.

- [ ] **Step 3: Typecheck + commit.**

```bash
pnpm typecheck
git add lib/billing.ts components/space-billing.tsx
git commit -m "feat(dedicated-ip): burn-rate pillar so runway matches the worker"
```

---

## Phase 5 — Orbit assignment (server action drives apply/remove)

### Task 11: Server-action `assignDedicatedIp` / `unassignDedicatedIp` (admin-only)

**Files:**
- Create: `app/actions/orbit-dedicated-ips.ts`

- [ ] **Step 1: Implement.** Create `app/actions/orbit-dedicated-ips.ts`. Gate with `requireAdmin()`-equivalent for actions (read an existing `app/actions/orbit-*.ts` for the exact admin guard + `audit` + return shape). The assign action runs the **preflight (Rule 58)** then the per-server-locked allocation, then enqueues `DEDICATED_IP_APPLY`:

```ts
"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { audit, extractRequestContext } from "@/lib/audit";
import { requireActionAdmin } from "@/lib/actions/auth-helpers";
import {
  allocateDedicatedIp,
  releaseDedicatedIp,
  DedicatedIpError,
} from "@/lib/server/dedicated-ip-allocate";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function assignDedicatedIpToCube(cubeId: string) {
  // requireActionAdmin RETURNS { error } — it does NOT throw. Must check.
  const session = await requireActionAdmin();
  if ("error" in session) return session;

  // Preflight (Rule 58): read state, validate BEFORE any side effect.
  const [cube] = await db
    .select({
      id: schema.cubes.id,
      serverId: schema.cubes.serverId,
      status: schema.cubes.status,
      transferState: schema.cubes.transferState,
      spaceId: schema.cubes.spaceId,
      dedicatedIpv4: schema.cubes.dedicatedIpv4,
    })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);
  if (!cube) return { error: "Cube not found" };
  if (cube.status === "deleted") return { error: "Cube is deleted" };
  if (cube.transferState !== "idle")
    return { error: "Cube is mid-transfer — try again after it completes" };
  if (cube.dedicatedIpv4) return { error: "Cube already has a dedicated IP" };

  try {
    const allocated = await db.transaction((tx) =>
      allocateDedicatedIp(tx, cube.serverId, cubeId)
    );
    await enqueueJob(
      JOB_NAMES.DEDICATED_IP_APPLY,
      { cubeId },
      { singletonKey: cubeId }
    );
    audit({
      action: "cube.dedicated_ip_assigned",
      category: "cube", // "infrastructure" is NOT a valid audit_category value
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube.spaceId,
      description: `Assigned dedicated IP ${allocated.v4?.address}${allocated.v6 ? ` / ${allocated.v6.address}` : ""}`,
      metadata: { v4: allocated.v4?.address, v6: allocated.v6?.address },
      ...extractRequestContext(await headers()),
    });
    revalidatePath(`/orbit/cubes/${cubeId}`);
    return { success: true, v4: allocated.v4?.address, v6: allocated.v6?.address };
  } catch (err) {
    if (err instanceof DedicatedIpError) return { error: err.message };
    throw err;
  }
}

export async function unassignDedicatedIpFromCube(cubeId: string) {
  const session = await requireActionAdmin();
  if ("error" in session) return session;
  const [cube] = await db
    .select({
      serverId: schema.cubes.serverId,
      spaceId: schema.cubes.spaceId,
      internalIp: schema.cubes.internalIp,
      internalIpv6: schema.cubes.internalIpv6,
      dedicatedIpv4: schema.cubes.dedicatedIpv4,
      dedicatedIpv6: schema.cubes.dedicatedIpv6,
    })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);
  if (!cube?.dedicatedIpv4 && !cube?.dedicatedIpv6)
    return { error: "Cube has no dedicated IP" };

  const released = await db.transaction((tx) => releaseDedicatedIp(tx, cubeId));
  await enqueueJob(
    JOB_NAMES.DEDICATED_IP_REMOVE,
    {
      cubeId,
      serverId: cube!.serverId,
      v4: released.v4,
      v6: released.v6,
      cubeIpv4: cube!.internalIp,
      cubeIpv6: cube!.internalIpv6,
    },
    { singletonKey: cubeId }
  );
  audit({
    action: "cube.dedicated_ip_unassigned",
    category: "cube",
    actorType: "admin",
    actorId: session.user.id,
    actorEmail: session.user.email,
    entityType: "cube",
    entityId: cubeId,
    spaceId: cube!.spaceId,
    description: `Unassigned dedicated IP ${released.v4 ?? ""} ${released.v6 ?? ""}`.trim(),
    metadata: { v4: released.v4, v6: released.v6 },
    ...extractRequestContext(await headers()),
  });
  revalidatePath(`/orbit/cubes/${cubeId}`);
  return { success: true };
}
```

> `requireActionAdmin` is the real admin guard ([lib/actions/auth-helpers.ts:68](../../../lib/actions/auth-helpers.ts#L68)). Verify the `audit({category})` enum accepts `"infrastructure"` (grep an existing `app/actions/orbit-*.ts` `audit(` call); if the enum differs, use the matching value.

- [ ] **Step 2: Typecheck + commit.**

```bash
pnpm typecheck
git add app/actions/orbit-dedicated-ips.ts
git commit -m "feat(dedicated-ip): orbit assign/unassign server actions (preflight + locked alloc + enqueue)"
```

### Task 12: Server-action to save a server's IP allocation (with strand guard)

**Files:**
- Create or extend: `app/actions/orbit-servers.ts` (add `updateServerDedicatedIpConfig`)

- [ ] **Step 1: Implement.** Add an admin-only action that validates + saves the allocation fields, and **refuses to clear/shrink an allocation that still has assigned cubes** (strand guard):

```ts
export async function updateServerDedicatedIpConfig(
  serverId: string,
  input: {
    ipv4AllocationCidr: string | null;
    ipv4Gateway: string | null;
    ipv6Address: string | null;
    ipv6Gateway: string | null;
    dedicatedIpExcludes: string | null;
  }
) {
  const session = await requireActionAdmin();
  if ("error" in session) return session;

  // Strand guard: if clearing the v4 allocation while cubes still hold a
  // dedicated v4 on this server, refuse.
  if (!input.ipv4AllocationCidr) {
    const [{ count } = { count: 0 }] = await db
      .select({ count: countDistinct(schema.cubes.id) })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.serverId, serverId),
          isNotNull(schema.cubes.dedicatedIpv4),
          ne(schema.cubes.status, "deleted")
        )
      );
    if (Number(count) > 0)
      return { error: `${count} cube(s) still hold a dedicated IP on this server — unassign them first` };
  }

  // Validation (pure): primary + gateway inside the CIDR, v6 gateway inside the /64.
  if (input.ipv4AllocationCidr && input.ipv4Gateway) {
    try {
      const list = assignableIpv4({
        cidr: input.ipv4AllocationCidr,
        gateway: input.ipv4Gateway,
        primaryIp: (await getServerPublicIp(serverId)) ?? "",
        excludes: input.dedicatedIpExcludes,
      });
      if (list.length === 0)
        return { error: "Allocation yields zero assignable IPv4 addresses" };
    } catch (e) {
      return { error: `Invalid IPv4 allocation: ${(e as Error).message}` };
    }
  }

  await db
    .update(schema.servers)
    .set({
      ipv4AllocationCidr: input.ipv4AllocationCidr,
      ipv4Gateway: input.ipv4Gateway,
      ipv6Address: input.ipv6Address,
      ipv6Gateway: input.ipv6Gateway,
      dedicatedIpExcludes: input.dedicatedIpExcludes,
    })
    .where(eq(schema.servers.id, serverId));

  audit({
    action: "server.dedicated_ip_config_updated",
    category: "server", // valid audit_category value
    actorType: "admin",
    actorId: session.user.id,
    actorEmail: session.user.email,
    entityType: "server",
    entityId: serverId,
    description: "Updated dedicated-IP allocation",
    metadata: { ...input },
    ...extractRequestContext(await headers()),
  });
  revalidatePath(`/orbit/servers/${serverId}`);
  return { success: true };
}

// Inline helper (same file): primary IPv4 of a server.
async function getServerPublicIp(serverId: string): Promise<string | null> {
  const [s] = await db
    .select({ publicIp: schema.servers.publicIp })
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .limit(1);
  return s?.publicIp ?? null;
}
```

> Imports for this action: `countDistinct, and, ne, isNotNull, eq` from `drizzle-orm`; `assignableIpv4` from `@/lib/server/dedicated-ip`; `requireActionAdmin` from `@/lib/actions/auth-helpers`; `audit, extractRequestContext` from `@/lib/audit`; `headers` from `next/headers`; `revalidatePath` from `next/cache`. `category: "server"` is a valid `audit_category` value (verified).

- [ ] **Step 2: Typecheck + commit.**

```bash
pnpm typecheck
git add app/actions/orbit-servers.ts
git commit -m "feat(dedicated-ip): server action to save allocation (validation + strand guard)"
```

### Task 13: Orbit UI — server allocation form + cube assign/unassign card

**Files:**
- Create: `app/(orbit)/orbit/servers/[serverId]/_components/dedicated-ip-config.tsx`
- Modify: `app/(orbit)/orbit/servers/[serverId]/page.tsx` (render the form + derived-availability list)
- Create: `app/(orbit)/orbit/cubes/[cubeId]/_components/dedicated-ip-card.tsx`
- Modify: `app/(orbit)/orbit/cubes/[cubeId]/page.tsx` (render the card)

- [ ] **Step 1: Server allocation form.** Create `dedicated-ip-config.tsx` — a `"use client"` form (react-hook-form + zodResolver, Rule 19; Sheet not needed since it's an inline settings card, but follow the form conventions: inline `<FormMessage />`, server errors via `form.setError("root")`, submit disabled until valid+dirty). Five text fields → `updateServerDedicatedIpConfig`. Read an existing Orbit server settings card for the exact card/markup pattern and reuse it.

- [ ] **Step 2: Derived availability list.** In `page.tsx`, server-side compute `assignableIpv4(...)` + the current assignments (`SELECT id,name,dedicatedIpv4,dedicatedIpv6 FROM cubes WHERE server_id=? AND dedicated_ipv4 IS NOT NULL`) and render a read-only table "Assignable: … · Assigned: <ip> → <cube>" mirroring the provider panel. Guard: only render when `ipv4AllocationCidr` is set.

- [ ] **Step 3: Cube assign card.** Create `dedicated-ip-card.tsx` — shows the cube's `dedicatedIpv4`/`dedicatedIpv6` (or "None"), an **Assign** button (calls `assignDedicatedIpToCube`) wrapped in an `AlertDialog` confirm, and an **Unassign** button (calls `unassignDedicatedIpFromCube`) behind an `AlertDialog`. If `dedicatedIpNeedsReassign` is true, show an amber "IP released on transfer — re-assign" badge + the Assign CTA. Use `useMutation` (`hooks/use-mutation.ts`) for the calls, `toast.success`/`toast.error`, and a one-line security note: "All ports of this cube are reachable on its dedicated IP — the customer must secure it with their in-guest firewall." Render the card on the Orbit cube detail page.

- [ ] **Step 4: Typecheck + lint + commit.**

```bash
pnpm typecheck && pnpm lint
git add "app/(orbit)/orbit/servers/[serverId]" "app/(orbit)/orbit/cubes/[cubeId]"
git commit -m "feat(dedicated-ip): orbit server allocation form + cube assign/unassign card"
```

---

## Phase 6 — Lifecycle hooks

### Task 14: Re-assert host rules on cube (re)start

**Files:**
- Modify: `lib/worker/handlers/server-reboot-recovery.ts`
- Modify: `lib/worker/handlers/cube-wake.ts`, `lib/worker/handlers/cube-cold-restart.ts`, `lib/worker/handlers/cube-auto-relaunch.ts`, `lib/worker/handlers/cube-provision.ts` (or `cube-boot.ts` if shared)

- [ ] **Step 1: Add a shared helper.** In `lib/ssh/dedicated-ip.ts`, add a convenience that takes an open client + the cube row and applies rules if assigned (so each start path is a one-liner). OR enqueue `DEDICATED_IP_APPLY` after a successful start. **Prefer enqueue** (decouples from the start path's SSH client + is idempotent): after each start path flips the cube to `running`, add:

```ts
if (cube.dedicatedIpv4 || cube.dedicatedIpv6) {
  await enqueueJob(JOB_NAMES.DEDICATED_IP_APPLY, { cubeId: cube.id }, { singletonKey: cube.id });
}
```

In `server-reboot-recovery.ts`, inside the loop that relaunches each running cube, add the same enqueue for cubes that have a dedicated IP. (Read each handler to select `dedicatedIpv4`/`dedicatedIpv6` in its cube query.)

- [ ] **Step 2: Typecheck + commit.**

```bash
pnpm typecheck
git add lib/worker/handlers/server-reboot-recovery.ts lib/worker/handlers/cube-wake.ts lib/worker/handlers/cube-cold-restart.ts lib/worker/handlers/cube-auto-relaunch.ts lib/worker/handlers/cube-provision.ts
git commit -m "feat(dedicated-ip): re-assert host rules on every cube (re)start incl. reboot-recovery"
```

### Task 15: Cube-delete cleanup

**Files:**
- Modify: `lib/worker/handlers/cube-delete.ts`

> **Reality check (verified):** `cube.delete` is a **soft delete** — it `.select()`s the full row (so `dedicatedIpv4`/`dedicatedIpv6`/`internalIp` are available), connects to the host (`connectToServer` → `{ client }`, ~line 94), tears down the cube's own iptables/rootfs, then flips the row to `status: "deleted"` (~line 250, the row PERSISTS). The partial-unique indexes exclude `status='deleted'`, so the dedicated IP is freed for reuse the moment the row flips — but we still enqueue the host removal AND null the columns for cleanliness.

- [ ] **Step 1: Release on delete.** Capture `dedicatedIpv4`, `dedicatedIpv6`, `internalIp`, `internalIpv6`, `serverId` from the already-selected cube row. If `dedicatedIpv4` or `dedicatedIpv6` is set, enqueue `DEDICATED_IP_REMOVE` (do this while the row still has the values — before the `status: "deleted"` update):

```ts
if (cube.dedicatedIpv4 || cube.dedicatedIpv6) {
  await enqueueJob(
    JOB_NAMES.DEDICATED_IP_REMOVE,
    {
      cubeId: cube.id,
      serverId: cube.serverId,
      v4: cube.dedicatedIpv4,
      v6: cube.dedicatedIpv6,
      cubeIpv4: cube.internalIp,
      cubeIpv6: cube.internalIpv6,
    },
    { singletonKey: cube.id }
  );
}
```

`cube.delete` already tears down the cube's own iptables; this additionally removes the dedicated addr alias + the `-d <dedicatedIp>` DNAT + the egress SNAT (matched precisely via the captured internal IPs).

- [ ] **Step 2: Null the dedicated columns in the soft-delete update.** In the `.update(cubes).set({ status: "deleted", updatedAt: new Date() })` call (~line 250), also set `dedicatedIpv4: null, dedicatedIpv6: null, dedicatedIpAssignedAt: null, dedicatedIpNeedsReassign: false` so the persisted `deleted` row carries no stale dedicated-IP state.

- [ ] **Step 3: Typecheck + commit.**

```bash
pnpm typecheck
git add lib/worker/handlers/cube-delete.ts
git commit -m "feat(dedicated-ip): remove host rules + free IP on cube delete"
```

### Task 16: Transfer release + flag (Rule 57 top-level)

**Files:**
- Modify: `lib/worker/handlers/cube-transfer.ts`

> **Reality check (verified):** the handler loads the cube via `db.query.cubes.findFirst` (FULL row — `cube.dedicatedIpv4`/`dedicatedIpv6` available, no select change needed) and ALREADY captures `oldInternalIp` (line 113) + `oldInternalIpv6` (line 119) "BEFORE any updates … for source teardown". **Step 9** (~line 950) is the atomic flip (cube row → destination, in a tx). **Step 10** (~line 1028) is the **non-fatal** source teardown (`freePortsByCube`, `rm -rf /var/lib/krova/cubes/<id>`). Release lives in those two anchors.

- [ ] **Step 1: Capture the source dedicated IP.** Next to the existing `oldInternalIp`/`oldInternalIpv6` captures (lines 113–119), add:

```ts
const oldDedicatedIpv4 = cube.dedicatedIpv4;
const oldDedicatedIpv6 = cube.dedicatedIpv6;
```

- [ ] **Step 2: Clear the columns in the step-9 atomic-flip tx.** In the step-9 `update(cubes).set({...})` that moves the row to the destination, also set (so the cube lands on the destination with no dedicated IP + the re-assign flag, and billing stops — durable, committed with the flip):

```ts
dedicatedIpv4: null,
dedicatedIpv6: null,
dedicatedIpAssignedAt: null,
dedicatedIpNeedsReassign: oldDedicatedIpv4 != null || oldDedicatedIpv6 != null,
```

- [ ] **Step 3: Remove host rules on the SOURCE in step-10 teardown (top level — Rule 57).** In the step-10 source-teardown block, gated ONLY on its own precondition (NOT nested under an unrelated guard), enqueue the host removal against the SOURCE server with the captured source addresses + source internal IPs, and lifecycle-log it:

```ts
if (oldDedicatedIpv4 || oldDedicatedIpv6) {
  await enqueueJob(
    JOB_NAMES.DEDICATED_IP_REMOVE,
    {
      cubeId,
      serverId: sourceServerId,
      v4: oldDedicatedIpv4,
      v6: oldDedicatedIpv6,
      cubeIpv4: oldInternalIp,
      cubeIpv6: oldInternalIpv6,
    },
    { singletonKey: `${cubeId}:dedip-release` }
  );
  await log.info("Dedicated IP released on transfer — re-assign on the destination server");
}
```

  Because the columns are cleared ONLY in the step-9 success tx, a **pre-cutover failure** never clears them — the cube stays on the source with its dedicated IP intact (host rules untouched). No special rollback handling needed.

- [ ] **Step 4: Typecheck + commit.**

```bash
pnpm typecheck
git add lib/worker/handlers/cube-transfer.ts
git commit -m "feat(dedicated-ip): transfer releases IP to source pool + flags for re-assign (Rule 57)"
```

---

## Phase 7 — Customer visibility + v1 API

### Task 17: Surface the dedicated IPs to the customer

> **Reality check (verified):** there are TWO v1 cube formatters. The single-cube `GET /v1/.../cubes/[cubeId]` uses **`formatCube`** ([lib/api/v1-cube-format.ts](../../../lib/api/v1-cube-format.ts)) via `getCubeDetailAction` (which does a full `.select()` — fields available). The cube LIST route + outbound `cube.*` webhooks use **`buildCubeSummary`** ([lib/webhook-payloads.ts](../../../lib/webhook-payloads.ts)). Both need the fields. `buildCubeSummary` has **17 callers** — so make the new Pick fields OPTIONAL (mirror the existing `& { regionId?: string | null }`) to avoid touching all 17; only the customer-facing select sites populate them.

**Files:**
- Modify: `lib/webhook-payloads.ts` (`CubeSummary` interface + `buildCubeSummary` — optional Pick fields)
- Modify: `lib/api/v1-cube-format.ts` (`formatCube` — the v1 detail shape)
- Modify: the customer cube-detail networking surface (read `components/cube-detail-*.tsx` for where public connection info renders; do NOT reveal `internalIp`)
- Modify: `docs/api/v1.md` (document the new fields)
- Test: `lib/webhook-payloads.test.ts` (assert the new fields)

- [ ] **Step 1: Extend `buildCubeSummary` (optional Pick — no caller churn).** In `lib/webhook-payloads.ts`: add `dedicatedIpv4: string | null;` + `dedicatedIpv6: string | null;` to the `CubeSummary` OUTPUT interface (always present). In the `Pick<Cube, …> & { regionId?: string | null }` param, EXTEND the intersection to `& { regionId?: string | null; dedicatedIpv4?: string | null; dedicatedIpv6?: string | null }` (optional — so the 17 existing callers still compile). Return:

```ts
    dedicatedIpv4: cube.dedicatedIpv4 ?? null,
    dedicatedIpv6: cube.dedicatedIpv6 ?? null,
```

`pnpm typecheck` should stay green with NO caller edits (optional fields default to `undefined` → `null`).

- [ ] **Step 2: Extend `formatCube` (v1 detail).** In `lib/api/v1-cube-format.ts`: add `dedicatedIpv4?: string | null;` + `dedicatedIpv6?: string | null;` to the `CubeRow` type, and to the returned object add `dedicatedIpv4: cube.dedicatedIpv4 ?? null, dedicatedIpv6: cube.dedicatedIpv6 ?? null,`. `getCubeDetailAction` already `.select()`s the full row, so the single-cube GET now returns them. (The list route's `buildCubeSummary` is covered by Step 1.)

- [ ] **Step 3: Customer cube detail display.** Show the assigned public IPs (with a copy button, like other connection fields) when set, plus the one-line firewall warning ("All ports of this cube are reachable on its dedicated IP — secure it with your in-guest firewall"). Reuse the existing connection-info component pattern; do NOT reveal `internalIp`.

- [ ] **Step 4: Test + docs.** Add an assertion to `lib/webhook-payloads.test.ts` that `buildCubeSummary` returns `dedicatedIpv4`/`dedicatedIpv6` (null when absent, the value when present). Add the two fields to the cube object(s) in `docs/api/v1.md` (both the list and detail shapes).

- [ ] **Step 5: Typecheck + lint + test + commit.**

```bash
pnpm typecheck && pnpm lint && pnpm test -- lib/webhook-payloads.test.ts
git add lib/webhook-payloads.ts lib/webhook-payloads.test.ts lib/api/v1-cube-format.ts app/api components docs/api/v1.md
git commit -m "feat(dedicated-ip): surface dedicated public IPs to customer (summary, formatCube, v1 API, UI, docs)"
```

---

## Phase 8 — Status display, docs, final gate

### Task 18: Docs (shared-responsibility, CLAUDE.md, README)

(`lib/status-display.ts` was already handled in Task 8 — no status-display work here.)

**Files:**
- Modify: `docs/security/shared-responsibility.md` (dedicated IP = all ports open, guest firewall is the boundary)
- Modify: `CLAUDE.md` + `README.md` (Rule 22 — document the feature, the new columns, the billing-event type, the host mechanism)

- [ ] **Step 1: shared-responsibility doc.** Add a "Dedicated IPs" subsection: the IP exposes all ports of the cube to the internet; the customer's in-guest firewall is the security boundary; Krova does not whitelist on the dedicated IP.

- [ ] **Step 2: CLAUDE.md + README.** Add a "Dedicated IPs" subsection under Architecture (block-derive supply, host 1:1 NAT in+out via on-link secondary addr + DNAT/SNAT at `-I …1`, always-on hourly billing through the overage cascade, transfer release+flag, the new `servers`/`cubes` columns, the `dedicated_ip_charge` event, the `dedicated_ip_rate_per_month` setting, the per-server advisory-lock seed 4). Keep it concise + accurate.

- [ ] **Step 3: Commit.**

```bash
git add docs/security/shared-responsibility.md CLAUDE.md README.md
git commit -m "docs(dedicated-ip): shared-responsibility, CLAUDE.md, README"
```

### Task 19: Final verification gate

- [ ] **Step 1: Full suite.**

Run: `pnpm test:all`
Expected: PASS (unit incl. the 3 new test files + migrations + integration).

- [ ] **Step 2: Typecheck + lint.**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Manual host smoke (pre-release, on a dev host — NEVER production).** On a KVM dev host with a configured allocation: assign a dedicated IP to a test cube, then verify from an external box: `curl http://<dedicatedIPv4>` reaches the cube; `ssh root@<dedicatedIPv4>` works; from inside the cube `curl -4 ifconfig.co` returns the dedicated v4 (egress SNAT); repeat for v6. Reboot the host, confirm reboot-recovery re-adds the addr + rules. Unassign, confirm the addr + rules are gone.

- [ ] **Step 4: Final commit (if any doc tweaks from smoke).**

```bash
git add -A && git commit -m "chore(dedicated-ip): smoke-test fixups" || true
```

---

## Deploy order (Rule 40)

1. Merge → the worker container runs `pnpm db:migrate` on startup (additive migration applies first).
2. App + worker deploy.
3. Operator fills a server's allocation fields in Orbit → Servers → (server) → Dedicated IPs.
4. Operator sets `dedicated_ip_rate_per_month` in Orbit → Platform settings (default $4.00).
5. Operator assigns an IP from Orbit → Cubes → (cube) → Dedicated IP.

The feature is inert until step 3+5 — existing cubes have null dedicated columns and behave exactly as today.

## Coverage map (spec → task)

| Spec section | Task(s) |
|---|---|
| §3 supply model (servers cols, derive) | 1, 2, 12, 13 |
| §4 cube assignment (cubes cols, alloc, lock) | 1, 4 |
| §5 host mechanism (DNAT/SNAT, on-link, legacy) | 3, 6 |
| §6 billing (setting, pass, event, burn) | 1, 7, 8, 9, 10 |
| §7 lifecycle (start/delete/transfer) | 14, 15, 16 |
| §8 Orbit UI | 12, 13 |
| §9 customer visibility + security | 17, 18 |
| §10 invariants | 2, 3, 4, 11, 12 |
| §11 testing | 2, 3, 4, 8, 9, 19 |
| §12 migration/rollout | 1, deploy order |
