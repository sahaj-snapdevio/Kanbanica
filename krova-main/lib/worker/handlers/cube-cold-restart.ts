/**
 * Force a cold-restart of a Cube: kill the Firecracker process via PID file,
 * then relaunch via startCube which re-reads the kernel from disk. Used to
 * pick up a refreshed kernel after `server.update-images` updates the host's
 * /var/lib/krova/images/vmlinux.
 *
 * The Cube's existing rootfs.ext4 (under /var/lib/krova/cubes/<id>/) is
 * preserved — customer state survives. Networking (TAP, iptables NAT) is
 * left in place since neither the cube's internal IP nor its host SSH port
 * change.
 *
 * After successful relaunch the cube row's `bootedKernelVersion` is updated
 * to the server's `currentKernelVersion`, so the UI's "outdated kernel"
 * banner clears automatically.
 */

import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import type { Client } from "ssh2";
import { cubes, lifecycleLogs, servers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { chargeProratedUsageWithAudit } from "@/lib/cost";
import { resolveLaunchModeForCube } from "@/lib/cubes/launch-mode";
import { cubeNumaLaunchOpts } from "@/lib/cubes/numa-launch-opts";
import { db } from "@/lib/db";
import { notifyAdminsOfCubeError } from "@/lib/email/notify-error";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { subnetOf } from "@/lib/server/cube-network";
import {
  assertFirecrackerExited,
  connectToServer,
  execCommand,
  startCube,
} from "@/lib/ssh";
import { cubePaths } from "@/lib/ssh/jailer";
import { formatImageVersion } from "@/lib/version";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeColdRestartPayload } from "@/lib/worker/job-types";

async function runHandler(job: Job<CubeColdRestartPayload>): Promise<void> {
  const { cubeId, spaceId, serverId, actorId, actorEmail } = job.data;
  const log = new JobLogger(job.id, "cube.cold_restart", "cube", cubeId);

  console.log(`[cube-cold-restart] starting for cubeId=${cubeId}`);
  await log.info("Cube cold-restart started");

  // Atomically claim: only proceed if the cube is currently running and not
  // already in a transitional state. Mark "stopping" so concurrent
  // sleep/wake/delete don't race.
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
    if (row.status !== "running") {
      console.log(
        `[cube-cold-restart] cube ${cubeId} not running (status=${row.status}), skipping`
      );
      return null;
    }
    if (!row.internalIp || row.vcpus <= 0 || row.ramMb <= 0) {
      throw new Error(
        `Cannot cold-restart cube ${cubeId}: missing config (ip=${row.internalIp}, vcpus=${row.vcpus}, ram=${row.ramMb})`
      );
    }
    await tx
      .update(cubes)
      .set({ status: "stopping", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));
    return row;
  });

  if (!cube) {
    await log.warn("Cube not running — aborting cold-restart");
    return;
  }

  // Fail-loud 198.18 scheme guard — parity with cube-wake (Rule 58 preflight,
  // BEFORE the kill so we never tear down a cube we can't safely relaunch).
  // Post-cutover the fleet is entirely on 198.18.0.0/15; a stray cube whose IP
  // isn't on its host's bridge_subnet would relaunch onto stale guest
  // networking and boot unreachable. subnetOf() throws on any non-198.18 IPv4.
  // Should never fire post-cutover — this is defense-in-depth. On mismatch flip
  // to error (clear reason) + return rather than relaunch onto the wrong scheme.
  if (cube.internalIp) {
    const [srv] = await db
      .select({ bridgeSubnet: servers.bridgeSubnet })
      .from(servers)
      .where(eq(servers.id, cube.serverId ?? serverId))
      .limit(1);
    if (srv?.bridgeSubnet != null) {
      let cubeSubnet: number | null = null;
      try {
        cubeSubnet = subnetOf(cube.internalIp);
      } catch {
        cubeSubnet = null;
      }
      if (cubeSubnet === null || cubeSubnet !== srv.bridgeSubnet) {
        const reason = `Cube internal IP ${cube.internalIp} is not on its host's 198.18 subnet (bridge_subnet=${srv.bridgeSubnet}) — refusing cold-restart onto stale networking`;
        await log.error(reason);
        await db
          .update(cubes)
          .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
          .where(eq(cubes.id, cubeId));
        await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "error" });
        audit({
          action: "cube.cold_restart_failed",
          category: "cube",
          actorType: actorId ? "user" : "system",
          actorId: actorId ?? null,
          actorEmail: actorEmail ?? null,
          entityType: "cube",
          entityId: cubeId,
          spaceId,
          description: reason,
          metadata: { serverId, internalIp: cube.internalIp },
          source: "worker",
        });
        return;
      }
    }
  }

  await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "stopping" });

  // Resolve the launch mode for the relaunch (and persist any transition).
  // With JAILER_ENABLED=false this returns "bare", so cubePaths(id, "bare")
  // === the legacy /var/lib/krova/cubes/<id>/… paths — byte-identical to the
  // prior behaviour.
  const { launchMode, jailerUid } = await resolveLaunchModeForCube({
    id: cubeId,
    serverId: cube.serverId ?? serverId,
    launchMode: cube.launchMode,
    jailerUid: cube.jailerUid,
  });

  // Connect to the host. GUARDED (Rule 58): the cube is already claimed
  // `stopping`, so a host-down connect failure MUST revert it to `running`
  // (the VM was never touched and is still alive on the host) and rethrow —
  // NOT `error`, and never left stranded in `stopping` (where cube.stale-check
  // could salvage-delete it). The retry re-attempts the cold-restart once the
  // host returns.
  let client: Client;
  try {
    ({ client } = await connectToServer(serverId));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[cube-cold-restart] host unreachable for cubeId=${cubeId}:`,
      err
    );
    await log.error(`Cold-restart failed to connect to host: ${reason}`);
    await db
      .update(cubes)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId))
      .catch(() => {});
    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: "running",
    }).catch(() => {});
    await audit({
      action: "cube.cold_restart_recovered",
      category: "cube",
      actorType: actorId ? "user" : "system",
      actorId: actorId ?? null,
      actorEmail: actorEmail ?? null,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description:
        "Cold-restart failed to connect to host; reverted to running (VM was never touched)",
      metadata: { serverId, error: reason.slice(0, 1000) },
      source: "worker",
    }).catch(() => {});
    throw err;
  }

  try {
    // Kill the CURRENT process using the cube's CURRENT launch mode's pid file
    // (it may differ from the resolved relaunch mode if converting). With
    // JAILER_ENABLED=false both are "bare" → identical legacy path.
    const pidFile = cubePaths(cubeId, cube.launchMode).pidFile;

    // 1. Kill the Firecracker process. SIGTERM, then SIGKILL after 2s.
    await log.step("Stop running VM (SIGTERM → SIGKILL)", async () => {
      await execCommand(
        client,
        `PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill "$PID" 2>/dev/null; sleep 2; PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`,
        15_000
      );
    });

    // 2. Verify the process is actually dead before relaunching — otherwise
    //    startCube will collide on the disk path and PID file.
    await log.step("Verify VM process exited", async () => {
      // Zombie-aware: a SIGKILL'd jailed FC (PID 1 of its --new-pid-ns) briefly
      // lingers as a resource-free zombie; treat that as exited (the old
      // single-shot `kill -0` counted a zombie as alive and stranded the cube
      // in `error` — the 2026-05-31 jailed-cube cold-restart failure).
      await assertFirecrackerExited(client, pidFile, cubeId);
    });

    // 2b. Cold-restart is CUSTOMER-INITIATED (operator clicks kernel-refresh).
    //     Rule 38: customer-initiated stops bill prorated for the partial
    //     hour the cube was running. Charge AFTER the VM is actually dead,
    //     mirroring the cube-sleep / cube-power-off order (VM action first →
    //     bill → status flip). This way:
    //       - Kill failure → no billing event written
    //       - The "now" timestamp at billing covers up to the kill moment
    //       - Step 5 below resets lastBilledAt to a fresh `now` post-restart,
    //         so the kill→relaunch gap is forgiven (typically ~5s)
    await chargeProratedUsageWithAudit(cube, {
      flow: "cold-restart",
      logPrefix: "[cube-cold-restart]",
      actor: actorId
        ? { type: "user", id: actorId, email: actorEmail }
        : { type: "system" },
      metadata: { serverId },
    });

    // 3. Relaunch with a fresh process. startCube re-reads the kernel from
    //    /var/lib/krova/images/vmlinux on the host — so this picks up any
    //    newer kernel that update-images deployed.
    let coldRestartHasVirtioMem = false;
    await log.step("Relaunch Firecracker VM (fresh kernel)", async () => {
      const r = await startCube(client, cubeId, {
        vcpus: cube.vcpus,
        ramMb: cube.ramMb,
        internalIp: cube.internalIp!,
        launchMode,
        jailerUid,
        ...(await cubeNumaLaunchOpts(cubeId)),
      });
      coldRestartHasVirtioMem = r.hasVirtioMem;
    });

    // 4. Refresh the bootedKernelVersion to whatever's on the server now.
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
        "[cube-cold-restart] kernel version refresh failed (non-fatal):",
        err instanceof Error ? err.message : err
      );
    }

    // 5. Mark cube → running again, update billing clock, refresh version.
    await db
      .update(cubes)
      .set({
        status: "running",
        lastBilledAt: new Date(),
        lastStartedAt: new Date(),
        hasVirtioMem: coldRestartHasVirtioMem,
        ...(refreshedKernelVersion === null
          ? {}
          : { bootedKernelVersion: refreshedKernelVersion }),
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId));

    const kernelLabel = formatImageVersion(refreshedKernelVersion);

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: kernelLabel
        ? `Cube cold-restarted (kernel v${kernelLabel})`
        : "Cube cold-restarted",
    });

    await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "running" });

    dispatchWebhookEvent(spaceId, "cube.cold_restarted", {
      cube: buildCubeSummary({ ...cube, status: "running" }),
      kernelVersion: refreshedKernelVersion,
    });

    audit({
      action: "cube.cold_restart_complete",
      category: "cube",
      actorType: actorId ? "user" : "system",
      actorId: actorId ?? null,
      actorEmail: actorEmail ?? null,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube cold-restarted (kernel ${kernelLabel ? `v${kernelLabel}` : "unknown"})`,
      metadata: { serverId, kernelVersion: refreshedKernelVersion },
      source: "worker",
    });

    await log.info(
      `Cold-restart complete${kernelLabel ? ` — running kernel v${kernelLabel}` : ""}`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-cold-restart] failed cubeId=${cubeId}:`, err);
    await log.error(`Cold-restart failed: ${reason}`);

    // Revert status so the user can see the error and retry. We don't know
    // for sure that the VM is alive, so flag it `error` rather than
    // optimistically marking it `running`. Also clear lastBilledAt to honor
    // the Rule 52 invariant (lastBilledAt != null ⇒ status='running') —
    // chargeProratedUsage may have already advanced lastBilledAt before the
    // verify/relaunch step threw.
    await db
      .update(cubes)
      .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
      .where(eq(cubes.id, cubeId))
      .catch(() => {});

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: "error",
      reason,
    }).catch(() => {});

    audit({
      action: "cube.cold_restart_failed",
      category: "cube",
      actorType: actorId ? "user" : "system",
      actorId: actorId ?? null,
      actorEmail: actorEmail ?? null,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube cold-restart failed: ${reason.slice(0, 200)}`,
      metadata: { serverId, error: reason.slice(0, 1000) },
      source: "worker",
    });

    // Mirror cube-auto-relaunch — operator-initiated cold-restart failures
    // shouldn't be silent (audit M2, 2026-05-24). The cube is now in `error`
    // and needs admin intervention to recover.
    await notifyAdminsOfCubeError({
      cubeName: cube.name,
      cubeId,
      spaceId,
      serverId,
      reason: `Cold-restart failed: ${reason}`,
    }).catch((notifyErr) => {
      console.error(
        `[cube-cold-restart] failed to notify admins for cubeId=${cubeId}:`,
        notifyErr
      );
    });

    throw err;
  } finally {
    client.end();
  }
}

export async function handleCubeColdRestart(
  jobs: Job<CubeColdRestartPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
