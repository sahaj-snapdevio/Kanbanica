import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cpusToRangeString,
  cubeLoadWeight,
  isCpusetSubset,
  nodeCpusetCpus,
  parseIdSet,
  parseNumaCpulists,
  selectLeastLoadedNode,
  shouldBindCpuset,
} from "@/lib/server/numa";

// Test helper: expand a range string the same way the module does, so the
// expected topology arrays stay readable.
function r(s: string): number[] {
  return s.split(",").flatMap((p) => {
    const [a, b] = p.split("-").map(Number);
    return b == null ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
}

test("parseNumaCpulists: `<node>\\t<cpulist>` lines → node-sorted topology", () => {
  const out = "1\t18-35,54-71\n0\t0-17,36-53\n";
  assert.deepEqual(parseNumaCpulists(out), [
    { node: 0, cpus: r("0-17,36-53") },
    { node: 1, cpus: r("18-35,54-71") },
  ]);
});

test("parseNumaCpulists: empty (non-NUMA kernel) → []", () => {
  assert.deepEqual(parseNumaCpulists(""), []);
});

test("cpusToRangeString: round-trips contiguous + split ranges", () => {
  assert.equal(cpusToRangeString(r("0-17,36-53")), "0-17,36-53");
  assert.equal(cpusToRangeString([5, 3, 4, 9]), "3-5,9");
  assert.equal(cpusToRangeString([7]), "7");
  assert.equal(cpusToRangeString([]), "");
});

test("nodeCpusetCpus: node cpus minus the N globally-lowest housekeeping cores", () => {
  const topo = [
    { node: 0, cpus: r("0-17,36-53") },
    { node: 1, cpus: r("18-35,54-71") },
  ];
  // housekeeping = 2 lowest global cpu ids = {0,1} → node 0 loses 0,1
  assert.equal(nodeCpusetCpus(topo, 0, 2), "2-17,36-53");
  // node 1 has none of the reserved ids → unchanged
  assert.equal(nodeCpusetCpus(topo, 1, 2), "18-35,54-71");
  // housekeeping 0 → full node
  assert.equal(nodeCpusetCpus(topo, 0, 0), "0-17,36-53");
});

test("nodeCpusetCpus: unknown node → '' (caller omits cpuset, fail-safe)", () => {
  assert.equal(nodeCpusetCpus([{ node: 0, cpus: [0, 1] }], 5, 2), "");
});

test("selectLeastLoadedNode: lowest weighted load wins; ties → lowest node id", () => {
  const topo = [
    { node: 0, cpus: [0] },
    { node: 1, cpus: [1] },
  ];
  assert.equal(selectLeastLoadedNode(topo, { 0: 10, 1: 3 }), 1);
  assert.equal(selectLeastLoadedNode(topo, { 0: 5, 1: 5 }), 0); // tie → lowest id
  assert.equal(selectLeastLoadedNode(topo, {}), 0); // no load → first node
});

test("selectLeastLoadedNode: capacity-aware — load is weighed PER usable core", () => {
  const topo = [
    { node: 0, cpus: [0, 1, 2, 3] },
    { node: 1, cpus: [4, 5, 6, 7] },
  ];
  // Node 0 gave 2 cores to housekeeping → 2 usable; node 1 keeps 4 usable.
  // Equal raw load (6 each) → node 0 ratio 3.0 vs node 1 ratio 1.5 → pick node 1.
  assert.equal(selectLeastLoadedNode(topo, { 0: 6, 1: 6 }, { 0: 2, 1: 4 }), 1);
  // Node 0 lighter even per-core → pick node 0.
  assert.equal(selectLeastLoadedNode(topo, { 0: 1, 1: 6 }, { 0: 2, 1: 4 }), 0);
});

test("selectLeastLoadedNode: a coreless node (0 usable) never wins, even at 0 load", () => {
  const topo = [
    { node: 0, cpus: [0, 1, 2] },
    { node: 1, cpus: [] }, // memory-only — 0 usable cores
  ];
  // Node 1 has 0 load AND 0 usable → its ratio would be 0 and beat node 0; the
  // +∞ guard must keep node 0 (a node WITH cores) selected instead.
  assert.equal(selectLeastLoadedNode(topo, { 0: 5, 1: 0 }, { 0: 3, 1: 0 }), 0);
  // Both real → capacity-aware behavior is unchanged (an explicit 0 is the only
  // value treated as +∞; a MISSING usable value still falls back to raw load).
  assert.equal(selectLeastLoadedNode(topo, { 0: 5, 1: 0 }, { 0: 3 }), 1);
});

test("cubeLoadWeight: vCPUs + RAM(GiB) — single source for tally + backfill sort", () => {
  assert.equal(cubeLoadWeight({ vcpus: 4, ramMb: 2048 }), 6); // 4 + 2
  assert.equal(cubeLoadWeight({ vcpus: 0, ramMb: 0 }), 0);
});

test("parseIdSet: expands a range string into an id set", () => {
  assert.deepEqual(
    [...parseIdSet("2-4,9")].sort((a, b) => a - b),
    [2, 3, 4, 9]
  );
  assert.equal(parseIdSet("").size, 0);
});

test("isCpusetSubset: true only when every computed id is in the parent's effective set (H1)", () => {
  assert.equal(isCpusetSubset("2-17,36-53", "0-35,36-71"), true);
  // a CPU offlined from the parent's effective set → NOT a subset → unpinned
  assert.equal(isCpusetSubset("2-17", "3-17"), false); // 2 missing from parent
  assert.equal(isCpusetSubset("18", "0-17"), false); // node-1 core absent
  assert.equal(isCpusetSubset("", "0-71"), false); // empty → nothing to bind
});

test("shouldBindCpuset: binds only when delegated + subset + mems-present + cube fits node", () => {
  // A node-0 cube (2 usable cores 2-17 after housekeeping) with 8 vCPUs on a host
  // whose parent effectively owns 0-71 cpus / nodes 0-1.
  const ok = {
    cpus: "2-17",
    vcpus: 8,
    node: 0,
    delegated: true,
    effCpus: "0-71",
    effMems: "0-1",
  };
  assert.equal(shouldBindCpuset(ok), true);

  // Parent doesn't delegate cpuset → no leaf cpuset files → unpinned.
  assert.equal(shouldBindCpuset({ ...ok, delegated: false }), false);
  // Computed cpus not a subset of the parent's live effective (CPU offlined) → H1.
  assert.equal(shouldBindCpuset({ ...ok, effCpus: "3-71" }), false);
  // Assigned node absent from the parent's effective mems (memoryless node) → no.
  assert.equal(shouldBindCpuset({ ...ok, effMems: "1" }), false);
  // Unknown node → empty cpus → nothing to bind.
  assert.equal(shouldBindCpuset({ ...ok, cpus: "" }), false);
});

test("shouldBindCpuset: OVERSELL guard — a cube larger than its node runs unpinned", () => {
  // Node 0 has 16 usable cores (2-17); the parent owns everything.
  const base = {
    cpus: "2-17",
    node: 0,
    delegated: true,
    effCpus: "0-71",
    effMems: "0-1",
  };
  // 16 vCPUs == 16 usable cores → fits exactly → bind.
  assert.equal(shouldBindCpuset({ ...base, vcpus: 16 }), true);
  // 17 vCPUs > 16 usable cores → would throttle below sold vCPUs → unpinned.
  assert.equal(shouldBindCpuset({ ...base, vcpus: 17 }), false);
  // 32-vCPU cube on a 16-core node → unpinned (uses the whole host).
  assert.equal(shouldBindCpuset({ ...base, vcpus: 32 }), false);
});
