import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { allocateJailerUid, freeJailerUid } from "@/lib/server/jailer-uids";
import { seedCube, seedServer, seedSpace } from "@/tests/integration/_seed";

// Per-server jailer-uid allocation against the real cubes table + the
// UNIQUE(server_id, jailer_uid) constraint + the advisory lock. The pure
// lowest-free math is unit-tested in lib/server/jailer-uids.test.ts; this
// proves the DB read/write path picks the lowest gap and the row is updated.

const BASE = 100_000;

async function uidOf(cubeId: string) {
  const [c] = await db
    .select({ uid: schema.cubes.jailerUid })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);
  return c?.uid ?? null;
}

test("allocateJailerUid: fills the lowest gap among the server's cubes", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  // occupy BASE and BASE+2 → the gap is BASE+1
  await seedCube(space.id, server.id, { jailerUid: BASE });
  await seedCube(space.id, server.id, { jailerUid: BASE + 2 });
  const target = await seedCube(space.id, server.id); // jailerUid null

  const uid = await db.transaction((tx) =>
    allocateJailerUid(tx, server.id, target.id)
  );
  assert.equal(uid, BASE + 1, "lowest free uid is the gap");
  assert.equal(await uidOf(target.id), BASE + 1, "target cube row was updated");

  // Now {BASE, BASE+1, BASE+2} are used → next allocation is BASE+3.
  const target2 = await seedCube(space.id, server.id);
  const uid2 = await db.transaction((tx) =>
    allocateJailerUid(tx, server.id, target2.id)
  );
  assert.equal(uid2, BASE + 3);
});

test("allocateJailerUid: each server has an independent uid space", async () => {
  const space = await seedSpace();
  const serverA = await seedServer();
  const serverB = await seedServer();
  await seedCube(space.id, serverA.id, { jailerUid: BASE });
  // server B has no cubes yet → its first uid is BASE, not BASE+1.
  const cubeB = await seedCube(space.id, serverB.id);
  const uidB = await db.transaction((tx) =>
    allocateJailerUid(tx, serverB.id, cubeB.id)
  );
  assert.equal(uidB, BASE, "uid space is per-server");
});

test("freeJailerUid: clears the cube's uid and frees the slot for reuse", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const c1 = await seedCube(space.id, server.id);
  const uid1 = await db.transaction((tx) =>
    allocateJailerUid(tx, server.id, c1.id)
  );
  assert.equal(uid1, BASE);

  await db.transaction((tx) => freeJailerUid(tx, c1.id));
  assert.equal(await uidOf(c1.id), null, "uid cleared on free");

  // The freed slot is the lowest gap again.
  const c2 = await seedCube(space.id, server.id);
  const uid2 = await db.transaction((tx) =>
    allocateJailerUid(tx, server.id, c2.id)
  );
  assert.equal(uid2, BASE, "freed uid is reused");
});
