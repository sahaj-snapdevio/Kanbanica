import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import type { Client } from "ssh2";
import { cubes, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { chargeProratedUsageWithAudit } from "@/lib/cost";
import { db } from "@/lib/db";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { reconcileServerResources } from "@/lib/server/allocate";
import { connectToServer, sleepCube } from "@/lib/ssh";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeSleepPayload } from "@/lib/worker/job-types";

async function handleCubeSleepJob(job: Job<CubeSleepPayload>): Promise<void> {
  const { cubeId, spaceId, serverId } = job.data;
  const log = new JobLogger(job.id, "cube.sleep", "cube", cubeId);
  console.log(`[cube-sleep] starting for cubeId=${cubeId}`);
  await log.info("Cube sleep started");

  // 1. Atomically claim cube inside a transaction to prevent concurrent wake/sleep/delete races
  const cube = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(cubes)
      .where(eq(cubes.id, cubeId))
      .for("update")
      .limit(1);
    if (row?.status !== "running") {
      return null;
    }

    // Mark as stopping to prevent other operations from claiming it
    await tx
      .update(cubes)
      .set({ status: "stopping", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));

    return row;
  });

  if (!cube) {
    console.log(
      `[cube-sleep] cube ${cubeId} not found or not running, skipping`
    );
    return;
  }

  // 2. Connect to the host. GUARDED (Rule 58): the cube is already claimed
  //    `stopping`, so a host-down connect failure MUST revert it to `running`
  //    (the VM was never paused) and rethrow — otherwise the cube strands in
  //    `stopping` forever, because the claim above requires `running` and the
  //    pg-boss retry would short-circuit. state-sync reconciles once the host
  //    returns; the retry re-attempts the sleep.
  let client: Client;
  try {
    ({ client } = await connectToServer(serverId));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-sleep] host unreachable for cubeId=${cubeId}:`, err);
    await log.error(`Cube sleep failed to connect to host: ${reason}`);
    await db
      .update(cubes)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId))
      .catch(() => {});
    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: "running",
    }).catch(() => {});
    await audit({
      action: "cube.sleep_recovered",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description:
        "Cube sleep failed to connect to host; reverted to running (VM was never paused)",
      metadata: { serverId, vmPaused: false, error: reason.slice(0, 1000) },
      source: "worker",
    }).catch(() => {});
    throw err;
  }

  // Tracks whether the VM has actually been paused on the hypervisor. From
  // the moment this flips true, the cube IS asleep — any subsequent failure
  // (billing tx, status flip, reconcile) must NOT revert to "running" or
  // we'd put a paused-VM cube back into the hourly billing rotation while
  // it sits unusable. See Fix #2 in billing audit (2026-05-27).
  let vmPaused = false;

  try {
    // 3a. Pause Cube via Firecracker API (PATCH /vm state Paused) FIRST,
    // then charge prorated usage. This order prevents charging for time the
    // VM was still running if the sleep operation fails.
    await log.step("Pause Firecracker VM", async () => {
      await sleepCube(client, cubeId, cube.launchMode);
    });
    vmPaused = true;

    // 3b. Charge prorated usage after successful pause. Billing failure
    //     means lost revenue — surface via audit log so it shows up in
    //     the admin billing dashboard rather than only the worker log
    //     (Rule 51, audit M5 2026-05-24). The helper writes the
    //     `cube.billing_prorated_failed` audit row on catch.
    await chargeProratedUsageWithAudit(cube, {
      flow: "sleep",
      logPrefix: "[cube-sleep]",
      metadata: { serverId: cube.serverId },
    });

    // 4. Update Cube status, clear billing clock (no longer billable), and
    //    rebuild the server's allocation counters so the sleeping cube
    //    releases its CPU+RAM back to the host pool (disk stays reserved —
    //    rootfs is still on the host filesystem). One transaction so a
    //    crash between the status flip and the reconcile can't leave the
    //    server over-counting an already-sleeping cube.
    //    `snapshottedSinceSleep: false` re-arms the auto-snapshot scheduler
    //    so the cube gets one auto-snapshot after the sleep transition;
    //    further ticks skip until the cube wakes again (rootfs is frozen
    //    while sleeping).
    await db.transaction(async (tx) => {
      await tx
        .update(cubes)
        .set({
          status: "sleeping",
          lastBilledAt: null,
          snapshottedSinceSleep: false,
          updatedAt: new Date(),
        })
        .where(eq(cubes.id, cubeId));
      await reconcileServerResources(tx, cube.serverId);
    });

    // 5. Write lifecycle log. Sleep-storage billing continues for the
    //    cube's disk footprint — the compute (vCPU + RAM) clock stops here
    //    but the rootfs still occupies host disk and bills hourly at the
    //    same DISK_RATE running cubes pay (config/platform.ts, via
    //    `calculateSleepHourlyCost`). Always on — set DISK_RATE = 0 in
    //    config/platform.ts to disable (also disables running-disk billing).
    const message = cube.zeroBalanceSleep
      ? "Cube slept — insufficient credits (compute charges stopped; sleep-storage billing continues for disk)"
      : "Cube put to sleep — compute charges stopped; sleep-storage billing continues for disk";
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message,
    });

    // 6. Fire Pusher event + outbound webhooks
    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "sleeping" });
    dispatchWebhookEvent(spaceId, "cube.sleeping", {
      cube: buildCubeSummary({ ...cube, status: "sleeping" }),
      zeroBalance: cube.zeroBalanceSleep,
    });

    audit({
      action: "cube.sleep_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: cube.zeroBalanceSleep
        ? "Cube slept due to zero balance"
        : "Cube put to sleep",
      metadata: {
        serverId,
        reason: cube.zeroBalanceSleep ? "zero_balance" : "user_requested",
      },
      source: "worker",
    });

    console.log(`[cube-sleep] completed cubeId=${cubeId}`);
    await log.info("Cube sleep complete");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-sleep] failed cubeId=${cubeId}:`, err);
    await log.error(`Cube sleep failed: ${reason}`);

    // Fix #2: choose the recovery state based on what we actually completed.
    //   - VM never paused → revert to "running"; the cube is still up, the
    //     customer can retry.
    //   - VM was paused (sleepCube succeeded) but a later step (billing,
    //     status flip) failed → the cube IS asleep on the hypervisor; forcing
    //     status back to "running" would re-add it to the hourly billing
    //     rotation while it sits unusable until cube.state-sync catches the
    //     mismatch (up to 2 min — and state-sync's mismatch path only fires
    //     for dbStatus="running" + hypervisorState="paused", not for the
    //     "stopping" status we left behind here). Forward-flip to "sleeping"
    //     with lastBilledAt cleared so the hourly cron skips it.
    //
    //   Do NOT touch `lastStartedAt` in either branch — the cube never
    //   actually started (this is an error-revert from a sleep attempt).
    //   Advancing it would corrupt the most-recently-started ordering used
    //   by `lib/plan/reconcile.ts` on plan-downgrade (audit M1, 2026-05-24).
    const recoveryStatus = vmPaused ? "sleeping" : "running";
    await db
      .update(cubes)
      .set({
        status: recoveryStatus,
        ...(vmPaused ? { lastBilledAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId))
      .catch(() => {});

    if (vmPaused) {
      // Rebuild server resource counters since the cube is now sleeping
      // (CPU+RAM released back to host pool). Best-effort — if this fails,
      // server.reconcile will fix it on the next tick.
      await db
        .transaction(async (tx) => {
          await reconcileServerResources(tx, cube.serverId);
        })
        .catch(() => {});

      await db
        .insert(lifecycleLogs)
        .values({
          entityType: "cube",
          entityId: cubeId,
          message: `Sleep flow failed mid-transaction but VM is paused — cube recovered as sleeping. Compute charges stopped; sleep-storage billing continues for disk. Error: ${reason.slice(0, 200)}`,
        })
        .catch(() => {});
    }

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: recoveryStatus,
    }).catch(() => {});

    // Await the recovery audit so the row is durably flushed before pg-boss
    // tears down the worker on the re-throw. The fire-and-forget pattern
    // common to `audit()` callers is safe on the success path; here the
    // immediate `throw` race-conditions the unawaited insert.
    await audit({
      action: "cube.sleep_recovered",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube sleep failed; recovered as ${recoveryStatus} (VM ${vmPaused ? "was paused" : "was not paused"})`,
      metadata: {
        serverId,
        vmPaused,
        error: reason.slice(0, 1000),
      },
      source: "worker",
    }).catch(() => {});

    throw err;
  } finally {
    client.end();
  }
}

export async function handleCubeSleep(
  jobs: Job<CubeSleepPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubeSleepJob(job);
  }
}
