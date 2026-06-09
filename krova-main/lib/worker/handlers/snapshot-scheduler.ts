/**
 * Per-plan auto-snapshot scheduler. Replaces the legacy platform-wide
 * `snapshot-auto.ts` handler — instead of a single global cadence, each
 * plan declares its own cadence + retention policy, and this cron
 * decides per-cube whether a snapshot is due.
 *
 * Runs hourly. For every cube whose plan declares a cadence:
 *  - `running` cubes are due when `now - lastAutoSnapshotAt >= cadence`.
 *  - `sleeping` cubes get AT MOST ONE auto-snapshot per sleep cycle —
 *    the cube-sleep handler flips `snapshotted_since_sleep = false` on
 *    transition, and this handler runs exactly one snapshot then leaves
 *    the cube alone until it wakes (rootfs is frozen while sleeping).
 *  - `error` / `transferring` / `booting` / `pending` cubes are skipped.
 *
 * Idempotency: re-running the scheduler within the same hour is a no-op
 * because `shouldScheduleAutoSnapshot` checks the cadence gate on every
 * decision. The actual `snapshot.create` handler enforces its own
 * per-snapshot atomic claim.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Job } from "pg-boss";
import { cubeSnapshots, cubes, plans, spaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isServerReachable } from "@/lib/ssh";
import { selectBackend } from "@/lib/storage/backends";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/** Minimal cube shape consumed by `shouldScheduleAutoSnapshot`. */
export interface SchedulerCubeRow {
  lastAutoSnapshotAt: Date | null;
  snapshottedSinceSleep: boolean;
  status: string;
}

/** Minimal plan shape consumed by `shouldScheduleAutoSnapshot`. */
export interface SchedulerPlanRow {
  autoSnapshotCadenceHours: number | null;
}

/**
 * Pure decision function — returns true iff an auto-snapshot should be
 * enqueued for this cube on this tick. Exported separately from the
 * handler so it's trivial to reason about and unit-test without DB I/O.
 *
 * Rules (in order):
 *  1. Plan must declare a cadence. Trial (null) opts out entirely.
 *  2. Cube must be `running` or `sleeping`. Any other status (error,
 *     pending, booting, stopping, deleted, plus the transfer states)
 *     means the rootfs isn't a stable target.
 *  3. Sleeping cube: due iff `snapshottedSinceSleep` is false (one shot
 *     per sleep cycle).
 *  4. Running cube: due iff no prior auto-snapshot OR cadence elapsed.
 */
export function shouldScheduleAutoSnapshot(
  cube: SchedulerCubeRow,
  plan: SchedulerPlanRow,
  now: Date
): boolean {
  if (plan.autoSnapshotCadenceHours == null) {
    return false;
  }
  if (cube.status !== "running" && cube.status !== "sleeping") {
    return false;
  }
  if (cube.status === "sleeping") {
    return cube.snapshottedSinceSleep === false;
  }
  if (cube.lastAutoSnapshotAt == null) {
    return true;
  }
  const elapsedMs = now.getTime() - cube.lastAutoSnapshotAt.getTime();
  const cadenceMs = plan.autoSnapshotCadenceHours * 3600 * 1000;
  return elapsedMs >= cadenceMs;
}

export async function handleSnapshotScheduler(_jobs: Job[]): Promise<void> {
  void _jobs;

  // Pre-flight: no active backend → skip the whole cycle. Same protection
  // the legacy snapshot-auto.ts had — avoids inserting `pending` snapshot
  // rows whose backing jobs would loop on "no backend".
  const probeBackend = await selectBackend().catch(() => null);
  if (!probeBackend) {
    console.warn("[snapshot-scheduler] no active storage backend — skipping");
    return;
  }

  const rows = await db
    .select({
      id: cubes.id,
      name: cubes.name,
      status: cubes.status,
      spaceId: cubes.spaceId,
      serverId: cubes.serverId,
      lastAutoSnapshotAt: cubes.lastAutoSnapshotAt,
      snapshottedSinceSleep: cubes.snapshottedSinceSleep,
      cadence: plans.autoSnapshotCadenceHours,
    })
    .from(cubes)
    .innerJoin(spaces, eq(cubes.spaceId, spaces.id))
    .innerJoin(plans, eq(spaces.planId, plans.id))
    .where(
      and(
        inArray(cubes.status, ["running", "sleeping"]),
        // A cube mid cross-server transfer keeps status='running'/'sleeping'
        // (transfer state lives in the separate cubeTransferState enum) while
        // `cube.transfer` is mid cp/rsync of rootfs.ext4. Snapshotting it would
        // restic-backup a torn, half-written ext4 and mark it `complete` —
        // silently unrestorable. Skip until the transfer settles (audit H2).
        eq(cubes.transferState, "idle"),
        isNotNull(plans.autoSnapshotCadenceHours)
      )
    );

  const now = new Date();
  // Timestamp suffix used as the snapshot name — keeps backwards-compat
  // with the customer-visible "Auto YYYY-MM-DD HH:MM" pattern from the
  // legacy handler so existing dashboard filters keep matching.
  const timestamp = now.toISOString().slice(0, 16).replace("T", " ");
  let enqueued = 0;
  let considered = 0;
  let skippedUnreachable = 0;
  // Probe each distinct host's SSH port once per tick. A host that's down
  // (EHOSTUNREACH) gets its cubes SKIPPED — we don't create a doomed `pending`
  // snapshot row that would only fail on connect. It's retried next tick once
  // the host returns. This is what would have prevented the 2026-05-28 mango
  // outage from leaving a batch of stuck rows.
  const reachabilityByServer = new Map<string, boolean>();

  for (const row of rows) {
    considered++;
    const decide = shouldScheduleAutoSnapshot(
      {
        status: row.status,
        lastAutoSnapshotAt: row.lastAutoSnapshotAt,
        snapshottedSinceSleep: row.snapshottedSinceSleep,
      },
      { autoSnapshotCadenceHours: row.cadence },
      now
    );
    if (!decide) {
      continue;
    }

    let reachable = reachabilityByServer.get(row.serverId);
    if (reachable === undefined) {
      reachable = await isServerReachable(row.serverId);
      reachabilityByServer.set(row.serverId, reachable);
    }
    if (!reachable) {
      skippedUnreachable++;
      continue;
    }

    try {
      const [snap] = await db
        .insert(cubeSnapshots)
        .values({
          cubeId: row.id,
          spaceId: row.spaceId,
          name: `Auto ${timestamp}`,
          status: "pending",
          kind: "auto",
        })
        .returning();
      await enqueueJob(JOB_NAMES.SNAPSHOT_CREATE, {
        snapshotId: snap.id,
        cubeId: row.id,
        spaceId: row.spaceId,
        serverId: row.serverId,
      });
      enqueued++;
    } catch (err) {
      console.error(
        `[snapshot-scheduler] failed to enqueue for cube ${row.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  audit({
    action: "snapshot.scheduler_tick",
    category: "platform",
    actorType: "system",
    entityType: "cube",
    description: `Scheduler tick — eligible=${considered} enqueued=${enqueued} skipped(host down)=${skippedUnreachable}`,
    metadata: { considered, enqueued, skippedUnreachable },
    source: "worker",
  });

  console.log(
    `[snapshot-scheduler] tick complete — considered=${considered} enqueued=${enqueued} skipped(host down)=${skippedUnreachable}`
  );
}
