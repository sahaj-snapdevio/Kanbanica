import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { backfillNumaNodes } from "@/lib/server/numa-backfill";
import { seedCube, seedServer, seedSpace } from "@/tests/integration/_seed";

// Interleaved 2-node topology (mirrors a real dual-socket HT layout). Nodes are
// sized comfortably above the test cubes' vCPUs so the oversize guard does NOT
// fire here (it is covered by dedicated small-node tests in numa-nodes.test.ts).
const TWO_NODE = [
  { node: 0, cpus: [0, 2, 4, 6, 8, 10, 12, 14] },
  { node: 1, cpus: [1, 3, 5, 7, 9, 11, 13, 15] },
];

async function nodeOf(cubeId: string): Promise<number | null> {
  const [row] = await db
    .select({ n: schema.cubes.numaNode })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);
  return row?.n ?? null;
}

async function backfilledAuditCount(cubeIds: string[]): Promise<number> {
  if (cubeIds.length === 0) {
    return 0;
  }
  const rows = await db
    .select({ entityId: schema.auditLogs.entityId })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, "cube.numa_backfilled"),
        inArray(schema.auditLogs.entityId, cubeIds)
      )
    );
  return rows.length;
}

async function backfilledAudit(cubeId: string) {
  const [row] = await db
    .select({
      spaceId: schema.auditLogs.spaceId,
      metadata: schema.auditLogs.metadata,
      source: schema.auditLogs.source,
    })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, "cube.numa_backfilled"),
        eq(schema.auditLogs.entityId, cubeId)
      )
    )
    .limit(1);
  return row ?? null;
}

function serverResult(
  res: Awaited<ReturnType<typeof backfillNumaNodes>>,
  id: string
) {
  const s = res.servers.find((x) => x.serverId === id);
  assert.ok(s, "expected this test's server in the backfill result");
  return s;
}

test("backfill: dry-run previews placement without persisting or auditing", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    status: "active",
    numaNodeCount: 2,
    numaTopology: TWO_NODE,
  });
  const c1 = await seedCube(space.id, server.id, {
    vcpus: 4,
    ramMb: 4000,
    status: "running",
    numaNode: null,
  });
  const c2 = await seedCube(space.id, server.id, {
    vcpus: 2,
    ramMb: 2000,
    status: "sleeping",
    numaNode: null,
  });

  const dry = await backfillNumaNodes({ apply: false, serverIds: [server.id] });

  // Nothing written, nothing audited.
  assert.equal(await nodeOf(c1.id), null, "dry-run must not persist");
  assert.equal(await nodeOf(c2.id), null, "dry-run must not persist");
  assert.equal(
    await backfilledAuditCount([c1.id, c2.id]),
    0,
    "dry-run must not audit"
  );
  // But the preview shows both cubes placed + a correct total.
  const s = serverResult(dry, server.id);
  assert.equal(s.assignments.length, 2, "preview covers both eligible cubes");
  assert.equal(dry.applied, false);
  assert.equal(dry.totalAssigned, 2, "dry-run total reflects the preview");
});

test("backfill apply: assigns + audits eligible cubes, balances across nodes, idempotent", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    status: "active",
    numaNodeCount: 2,
    numaTopology: TWO_NODE,
  });
  // Two equal heavy cubes → greedy bin-packing must split them across nodes.
  const c1 = await seedCube(space.id, server.id, {
    vcpus: 4,
    ramMb: 4000,
    status: "running",
    numaNode: null,
  });
  const c2 = await seedCube(space.id, server.id, {
    vcpus: 4,
    ramMb: 4000,
    status: "running",
    numaNode: null,
  });
  const c3 = await seedCube(space.id, server.id, {
    vcpus: 1,
    ramMb: 1024,
    status: "sleeping",
    numaNode: null,
  });
  // Already-assigned → skipped. Sentinel node 9 (the allocator can never pick it
  // on a 2-node host) proves the row is left UNTOUCHED, not coincidentally
  // re-derived to the same value.
  const c4 = await seedCube(space.id, server.id, {
    vcpus: 1,
    ramMb: 1024,
    status: "running",
    numaNode: 9,
  });
  // Deleted → never touched.
  const c5 = await seedCube(space.id, server.id, {
    vcpus: 8,
    ramMb: 8000,
    status: "deleted",
    numaNode: null,
  });

  const res = await backfillNumaNodes({ apply: true, serverIds: [server.id] });
  const s = serverResult(res, server.id);

  assert.equal(s.assignments.length, 3, "3 eligible cubes assigned");
  assert.equal(res.totalAssigned, 3, "total matches");
  assert.equal(
    s.alreadyAssigned,
    1,
    "the pre-assigned cube is reported, not re-touched"
  );
  assert.notEqual(await nodeOf(c1.id), null);
  assert.notEqual(await nodeOf(c2.id), null);
  assert.notEqual(await nodeOf(c3.id), null);
  assert.equal(
    await nodeOf(c4.id),
    9,
    "pre-assigned cube UNTOUCHED (sentinel)"
  );
  assert.equal(await nodeOf(c5.id), null, "deleted cube untouched");
  // The two equal heavy cubes split across the two nodes.
  assert.notEqual(
    await nodeOf(c1.id),
    await nodeOf(c2.id),
    "greedy placement spreads the two heaviest across both nodes"
  );

  // Rule 9: every assignment wrote exactly one audit row with correct payload.
  assert.equal(
    await backfilledAuditCount([c1.id, c2.id, c3.id]),
    3,
    "one cube.numa_backfilled audit row per assigned cube"
  );
  assert.equal(
    await backfilledAuditCount([c4.id, c5.id]),
    0,
    "skipped/deleted cubes are never audited"
  );
  const a1 = await backfilledAudit(c1.id);
  assert.ok(a1);
  assert.equal(a1.spaceId, space.id, "audit carries the cube's space");
  assert.equal(a1.source, "system", "operator-run script audits as system");
  assert.equal(
    (a1.metadata as { serverId?: string; node?: number }).serverId,
    server.id,
    "audit metadata carries the server"
  );
  assert.equal(
    (a1.metadata as { serverId?: string; node?: number }).node,
    await nodeOf(c1.id),
    "audit metadata node matches the persisted node"
  );

  // Re-run is a no-op for this server (all eligible cubes now have a node) — and
  // writes no new audit rows.
  const again = await backfillNumaNodes({
    apply: true,
    serverIds: [server.id],
  });
  const s2 = serverResult(again, server.id);
  assert.equal(s2.assignments.length, 0, "re-run assigns nothing");
  assert.equal(s2.alreadyAssigned, 4, "all 4 non-deleted cubes now assigned");
  assert.equal(
    await backfilledAuditCount([c1.id, c2.id, c3.id]),
    3,
    "re-run adds no new audit rows"
  );
});

test("backfill: cubes in transient status OR mid-transfer are skipped (not eligible)", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    status: "active",
    numaNodeCount: 2,
    numaTopology: TWO_NODE,
  });
  const transferring = await seedCube(space.id, server.id, {
    vcpus: 2,
    ramMb: 2048,
    status: "running",
    numaNode: null,
    transferState: "snapshotting",
  });
  const booting = await seedCube(space.id, server.id, {
    vcpus: 2,
    ramMb: 2048,
    status: "booting",
    numaNode: null,
  });
  const eligible = await seedCube(space.id, server.id, {
    vcpus: 2,
    ramMb: 2048,
    status: "running",
    numaNode: null,
  });

  const res = await backfillNumaNodes({ apply: true, serverIds: [server.id] });
  const s = serverResult(res, server.id);

  assert.equal(s.assignments.length, 1, "only the eligible cube is assigned");
  assert.notEqual(await nodeOf(eligible.id), null);
  assert.equal(
    await nodeOf(transferring.id),
    null,
    "mid-transfer cube left unpinned"
  );
  assert.equal(
    await nodeOf(booting.id),
    null,
    "transient-status cube left unpinned"
  );
  assert.equal(
    s.skippedNotEligible,
    2,
    "both ineligible cubes reported (no silent drop)"
  );
});

test("backfill: single-socket host is a no-op (cube stays null, counted as single-socket)", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    status: "active",
    numaNodeCount: 1,
    numaTopology: null,
  });
  const c = await seedCube(space.id, server.id, {
    vcpus: 2,
    ramMb: 2048,
    status: "running",
    numaNode: null,
  });

  const res = await backfillNumaNodes({ apply: true, serverIds: [server.id] });

  assert.equal(await nodeOf(c.id), null, "single-socket cube stays unpinned");
  assert.ok(
    !res.servers.find((x) => x.serverId === server.id),
    "single-socket server is not in the multi-socket result set"
  );
  assert.equal(
    res.singleSocketServers,
    1,
    "reported as a single-socket no-op host"
  );
  assert.equal(res.totalAssigned, 0);
});

test("backfill: multi-socket host with undetected topology is flagged, not assigned", async () => {
  const space = await seedSpace();
  const server = await seedServer({
    status: "active",
    numaNodeCount: 2,
    numaTopology: null, // detected count > 1 but topology never populated
  });
  const c = await seedCube(space.id, server.id, {
    vcpus: 2,
    ramMb: 2048,
    status: "running",
    numaNode: null,
  });

  const res = await backfillNumaNodes({ apply: true, serverIds: [server.id] });
  const s = serverResult(res, server.id);

  assert.equal(
    s.topologyMissing,
    true,
    "flagged so the operator runs install:numa-detect"
  );
  assert.equal(s.assignments.length, 0);
  assert.equal(await nodeOf(c.id), null, "no assignment without topology");
});
