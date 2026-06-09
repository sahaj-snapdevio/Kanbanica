import assert from "node:assert/strict";
import { test } from "node:test";
import { isNotNull } from "drizzle-orm";
import {
  CUBE_BRIDGE_SUBNET_MAX,
  CUBE_BRIDGE_SUBNET_MIN,
} from "@/config/platform";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { allocateBridgeSubnet } from "@/lib/server/bridge-subnets";
import { seedServer } from "@/tests/integration/_seed";

// Global per-fleet bridge-subnet allocation against the real servers table +
// the global advisory lock. The pure lowest-free math is unit-tested; this
// proves the DB read picks a subnet not already in use and advances when one
// is taken. Written to be robust against whatever other rows exist in the
// shared test DB (snapshot the in-use set first).

async function inUseSubnets(): Promise<Set<number>> {
  const rows = await db
    .select({ s: schema.servers.bridgeSubnet })
    .from(schema.servers)
    .where(isNotNull(schema.servers.bridgeSubnet));
  return new Set(rows.map((r) => r.s).filter((s): s is number => s !== null));
}

test("allocateBridgeSubnet: returns an in-range subnet not already in use", async () => {
  const before = await inUseSubnets();
  const s1 = await db.transaction((tx) => allocateBridgeSubnet(tx));
  assert.ok(
    s1 >= CUBE_BRIDGE_SUBNET_MIN && s1 <= CUBE_BRIDGE_SUBNET_MAX,
    `subnet ${s1} out of [${CUBE_BRIDGE_SUBNET_MIN}, ${CUBE_BRIDGE_SUBNET_MAX}]`
  );
  assert.ok(!before.has(s1), "allocated a subnet already in use");
});

test("allocateBridgeSubnet: advances once a subnet is occupied", async () => {
  const before = await inUseSubnets();
  const s1 = await db.transaction((tx) => allocateBridgeSubnet(tx));
  // Occupy it.
  await seedServer({ bridgeSubnet: s1 });

  const s2 = await db.transaction((tx) => allocateBridgeSubnet(tx));
  assert.notEqual(s2, s1, "must not re-hand the now-occupied subnet");
  assert.ok(!before.has(s2) || s2 !== s1);
  // s2 must avoid the freshly-occupied s1.
  const afterInUse = await inUseSubnets();
  assert.ok(afterInUse.has(s1), "seeded server occupies s1");
  assert.ok(!afterInUse.has(s2), "s2 is still free until a caller writes it");
});
