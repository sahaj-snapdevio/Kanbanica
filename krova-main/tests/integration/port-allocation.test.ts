import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { allocatePort, freePort, freePortsByCube } from "@/lib/server/ports";
import { seedCube, seedServer, seedSpace } from "@/tests/integration/_seed";

// Dynamic port allocation against the real allocated_ports table + its unique
// index — proves two allocations on the same server never collide and the
// free helpers release rows.

async function portsForServer(serverId: string) {
  return db
    .select()
    .from(schema.allocatedPorts)
    .where(eq(schema.allocatedPorts.serverId, serverId));
}

test("allocatePort: two allocations on one server get distinct in-range ports", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const cube = await seedCube(space.id, server.id);

  const [p1, p2] = await db.transaction(async (tx) => {
    const a = await allocatePort(tx, server.id, cube.id, "ssh");
    const b = await allocatePort(tx, server.id, cube.id, "tcp");
    return [a, b];
  });

  assert.ok(p1 && p2, "both allocations returned a row");
  assert.notEqual(p1.port, p2.port);
  for (const p of [p1, p2]) {
    assert.ok(
      p.port >= 30_000 && p.port <= 50_000,
      `port ${p.port} out of range`
    );
  }
});

test("freePort releases exactly one allocation; freePortsByCube clears the rest", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const cube = await seedCube(space.id, server.id);

  const [p1, p2] = await db.transaction(async (tx) => [
    await allocatePort(tx, server.id, cube.id, "ssh"),
    await allocatePort(tx, server.id, cube.id, "tcp"),
  ]);
  assert.ok(p1 && p2);

  await db.transaction((tx) => freePort(tx, p1.id));
  let rows = await portsForServer(server.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.port, p2.port);

  await db.transaction((tx) => freePortsByCube(tx, cube.id));
  rows = await portsForServer(server.id);
  assert.equal(rows.length, 0, "freePortsByCube cleared the cube's ports");
});

test("allocatePort: a freed port number is reused (lowest-free)", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const cube = await seedCube(space.id, server.id);

  // First allocation, capture its number, free it, allocate again → same lowest.
  const first = await db.transaction((tx) =>
    allocatePort(tx, server.id, cube.id, "ssh")
  );
  assert.ok(first);
  await db.transaction((tx) => freePort(tx, first.id));
  const again = await db.transaction((tx) =>
    allocatePort(tx, server.id, cube.id, "ssh")
  );
  assert.ok(again);
  assert.equal(again.port, first.port, "lowest-free port is reused after free");

  await db
    .delete(schema.allocatedPorts)
    .where(and(eq(schema.allocatedPorts.serverId, server.id)));
});
