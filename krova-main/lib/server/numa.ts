/**
 * Pure NUMA-topology helpers for L2 placement (no I/O). Detection shells out
 * elsewhere (server-bootstrap / install:numa-detect); this module only parses
 * the raw output and computes cpuset strings + the placement choice, so it is
 * fully unit-testable with zero deps.
 *
 * cgroup-v2 cpuset rules this honors (verified against the kernel cgroup-v2 doc
 * 2026-06-03): a leaf's cpuset.cpus must be a subset of the parent's effective
 * cpus; an empty cpuset.cpus inherits the parent (= no pinning); cpuset.cpus and
 * cpuset.mems are independent.
 */

export type NumaTopology = { cpus: number[]; node: number }[];

/**
 * Per-node placement weight of a cube: vCPUs + RAM(GiB) as a sub-unit tiebreak
 * (CPU-dominant). SINGLE SOURCE for both the live load tally (assignNumaNode) and
 * the backfill's heaviest-first sort, so the two can never drift (Rule 14).
 */
export function cubeLoadWeight(c: { vcpus: number; ramMb: number }): number {
  return c.vcpus + c.ramMb / 1024;
}

/** Expand a Linux cpulist range string ("0-17,36-53") into sorted cpu ids. */
function expandRange(cpulist: string): number[] {
  return cpulist
    .trim()
    .split(",")
    .filter(Boolean)
    .flatMap((part) => {
      const [a, b] = part.split("-").map((n) => Number.parseInt(n, 10));
      return b === undefined
        ? [a]
        : Array.from({ length: b - a + 1 }, (_, i) => a + i);
    });
}

/**
 * Parse the bootstrap probe output — one `"<node>\t<cpulist>"` line per NUMA
 * node — into a node-sorted topology. Empty input (non-NUMA kernel) → [].
 */
export function parseNumaCpulists(out: string): NumaTopology {
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [node, cpulist] = line.split("\t");
      return { node: Number.parseInt(node, 10), cpus: expandRange(cpulist) };
    })
    .sort((a, b) => a.node - b.node);
}

/** Compact a cpu-id array back to a cpuset range string ("2-17,36-53"). */
export function cpusToRangeString(cpus: number[]): string {
  const sorted = [...cpus].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return "";
  }
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = sorted[i];
    prev = sorted[i];
  }
  return parts.join(",");
}

/**
 * The cpuset.cpus a cube placed on `node` may use: that node's cpus minus the
 * `housekeeping` lowest cpu ids GLOBALLY (reserved for host OS / IRQ / Caddy).
 * Returns "" if the node is unknown in the topology (caller then omits cpuset →
 * the cube boots unpinned, fail-safe).
 */
export function nodeCpusetCpus(
  topo: NumaTopology,
  node: number,
  housekeeping: number
): string {
  const entry = topo.find((t) => t.node === node);
  if (!entry) {
    return "";
  }
  const reserved = new Set(
    topo
      .flatMap((t) => t.cpus)
      .sort((a, b) => a - b)
      .slice(0, housekeeping)
  );
  return cpusToRangeString(entry.cpus.filter((c) => !reserved.has(c)));
}

/**
 * Capacity-aware least-loaded-node policy: pick the node with the lowest load
 * PER USABLE CORE, so a node that gives up cores to housekeeping (typically
 * node 0) isn't systematically over-subscribed (review ISSUE-1b). `loadByNode`
 * is a per-node weight (Σ vcpus + ramMb/1024); `usableByNode` is the node's
 * usable-core count after the housekeeping carve-out (>=1, clamped). Ties → the
 * lowest node id (topo is node-sorted, first scanned wins).
 */
export function selectLeastLoadedNode(
  topo: NumaTopology,
  loadByNode: Record<number, number>,
  usableByNode: Record<number, number> = {}
): number {
  const ratio = (node: number): number => {
    const u = usableByNode[node];
    // A coreless NUMA node (memory-only — CXL / persistent-memory, cpulist empty
    // → 0 usable cores) must NEVER win selection: its ratio would be 0 and beat
    // every real node, then the cube would boot unpinned (empty cpuset) host-wide.
    // Treat it as +∞ so a node WITH cores is always preferred. (`u` undefined →
    // legacy raw-load fallback; only an explicit 0 is excluded.)
    if (u === 0) {
      return Number.POSITIVE_INFINITY;
    }
    return (loadByNode[node] ?? 0) / Math.max(1, u ?? 1);
  };
  let best = topo[0].node;
  let bestRatio = ratio(topo[0].node);
  for (const t of topo) {
    const r = ratio(t.node);
    if (r < bestRatio) {
      best = t.node;
      bestRatio = r;
    }
  }
  return best;
}

/** Expand a cpulist/memlist range string ("2-17,36-53" or "0") into an id Set. */
export function parseIdSet(rangeStr: string): Set<number> {
  return new Set(expandRange(rangeStr));
}

/**
 * True iff EVERY id in `subsetRange` is present in `supersetRange`. Used at
 * launch (review H1) to confirm a computed leaf `cpuset.cpus` is a subset of the
 * parent's LIVE `cpuset.cpus.effective` before binding — a non-subset would make
 * the jailer's cpuset write EINVAL and brick the boot, so the caller falls back
 * to an unpinned launch instead. An empty subset returns false (nothing to bind).
 */
export function isCpusetSubset(
  subsetRange: string,
  supersetRange: string
): boolean {
  const sub = parseIdSet(subsetRange);
  if (sub.size === 0) {
    return false;
  }
  const sup = parseIdSet(supersetRange);
  for (const id of sub) {
    if (!sup.has(id)) {
      return false;
    }
  }
  return true;
}

/**
 * The single launch-time decision: may a cube be cpuset-bound to its assigned
 * node? Pure so it can be unit-tested away from the SSH path. ALL must hold:
 *
 *  1. the krova parent delegates `cpuset` (else the leaf has no cpuset.* files);
 *  2. the computed leaf `cpus` is a subset of the parent's LIVE
 *     `cpuset.cpus.effective` (review H1 — a non-subset write EINVALs in the
 *     jailer and BRICKS the boot; `isCpusetSubset` is also false for an empty
 *     `cpus` = unknown node);
 *  3. the node id is present in the parent's `cpuset.mems.effective`;
 *  4. OVERSELL GUARD — the node has at least as many usable cores as the cube has
 *     vCPUs. A cube with MORE vCPUs than a node's cores must run UNPINNED across
 *     the whole host: node-confining it would throttle its vCPU threads below the
 *     sold count even when the other socket is idle, defeating CPU oversell. A
 *     cube that fits the node still shares it work-conservingly via `cpu.weight`
 *     (no `cpu.max`), so oversell WITHIN the node is preserved. (With the
 *     platform's 16-vCPU cap this never fires on a normal multi-core socket — it
 *     is defense-in-depth for small dual-socket hosts / future plan changes.)
 *
 * Any failure → the caller launches unpinned (fail-safe — the cube still boots).
 */
export function shouldBindCpuset(args: {
  cpus: string;
  vcpus: number;
  node: number;
  delegated: boolean;
  effCpus: string;
  effMems: string;
}): boolean {
  if (!args.delegated) {
    return false;
  }
  if (!isCpusetSubset(args.cpus, args.effCpus)) {
    return false;
  }
  if (!parseIdSet(args.effMems).has(args.node)) {
    return false;
  }
  if (parseIdSet(args.cpus).size < args.vcpus) {
    return false;
  }
  return true;
}
