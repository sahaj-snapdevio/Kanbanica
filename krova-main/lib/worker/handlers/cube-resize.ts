import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { VIRTIO_MEM_BOOT_FLOOR_MIB } from "@/config/platform";
import { cubes, lifecycleLogs, servers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { chargeProratedUsageWithAudit } from "@/lib/cost";
import { validateResize } from "@/lib/cube-resize/validate";
import { resolveLaunchModeForCube } from "@/lib/cubes/launch-mode";
import { cubeNumaLaunchOpts } from "@/lib/cubes/numa-launch-opts";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { env } from "@/lib/env";
import { ioNicePrefix } from "@/lib/io-nice";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { reconcileServerResources } from "@/lib/server/allocate";
import { connectToServer, execCommand, guestExec } from "@/lib/ssh";
import {
  firecrackerApi,
  plugAndWait,
  powerOffCube,
  sleepCube,
  startCube,
} from "@/lib/ssh/firecracker";
import { cubePaths, JAILED_INNER } from "@/lib/ssh/jailer";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { JobLogger } from "@/lib/worker/job-log";
import type { CubeResizePayload } from "@/lib/worker/job-types";

/**
 * Apply a resize to a running cube.
 *
 * Live path (CPU unchanged, RAM/disk grow):
 *   1. Charge prorated usage at the OLD rate (Rule 38 — customer-initiated).
 *   2. Live RAM grow via Firecracker virtio-mem PATCH /hotplug/memory.
 *   3. Live disk grow: truncate host backing file → PATCH /drives/rootfs →
 *      `resize2fs /dev/vda` inside the guest via vsock.
 *
 * Cold path (any vCPU change):
 *   1. Charge prorated usage at the OLD rate.
 *   2. Sleep cube if running.
 *   3. Resize host rootfs file (truncate + e2fsck + resize2fs) when growing.
 *   4. Restart cube with new vCPU/RAM (Firecracker re-reads the rootfs at
 *      its new size).
 *
 * Failure semantics:
 *   - Re-validation at handler start (server state may have drifted) failing
 *     is logged + audited and the handler returns cleanly without throwing,
 *     so pg-boss does not retry a fundamentally invalid request.
 *   - COLD-path infra failure (the VM was powered off: sleepCube, host disk
 *     truncate, or startCube) marks the cube `status='error'` so the customer
 *     can't try to wake a broken cube. `cube.state-sync` is NOT sufficient — it
 *     transitions paused cubes to `sleeping`, misleading the customer.
 *   - LIVE-path failure (RAM/disk hotplug against the RUNNING guest) does NOT
 *     stop the VM, so the cube stays healthy and serving — the handler restores
 *     `status='running'` and keeps billing running rather than flipping a live
 *     cube to `error` (which would hide a working cube + stop its billing).
 */
async function handleCubeResizeJob(job: Job<CubeResizePayload>): Promise<void> {
  const {
    cubeId,
    spaceId,
    serverId,
    newVcpus,
    newRamMb,
    newDiskLimitGb,
    isLive,
    actorId,
    actorType,
  } = job.data;
  const log = new JobLogger(job.id, "cube.resize", "cube", cubeId);

  // 1. Load cube
  const cube = await db.query.cubes.findFirst({ where: eq(cubes.id, cubeId) });
  if (!cube) {
    throw new Error(`Cube ${cubeId} not found`);
  }

  const cpuDelta = newVcpus - cube.vcpus;
  const ramDelta = newRamMb - cube.ramMb;
  const diskDelta = newDiskLimitGb - cube.diskLimitGb;

  // Live resize requires the vsock guest agent — unreachable on a paused (sleeping) VM.
  // Force cold path so a sleeping cube doesn't end up with the host backing file grown
  // but filesystem un-resized (guestExec(resize2fs) would time out after 60s).
  const effectiveLive = isLive && cube.status === "running";
  // Remember the pre-resize status so a sleeping cube can be re-paused after a cold restart
  // rather than left running — the customer paused deliberately to stop billing.
  const wasRunning = cube.status === "running";

  console.log(
    `[cube-resize] starting cubeId=${cubeId} → vcpu=${newVcpus} ram=${newRamMb}MB disk=${newDiskLimitGb}GB live=${effectiveLive}`
  );
  await log.info(
    `Cube resize started — target: ${newVcpus} vCPU, ${newRamMb} MB, ${newDiskLimitGb} GB (${effectiveLive ? "live" : "cold"}${isLive && !effectiveLive ? " — forced cold: cube is sleeping" : ""})`
  );

  // 2. Re-validate at handler time. Server allocation could have changed
  //    between enqueue and run, so we re-check capacity. A failure here is
  //    "this resize is no longer valid" — log + audit and return cleanly so
  //    pg-boss does not retry.
  const server = await db.query.servers.findFirst({
    where: eq(servers.id, serverId),
  });
  if (!server) {
    const reason = `Server ${serverId} not found`;
    console.error(`[cube-resize] ${reason}`);
    await log.error(`Cube resize aborted: ${reason}`);
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Cube resize aborted: ${reason}`,
    });
    audit({
      action: "cube.resize_failed",
      category: "cube",
      actorType,
      actorId,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube resize aborted: ${reason}`,
      metadata: { isLive, cpuDelta, ramDelta, diskDelta, error: reason },
      source: "worker",
    });
    return;
  }

  const validation = validateResize({
    cube,
    server,
    req: {
      vcpus: newVcpus,
      ramMb: newRamMb,
      diskLimitGb: newDiskLimitGb,
    },
  });
  if (!validation.ok) {
    const reason = `Re-validation failed: ${validation.error}`;
    console.error(`[cube-resize] ${reason}`);
    await log.error(`Cube resize aborted: ${reason}`);
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Cube resize aborted: ${reason}`,
    });
    audit({
      action: "cube.resize_failed",
      category: "cube",
      actorType,
      actorId,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube resize aborted: ${reason}`,
      metadata: { isLive, cpuDelta, ramDelta, diskDelta, error: reason },
      source: "worker",
    });
    return;
  }

  // 3. Connect to server and apply the resize.
  const { client } = await connectToServer(serverId);

  // 3a. Atomically claim the cube and transition to "stopping" so concurrent
  //     sleep / wake / delete handlers (which check status before claiming
  //     themselves) refuse to interleave with this resize. Without the
  //     claim, a concurrent sleep racing the cold-restart can leave the
  //     cube in an inconsistent state. We do this AFTER `connectToServer`
  //     so an SSH connection failure doesn't leave an orphan "stopping"
  //     status behind — the claim has not yet happened at that point.
  //     The status is restored in the final transaction on success, the
  //     catch block on failure-with-infraTouched (→ "error"), or the
  //     catch block on failure-without-infraTouched (→ originalStatus).
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: cubes.status, transferState: cubes.transferState })
      .from(cubes)
      .where(eq(cubes.id, cubeId))
      .for("update")
      .limit(1);
    if (!row) {
      return null;
    }
    if (row.status !== "running" && row.status !== "sleeping") {
      return { conflict: row.status as string };
    }
    // Re-check transferState inside the claim transaction. enqueue-time
    // validation can be stale — a transfer accepted AFTER resize was
    // enqueued (both queued, resize ran first) would otherwise race the
    // transfer over the same rootfs. See audit H9 (2026-05-24).
    if (row.transferState !== "idle" && row.transferState !== "failed") {
      return {
        conflict: `mid-transfer (transferState=${row.transferState})`,
      };
    }
    await tx
      .update(cubes)
      .set({ status: "stopping", updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));
    return { claimed: row.status as "running" | "sleeping" };
  });

  if (!claimed) {
    client.end();
    console.log(`[cube-resize] cube ${cubeId} no longer exists, skipping`);
    return;
  }
  if ("conflict" in claimed) {
    client.end();
    const reason = `Cube is currently in ${claimed.conflict} state — cannot resize`;
    console.warn(`[cube-resize] ${reason}`);
    await log.error(`Cube resize aborted: ${reason}`);
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Cube resize aborted: ${reason}`,
    });
    audit({
      action: "cube.resize_failed",
      category: "cube",
      actorType,
      actorId,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube resize aborted: ${reason}`,
      metadata: { isLive, cpuDelta, ramDelta, diskDelta, error: reason },
      source: "worker",
    });
    return;
  }
  const originalStatus = claimed.claimed;

  dispatchWebhookEvent(spaceId, "cube.resize.started", {
    cube: buildCubeSummary(cube),
    resize: {
      from: {
        vcpus: cube.vcpus,
        ramMb: cube.ramMb,
        diskLimitGb: cube.diskLimitGb,
      },
      to: { vcpus: newVcpus, ramMb: newRamMb, diskLimitGb: newDiskLimitGb },
    },
  });

  // Track whether infrastructure work has begun. If so, a failure leaves the
  // cube in an inconsistent state (Firecracker stopped, host file partially
  // resized, etc.) and the row must be marked `error` so customers can't try
  // to wake a broken cube. Pre-flight validation failures return cleanly
  // without setting this flag, so those don't taint the row.
  let infraTouched = false;
  // Track when the host rootfs file has been grown (via `truncate -s`) but
  // before the guest's resize2fs has run. On failure of resize2fs we still
  // need to persist the new diskLimitGb so future operations (subsequent
  // resize, transfer, snapshot) compute deltas from the actual host file
  // size and don't try to re-grow an already-grown file (audit M10,
  // 2026-05-24).
  let diskHostFileGrown = false;
  let coldRestartHasVirtioMem: boolean | null = null;
  try {
    // Charge prorated usage at the OLD rate up to this moment.
    // Rule 38: resize is customer-initiated, prorated billing is allowed.
    // Skip if lastBilledAt is recent — this happens on a pg-boss retry where a
    // previous attempt already charged and advanced lastBilledAt to ~now. The
    // window MUST exceed the queue's retryDelay (CUBE_RESIZE retryDelay=60s) or
    // a retry 60s after a successful charge slips past a smaller guard and
    // double-charges (the old 30s guard did exactly that). 90s comfortably
    // clears the 60s retry; the at-most-90s of un-prorated compute it can skip
    // is recovered by the next hourly cron tick (lastBilledAt isn't advanced
    // when we skip), so the customer is never under-billed.
    const PRORATED_SKIP_MS = 90_000; // > QUEUE_OPTIONS[CUBE_RESIZE].retryDelay (60s)
    const sinceLastBillMs = cube.lastBilledAt
      ? Date.now() - new Date(cube.lastBilledAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (sinceLastBillMs > PRORATED_SKIP_MS) {
      await chargeProratedUsageWithAudit(cube, {
        flow: "resize",
        logPrefix: "[cube-resize]",
        actor: { type: actorType, id: actorId },
        metadata: { serverId },
      });
    }

    // Heartbeat cubes.updatedAt while the slow infra work runs (Rule 34). The
    // cube is held in `stopping` here; a cold resize (power-off + e2fsck +
    // resize2fs + startCube) can exceed the 10-min stale threshold, at which
    // point cube.stale-check would salvage-backup + cube.delete the cube
    // mid-resize (data loss). The 2-min pulse keeps it out of the stale sweep.
    await withCubeHeartbeat(cubeId, async () => {
      if (effectiveLive) {
        // ── Live path ──
        // Live resize talks to the running cube's CURRENT launch mode — its
        // Firecracker process is already up under cube.launchMode, so use that
        // mode's host-visible API socket (cubePaths keeps "bare" byte-identical
        // to the legacy /var/lib/krova/cubes/<id>/firecracker.sock).
        const apiSock = cubePaths(cubeId, cube.launchMode).apiSock;

        if (ramDelta > 0) {
          infraTouched = true;
          await log.step(
            `Live RAM grow ${cube.ramMb} → ${newRamMb} MB`,
            async () => {
              const targetPlugged = newRamMb - VIRTIO_MEM_BOOT_FLOOR_MIB;
              // 60s ceiling — a live grow may take longer than the initial
              // plug if the guest needs to reorganise movable memory. The
              // shared plugAndWait helper handles the `Device is not active`
              // retry as well; on a long-running cube the driver is usually
              // long-activated, but the retry defends against transient
              // unresponsiveness (e.g. heavy memory pressure mid-grow).
              await plugAndWait(client, apiSock, targetPlugged, 60_000);
            }
          );
        }

        if (diskDelta > 0) {
          infraTouched = true;
          await log.step(
            `Live disk grow ${cube.diskLimitGb} → ${newDiskLimitGb} GB`,
            async () => {
              const rootfsPath = `/var/lib/krova/cubes/${cubeId}/rootfs.ext4`;

              // 1. Grow the host backing file.
              const tr = await execCommand(
                client,
                `truncate -s ${newDiskLimitGb}G ${rootfsPath}`,
                30_000
              );
              if (tr.exitCode !== 0) {
                throw new Error(`truncate failed: ${tr.stderr}`);
              }
              // Mark the host file as grown. From this point on, even if
              // PATCH /drives/rootfs or guest resize2fs fail, the host file
              // is at the new size; the DB row must reflect that.
              diskHostFileGrown = true;

              // 2. Tell Firecracker to re-read the drive size. `path_on_host`
              //    is interpreted RELATIVE TO THE CHROOT for a jailed cube, so it
              //    MUST be the chroot-relative path (JAILED_INNER.rootfs), NOT
              //    the host-absolute path — exactly as createCube/startCube
              //    resolve it (firecracker.ts rootfsApiPath). The `truncate`
              //    above stays on the canonical host path (same hardlinked inode).
              await firecrackerApi(client, apiSock, "PATCH", "/drives/rootfs", {
                drive_id: "rootfs",
                path_on_host:
                  cube.launchMode === "jailed"
                    ? JAILED_INNER.rootfs
                    : rootfsPath,
              });

              // 3. Online-resize ext4 inside the guest via vsock.
              const r = await guestExec(
                client,
                cubeId,
                "resize2fs /dev/vda",
                60_000
              );
              if (r.exitCode !== 0) {
                throw new Error(
                  `Guest resize2fs failed (host file is at new size; retry will fix): ${r.stderr}`
                );
              }
            }
          );
        }
      } else {
        // ── Cold path ──
        // Power off (kill the Firecracker process) regardless of whether the
        // pre-resize status was "running" or "sleeping" — a sleeping cube's
        // Firecracker is merely paused (PATCH /vm Paused), so the process is
        // still alive holding the TAP device. The cold-resize spawns a NEW
        // Firecracker process below via `startCube`, which attaches the same
        // TAP by name (e.g. fc6); if the old process is still alive (running
        // OR paused) the new Firecracker's PUT /network-interfaces returns
        // 400 "Open tap device failed: Resource busy". Killing the old
        // process releases the TAP so the new one can claim it cleanly.
        if (cube.status === "running" || cube.status === "sleeping") {
          infraTouched = true;
          await log.step("Power off cube for cold resize", async () => {
            // The currently-running Firecracker is under the cube's CURRENT
            // launch mode (we kill it before the resolved-mode cold restart).
            await powerOffCube(client, cubeId, cube.launchMode);
          });
        }

        if (diskDelta > 0) {
          infraTouched = true;
          await log.step(
            `Resize host rootfs file ${cube.diskLimitGb} → ${newDiskLimitGb} GB`,
            async () => {
              const rootfsPath = `/var/lib/krova/cubes/${cubeId}/rootfs.ext4`;
              const trR = await execCommand(
                client,
                `truncate -s ${newDiskLimitGb}G ${rootfsPath}`,
                30_000
              );
              if (trR.exitCode !== 0) {
                throw new Error(`truncate failed: ${trR.stderr}`);
              }
              diskHostFileGrown = true;
              // e2fsck may exit non-zero when it fixes things — that's fine.
              await execCommand(
                client,
                `${ioNicePrefix()}e2fsck -fy ${rootfsPath} || true`,
                60_000
              );
              const rR = await execCommand(
                client,
                `${ioNicePrefix()}resize2fs ${rootfsPath}`,
                60_000
              );
              if (rR.exitCode !== 0) {
                throw new Error(`resize2fs failed: ${rR.stderr}`);
              }
            }
          );
        }

        // Resolve the launch mode for the cold-restart in its own tx (applies the
        // JAILER_ENABLED policy + persists any bare⇄jailed transition + uid). With
        // the flag off this returns "bare" / undefined uid, so the relaunch stays
        // byte-identical to the legacy path.
        const { launchMode, jailerUid } = await resolveLaunchModeForCube({
          id: cubeId,
          serverId: cube.serverId ?? serverId,
          launchMode: cube.launchMode,
          jailerUid: cube.jailerUid,
        });

        infraTouched = true;
        await log.step(
          `Restart cube with new CPU/RAM (${newVcpus} vCPU, ${newRamMb} MB)`,
          async () => {
            if (!cube.internalIp) {
              throw new Error("Cube has no internalIp — cannot restart");
            }
            const r = await startCube(client, cubeId, {
              vcpus: newVcpus,
              ramMb: newRamMb,
              internalIp: cube.internalIp,
              launchMode,
              jailerUid,
              // Same-server cold restart — re-pin to the cube's NUMA node. If the
              // new vCPU count now exceeds the node, shouldBindCpuset's oversell
              // guard launches it unpinned (fail-safe; backfill re-pins later).
              ...(await cubeNumaLaunchOpts(cubeId)),
            });
            coldRestartHasVirtioMem = r.hasVirtioMem;
          }
        );

        // If the cube was sleeping before the resize, re-pause it so the customer's
        // intentional sleep is preserved. They asked for a resize, not a wake.
        if (!wasRunning) {
          await log.step(
            "Re-sleep cube (restoring pre-resize sleeping state)",
            async () => {
              // The cube was just cold-restarted under the RESOLVED launch mode.
              await sleepCube(client, cubeId, launchMode);
            }
          );
        }
      }
    });

    // 4. Atomic update — write the cube's new resources + final status,
    //    then rebuild the server's allocation counters from the cube
    //    rows. Reconcile rather than manual delta math because a sleeping
    //    cube contributes 0 CPU + 0 RAM to the server's tally (see
    //    `reconcileServerResources` in `lib/server/allocate.ts`) — a
    //    `srv.allocatedCpus + cpuDelta` increment is wrong when the cube
    //    being resized is sleeping (it wasn't contributing to begin with).
    //    Reconcile handles every status case correctly from one rule.
    //    Take FOR UPDATE on the server row first to keep the lock-order
    //    deterministic and serialize against concurrent allocations.
    await db.transaction(async (tx) => {
      await tx
        .select({ id: servers.id })
        .from(servers)
        .where(eq(servers.id, serverId))
        .for("update")
        .limit(1);

      await tx
        .update(cubes)
        .set({
          vcpus: newVcpus,
          ramMb: newRamMb,
          diskLimitGb: newDiskLimitGb,
          // Cold-resizing a sleeping cube re-starts it briefly then re-sleeps it.
          // Preserve the pre-resize status so billing stays paused.
          status: wasRunning ? "running" : "sleeping",
          // Fix #5: respect the invariant "sleeping ⇒ lastBilledAt is null".
          // Only restart the running-compute billing clock when the cube ends
          // up running; a sleeping cube must keep null so the hourly cron
          // never picks it up for compute charges (sleep-storage billing is a
          // separate pass driven by diskLimitGb, not lastBilledAt).
          lastBilledAt: wasRunning ? new Date() : null,
          // Rule 52: advance lastStartedAt only when the cube ends running
          // AND a real cold-restart happened (live-resize doesn't reboot the
          // VM, so lastStartedAt should NOT move). The plan-downgrade sleep-
          // priority order depends on this — a live RAM grow on a running
          // cube must keep the customer's original boot timestamp.
          ...(wasRunning && coldRestartHasVirtioMem !== null
            ? { lastStartedAt: new Date() }
            : {}),
          ...(coldRestartHasVirtioMem === null
            ? {}
            : { hasVirtioMem: coldRestartHasVirtioMem }),
          updatedAt: new Date(),
        })
        .where(eq(cubes.id, cubeId));

      await reconcileServerResources(tx, serverId);
    });

    // 5. Audit + lifecycle log + Pusher event.
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Cube resized: ${cube.vcpus}→${newVcpus} vCPU, ${cube.ramMb}→${newRamMb} MB, ${cube.diskLimitGb}→${newDiskLimitGb} GB${effectiveLive ? "" : " (cold)"}`,
    });

    audit({
      action: "cube.resize_complete",
      category: "cube",
      actorType,
      actorId,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube resized ${cube.vcpus}→${newVcpus} vCPU, ${cube.ramMb}→${newRamMb} MB, ${cube.diskLimitGb}→${newDiskLimitGb} GB`,
      metadata: { isLive, effectiveLive, cpuDelta, ramDelta, diskDelta },
      source: "worker",
    });

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: wasRunning ? "running" : "sleeping",
      resized: true,
    });

    dispatchWebhookEvent(spaceId, "cube.resize.completed", {
      cube: buildCubeSummary({
        ...cube,
        vcpus: newVcpus,
        ramMb: newRamMb,
        diskLimitGb: newDiskLimitGb,
        status: wasRunning ? "running" : "sleeping",
      }),
      resize: {
        from: {
          vcpus: cube.vcpus,
          ramMb: cube.ramMb,
          diskLimitGb: cube.diskLimitGb,
        },
        to: { vcpus: newVcpus, ramMb: newRamMb, diskLimitGb: newDiskLimitGb },
      },
    });

    // Notify space owner that the resize succeeded.
    try {
      const owner = await getSpaceOwner(spaceId);
      if (owner) {
        const cubeUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/cubes/${cubeId}`;
        const cubeName = cube.name ?? cubeId;
        const { cubeResizedEmailTemplate } = await import(
          "@/lib/email/templates/cube-resized"
        );
        const { html, text } = await cubeResizedEmailTemplate({
          userName: owner.name,
          spaceName: owner.spaceName,
          cubeName,
          cubeId,
          cubeUrl,
          before: {
            vcpus: cube.vcpus,
            ramMb: cube.ramMb,
            diskLimitGb: cube.diskLimitGb,
          },
          after: {
            vcpus: newVcpus,
            ramMb: newRamMb,
            diskLimitGb: newDiskLimitGb,
          },
          isLive,
        });
        await enqueueEmail({
          to: owner.email,
          subject: `Cube resized — ${cubeName}`,
          html,
          text,
        });
      }
    } catch (emailErr) {
      console.error("[cube-resize] success email enqueue failed:", emailErr);
    }

    await log.info("Cube resize completed");
    console.log(`[cube-resize] completed cubeId=${cubeId}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[cube-resize] failed cubeId=${cubeId}:`, reason);
    await log.error(`Cube resize failed: ${reason}`);

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Cube resize failed: ${reason}`,
    });

    // Recovery status — the LIVE path never stops the VM (RAM/disk hotplug runs
    // against the running guest), so a live-grow failure leaves a perfectly
    // healthy, serving cube. Flipping it to `error` (the old behavior) wrongly
    // hid a running cube as broken, silently stopped its billing, and made it
    // ineligible for state-sync while cube.error-recovery couldn't relaunch it
    // (the old FC still holds the TAP → "Resource busy"). So:
    //   - effectiveLive  → restore `running`, KEEP lastBilledAt (VM still up,
    //                      billing continues — mirrors snapshot-restore's
    //                      preserve-on-failure, Rule 51).
    //   - cold + infra   → `error` (the VM WAS powered off; cube is broken).
    //   - no infra       → revert to the pre-resize status.
    const recoveryStatus: "running" | "sleeping" | "error" = effectiveLive
      ? "running"
      : infraTouched
        ? "error"
        : originalStatus;
    await db
      .update(cubes)
      .set({
        status: recoveryStatus,
        // Rule 52: clear the running-compute clock ONLY when landing in error.
        // On the live path the VM never stopped, so keep lastBilledAt (it was
        // just advanced by the pre-resize prorated charge) and billing continues.
        ...(recoveryStatus === "error" ? { lastBilledAt: null } : {}),
        // If the host rootfs file was already grown but a downstream step
        // failed, the host file IS at newDiskLimitGb — persist it so later ops
        // don't compute deltas from a stale baseline (audit M10, 2026-05-24).
        ...(diskHostFileGrown ? { diskLimitGb: newDiskLimitGb } : {}),
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId));

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: recoveryStatus,
    });

    dispatchWebhookEvent(spaceId, "cube.resize.failed", {
      cube: buildCubeSummary({
        ...cube,
        status: recoveryStatus,
      }),
      reason,
      resize: {
        from: {
          vcpus: cube.vcpus,
          ramMb: cube.ramMb,
          diskLimitGb: cube.diskLimitGb,
        },
        to: { vcpus: newVcpus, ramMb: newRamMb, diskLimitGb: newDiskLimitGb },
      },
    });

    audit({
      action: "cube.resize_failed",
      category: "cube",
      actorType,
      actorId,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Cube resize failed: ${reason}`,
      metadata: { isLive, error: reason, cpuDelta, ramDelta, diskDelta },
      source: "worker",
    });

    throw err;
  } finally {
    client.end();
  }
}

export async function handleCubeResize(
  jobs: Job<CubeResizePayload>[]
): Promise<void> {
  for (const j of jobs) {
    await handleCubeResizeJob(j);
  }
}
