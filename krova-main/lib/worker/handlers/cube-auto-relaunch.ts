/**
 * cube.auto-relaunch — relaunch a Firecracker microVM that exited cleanly.
 *
 * Firecracker doesn't support guest-initiated reboot: when a guest issues
 * `reboot` / `systemctl reboot` / `shutdown -r`, Firecracker treats it as
 * VM shutdown and exits with `exit_code=0`. The cube vanishes from the
 * customer's perspective even though they asked for a reboot, not a halt.
 *
 * cube.state-sync detects this case by tailing the host's `fc.log` for the
 * "Firecracker exiting successfully. exit_code=0" line, then enqueues this
 * job to restart the cube — same machine config, same rootfs.
 *
 * Rate-limited by cube.state-sync at enqueue time (max N per hour by
 * counting recent "Cube auto-restarted" lifecycle logs); over the limit
 * the cube is left in `error` for admin review instead of being
 * auto-relaunched.
 *
 * Idempotent: atomically claims the cube via status running|booting →
 * booting. If the cube was concurrently slept/deleted/transferred,
 * the claim returns nothing and the handler no-ops.
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import type { Job } from "pg-boss";
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
import type { CubeAutoRelaunchPayload } from "@/lib/worker/job-types";

async function runHandler(job: Job<CubeAutoRelaunchPayload>): Promise<void> {
  const { cubeId, spaceId, serverId, reason } = job.data;
  const log = new JobLogger(job.id, "cube.auto_relaunch", "cube", cubeId);

  console.log(
    `[cube-auto-relaunch] starting for cubeId=${cubeId} reason="${reason ?? "guest-reboot"}"`
  );
  await log.info(
    `Auto-relaunch started (trigger: ${reason ?? "guest-issued reboot"})`
  );

  // 1. Atomically claim. Accept both `running` (the typical state when
  //    state-sync triggered us) AND `booting` (a previous attempt of this
  //    same job may have claimed it; pg-boss retried due to transient
  //    failure). Anything else — `sleeping`, `error`, `deleted`,
  //    `stopping`, mid-transfer — means another path owns the cube now.
  const [cube] = await db
    .select({
      diskLimitGb: cubes.diskLimitGb,
      id: cubes.id,
      imageId: cubes.imageId,
      internalIp: cubes.internalIp,
      jailerUid: cubes.jailerUid,
      launchMode: cubes.launchMode,
      name: cubes.name,
      ramMb: cubes.ramMb,
      serverId: cubes.serverId,
      vcpus: cubes.vcpus,
    })
    .from(cubes)
    .where(eq(cubes.id, cubeId))
    .limit(1);

  if (!cube) {
    await log.warn(`Cube ${cubeId} no longer exists — aborting auto-relaunch`);
    return;
  }

  const [claimed] = await db
    .update(cubes)
    .set({ status: "booting", updatedAt: new Date() })
    .where(
      and(eq(cubes.id, cubeId), inArray(cubes.status, ["running", "booting"]))
    )
    .returning({ id: cubes.id });

  if (!claimed) {
    await log.info(
      `Cube "${cube.name}" status changed concurrently — skipping auto-relaunch`
    );
    return;
  }
  await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "booting" });

  if (!cube.internalIp || cube.vcpus <= 0 || cube.ramMb <= 0) {
    const reasonText = `missing config (ip=${cube.internalIp}, vcpus=${cube.vcpus}, ram=${cube.ramMb})`;
    await markFailed(cube, spaceId, serverId, reasonText, log);
    throw new Error(reasonText);
  }

  // 2. Read the server's current on-disk kernel — startCube will load it
  //    from /var/lib/krova/images/vmlinux, so the cube ends up on whatever
  //    is current. Capture before SSH so a failed read doesn't gate the
  //    relaunch (best-effort, matches cube-cold-restart's pattern).
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
      "[cube-auto-relaunch] kernel version read failed (non-fatal):",
      err instanceof Error ? err.message : err
    );
  }

  // Resolve the launch mode (bare vs jailed) once before booting. Runs in
  // its own tx, applies the JAILER_ENABLED policy, and persists any
  // mode/uid transition. With JAILER_ENABLED=false this returns the
  // legacy bare mode so the relaunch path stays byte-identical.
  const { launchMode, jailerUid } = await resolveLaunchModeForCube({
    id: cubeId,
    serverId: cube.serverId ?? serverId,
    launchMode: cube.launchMode,
    jailerUid: cube.jailerUid,
  });

  const { client } = await connectToServer(serverId);

  try {
    // startCube includes a virtio-mem probe fallback with two attempts +
    // a plug-wait poll loop — total budget can approach 90 s under fleet
    // load. Wrap in `withCubeHeartbeat` so the cube's pulse stays fresh
    // (Rule 34) and `cube.stale-check`'s 10-min threshold can't kill the
    // in-flight relaunch.
    let hasVirtioMem = false;
    const ip = cube.internalIp;
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

    // 3. Mark running again, refresh hasVirtioMem + bootedKernelVersion
    //    (same semantics as cube-cold-restart). Reset the billing clock so
    //    the customer isn't charged for the gap between Firecracker's clean
    //    exit and our relaunch — they wanted a reboot, not a halt; Rule 38
    //    applies.
    //
    //    `ne("deleted")` guard: a concurrent `cube.delete` can claim the
    //    cube (booting → deleted) while startCube is running. Without this
    //    guard, the final UPDATE would resurrect the deleted cube as
    //    `running` with a live Firecracker the platform no longer tracks.
    await db
      .update(cubes)
      .set({
        status: "running",
        lastBilledAt: new Date(),
        lastStartedAt: new Date(),
        hasVirtioMem,
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
      // The "Cube auto-restarted" phrase is load-bearing — cube.state-sync
      // counts these lifecycle logs to rate-limit reboot loops. Don't
      // rephrase without updating the matcher there.
      message: kernelLabel
        ? `Cube auto-restarted after guest-issued reboot (kernel v${kernelLabel})`
        : "Cube auto-restarted after guest-issued reboot",
    });

    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "running" });
    dispatchWebhookEvent(spaceId, "cube.running", {
      cube: buildCubeSummary({ ...cube, status: "running" }),
      reason: "auto_relaunch",
    });

    audit({
      action: "cube.auto_relaunch_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube auto-restarted after guest-issued reboot (kernel ${kernelLabel ? `v${kernelLabel}` : "unknown"})`,
      metadata: {
        serverId,
        kernelVersion: refreshedKernelVersion,
        triggerReason: reason ?? null,
      },
      source: "worker",
    });

    await log.info(
      `Auto-relaunch complete${kernelLabel ? ` — running kernel v${kernelLabel}` : ""}`
    );
    console.log(`[cube-auto-relaunch] completed cubeId=${cubeId}`);
  } catch (err) {
    const reasonText = err instanceof Error ? err.message : String(err);
    console.error(`[cube-auto-relaunch] failed cubeId=${cubeId}:`, err);
    await markFailed(cube, spaceId, serverId, reasonText, log);
    throw err;
  } finally {
    client.end();
  }
}

async function markFailed(
  cube: {
    diskLimitGb: number;
    id: string;
    imageId: string;
    internalIp: string | null;
    name: string;
    ramMb: number;
    serverId: string;
    vcpus: number;
  },
  spaceId: string,
  serverId: string,
  reasonText: string,
  log: JobLogger
): Promise<void> {
  const cubeId = cube.id;
  await log.error(`Auto-relaunch failed: ${reasonText}`);

  // Rule 52: clear lastBilledAt when flipping to error. The cube was in
  // status="running" with a non-null lastBilledAt when state-sync detected
  // the clean Firecracker exit and enqueued this job; leaving lastBilledAt
  // set would let the hourly cron compute-charge the error cube.
  await db
    .update(cubes)
    .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
    .where(eq(cubes.id, cubeId))
    .catch(() => {});

  await db
    .insert(lifecycleLogs)
    .values({
      entityType: "cube",
      entityId: cubeId,
      message: `Auto-relaunch after guest reboot failed: ${reasonText}`,
    })
    .catch(() => {});

  await triggerCubeLifecycleEvent(cubeId, spaceId, {
    status: "error",
    reason: reasonText,
  }).catch(() => {});

  dispatchWebhookEvent(spaceId, "cube.error", {
    cube: buildCubeSummary({ ...cube, status: "error" }),
    reason: reasonText,
  });

  await notifyAdminsOfCubeError({
    cubeName: cube.name,
    cubeId,
    spaceId,
    serverId,
    reason: `Auto-relaunch after guest reboot failed: ${reasonText}`,
  }).catch(() => {});

  audit({
    action: "cube.auto_relaunch_failed",
    category: "cube",
    actorType: "system",
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Cube auto-relaunch failed: ${reasonText.slice(0, 200)}`,
    metadata: { serverId, error: reasonText.slice(0, 1000) },
    source: "worker",
  });
}

export async function handleCubeAutoRelaunch(
  jobs: Job<CubeAutoRelaunchPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
