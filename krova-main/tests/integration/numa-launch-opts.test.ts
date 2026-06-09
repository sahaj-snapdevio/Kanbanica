import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { cubeNumaLaunchOpts } from "@/lib/cubes/numa-launch-opts";
import { db } from "@/lib/db";
import { seedCube, seedServer, seedSpace } from "@/tests/integration/_seed";

// The resolver every rarer relaunch path (snapshot-restore, resize, error-
// recovery, reboot-recovery, from-snapshot, import, redeploy) now spreads into
// startCube. Its correctness IS the portability guarantee for those paths: it
// must always return the node + topology of the cube's CURRENT server.

const TWO_NODE = [
  { node: 0, cpus: [0, 1, 2, 3, 4, 5, 6, 7] },
  { node: 1, cpus: [8, 9, 10, 11, 12, 13, 14, 15] },
];

test("cubeNumaLaunchOpts: returns the cube's node + the host topology when assigned", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    numaNodeCount: 2,
    numaTopology: TWO_NODE,
  });
  const cube = await seedCube(space.id, server.id, { numaNode: 1 });

  const opts = await cubeNumaLaunchOpts(cube.id);
  assert.equal(opts.numaNode, 1);
  assert.deepEqual(opts.numaTopology, TWO_NODE);
});

test("cubeNumaLaunchOpts: null node → numaNode null (cube launches unpinned)", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    numaNodeCount: 2,
    numaTopology: TWO_NODE,
  });
  const cube = await seedCube(space.id, server.id, { numaNode: null });

  const opts = await cubeNumaLaunchOpts(cube.id);
  assert.equal(opts.numaNode, null);
});

test("cubeNumaLaunchOpts: single-socket host → null node + null topology (no pinning)", async () => {
  const space = await seedSpace();
  const server = await seedServer({ numaNodeCount: 1, numaTopology: null });
  const cube = await seedCube(space.id, server.id, { numaNode: null });

  const opts = await cubeNumaLaunchOpts(cube.id);
  assert.equal(opts.numaNode, null);
  assert.equal(opts.numaTopology, null);
});

test("cubeNumaLaunchOpts: PORTABILITY — follows the cube's CURRENT server after a move (reads dest topology, not source)", async () => {
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
  const cube = await seedCube(space.id, serverA.id, { numaNode: 3 });

  // Residency flip to B + a B-valid node (exactly what cube-transfer commits).
  await db
    .update(schema.cubes)
    .set({ serverId: serverB.id, numaNode: 0 })
    .where(eq(schema.cubes.id, cube.id));

  const opts = await cubeNumaLaunchOpts(cube.id);
  assert.equal(opts.numaNode, 0, "reads the cube's NEW node");
  assert.deepEqual(
    opts.numaTopology,
    TWO_NODE,
    "reads the DESTINATION topology — never the source's"
  );
});
