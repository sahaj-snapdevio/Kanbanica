import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import {
  allocatePort,
  findSshAllocation,
  revertMappingsToSourceServer,
} from "@/lib/server/ports";
import { seedCube, seedServer, seedSpace } from "@/tests/integration/_seed";

// Guards the host-port-uniqueness fix: cube-transfer step 8 re-points each
// mapping's host_port + allocated_port_id to a fresh DESTINATION allocation,
// but the failure-before-flip and cancel paths used to leave that drift in
// place (and a naive "delete the dest allocations" would CASCADE-DELETE the
// mapping via tcp_port_mappings.allocated_port_id onDelete: cascade).
// revertMappingsToSourceServer restores the source allocation FIRST, then frees
// the destination — so the mapping survives and the host port is reclaimable.

async function allocsOn(cubeId: string, serverId: string) {
  return db
    .select()
    .from(schema.allocatedPorts)
    .where(
      and(
        eq(schema.allocatedPorts.cubeId, cubeId),
        eq(schema.allocatedPorts.serverId, serverId)
      )
    );
}

test("revertMappingsToSourceServer: re-points a dest-pointing SSH mapping back to its source allocation and frees the dest", async () => {
  const space = await seedSpace();
  const source = await seedServer();
  const dest = await seedServer();
  const cube = await seedCube(space.id, source.id);

  // Original source allocation (from initial provisioning).
  const [srcAlloc] = await db
    .insert(schema.allocatedPorts)
    .values({
      serverId: source.id,
      port: 30_002,
      cubeId: cube.id,
      purpose: "ssh",
    })
    .returning();
  // Step-8 destination allocation (port preserved) + mapping re-pointed onto it.
  const [destAlloc] = await db
    .insert(schema.allocatedPorts)
    .values({
      serverId: dest.id,
      port: 30_002,
      cubeId: cube.id,
      purpose: "ssh",
    })
    .returning();
  assert.ok(srcAlloc && destAlloc);
  const [mapping] = await db
    .insert(schema.tcpPortMappings)
    .values({
      cubeId: cube.id,
      cubePort: 22,
      hostPort: 30_002,
      allocatedPortId: destAlloc.id,
      isSsh: true,
      status: "active",
      label: "SSH",
    })
    .returning();
  assert.ok(mapping);

  await db.transaction((tx) =>
    revertMappingsToSourceServer(tx, cube.id, source.id, dest.id)
  );

  const [after] = await db
    .select()
    .from(schema.tcpPortMappings)
    .where(eq(schema.tcpPortMappings.id, mapping.id));
  assert.ok(after, "mapping must still exist (not cascade-deleted)");
  assert.equal(
    after.allocatedPortId,
    srcAlloc.id,
    "re-pointed to source alloc"
  );
  assert.equal(after.hostPort, 30_002);

  assert.equal(
    (await allocsOn(cube.id, dest.id)).length,
    0,
    "destination allocations freed"
  );
  const srcRows = await allocsOn(cube.id, source.id);
  assert.equal(srcRows.length, 1, "source allocation retained");
  assert.equal(srcRows[0]?.id, srcAlloc.id);
});

test("revertMappingsToSourceServer: no-op when the mapping already points at a source allocation (failure before step 8)", async () => {
  const space = await seedSpace();
  const source = await seedServer();
  const dest = await seedServer();
  const cube = await seedCube(space.id, source.id);

  const [srcAlloc] = await db
    .insert(schema.allocatedPorts)
    .values({
      serverId: source.id,
      port: 30_005,
      cubeId: cube.id,
      purpose: "ssh",
    })
    .returning();
  assert.ok(srcAlloc);
  const [mapping] = await db
    .insert(schema.tcpPortMappings)
    .values({
      cubeId: cube.id,
      cubePort: 22,
      hostPort: 30_005,
      allocatedPortId: srcAlloc.id,
      isSsh: true,
      status: "active",
      label: "SSH",
    })
    .returning();
  assert.ok(mapping);

  await db.transaction((tx) =>
    revertMappingsToSourceServer(tx, cube.id, source.id, dest.id)
  );

  const [after] = await db
    .select()
    .from(schema.tcpPortMappings)
    .where(eq(schema.tcpPortMappings.id, mapping.id));
  assert.ok(after);
  assert.equal(after.allocatedPortId, srcAlloc.id, "unchanged");
  assert.equal(after.hostPort, 30_005);
});

test("revertMappingsToSourceServer: mints a fresh source allocation when no spare exists", async () => {
  const space = await seedSpace();
  const source = await seedServer();
  const dest = await seedServer();
  const cube = await seedCube(space.id, source.id);

  // Only a dest allocation + mapping pointing at it; the source allocation is
  // gone (the retry-desync the bug could produce).
  const [destAlloc] = await db
    .insert(schema.allocatedPorts)
    .values({
      serverId: dest.id,
      port: 30_009,
      cubeId: cube.id,
      purpose: "ssh",
    })
    .returning();
  assert.ok(destAlloc);
  const [mapping] = await db
    .insert(schema.tcpPortMappings)
    .values({
      cubeId: cube.id,
      cubePort: 22,
      hostPort: 30_009,
      allocatedPortId: destAlloc.id,
      isSsh: true,
      status: "active",
      label: "SSH",
    })
    .returning();
  assert.ok(mapping);

  await db.transaction((tx) =>
    revertMappingsToSourceServer(tx, cube.id, source.id, dest.id)
  );

  const [after] = await db
    .select()
    .from(schema.tcpPortMappings)
    .where(eq(schema.tcpPortMappings.id, mapping.id));
  assert.ok(after);
  const [newAlloc] = await db
    .select()
    .from(schema.allocatedPorts)
    .where(eq(schema.allocatedPorts.id, after.allocatedPortId));
  assert.ok(newAlloc, "mapping points at a real allocation");
  assert.equal(
    newAlloc.serverId,
    source.id,
    "fresh allocation is on the source"
  );
  assert.equal(after.hostPort, newAlloc.port, "host_port == allocation.port");
  assert.equal((await allocsOn(cube.id, dest.id)).length, 0, "dest freed");
});

test("findSshAllocation: returns the SSH allocation on the requested server, ignoring a stranded cross-server one", async () => {
  const space = await seedSpace();
  const home = await seedServer();
  const other = await seedServer();
  const cube = await seedCube(space.id, home.id);

  const [homeAlloc] = await db
    .insert(schema.allocatedPorts)
    .values({
      serverId: home.id,
      port: 30_003,
      cubeId: cube.id,
      purpose: "ssh",
    })
    .returning();
  await db.insert(schema.allocatedPorts).values({
    serverId: other.id,
    port: 30_007,
    cubeId: cube.id,
    purpose: "ssh",
  });
  assert.ok(homeAlloc);

  const onHome = await findSshAllocation(home.id, cube.id);
  assert.ok(onHome);
  assert.equal(onHome.id, homeAlloc.id);
  assert.equal(onHome.port, 30_003);

  const onOther = await findSshAllocation(other.id, cube.id);
  assert.ok(onOther);
  assert.equal(onOther.port, 30_007);
});

test("findSshAllocation: returns null when the cube has no SSH allocation on that server", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const cube = await seedCube(space.id, server.id);
  assert.equal(await findSshAllocation(server.id, cube.id), null);
});

test("allocatePort still hands out a distinct in-range port after a revert frees the dest (sanity)", async () => {
  const space = await seedSpace();
  const dest = await seedServer();
  const cube = await seedCube(space.id, dest.id);
  const fresh = await db.transaction((tx) =>
    allocatePort(tx, dest.id, cube.id, "ssh")
  );
  assert.ok(fresh && fresh.port >= 30_000 && fresh.port <= 50_000);
});
