import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { assignNumaNode, clearNumaNode } from "@/lib/server/numa-nodes";
import { seedCube, seedServer, seedSpace } from "@/tests/integration/_seed";

// Node sizes comfortably exceed the placement tests' cube vCPUs so the oversize
// guard (a cube larger than a node → unpinned) does NOT fire in these balance
// tests — the guard + the coreless case get dedicated small-node tests below.
const TWO_NODE = [
  { node: 0, cpus: [0, 1, 2, 3, 4, 5, 6, 7] },
  { node: 1, cpus: [8, 9, 10, 11, 12, 13, 14, 15] },
];

async function nodeOf(cubeId: string): Promise<number | null> {
  const [row] = await db
    .select({ n: schema.cubes.numaNode })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);
  return row?.n ?? null;
}

test("assignNumaNode: second cube avoids the loaded node + persists numa_node", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    numaNodeCount: 2,
    numaTopology: TWO_NODE,
  });
  // Pre-load node 0 with a fat RUNNING cube (status must be one the load tally
  // counts — C1 excludes deleted/error/sleeping).
  await seedCube(space.id, server.id, {
    vcpus: 8,
    ramMb: 16_000,
    numaNode: 0,
    status: "running",
  });
  const cube = await seedCube(space.id, server.id, {
    vcpus: 2,
    ramMb: 4000,
    numaNode: null,
  });

  const node = await db.transaction((tx) =>
    assignNumaNode(tx, server.id, cube.id)
  );

  assert.equal(node, 1, "least-loaded node should be 1 (node 0 is loaded)");
  assert.equal(await nodeOf(cube.id), 1, "numa_node persisted on the row");
});

test("assignNumaNode: single-socket host → null (cube unpinned)", async () => {
  const space = await seedSpace();
  const server = await seedServer({ numaNodeCount: 1, numaTopology: null });
  const cube = await seedCube(space.id, server.id, { vcpus: 2, ramMb: 4000 });

  const node = await db.transaction((tx) =>
    assignNumaNode(tx, server.id, cube.id)
  );

  assert.equal(node, null);
  assert.equal(await nodeOf(cube.id), null);
});

test("assignNumaNode: empty host → node 0 (ties → lowest id); clearNumaNode resets", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    numaNodeCount: 2,
    numaTopology: TWO_NODE,
  });
  const cube = await seedCube(space.id, server.id, {
    vcpus: 4,
    ramMb: 8000,
    numaNode: null,
  });

  const node = await db.transaction((tx) =>
    assignNumaNode(tx, server.id, cube.id)
  );
  assert.equal(node, 0, "first cube on an empty host → node 0");
  assert.equal(await nodeOf(cube.id), 0);

  await db.transaction((tx) => clearNumaNode(tx, cube.id));
  assert.equal(await nodeOf(cube.id), null, "clearNumaNode resets to null");
});

test("assignNumaNode: oversize cube (vCPUs > a node's usable cores) → null, no phantom load", async () => {
  const space = await seedSpace();
  // Small dual-socket: 4 cores/node. After the 2-core global housekeeping carve,
  // node 0 has 2 usable, node 1 has 4 usable — a 6-vCPU cube exceeds BOTH.
  const server = await seedServer({
    numaNodeCount: 2,
    numaTopology: [
      { node: 0, cpus: [0, 1, 2, 3] },
      { node: 1, cpus: [4, 5, 6, 7] },
    ],
  });
  const big = await seedCube(space.id, server.id, {
    vcpus: 6,
    ramMb: 6000,
    numaNode: null,
  });

  const node = await db.transaction((tx) =>
    assignNumaNode(tx, server.id, big.id)
  );
  assert.equal(node, null, "cube larger than any node → unpinned (null)");
  assert.equal(await nodeOf(big.id), null);

  // It left NO phantom load: a later small cube still lands on a real node.
  const small = await seedCube(space.id, server.id, {
    vcpus: 2,
    ramMb: 2000,
    numaNode: null,
  });
  const n2 = await db.transaction((tx) =>
    assignNumaNode(tx, server.id, small.id)
  );
  assert.ok(n2 === 0 || n2 === 1, `small cube assigned a real node, got ${n2}`);
  assert.equal(await nodeOf(small.id), n2);
});

test("assignNumaNode: a coreless (memory-only) node is never chosen", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    numaNodeCount: 2,
    numaTopology: [
      { node: 0, cpus: [0, 1, 2, 3, 4, 5, 6, 7] },
      { node: 1, cpus: [] }, // memory-only node (CXL / persistent-memory)
    ],
  });
  const cube = await seedCube(space.id, server.id, {
    vcpus: 2,
    ramMb: 2000,
    numaNode: null,
  });

  const node = await db.transaction((tx) =>
    assignNumaNode(tx, server.id, cube.id)
  );
  assert.equal(node, 0, "coreless node 1 never picked; real node 0 chosen");
  assert.equal(await nodeOf(cube.id), 0);
});

test("assignNumaNode: re-assigning for a DIFFERENT server picks a node valid on the new host (transfer mechanism)", async () => {
  const space = await seedSpace();
  const serverA = await seedServer({
    numaNodeCount: 4,
    numaTopology: [
      { node: 0, cpus: [0, 1, 2, 3] },
      { node: 1, cpus: [4, 5, 6, 7] },
      { node: 2, cpus: [8, 9, 10, 11] },
      { node: 3, cpus: [12, 13, 14, 15] },
    ],
  });
  const serverB = await seedServer({
    numaNodeCount: 2,
    numaTopology: TWO_NODE,
  });
  // Cube assigned node 3 on A — node 3 does NOT exist on the 2-node server B.
  const cube = await seedCube(space.id, serverA.id, {
    vcpus: 2,
    ramMb: 2000,
    numaNode: 3,
  });

  // Simulate the transfer residency flip, then re-assign against B (exactly what
  // cube-transfer.ts does after the atomic flip).
  await db
    .update(schema.cubes)
    .set({ serverId: serverB.id })
    .where(eq(schema.cubes.id, cube.id));
  const node = await db.transaction((tx) =>
    assignNumaNode(tx, serverB.id, cube.id)
  );

  assert.ok(
    node === 0 || node === 1,
    `re-assigned to a B-valid node, got ${node}`
  );
  assert.equal(
    await nodeOf(cube.id),
    node,
    "stale source node 3 replaced with a destination node"
  );
});

test("PORTABILITY: re-assigning a cube to ANY destination topology yields a node valid there OR null — never a foreign id", async () => {
  const FOUR_NODE = [
    { node: 0, cpus: [0, 1, 2, 3] },
    { node: 1, cpus: [4, 5, 6, 7] },
    { node: 2, cpus: [8, 9, 10, 11] },
    { node: 3, cpus: [12, 13, 14, 15] },
  ];
  const space = await seedSpace();
  // Start the cube on a dual-socket host pinned to node 1.
  const origin = await seedServer({ numaNodeCount: 2, numaTopology: TWO_NODE });
  const cube = await seedCube(space.id, origin.id, {
    vcpus: 2,
    ramMb: 2000,
    numaNode: 1,
  });

  const destinations: {
    label: string;
    overrides: Partial<typeof schema.servers.$inferInsert>;
    ok: (n: number | null) => boolean;
  }[] = [
    {
      label: "single-socket",
      overrides: { numaNodeCount: 1, numaTopology: null },
      ok: (n) => n === null,
    },
    {
      label: "dual-socket",
      overrides: { numaNodeCount: 2, numaTopology: TWO_NODE },
      ok: (n) => n === 0 || n === 1,
    },
    {
      label: "quad-socket",
      overrides: { numaNodeCount: 4, numaTopology: FOUR_NODE },
      ok: (n) => n !== null && n >= 0 && n <= 3,
    },
    {
      label: "topology-undetected",
      overrides: { numaNodeCount: 2, numaTopology: null },
      ok: (n) => n === null,
    },
  ];

  for (const d of destinations) {
    const dest = await seedServer(d.overrides);
    // Residency flip (what cube-transfer does), then re-assign against the dest.
    await db
      .update(schema.cubes)
      .set({ serverId: dest.id })
      .where(eq(schema.cubes.id, cube.id));
    const node = await db.transaction((tx) =>
      assignNumaNode(tx, dest.id, cube.id)
    );
    assert.ok(
      d.ok(node),
      `${d.label}: expected a valid node or null, got ${node}`
    );
    // The persisted column matches the returned node — never a stale/foreign id.
    assert.equal(
      await nodeOf(cube.id),
      node,
      `${d.label}: persisted node matches`
    );
  }
});
