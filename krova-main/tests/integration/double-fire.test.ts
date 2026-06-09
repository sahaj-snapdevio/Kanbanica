import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueJob, getBoss } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";
import { seedCube, seedServer, seedSpace } from "@/tests/integration/_seed";

// This is the only integration test that starts pg-boss (getBoss). pg-boss
// keeps an open pool + maintenance timers alive, which would hang `node --test`
// at the end of the suite — stop it once these tests finish.
after(async () => {
  const boss = await getBoss();
  // Default stop: graceful (no workers/jobs here so it's instant) + closes the
  // owned pool, so `node --test` can exit instead of hanging on pg-boss timers.
  await boss.stop().catch(() => {});
});

// Validates the 2026-05-31 double-fire fixes end-to-end against real pg-boss +
// real rows: (1) the exclusive-queue + singletonKey dedup that stops a
// double-click re-enqueueing cold-restart/resize/transfer/update-images, and
// (2) the cube-transfer atomic transferState claim.

test("exclusive queue + singletonKey dedupes a duplicate enqueue", async () => {
  await getBoss(); // ensure queues are created with their QUEUE_OPTIONS policies

  for (const queue of [
    JOB_NAMES.CUBE_COLD_RESTART,
    JOB_NAMES.CUBE_RESIZE,
    JOB_NAMES.CUBE_TRANSFER,
    JOB_NAMES.SERVER_UPDATE_IMAGES,
  ]) {
    const key = `e2e-dedup:${createId()}`;
    const first = await enqueueJob(queue, { probe: 1 }, { singletonKey: key });
    const second = await enqueueJob(queue, { probe: 2 }, { singletonKey: key });
    assert.ok(first, `${queue}: first enqueue should return a job id`);
    assert.equal(
      second,
      null,
      `${queue}: a second enqueue with the SAME singletonKey must be deduped (null) — proves policy:"exclusive"`
    );

    // A different key is NOT deduped (dedup is per-key, not a global lock).
    const other = await enqueueJob(
      queue,
      { probe: 3 },
      { singletonKey: `e2e-dedup:${createId()}` }
    );
    assert.ok(other, `${queue}: a different singletonKey must NOT be deduped`);
  }
});

test("cube transfer: atomic transferState claim picks exactly one winner", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const cube = await seedCube(space.id, server.id, { status: "running" });
  // (transferState defaults to 'idle')

  // The exact conditional UPDATE the transfer route uses. Run twice
  // concurrently — Postgres row-locking serializes them; the first flips
  // idle→snapshotting, the second re-evaluates the WHERE (now snapshotting)
  // and claims nothing.
  const claim = () =>
    db
      .update(schema.cubes)
      .set({
        transferState: "snapshotting",
        transferDestinationServerId: server.id,
        transferStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.cubes.id, cube.id),
          inArray(schema.cubes.transferState, ["idle", "failed"]),
          inArray(schema.cubes.status, ["running", "sleeping"])
        )
      )
      .returning({ id: schema.cubes.id });

  const [a, b] = await Promise.all([claim(), claim()]);
  const winners = a.length + b.length;
  assert.equal(winners, 1, "exactly one concurrent transfer claim must win");

  const [row] = await db
    .select({ ts: schema.cubes.transferState })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cube.id))
    .limit(1);
  assert.equal(row?.ts, "snapshotting", "cube is claimed into snapshotting");

  // A subsequent claim while already snapshotting also wins nothing.
  const again = await claim();
  assert.equal(again.length, 0, "no claim once the transfer is in progress");
});
