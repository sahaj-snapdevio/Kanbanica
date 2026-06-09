/**
 * Cube power-off worker.
 *
 * Distinct from `cube-sleep` (which PAUSES the Firecracker VM via the
 * `PATCH /vm state=Paused` API): power-off KILLS the Firecracker process
 * entirely. The customer-visible status is still `sleeping` (the existing
 * enum covers both paused-VM and shut-off-process — `cube-wake` detects
 * which one and either resumes or cold-restarts). The difference becomes
 * visible on wake: a resume-from-paused is instant, while a cold restart
 * re-loads the kernel from disk and is several seconds slower.
 *
 * Side benefit relied on by the resize UI: a cube provisioned before
 * live-resize support has `hasVirtioMem=false` and is locked out of the
 * resize sheet. Power-off → start triggers a fresh boot through the
 * `useVirtioMem=true` path in `bootCubeVm`, after which `cube-wake` /
 * `cube-power-off` flip `hasVirtioMem=true` and the resize button unlocks.
 */

import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import type { Client } from "ssh2";
import { cubes, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { chargeProratedUsageWithAudit } from "@/lib/cost";
import { db } from "@/lib/db";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { reconcileServerResources } from "@/lib/server/allocate";
import { connectToServer, powerOffCube } from "@/lib/ssh";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubePowerOffPayload } from "@/lib/worker/job-types";

async function handleCubePowerOffJob(
  job: Job<CubePowerOffPayload>
): Promise<void> {
  const { cubeId, spaceId, serverId } = job.data;
  const log = new JobLogger(job.id, "cube.power-off", "cube", cubeId);
  console.log(`[cube-power-off] starting for cubeId=${cubeId}`);
  await log.info("Cube power-off started");

  // 1. Atomically claim the cube to prevent racing concurrent
  //    sleep/wake/delete/power-off operations. We accept `running` and
  //    `stopping` (the latter is what `transitionCubeStatus` sets in the
  //    action layer before enqueuing this job).
  const cube = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(cubes)
      .where(eq(cubes.id, cubeId))
      .for("update")
      .limit(1);
    if (!row) {
      return null;
    }
    if (row.status !== "running" && row.status !== "stopping") {
      return null;
    }

    await tx
      .update(cubes)
      .set({ status: "stopping", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));

    return row;
  });

  if (!cube) {
    console.log(
      `[cube-power-off] cube ${cubeId} not in a power-off-able state, skipping`
    );
    return;
  }

  // Connect to the host. GUARDED (Rule 58): the cube is already claimed
  // `stopping`, so a host-down connect failure MUST revert it to `running`
  // (the VM was never killed and is still alive on the host) and rethrow —
  // otherwise the cube strands in `stopping` forever. state-sync reconciles
  // when the host returns; the retry re-attempts the power-off.
  let client: Client;
  try {
    ({ client } = await connectToServer(serverId));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[cube-power-off] host unreachable for cubeId=${cubeId}:`,
      err
    );
    await log.error(`Cube power-off failed to connect to host: ${reason}`);
    await db
      .update(cubes)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId))
      .catch(() => {});
    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: "running",
    }).catch(() => {});
    await audit({
      action: "cube.power_off_recovered",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description:
        "Cube power-off failed to connect to host; reverted to running (VM was never killed)",
      metadata: { serverId, vmKilled: false, error: reason.slice(0, 1000) },
      source: "worker",
    }).catch(() => {});
    throw err;
  }

  // Tracks whether the Firecracker process has been killed. From the moment
  // this flips true, the cube IS down — any subsequent failure must NOT
  // revert status to "running" or we'd bill an unusable cube until
  // cube.state-sync catches the mismatch. See Fix #2 in billing audit.
  let vmKilled = false;

  try {
    // 2. Kill the Firecracker process FIRST, then charge prorated usage.
    //    Mirrors the sleep handler's order so we don't bill for time the
    //    VM was still running if the kill fails.
    await log.step("Kill Firecracker process", async () => {
      await powerOffCube(client, cubeId, cube.launchMode);
    });
    vmKilled = true;

    // Rule 51: prorated billing failure must land in the audit log so the
    // operator can recover the lost charge (the cube row + lastBilledAt
    // are about to be cleared, making this non-recoverable otherwise).
    await chargeProratedUsageWithAudit(cube, {
      flow: "power-off",
      logPrefix: "[cube-power-off]",
      metadata: { serverId: cube.serverId },
    });

    // 3. Move the cube to `sleeping` and rebuild the server's allocation
    //    counters in one transaction. The Firecracker process is dead, so
    //    its CPU+RAM should be released back to the host pool — the
    //    reconcile call applies the platform's "sleeping cubes free CPU+RAM
    //    but still occupy disk" rule. The wake handler detects the killed
    //    process via `getCubeStatus` (returns "shut off") and cold-restarts
    //    automatically; no per-cube flag needed.
    //    `snapshottedSinceSleep: false` re-arms the auto-snapshot scheduler
    //    so the cube gets one auto-snapshot after the sleep transition.
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

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message:
        "Cube powered off — compute charges stopped; sleep-storage billing continues for disk",
    });

    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "sleeping" });
    dispatchWebhookEvent(spaceId, "cube.sleeping", {
      cube: buildCubeSummary({ ...cube, status: "sleeping" }),
      reason: "power_off",
    });

    audit({
      action: "cube.power_off_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: "Cube powered off — Firecracker process killed",
      metadata: { serverId },
      source: "worker",
    });

    console.log(`[cube-power-off] completed cubeId=${cubeId}`);
    await log.info("Cube power-off complete");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-power-off] failed cubeId=${cubeId}:`, err);
    await log.error(`Cube power-off failed: ${reason}`);

    // Fix #2 — same recovery split as cube-sleep:
    //   - VM never killed → revert to "running"; user can retry.
    //   - VM was killed (powerOffCube succeeded) but a later step failed →
    //     forward-flip to "sleeping" with lastBilledAt cleared. The wake
    //     handler detects the killed process and cold-restarts on the
    //     customer's next wake; reverting to "running" here would keep
    //     billing for an unusable cube until state-sync catches up.
    //
    //   Do NOT touch `lastStartedAt` (audit M1, 2026-05-24).
    const recoveryStatus = vmKilled ? "sleeping" : "running";
    await db
      .update(cubes)
      .set({
        status: recoveryStatus,
        ...(vmKilled ? { lastBilledAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId))
      .catch(() => {});

    if (vmKilled) {
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
          message: `Power-off flow failed mid-transaction but Firecracker is dead — cube recovered as sleeping. Compute charges stopped; sleep-storage billing continues for disk. Error: ${reason.slice(0, 200)}`,
        })
        .catch(() => {});
    }

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: recoveryStatus,
    }).catch(() => {});

    // Await the recovery audit so the row is durably flushed before pg-boss
    // tears down the worker on the re-throw. Same reasoning as cube-sleep.ts.
    await audit({
      action: "cube.power_off_recovered",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube power-off failed; recovered as ${recoveryStatus} (VM ${vmKilled ? "was killed" : "was not killed"})`,
      metadata: {
        serverId,
        vmKilled,
        error: reason.slice(0, 1000),
      },
      source: "worker",
    }).catch(() => {});

    throw err;
  } finally {
    client.end();
  }
}

export async function handleCubePowerOff(
  jobs: Job<CubePowerOffPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubePowerOffJob(job);
  }
}
