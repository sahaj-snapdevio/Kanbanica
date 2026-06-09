/**
 * server.reboot-recovery — restart cubes after a bare-metal host reboot.
 *
 * A host reboot kills every Firecracker process. The database remains the
 * source of truth: cubes the DB says are `running` MUST be running, so this
 * job reconciles reality to the database by restarting them via startCube.
 *
 * Triggered by:
 *   - cube.state-sync detecting a changed /proc/sys/kernel/random/boot_id
 *   - POST /api/internal/server-rebooted (host-side krova-boot-notify.service)
 *
 * Idempotent: keyed on the host boot-id. If the live boot-id already equals
 * servers.lastBootId, this boot was already recovered and the job no-ops.
 * servers.lastBootId is written ONLY here, only after every cube is processed,
 * so a crash mid-recovery leaves it unchanged and the next run retries.
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
import {
  connectToServer,
  execCommand,
  getCubeStatus,
  startCube,
} from "@/lib/ssh";
import { formatImageVersion } from "@/lib/version";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerRebootRecoveryPayload } from "@/lib/worker/job-types";

async function runHandler(
  job: Job<ServerRebootRecoveryPayload>
): Promise<void> {
  const { serverId } = job.data;
  const log = new JobLogger(
    job.id,
    "server.reboot-recovery",
    "server",
    serverId
  );
  console.log(`[server-reboot-recovery] starting for serverId=${serverId}`);

  const { server, client } = await connectToServer(serverId);

  try {
    // 1. Read the live boot-id.
    const bootIdResult = await execCommand(
      client,
      "cat /proc/sys/kernel/random/boot_id",
      5000
    );
    const currentBootId = bootIdResult.stdout.trim();
    if (!currentBootId) {
      await log.error("Could not read host boot-id — aborting recovery");
      throw new Error("could not read /proc/sys/kernel/random/boot_id");
    }

    // 2. Idempotency gate — if this boot-id is already recorded, this reboot
    //    was already recovered. No-op.
    const [serverRow] = await db
      .select({ lastBootId: servers.lastBootId })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);
    if (serverRow && serverRow.lastBootId === currentBootId) {
      await log.info(
        `Boot-id ${currentBootId} already recovered — nothing to do`
      );
      return;
    }

    // 3. The database is the source of truth: select every cube this server
    //    is supposed to be running. `booting` is included so a previous
    //    crashed recovery's half-claimed cubes are re-picked.
    const recoverable = await db
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
        spaceId: cubes.spaceId,
        vcpus: cubes.vcpus,
      })
      .from(cubes)
      .where(
        and(
          eq(cubes.serverId, serverId),
          inArray(cubes.status, ["running", "booting"])
        )
      );

    await log.info(
      `Host ${server.hostname} rebooted (boot-id ${currentBootId}) — ` +
        `${recoverable.length} cube(s) to recover`
    );

    // Read the server's current on-disk kernel version once, up front. When
    // startCube actually relaunches a cube it loads /var/lib/krova/images/vmlinux
    // — the cube IS on whatever the server's currentKernelVersion is. The DB
    // must reflect that, otherwise the UI's "outdated kernel" badge nudges
    // customers into a redundant cold-restart of an already-current cube.
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
        "[server-reboot-recovery] kernel version read failed (non-fatal):",
        err instanceof Error ? err.message : err
      );
    }
    const kernelLabel = formatImageVersion(refreshedKernelVersion);

    // Track per-cube failures so we can skip the `lastBootId` write at the
    // end if any cube failed to recover. Without this, the idempotency gate
    // at the top of this handler (line 69) would block a re-run of recovery
    // for the same boot-id — leaving the failed cube permanently stuck in
    // `error` with no automatic retry (audit M4, 2026-05-24). The next
    // attempt will re-enter, see the failed cubes still in `error` (not in
    // the `recoverable` set, which only picks running|booting), and won't
    // re-touch them — but operators can manually flip them back to
    // sleeping/running to retry.
    let recoveryFailures = 0;

    for (const cube of recoverable) {
      try {
        // Atomically claim the cube: running|booting -> booting. If nothing
        // is returned the cube was concurrently slept/deleted — skip it.
        const [claimed] = await db
          .update(cubes)
          .set({ status: "booting", updatedAt: new Date() })
          .where(
            and(
              eq(cubes.id, cube.id),
              inArray(cubes.status, ["running", "booting"])
            )
          )
          .returning({ id: cubes.id });
        if (!claimed) {
          await log.info(
            `Cube "${cube.name}" changed state concurrently — skipping`
          );
          continue;
        }
        await triggerCubeLifecycleEvent(cube.id, cube.spaceId, {
          status: "booting",
        });

        // Resolve the launch mode + jailer uid once (applies the
        // JAILER_ENABLED policy and persists any transition). serverId is the
        // server this cube lives on. With JAILER_ENABLED=false this returns
        // "bare"/undefined and cubePaths(id,"bare") === the legacy paths, so
        // the bare control flow is byte-identical.
        const { launchMode, jailerUid } = await resolveLaunchModeForCube({
          id: cube.id,
          serverId: cube.serverId ?? serverId,
          launchMode: cube.launchMode,
          jailerUid: cube.jailerUid,
        });

        // If the VM is somehow already up, just reconcile the DB.
        let vmState = "unknown";
        try {
          vmState = (
            await getCubeStatus(client, cube.id, cube.launchMode)
          ).toLowerCase();
        } catch {
          // Post-reboot the VM process is gone; treat any status-read error
          // as "down" and let startCube relaunch it.
        }

        let hasVirtioMem = false;
        const relaunched = vmState !== "running";
        if (relaunched) {
          if (!cube.internalIp || cube.vcpus <= 0 || cube.ramMb <= 0) {
            throw new Error(
              `missing config (ip=${cube.internalIp}, vcpus=${cube.vcpus}, ram=${cube.ramMb})`
            );
          }
          const ip = cube.internalIp;
          await log.step(`Restart cube "${cube.name}"`, async () => {
            const r = await startCube(client, cube.id, {
              vcpus: cube.vcpus,
              ramMb: cube.ramMb,
              internalIp: ip,
              launchMode,
              jailerUid,
              // Per-cube node (loop var is `cube.id`, NOT `cubeId`). Reboot never
              // moves cubes, so each cube's node is still valid on this host.
              ...(await cubeNumaLaunchOpts(cube.id)),
            });
            hasVirtioMem = r.hasVirtioMem;
          });
        } else {
          await log.info(
            `Cube "${cube.name}" already running — reconciling DB`
          );
        }

        await db
          .update(cubes)
          .set({
            status: "running",
            // Only reset the billing clock + persist hasVirtioMem +
            // bootedKernelVersion when startCube actually ran (vmState was
            // down). Rule 38: a host reboot is an unexpected shutdown —
            // resetting lastBilledAt to now forgives both the reboot
            // downtime and the partial hour before the crash; past
            // full-hour cron charges stand. If the VM was already up,
            // its billing clock was correctly accruing and its device
            // set + kernel are whatever it booted with originally —
            // leave all four as-is so we don't refund time the customer
            // legitimately consumed nor distort the lastStartedAt
            // ordering used by plan-downgrade reconcile.
            ...(relaunched
              ? {
                  lastBilledAt: new Date(),
                  lastStartedAt: new Date(),
                  hasVirtioMem,
                  ...(refreshedKernelVersion === null
                    ? {}
                    : { bootedKernelVersion: refreshedKernelVersion }),
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(cubes.id, cube.id), ne(cubes.status, "deleted")));

        await db.insert(lifecycleLogs).values({
          entityType: "cube",
          entityId: cube.id,
          // Distinguish "we actually relaunched the VM" from "the VM was
          // somehow still alive and we just reconciled the DB". The second
          // case is rare (would mean boot-id changed without Firecracker
          // dying — kexec, manual lastBootId reset, etc.) but writing the
          // same misleading "Cube restarted" message hides what happened.
          message: relaunched
            ? kernelLabel
              ? `Cube restarted after host reboot (kernel v${kernelLabel})`
              : "Cube restarted after host reboot"
            : "Cube reconciled after host reboot — VM was already running",
        });
        await triggerCubeLifecycleEvent(cube.id, cube.spaceId, {
          status: "running",
        });
        dispatchWebhookEvent(cube.spaceId, "cube.running", {
          cube: buildCubeSummary({ ...cube, status: "running" }),
          publicIpv4: server.publicIp ?? null,
          reason: relaunched
            ? "host_reboot_relaunched"
            : "host_reboot_reconciled",
        });

        audit({
          action: "cube.reboot_recovered",
          category: "cube",
          actorType: "system",
          entityType: "cube",
          entityId: cube.id,
          spaceId: cube.spaceId,
          description: `Cube restarted after host ${server.hostname} reboot`,
          metadata: { serverId, bootId: currentBootId },
          source: "worker",
        });
      } catch (err) {
        recoveryFailures++;
        const reason = err instanceof Error ? err.message : String(err);
        console.error(
          `[server-reboot-recovery] cube ${cube.id} failed: ${reason}`
        );
        await log.error(`Cube "${cube.name}" failed to restart: ${reason}`);

        // Rule 52: clear lastBilledAt when flipping to error. The cube was
        // status="running" with a non-null lastBilledAt before the host
        // reboot; if recovery's startCube fails the cube can't come back,
        // and leaving lastBilledAt set would let the hourly cron
        // compute-charge an error cube.
        await db
          .update(cubes)
          .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
          .where(eq(cubes.id, cube.id))
          .catch(() => {});
        await db
          .insert(lifecycleLogs)
          .values({
            entityType: "cube",
            entityId: cube.id,
            message: `Cube failed to restart after host reboot: ${reason}`,
          })
          .catch(() => {});
        await triggerCubeLifecycleEvent(cube.id, cube.spaceId, {
          status: "error",
          reason,
        }).catch(() => {});
        dispatchWebhookEvent(cube.spaceId, "cube.error", {
          cube: buildCubeSummary({ ...cube, status: "error" }),
          reason,
        });
        await notifyAdminsOfCubeError({
          cubeName: cube.name,
          cubeId: cube.id,
          spaceId: cube.spaceId,
          serverId,
          reason: `Failed to restart after host reboot: ${reason}`,
        }).catch(() => {});
      }
    }

    // 4. Record the boot-id. ONLY writer of servers.lastBootId — written
    //    last so a crash mid-recovery leaves it unchanged and the next run
    //    retries. Also skip the write if ANY cube failed to recover — the
    //    idempotency gate at the top of this handler (line 69) would
    //    otherwise block a retry that could potentially recover the
    //    failed cubes (audit M4, 2026-05-24).
    if (recoveryFailures > 0) {
      await log.warn(
        `${recoveryFailures} cube(s) failed to recover — NOT writing lastBootId so a retry can re-attempt`
      );
      console.warn(
        `[server-reboot-recovery] ${recoveryFailures} cube(s) failed for serverId=${serverId} — lastBootId NOT written`
      );
    } else {
      await db
        .update(servers)
        .set({ lastBootId: currentBootId, updatedAt: new Date() })
        .where(eq(servers.id, serverId));
      await log.info(`Reboot recovery complete for ${server.hostname}`);
    }

    console.log(`[server-reboot-recovery] completed for serverId=${serverId}`);
  } finally {
    client.end();
  }
}

export async function handleServerRebootRecovery(
  jobs: Job<ServerRebootRecoveryPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
