/**
 * cube.error-recovery — try to revive ONE cube parked in `status='error'`.
 *
 * Enqueued by the `cube.error-recovery-scan` cron (every 5 min) only for
 * cubes whose host is reachable AND whose `error_recovery_attempts` is still
 * below `MAX_ERROR_RECOVERY_ATTEMPTS`. The flow mirrors `cube.auto-relaunch`:
 * atomically claim `error → booting`, call startCube with the existing
 * machine config + rootfs (customer state preserved), then flip to `running`.
 *
 * Attempt accounting (the hard 3-strike cap, Option B):
 *  - On SUCCESS: status → `running`, `error_recovery_attempts` reset to 0, so
 *    a later unrelated error episode gets a fresh budget.
 *  - On FAILURE: status → `error`, `error_recovery_attempts` set to the new
 *    attempt number. Once it reaches the cap the cron stops enqueuing and this
 *    handler emails the admins once.
 *
 * retryLimit=0 (see ensure-queues.ts): the cron + the DB counter own retries,
 * not pg-boss. The handler therefore NEVER rethrows on a recovery failure —
 * rethrowing would let pg-boss re-run the job and double-count attempts.
 */

import { and, eq, ne } from "drizzle-orm";
import type { Job } from "pg-boss";
import { MAX_ERROR_RECOVERY_ATTEMPTS } from "@/config/platform";
import { cubes, lifecycleLogs, servers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { resolveLaunchModeForCube } from "@/lib/cubes/launch-mode";
import { cubeNumaLaunchOpts } from "@/lib/cubes/numa-launch-opts";
import { db } from "@/lib/db";
import { notifyAdminsOfCubeError } from "@/lib/email/notify-error";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { connectToServer, startCube } from "@/lib/ssh";
import { formatImageVersion } from "@/lib/version";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeErrorRecoveryPayload } from "@/lib/worker/job-types";

type RecoveryCube = {
  id: string;
  name: string;
  vcpus: number;
  ramMb: number;
  diskLimitGb: number;
  imageId: string;
  internalIp: string | null;
  serverId: string;
  launchMode: "bare" | "jailed";
  jailerUid: number | null;
  errorRecoveryAttempts: number;
};

async function runHandler(job: Job<CubeErrorRecoveryPayload>): Promise<void> {
  const { cubeId, spaceId, serverId } = job.data;
  const log = new JobLogger(job.id, "cube.error_recovery", "cube", cubeId);

  // 1. Load cube + its current attempt count.
  const [cube] = await db
    .select({
      id: cubes.id,
      name: cubes.name,
      vcpus: cubes.vcpus,
      ramMb: cubes.ramMb,
      diskLimitGb: cubes.diskLimitGb,
      imageId: cubes.imageId,
      internalIp: cubes.internalIp,
      serverId: cubes.serverId,
      launchMode: cubes.launchMode,
      jailerUid: cubes.jailerUid,
      status: cubes.status,
      errorRecoveryAttempts: cubes.errorRecoveryAttempts,
    })
    .from(cubes)
    .where(eq(cubes.id, cubeId))
    .limit(1);

  if (!cube) {
    return;
  }
  if (cube.status !== "error") {
    await log.info(
      `Cube "${cube.name}" is no longer in error (status=${cube.status}) — skipping recovery`
    );
    return;
  }
  if (cube.errorRecoveryAttempts >= MAX_ERROR_RECOVERY_ATTEMPTS) {
    await log.info(
      `Cube "${cube.name}" already hit the ${MAX_ERROR_RECOVERY_ATTEMPTS}-attempt cap — leaving in error for manual handling`
    );
    return;
  }

  const attempt = cube.errorRecoveryAttempts + 1;

  if (!cube.internalIp || cube.vcpus <= 0 || cube.ramMb <= 0) {
    await recordFailure(
      cube,
      spaceId,
      serverId,
      attempt,
      `missing config (ip=${cube.internalIp}, vcpus=${cube.vcpus}, ram=${cube.ramMb})`,
      log
    );
    return;
  }

  await log.info(
    `Auto-recovery attempt ${attempt}/${MAX_ERROR_RECOVERY_ATTEMPTS} for cube "${cube.name}"`
  );

  // 2. Connect FIRST (guarded). If the host is down the cube stays in `error`
  //    cleanly — we just count the attempt and let the next tick retry.
  let client: Awaited<ReturnType<typeof connectToServer>>["client"];
  try {
    client = (await connectToServer(serverId)).client;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordFailure(cube, spaceId, serverId, attempt, reason, log);
    return;
  }

  try {
    // 3. Atomically claim `error → booting`. If another path (manual restart,
    //    delete) changed the status in the meantime, the claim returns nothing
    //    and we bail without consuming an attempt.
    const [claimed] = await db
      .update(cubes)
      .set({ status: "booting", updatedAt: new Date() })
      .where(and(eq(cubes.id, cubeId), eq(cubes.status, "error")))
      .returning({ id: cubes.id });
    if (!claimed) {
      await log.info(
        `Cube "${cube.name}" status changed concurrently — skipping recovery`
      );
      return;
    }
    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "booting" });

    // Read the server's current on-disk kernel (best-effort) so a successful
    // recovery refreshes bootedKernelVersion, same as cold-restart / relaunch.
    let refreshedKernelVersion: number | null = null;
    try {
      const [serverRow] = await db
        .select({ currentKernelVersion: servers.currentKernelVersion })
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1);
      if (serverRow) {
        refreshedKernelVersion = serverRow.currentKernelVersion;
      }
    } catch (err) {
      console.warn(
        "[cube-error-recovery] kernel version read failed (non-fatal):",
        err instanceof Error ? err.message : err
      );
    }

    // 4. Relaunch. startCube's virtio-mem probe + plug-wait can approach 90s
    //    under fleet load — wrap in withCubeHeartbeat so cube.stale-check's
    //    10-min threshold can't kill the in-flight boot (Rule 34).
    let hasVirtioMem = false;
    const ip = cube.internalIp;
    const { launchMode, jailerUid } = await resolveLaunchModeForCube({
      id: cubeId,
      serverId: cube.serverId ?? serverId,
      launchMode: cube.launchMode,
      jailerUid: cube.jailerUid,
    });
    await withCubeHeartbeat(cubeId, async () => {
      await log.step(`Relaunch cube "${cube.name}" via startCube`, async () => {
        const r = await startCube(client, cubeId, {
          vcpus: cube.vcpus,
          ramMb: cube.ramMb,
          internalIp: ip,
          launchMode,
          jailerUid,
          ...(await cubeNumaLaunchOpts(cubeId)),
        });
        hasVirtioMem = r.hasVirtioMem;
      });
    });

    // 5. Success: running + reset the attempt counter. `ne("deleted")` guards
    //    against a concurrent cube.delete claiming the row mid-boot.
    await db
      .update(cubes)
      .set({
        status: "running",
        lastBilledAt: new Date(),
        lastStartedAt: new Date(),
        hasVirtioMem,
        errorRecoveryAttempts: 0,
        ...(refreshedKernelVersion === null
          ? {}
          : { bootedKernelVersion: refreshedKernelVersion }),
        updatedAt: new Date(),
      })
      .where(and(eq(cubes.id, cubeId), ne(cubes.status, "deleted")));

    const kernelLabel = formatImageVersion(refreshedKernelVersion);
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: kernelLabel
        ? `Cube auto-recovered from error (attempt ${attempt}, kernel v${kernelLabel})`
        : `Cube auto-recovered from error (attempt ${attempt})`,
    });

    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "running" });
    dispatchWebhookEvent(spaceId, "cube.running", {
      cube: buildCubeSummary({ ...cube, status: "running" }),
      reason: "error_recovery",
    });

    audit({
      action: "cube.error_recovery_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube auto-recovered from error on attempt ${attempt}`,
      metadata: { serverId, attempt, kernelVersion: refreshedKernelVersion },
      source: "worker",
    });

    await log.info(
      `Auto-recovery succeeded on attempt ${attempt}${kernelLabel ? ` — running kernel v${kernelLabel}` : ""}`
    );
    console.log(
      `[cube-error-recovery] completed cubeId=${cubeId} attempt=${attempt}`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-error-recovery] failed cubeId=${cubeId}:`, err);
    await recordFailure(cube, spaceId, serverId, attempt, reason, log);
    // Deliberately NOT rethrown — retryLimit=0; the cron + counter own retries.
  } finally {
    client.end();
  }
}

async function recordFailure(
  cube: RecoveryCube & { status?: string },
  spaceId: string,
  serverId: string,
  attempt: number,
  reason: string,
  log: JobLogger
): Promise<void> {
  const cubeId = cube.id;
  const capped = attempt >= MAX_ERROR_RECOVERY_ATTEMPTS;
  await log.error(
    `Auto-recovery attempt ${attempt}/${MAX_ERROR_RECOVERY_ATTEMPTS} failed: ${reason}${capped ? " — giving up, notifying admins" : ""}`
  );

  // Rule 52: pair status="error" with lastBilledAt=null. Set the attempt count
  // unconditionally (works whether the cube is currently `booting` after a
  // claim or still `error` from a pre-claim connect failure).
  await db
    .update(cubes)
    .set({
      status: "error",
      lastBilledAt: null,
      errorRecoveryAttempts: attempt,
      updatedAt: new Date(),
    })
    .where(eq(cubes.id, cubeId))
    .catch(() => {});

  await db
    .insert(lifecycleLogs)
    .values({
      entityType: "cube",
      entityId: cubeId,
      message: capped
        ? `Auto-recovery gave up after ${attempt} attempts: ${reason}`
        : `Auto-recovery attempt ${attempt} failed: ${reason}`,
    })
    .catch(() => {});

  await triggerCubeLifecycleEvent(cubeId, spaceId, {
    status: "error",
    reason,
  }).catch(() => {});

  // Fire the customer-facing cube.error webhook ONLY when recovery gives up
  // (capped) — NOT on every failed attempt. The cube was already `error` before
  // recovery began (that's what made it eligible), so the customer already got
  // a cube.error event; re-dispatching it each tick would spam their endpoint
  // with duplicates. Gate it like the admin-notify below.
  if (capped) {
    dispatchWebhookEvent(spaceId, "cube.error", {
      cube: buildCubeSummary({ ...cube, status: "error" }),
      reason,
    });
  }

  // Notify admins only once — when the cap is hit — to avoid an email per tick.
  if (capped) {
    await notifyAdminsOfCubeError({
      cubeName: cube.name,
      cubeId,
      spaceId,
      serverId,
      reason: `Auto-recovery gave up after ${attempt} attempts: ${reason}`,
    }).catch(() => {});
  }

  audit({
    action: "cube.error_recovery_failed",
    category: "cube",
    actorType: "system",
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Cube auto-recovery attempt ${attempt} failed${capped ? " (cap reached)" : ""}: ${reason.slice(0, 200)}`,
    metadata: { serverId, attempt, capped, error: reason.slice(0, 1000) },
    source: "worker",
  });
}

export async function handleCubeErrorRecovery(
  jobs: Job<CubeErrorRecoveryPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
