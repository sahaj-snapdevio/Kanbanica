# L2 — NUMA-aware cube placement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each cube to a single NUMA node (cpuset.cpus + cpuset.mems) on multi-socket hosts so its vCPUs and RAM stay local — eliminating the cross-socket UPI penalty (up to ~50% on memory-bound workloads) — while preserving CPU overselling and never bricking a boot.

**Architecture:** Reuses the L1 machinery end-to-end. The same dedicated `krova` cgroup-v2 parent and the same jailer `--cgroup` chokepoint (`buildJailerArgs`) gain `cpuset.cpus`/`cpuset.mems` alongside the existing `cpu.weight`. A new per-server **least-loaded-node** allocator (mirrors `lib/server/jailer-uids.ts`, advisory-lock **seed 4**) assigns each cube a NUMA node, stored on `cubes.numa_node`. Bootstrap detects per-node CPU topology into new additive `servers` columns. **2 logical cores per host are reserved as housekeeping** (excluded from every cube's cpuset). Everything behind a new `NUMA_PLACEMENT_ENABLED` flag (default false), fail-safe preflight (missing/half-prepped topology → launch without cpuset, cube still boots), single-socket hosts = automatic no-op. Rollout mirrors L1 exactly: deploy flag-off → `pnpm install:cpu-cgroup` re-run (adds `+cpuset` delegation) + a one-shot `pnpm install:numa-detect` to backfill topology on existing hosts → canary one cold-booted cube on a dual-socket host → flip the flag.

**Tech Stack:** TypeScript (strict), Drizzle ORM (additive migration via `pnpm db:generate`), cgroup-v2 cpuset controller, Firecracker jailer v1.15.1 `--cgroup cpuset.cpus=…`/`cpuset.mems=…`, `node:test` (unit) + DB-backed integration + `pnpm test:host` (real-host smoke).

**Decided parameters (operator, 2026-06-03):** `HOUSEKEEPING_CORES_PER_HOST = 2` (lowest logical cores excluded from cube cpusets); placement policy = **least-loaded node** (assign to the node with the lowest allocated vCPU+RAM share).

---

## Constraints & invariants (must respect)

1. **cgroup-v2 cpuset is hierarchical:** a leaf's `cpuset.cpus` MUST be a subset of the parent's `cpuset.cpus.effective`. So the `krova` parent must have `cpuset` in its `subtree_control` AND a concrete `cpuset.cpus` set (to the full allocatable set) before any leaf can set its own. The prep handles this.
2. **Never brick a boot (the L1 cardinal invariant):** flag-off → byte-identical to today; flag-on but topology missing / `cpuset` not delegated / node unset → launch WITHOUT cpuset (the cube boots, just unpinned). The launch preflight already used for `cpu.weight` is extended, never replaced.
3. **Oversell preserved:** cpuset binds a cube to a *socket's worth of cores* and lets it float + oversell **within** that node. NO 1:1 pinning, NO `cpu.max`. `cpu.weight` (L1) still arbitrates the share inside the node.
4. **Single-socket / unknown topology = no-op:** 1 NUMA node (or null topology) → no cpuset emitted (cpuset to "all cores" is pointless), so commodity single-socket hosts are unaffected.
5. **Additive DDL only (Rule 40):** new nullable/defaulted columns; `pnpm db:generate`; never hand-edit the journal (Rule 6).
6. **Rule 60:** all live-host validation (real dual-socket cpuset binding) is operator-run on a banana/mango canary; the dev host is a single-socket VM and cannot prove NUMA binding.
7. **Rule 14:** the CPU/RAM cap formula (3 sites) is centralized in Task 0 before the allocator changes.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `config/platform.ts` | `NUMA_PLACEMENT_ENABLED`, `HOUSEKEEPING_CORES_PER_HOST` | modify |
| `lib/server/cpu-ram-capacity.ts` | single source for the CPU/RAM overcommit cap (Rule 14) | **create** |
| `lib/server/numa.ts` | pure: topology type, parse sysfs cpulist, least-loaded-node selection, per-node cpuset.cpus string (minus housekeeping) | **create** |
| `lib/server/numa-nodes.ts` | per-server NUMA-node allocator (advisory lock seed 4; mirrors `jailer-uids.ts`) | **create** |
| `db/schema/servers.ts` | `numa_node_count` (int), `numa_topology` (jsonb) | modify |
| `db/schema/cubes.ts` | `numa_node` (int, nullable) | modify |
| `lib/worker/handlers/server-bootstrap.ts` | detect per-node topology (ungated, read-only) | modify |
| `scripts/install-numa-detect.ts` + `package.json` | retrofit topology onto existing servers | **create** |
| `lib/ssh/cpu-cgroup.ts` | prep: add `+cpuset` delegation + set `krova` cpuset.cpus (gated) | modify |
| `lib/server/allocate.ts` | call the node allocator after server select (gated); use the centralized cap | modify |
| `lib/cube-resize/validate.ts`, `lib/worker/handlers/cube-transfer.ts` | use the centralized cap (Rule 14) | modify |
| `lib/ssh/jailer.ts` | `buildJailerArgs` cgroup opt gains optional `cpuset` | modify |
| `lib/ssh/firecracker.ts` | `launchJailed` computes + passes the cube's cpuset (gated, fail-safe) | modify |
| `lib/worker/handlers/server-verify.ts` | gated check: `krova` delegates `cpuset` | modify |
| `lib/worker/handlers/cube-transfer.ts` | re-assign `numa_node` on the destination (mirror the octet) | modify |
| `CLAUDE.md` | document the feature + flag + rollout | modify |

---

## Task 0: Centralize the CPU/RAM overcommit cap (Rule 14 prerequisite)

**Files:**
- Create: `lib/server/cpu-ram-capacity.ts`
- Test: `lib/server/cpu-ram-capacity.test.ts`
- Modify: `lib/server/allocate.ts:87-97`, `lib/cube-resize/validate.ts:143-157`, `lib/worker/handlers/cube-transfer.ts:201-205`

- [ ] **Step 1: Write the failing test** — `lib/server/cpu-ram-capacity.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { serverCpuRamCapacity, serverHasCpuRamRoom } from "@/lib/server/cpu-ram-capacity";

const srv = { totalCpus: 72, totalRamMb: 256_000, maxCpuOvercommit: "2.00", maxRamOvercommit: "1.00", allocatedCpus: 70, allocatedRamMb: 250_000 };

test("serverCpuRamCapacity multiplies totals by the overcommit ratios", () => {
  const cap = serverCpuRamCapacity(srv);
  assert.equal(cap.maxCpu, 144);        // 72 * 2.00
  assert.equal(cap.maxRam, 256_000);    // 256000 * 1.00
});

test("serverHasCpuRamRoom: fits when adding stays within both caps", () => {
  assert.equal(serverHasCpuRamRoom(srv, 2, 5_000), true);    // 72->74<=144, 250k->255k<=256k
});

test("serverHasCpuRamRoom: rejects when RAM would exceed the cap", () => {
  assert.equal(serverHasCpuRamRoom(srv, 2, 10_000), false);  // 250k+10k > 256k
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm test` → FAIL ("Cannot find module '@/lib/server/cpu-ram-capacity'").

- [ ] **Step 3: Implement** — `lib/server/cpu-ram-capacity.ts`

```ts
/**
 * Single source of truth for the per-server CPU/RAM overcommit cap (Rule 14).
 * Disk has its own module (lib/server/disk-capacity.ts); this is the CPU+RAM
 * analog. Every placement/resize/transfer capacity decision routes through here
 * — never re-derive `totalCpus * maxCpuOvercommit` inline again.
 */
type CapServer = {
  totalCpus: number;
  totalRamMb: number;
  maxCpuOvercommit: string | number;
  maxRamOvercommit: string | number;
};
type UsageServer = CapServer & { allocatedCpus: number; allocatedRamMb: number };

export function serverCpuRamCapacity(s: CapServer): { maxCpu: number; maxRam: number } {
  return {
    maxCpu: s.totalCpus * Number.parseFloat(String(s.maxCpuOvercommit)),
    maxRam: s.totalRamMb * Number.parseFloat(String(s.maxRamOvercommit)),
  };
}

export function serverHasCpuRamRoom(s: UsageServer, addVcpus: number, addRamMb: number): boolean {
  const { maxCpu, maxRam } = serverCpuRamCapacity(s);
  return s.allocatedCpus + addVcpus <= maxCpu && s.allocatedRamMb + addRamMb <= maxRam;
}
```

- [ ] **Step 4: Replace the 3 inline formula sites** (keep behavior identical):
  - `allocate.ts:87-97` — replace the `maxRam`/`maxCpu` locals + the `find` predicate's cpu/ram clauses with `serverHasCpuRamRoom(s, input.vcpus, input.ramMb)` (keep `serverHasDiskRoom(...)`). Keep the rejection-logging block but source `maxCpu`/`maxRam` from `serverCpuRamCapacity(s)`.
  - `cube-resize/validate.ts:143-157` — replace with `serverCpuRamCapacity(server)` for `maxCpu`/`maxRam` (resize uses deltas, so keep the `+ cpuDelta`/`+ ramDelta` checks but compute the caps via the helper).
  - `cube-transfer.ts:201-205` — replace `maxCpu`/`maxRam` locals with `serverCpuRamCapacity(dest)`.

- [ ] **Step 5: Verify green** — `pnpm test && pnpm typecheck` → PASS.

- [ ] **Step 6: Commit** — `git add lib/server/cpu-ram-capacity.* lib/server/allocate.ts lib/cube-resize/validate.ts lib/worker/handlers/cube-transfer.ts && git commit -m "refactor(server): centralize CPU/RAM overcommit cap (Rule 14) — prereq for L2"`

---

## Task 1: Flags + schema (additive migration)

**Files:** Modify `config/platform.ts`, `db/schema/servers.ts`, `db/schema/cubes.ts`; generate a migration.

- [ ] **Step 1: Add the flags** — `config/platform.ts` (next to `CPU_CGROUP_ENABLED`/`CPU_CGROUP_PARENT`):

```ts
/**
 * L2 — NUMA-aware placement. Default FALSE: flag off → no cpuset on the jailer
 * args, no `+cpuset` delegation, byte-identical to L1-only. Requires the krova
 * parent prepped with cpuset (re-run `pnpm install:cpu-cgroup`) AND per-node
 * topology recorded (`pnpm install:numa-detect` / bootstrap). Single-socket or
 * unknown-topology hosts are an automatic no-op. Flip true ONLY after a canary
 * on a dual-socket host confirms cpuset binds + the cube boots/networks.
 */
export const NUMA_PLACEMENT_ENABLED = false;
/** Logical cores reserved for host OS / IRQ / Caddy, excluded from every cube
 *  cpuset (the lowest N cpu ids). Firecracker prod-host-setup recommends a small
 *  housekeeping carve-out. */
export const HOUSEKEEPING_CORES_PER_HOST = 2;
```

- [ ] **Step 2: Add server columns** — `db/schema/servers.ts` (after `bridgeSubnet`, import `jsonb` from `drizzle-orm/pg-core`):

```ts
  numaNodeCount: integer("numa_node_count").notNull().default(1),
  // [{ node: 0, cpus: [0,1,...] }, ...] from /sys/devices/system/node/node*/cpulist; null until detected.
  numaTopology: jsonb("numa_topology").$type<{ node: number; cpus: number[] }[]>(),
```

- [ ] **Step 3: Add cube column** — `db/schema/cubes.ts` (near `jailerUid`):

```ts
  numaNode: integer("numa_node"),   // assigned NUMA node when NUMA_PLACEMENT_ENABLED; null = unpinned
```

- [ ] **Step 4: Generate + smoke the migration** — `pnpm db:generate` then `pnpm test:migrations`. Expected: a new `db/migrations/00NN_*.sql` adding 3 columns (all nullable/defaulted), applied count == journal count, re-run is a no-op.

- [ ] **Step 5: Commit** — `git add config/platform.ts db/schema/servers.ts db/schema/cubes.ts db/migrations && git commit -m "feat(numa): NUMA_PLACEMENT_ENABLED flag + servers/cubes topology columns (L2)"`

---

## Task 2: Pure NUMA topology parse + node-cpuset math

**Files:** Create `lib/server/numa.ts`, `lib/server/numa.test.ts`.

- [ ] **Step 1: Failing test** — `lib/server/numa.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNumaCpulists, nodeCpusetCpus, selectLeastLoadedNode, cpusToRangeString } from "@/lib/server/numa";

test("parseNumaCpulists: sysfs `node\\tcpulist` lines → topology", () => {
  // emitted by: for n in /sys/devices/system/node/node*; do echo "$(basename $n|tr -dc 0-9)\t$(cat $n/cpulist)"; done
  const out = "0\t0-17,36-53\n1\t18-35,54-71\n";
  assert.deepEqual(parseNumaCpulists(out), [
    { node: 0, cpus: rangeArr("0-17,36-53") },
    { node: 1, cpus: rangeArr("18-35,54-71") },
  ]);
});

test("nodeCpusetCpus: node cpus minus the N lowest housekeeping cores, as a range string", () => {
  const topo = [{ node: 0, cpus: rangeArr("0-17,36-53") }, { node: 1, cpus: rangeArr("18-35,54-71") }];
  // housekeeping = 2 lowest cpu ids globally (0,1) → node 0 loses 0,1
  assert.equal(nodeCpusetCpus(topo, 0, 2), "2-17,36-53");
  assert.equal(nodeCpusetCpus(topo, 1, 2), "18-35,54-71"); // node 1 unaffected
});

test("selectLeastLoadedNode: lowest weighted load wins; ties → lowest node id", () => {
  const topo = [{ node: 0, cpus: [0] }, { node: 1, cpus: [1] }];
  assert.equal(selectLeastLoadedNode(topo, { 0: 10, 1: 3 }), 1);
  assert.equal(selectLeastLoadedNode(topo, { 0: 5, 1: 5 }), 0);
  assert.equal(selectLeastLoadedNode(topo, {}), 0); // no load → first node
});

function rangeArr(s: string): number[] { /* test helper mirrors expandRange */ 
  return s.split(",").flatMap((p) => { const [a,b]=p.split("-").map(Number); return b==null?[a]:Array.from({length:b-a+1},(_,i)=>a+i); }); }
```

- [ ] **Step 2: Run, verify fail** — `pnpm test` → FAIL (module missing).

- [ ] **Step 3: Implement** — `lib/server/numa.ts`

```ts
/** Pure NUMA topology helpers (no I/O). Detection shells out elsewhere; this
 *  parses + computes cpuset strings. Unit-tested; zero deps. */
export type NumaTopology = { node: number; cpus: number[] }[];

function expandRange(cpulist: string): number[] {
  return cpulist.trim().split(",").filter(Boolean).flatMap((part) => {
    const [a, b] = part.split("-").map((n) => Number.parseInt(n, 10));
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
}

/** Parse `<node>\t<cpulist>` lines (one per NUMA node). */
export function parseNumaCpulists(out: string): NumaTopology {
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const [node, cpulist] = line.split("\t");
    return { node: Number.parseInt(node, 10), cpus: expandRange(cpulist) };
  }).sort((a, b) => a.node - b.node);
}

/** Compact a sorted cpu-id array back to a cpuset range string ("2-17,36-53"). */
export function cpusToRangeString(cpus: number[]): string {
  const sorted = [...cpus].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = sorted[i]; prev = sorted[i];
  }
  return parts.join(",");
}

/** The cpuset.cpus a cube on `node` may use: that node's cpus minus the N
 *  lowest cpu ids globally (housekeeping). Returns "" if the node is unknown. */
export function nodeCpusetCpus(topo: NumaTopology, node: number, housekeeping: number): string {
  const entry = topo.find((t) => t.node === node);
  if (!entry) return "";
  const reserved = new Set(topo.flatMap((t) => t.cpus).sort((a, b) => a - b).slice(0, housekeeping));
  return cpusToRangeString(entry.cpus.filter((c) => !reserved.has(c)));
}

/** Least-loaded-node policy: pick the node with the lowest accumulated load;
 *  ties broken by lowest node id (topo is node-sorted). */
export function selectLeastLoadedNode(topo: NumaTopology, loadByNode: Record<number, number>): number {
  let best = topo[0].node, bestLoad = loadByNode[topo[0].node] ?? 0;
  for (const t of topo) {
    const load = loadByNode[t.node] ?? 0;
    if (load < bestLoad) { best = t.node; bestLoad = load; }
  }
  return best;
}
```

- [ ] **Step 4: Verify green** — `pnpm test` → the 3 tests PASS.
- [ ] **Step 5: Commit** — `git add lib/server/numa.* && git commit -m "feat(numa): pure topology parse + cpuset/least-loaded helpers (L2)"`

---

## Task 3: Per-server NUMA-node allocator (advisory lock seed 4)

**Files:** Create `lib/server/numa-nodes.ts`; integration test `tests/integration/numa-nodes.test.ts`.

- [ ] **Step 1: Failing integration test** — `tests/integration/numa-nodes.test.ts` (seed a 2-node server + two cubes via `tests/integration/_seed.ts`; assert the allocator returns the least-loaded node and persists `cubes.numa_node`). Mirror an existing `tests/integration/*allocate*`/`*jailer*` test for the seed scaffolding.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { assignNumaNode } from "@/lib/server/numa-nodes";
import { seedServerWithTopology, seedCube } from "@/tests/integration/_seed"; // extend _seed with these

test("assignNumaNode: first cube → node 0; second (node 0 loaded) → node 1; persisted", async () => {
  const serverId = await seedServerWithTopology({ numaNodeCount: 2,
    numaTopology: [{ node: 0, cpus: [0,1] }, { node: 1, cpus: [2,3] }] });
  const a = await seedCube({ serverId, vcpus: 8, ramMb: 16000, numaNode: 0 }); // pre-load node 0
  const c = await seedCube({ serverId, vcpus: 2, ramMb: 4000, numaNode: null });
  const node = await db.transaction((tx) => assignNumaNode(tx, serverId, c, 2, 4000));
  assert.equal(node, 1);
  const [row] = await db.select({ n: schema.cubes.numaNode }).from(schema.cubes).where(eq(schema.cubes.id, c));
  assert.equal(row.n, 1);
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm test:integration` → FAIL (module missing / seed helpers missing).

- [ ] **Step 3: Implement** — `lib/server/numa-nodes.ts` (mirror `jailer-uids.ts`: advisory lock, derive load from co-located cubes, persist on the row — but pick least-loaded node, not lowest-free uid):

```ts
/** Per-server NUMA-node assignment (least-loaded policy). Mirrors
 *  lib/server/jailer-uids.ts: a per-server advisory lock (disjoint seed 4 —
 *  0/1/2/3 are acquireSpaceLock / per-user / jailer-uid / bridge-subnet)
 *  serializes the load read + write so two concurrent provisions on one host
 *  can't both pick the same "least-loaded" node off a stale read. Load = sum of
 *  co-located cubes' vcpus weighted + ramMb/1024 (CPU-dominant, RAM tiebreak). */
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { selectLeastLoadedNode, type NumaTopology } from "@/lib/server/numa";

type Tx = Parameters<Parameters<typeof import("@/lib/db").db.transaction>[0]>[0];

export async function assignNumaNode(
  tx: Tx, serverId: string, cubeId: string, vcpus: number, ramMb: number
): Promise<number | null> {
  const [srv] = await tx
    .select({ topo: schema.servers.numaTopology, count: schema.servers.numaNodeCount })
    .from(schema.servers).where(eq(schema.servers.id, serverId)).limit(1);
  const topo = (srv?.topo ?? null) as NumaTopology | null;
  // No-op: single-socket or undetected topology → leave numa_node null (unpinned).
  if (!topo || topo.length <= 1) {
    await tx.update(schema.cubes).set({ numaNode: null }).where(eq(schema.cubes.id, cubeId));
    return null;
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`numa_node:${serverId}`}, 4))`);
  const peers = await tx
    .select({ node: schema.cubes.numaNode, vcpus: schema.cubes.vcpus, ramMb: schema.cubes.ramMb })
    .from(schema.cubes)
    .where(and(eq(schema.cubes.serverId, serverId), ne(schema.cubes.id, cubeId), isNotNull(schema.cubes.numaNode)));
  const loadByNode: Record<number, number> = {};
  for (const p of peers) {
    const n = p.node as number;
    loadByNode[n] = (loadByNode[n] ?? 0) + Number(p.vcpus) + p.ramMb / 1024;
  }
  const node = selectLeastLoadedNode(topo, loadByNode);
  await tx.update(schema.cubes).set({ numaNode: node }).where(eq(schema.cubes.id, cubeId));
  return node;
}

/** Clear a cube's node (delete / transfer-out). Idempotent. */
export async function clearNumaNode(tx: Tx, cubeId: string): Promise<void> {
  await tx.update(schema.cubes).set({ numaNode: null }).where(eq(schema.cubes.id, cubeId));
}
```

- [ ] **Step 4: Add the `_seed.ts` helpers** (`seedServerWithTopology`, `seedCube` with `numaNode`) if absent — follow the existing seed patterns.
- [ ] **Step 5: Verify green** — `pnpm test:integration` → PASS.
- [ ] **Step 6: Commit** — `git add lib/server/numa-nodes.ts tests/integration/numa-nodes.test.ts tests/integration/_seed.ts && git commit -m "feat(numa): per-server least-loaded-node allocator, advisory lock seed 4 (L2)"`

---

## Task 4: Bootstrap topology detection + retrofit script

**Files:** Modify `lib/worker/handlers/server-bootstrap.ts`; create `scripts/install-numa-detect.ts` + `package.json` entry.

- [ ] **Step 1:** In `server-bootstrap.ts`'s "Detect hardware capacity" step (~line 152), after the nproc/meminfo/df reads, add a read-only NUMA probe (UNGATED — topology is harmless data, recorded regardless of the flag):

```ts
// NUMA topology (read-only). One line per node: "<node>\t<cpulist>".
const numaRes = await execCommand(bootstrapClient!,
  `for n in /sys/devices/system/node/node[0-9]*; do [ -d "$n" ] && printf '%s\\t%s\\n' "$(basename "$n" | tr -dc 0-9)" "$(cat "$n/cpulist")"; done`,
  5000);
const numaTopology = parseNumaCpulists(numaRes.stdout);          // import from @/lib/server/numa
const numaNodeCount = Math.max(1, numaTopology.length);
```
Persist `numaNodeCount` + `numaTopology` in the same `.set({...})` that writes `totalCpus` (~line 401). A host with no `node*` dirs (non-NUMA kernel) → `[]` → `numaNodeCount=1`, topology null → the no-op path.

- [ ] **Step 2:** Create `scripts/install-numa-detect.ts` (mirror `scripts/install-cpu-cgroup.ts`): for every `active` server, SSH, run the same probe, write `numaNodeCount`/`numaTopology`. Add `"install:numa-detect": "tsx scripts/install-numa-detect.ts"` to `package.json` (after `install:cpu-cgroup`). This backfills banana/mango (set up before this column existed).

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm lint`. (Live detection is operator-run, Rule 60.)
- [ ] **Step 4: Commit** — `git add lib/worker/handlers/server-bootstrap.ts scripts/install-numa-detect.ts package.json && git commit -m "feat(numa): detect per-node topology at bootstrap + install:numa-detect retrofit (L2)"`

---

## Task 5: cgroup prep — delegate `+cpuset` + set the krova parent cpuset (gated)

**Files:** Modify `lib/ssh/cpu-cgroup.ts` + `lib/ssh/cpu-cgroup.test.ts`.

- [ ] **Step 1:** Extend `cpuCgroupPrepScript()` so the prep oneshot ALSO delegates `cpuset` and gives the `krova` parent a concrete `cpuset.cpus`/`cpuset.mems` = the whole machine (required before any leaf can subset it — see invariant 1). Gate the cpuset lines behind `NUMA_PLACEMENT_ENABLED` (cpu delegation stays unconditional, as today). Add to the prep body (after the `+cpu` line):

```sh
# L2: delegate cpuset + seed the parent's cpuset to the whole machine so leaves can subset a node.
grep -qw cpuset /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || echo +cpuset > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
cat /sys/fs/cgroup/cpuset.cpus.effective > ${PARENT}/cpuset.cpus 2>/dev/null || true
cat /sys/fs/cgroup/cpuset.mems.effective > ${PARENT}/cpuset.mems 2>/dev/null || true
grep -qw cpuset ${PARENT}/cgroup.subtree_control 2>/dev/null || echo +cpuset > ${PARENT}/cgroup.subtree_control 2>/dev/null || true
```
Conditionally include these lines via a `${NUMA_PLACEMENT_ENABLED ? cpusetLines : ""}` interpolation in the script builder. Keep the `|| true` fail-safe discipline + the final `exit 0`.

- [ ] **Step 2:** Extend `cpuCgroupReadyCommand()` to optionally also assert cpuset delegation when NUMA is on — OR add a separate `cpusetReadyCommand()` = `grep -qw cpuset /sys/fs/cgroup/krova/cgroup.subtree_control`. Prefer a separate probe so the L1 `cpu`-only readiness is unchanged.
- [ ] **Step 3:** Update `cpu-cgroup.test.ts` — when the test toggles the flag context, assert the payload contains `+cpuset` + `cpuset.cpus`; default (flag-off) asserts it does NOT. (Since the flag is a module const, add a test that calls the builder and checks the string only contains cpuset lines if `NUMA_PLACEMENT_ENABLED`.)
- [ ] **Step 4: Verify** — `pnpm test && pnpm lint` (the `bash -n` payload check must still pass).
- [ ] **Step 5: Commit** — `git commit -am "feat(numa): krova parent delegates cpuset + seeds machine cpuset, gated (L2)"`

---

## Task 6: `buildJailerArgs` — optional cpuset on the cgroup opt

**Files:** Modify `lib/ssh/jailer.ts` + `lib/ssh/jailer.test.ts`.

- [ ] **Step 1: Failing test** — `jailer.test.ts`: WITH `cgroup: { cpuWeight: 200, cpuset: { cpus: "2-17,36-53", mems: "0" } }` the argv contains `--cgroup cpuset.cpus=2-17,36-53` and `--cgroup cpuset.mems=0` in addition to `--cgroup cpu.weight=200`; WITHOUT `cpuset` it contains only `cpu.weight` (the L1 behavior, unchanged).

- [ ] **Step 2: Run, fail** — `pnpm test`.

- [ ] **Step 3: Implement** — extend the `cgroup` opt type + the arg emission:

```ts
cgroup?: { cpuWeight: number; cpuset?: { cpus: string; mems: string } };
// ...
const cgroupArgs = opts.cgroup
  ? [
      "--parent-cgroup", CPU_CGROUP_PARENT,
      "--cgroup", `cpu.weight=${opts.cgroup.cpuWeight}`,
      ...(opts.cgroup.cpuset
        ? ["--cgroup", `cpuset.cpus=${opts.cgroup.cpuset.cpus}`,
           "--cgroup", `cpuset.mems=${opts.cgroup.cpuset.mems}`]
        : []),
    ]
  : [];
```

- [ ] **Step 4: Verify green** — `pnpm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat(numa): buildJailerArgs emits cpuset.cpus/mems when present (L2)"`

---

## Task 7: `launchJailed` — compute + pass the cpuset (gated, fail-safe)

**Files:** Modify `lib/ssh/firecracker.ts` (`launchJailed` ~406-426); both call sites (`createCube`, `startCube`) must pass the server's topology + the cube's `numaNode`.

- [ ] **Step 1:** Extend `launchJailed`'s opts with `numaNode: number | null` and `numaTopology: NumaTopology | null`. Inside, AFTER the existing L1 `cpu.weight` block, gate cpuset on `NUMA_PLACEMENT_ENABLED`:

```ts
let cpuset: { cpus: string; mems: string } | undefined;
if (NUMA_PLACEMENT_ENABLED && cgroup && opts.numaNode != null && opts.numaTopology) {
  const cpus = nodeCpusetCpus(opts.numaTopology, opts.numaNode, HOUSEKEEPING_CORES_PER_HOST);
  // Preflight: only emit cpuset if the krova parent actually delegates cpuset on
  // THIS host (re-uses the fail-safe pattern). Missing → boot without cpuset.
  const ready = await execCommand(client, cpusetReadyCommand(), 5000).catch(() => ({ exitCode: 1 }));
  if (cpus && ready.exitCode === 0) {
    cpuset = { cpus, mems: String(opts.numaNode) };
  } else {
    console.warn(`[launchJailed] cube ${opts.cubeId}: cpuset not applied (cpus="${cpus}", ready=${ready.exitCode}) — booting unpinned`);
  }
}
// merge into the existing cgroup object: cgroup = { cpuWeight, ...(cpuset ? { cpuset } : {}) }
```
The `cgroup` object built for L1 gains `cpuset` only when all gates pass. If `cgroup` itself is undefined (L1 preflight failed / flag off), cpuset is never reached — correct (no parent → no leaf).

- [ ] **Step 2:** Update `createCube` (~684) and `startCube` (~1045) to pass `numaNode: opts.numaNode ?? cube.numaNode` and `numaTopology` (loaded from the server row — thread `server.numaTopology` through the existing `CubeBootInput`/start opts). For relaunch paths that already load the cube row, read `cube.numaNode`; for the server topology, the boot input already carries the server — add `numaTopology` to it.

- [ ] **Step 3: Verify** — `pnpm typecheck` (this is the structural guarantee every caller threads the new args, exactly like L1's required `vcpus`) `&& pnpm test`.
- [ ] **Step 4: Commit** — `git commit -am "feat(numa): launchJailed applies node cpuset, gated + fail-safe preflight (L2)"`

---

## Task 8: Wire node assignment into allocation + relaunch/transfer

**Files:** Modify `lib/server/allocate.ts`, `lib/worker/handlers/cube-transfer.ts`, `lib/worker/handlers/cube-delete.ts`.

- [ ] **Step 1:** In `allocate.ts`, after the server is chosen + counters incremented (~138), call (gated):

```ts
if (NUMA_PLACEMENT_ENABLED) {
  await assignNumaNode(tx, serverId, cubeId, input.vcpus, input.ramMb);
}
```
(Imports `assignNumaNode` from `@/lib/server/numa-nodes`.) The cube row already exists at this point (inserted just below — reorder so the insert precedes the assign, or fold `numaNode` into the insert by computing it first; simplest: insert the cube, then `assignNumaNode`.)

- [ ] **Step 2:** `cube-transfer.ts` — the destination is a different server, so re-assign on the destination inside the transfer's per-server-locked section (mirror how the internal IP octet is re-derived per destination). Call `assignNumaNode(tx, destServerId, cubeId, cube.vcpus, cube.ramMb)` and roll back to null on failure (mirror the existing rollback). `clearNumaNode` on the source-teardown path.

- [ ] **Step 3:** `cube-delete.ts` — no explicit action needed (the row is deleted), but if there's a "free resources" path mirror `freeJailerUid`, add `clearNumaNode` for symmetry (defensive; the row delete already removes it).

- [ ] **Step 4: Integration test** — extend `tests/integration/numa-nodes.test.ts`: a transfer re-assigns the node on the destination; a same-server relaunch keeps the node stable (assignNumaNode excludes the cube's own row, so an existing node is re-picked only if still least-loaded — acceptable; document that relaunch MAY move a cube's node if load shifted, which is fine on a cold boot).

- [ ] **Step 5: Verify** — `pnpm test:all`.
- [ ] **Step 6: Commit** — `git commit -am "feat(numa): assign node at allocation + re-assign on transfer, gated (L2)"`

---

## Task 9: verify-phase check + docs

**Files:** Modify `lib/worker/handlers/server-verify.ts`, `CLAUDE.md`.

- [ ] **Step 1:** In `server-verify.ts`, add a gated non-critical check mirroring the L1 "krova cgroup delegates cpu":

```ts
...(NUMA_PLACEMENT_ENABLED ? [{
  name: "krova cgroup delegates cpuset",
  cmd: "grep -qw cpuset /sys/fs/cgroup/krova/cgroup.subtree_control 2>/dev/null && echo ok || echo none",
  expect: (out: string) => out.trim() === "ok" || out.trim() === "none",
  critical: false,
}] : []),
```

- [ ] **Step 2:** Document in `CLAUDE.md`: the L2 feature (the cubes.numa_node + servers.numa_topology columns in the schema bullets), the `NUMA_PLACEMENT_ENABLED`/`HOUSEKEEPING_CORES_PER_HOST` flags, the `install:numa-detect` command row, and the rollout in the jailer cgroup paragraph (cpuset alongside cpu.weight). Note the cold-boot propagation + single-socket no-op + the dev-host can't-validate-NUMA caveat.

- [ ] **Step 3: Verify** — `pnpm test:all && pnpm typecheck && pnpm lint`.
- [ ] **Step 4: Commit** — `git commit -am "feat(numa): verify-phase cpuset check + CLAUDE.md docs (L2)"`

---

## Task 10: host-smoke note (real-host validation is operator-run)

**Files:** `scripts/host-smoke/cube-lifecycle-smoke.sh` (a NON-gating note) + `docs/security/` or the plan's validation section.

- [ ] **Step 1:** The dev host is a single-socket VM → it cannot prove NUMA binding. Add a comment to the host-smoke documenting that the cpuset leg is validated on a real dual-socket host (banana/mango canary) via: cold-boot a cube with `NUMA_PLACEMENT_ENABLED` on a prepped host, then `cat /sys/fs/cgroup/krova/<cubeId>/cpuset.cpus` (= the node's cores minus housekeeping) + `cpuset.mems` (= the node) + `cat /proc/<fcpid>/status | grep Cpus_allowed_list` (confirms the kernel restricted FC to the node). No automated host-smoke assertion (no dual-socket CI).
- [ ] **Step 2: Commit** — `git commit -am "docs(numa): operator dual-socket canary validation steps (L2)"`

---

## Self-Review

**Spec coverage** (design doc §4 L2 + §5 wiring): topology detect ✅ T4; per-socket allocator ✅ T3+T8; `cpuset.cpus/mems` at launch ✅ T6+T7; reserve housekeeping cores ✅ T2 (`nodeCpusetCpus` minus 2) wired via T7; new `servers` columns ✅ T1; centralized cap (the "6 sites"/Rule 14) ✅ T0; flag-gated + fail-safe + canary ✅ T1/T5/T7; disk-NUMA cross-link — **noted as a follow-up** (the disk audit's NUMA point): once `cubes.numa_node` exists, a later change can prefer the NVMe-local node; out of scope for L2's CPU/RAM placement, flagged here so it isn't lost.

**Placeholder scan:** pure helpers (T0, T2, T3, T6) are fully coded + tested; wiring tasks (T4, T5, T7, T8) cite exact files/lines + show the inserted code. No "TBD".

**Type consistency:** `NumaTopology` (T2) is the single type used by T3/T7/server-bootstrap; `assignNumaNode`/`clearNumaNode` (T3) names match T8 call sites; `cgroup.cpuset: { cpus, mems }` shape matches across T6/T7; `serverHasCpuRamRoom`/`serverCpuRamCapacity` (T0) match the 3 replaced sites.

**Ordering:** T0 (cap centralize) → T1 (flag+schema) → T2/T3 (pure + allocator) → T4 (detect) → T5 (prep cpuset) → T6 (jailer args) → T7 (launch) → T8 (wire allocation/transfer) → T9 (verify+docs) → T10 (canary note). Each task ships green + committed independently.

---

## Rollout (mirrors L1 — operator-run, Rule 60)

1. Deploy flag-off (`NUMA_PLACEMENT_ENABLED=false`) → inert; only the additive migration + the (read-only) topology detection are live.
2. `pnpm install:numa-detect` (backfill topology on banana/mango) + re-run `pnpm install:cpu-cgroup` (adds `+cpuset` delegation — but it's gated, so it only emits cpuset lines once the flag build is deployed; deploy flag-off first, then the prep is a no-op for cpuset until the flag flips → so the order is: flip the flag build, deploy, THEN re-run install:cpu-cgroup, OR ungate the cpuset delegation in the prep so it's prepped ahead of time). **Decide at execution: prefer ungating the prep's cpuset delegation (inert like the cpu one) so prep can run ahead of the flag.**
3. Canary one cold-booted cube on a **dual-socket** host; verify `cpuset.cpus`/`cpuset.mems`/`Cpus_allowed_list` (Task 10).
4. Flip `NUMA_PLACEMENT_ENABLED=true` + deploy. Cubes pick up their node on the next cold boot; single-socket hosts no-op; rollback = flip false.
