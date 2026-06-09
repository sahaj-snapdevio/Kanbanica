import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { cubeSnapshots, cubes, lifecycleLogs, servers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { chargeProratedUsageWithAudit } from "@/lib/cost";
import { resolveLaunchModeForCube } from "@/lib/cubes/launch-mode";
import { cubeNumaLaunchOpts } from "@/lib/cubes/numa-launch-opts";
import { db } from "@/lib/db";
import { ioNicePrefix } from "@/lib/io-nice";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import {
  assertFirecrackerExited,
  connectToServer,
  execCommand,
} from "@/lib/ssh";
import { writeCubeGuestNetworkConfig } from "@/lib/ssh/cube-guest-network";
import { cubePaths } from "@/lib/ssh/jailer";
import { loadResticRepoConfig, resticRestore } from "@/lib/storage/restic";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildSnapshotPayload } from "@/lib/webhook-payloads";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { JobLogger } from "@/lib/worker/job-log";
import type { SnapshotRestorePayload } from "@/lib/worker/job-types";

async function handleSnapshotRestoreJob(
  job: Job<SnapshotRestorePayload>
): Promise<void> {
  const { snapshotId, cubeId, spaceId, serverId } = job.data;
  const log = new JobLogger(job.id, "snapshot.restore", "cube", cubeId);
  console.log(
    `[snapshot-restore] starting for snapshotId=${snapshotId} cubeId=${cubeId}`
  );
  await log.info(`Snapshot restore started (snapshotId=${snapshotId})`);

  // 1. Load snapshot — it must be a usable, complete snapshot. (Under the new
  //    model restore never flips it to `restoring`; the `restoring` allowance
  //    here only covers a job already in flight across the deploy that changed
  //    this contract.) The REAL claim is the cube being `stopping` (step 2).
  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, snapshotId),
  });
  if (
    !snapshot ||
    (snapshot.status !== "complete" && snapshot.status !== "restoring")
  ) {
    console.log(
      `[snapshot-restore] snapshot ${snapshotId} not complete (status=${snapshot?.status}), skipping`
    );
    return;
  }
  if (!snapshot.storagePath) {
    throw new Error(
      `Snapshot ${snapshotId} has no restic snapshot id (storagePath)`
    );
  }
  // `storagePath` holds the restic snapshot id under the new
  // restic-based storage layer (see snapshot-create.ts). The
  // `storageBackendId` still references the S3 backend whose bucket
  // hosts the repo.
  const resticSnapshotId = snapshot.storagePath;

  // 2. Load cube
  const cube = await db.query.cubes.findFirst({
    where: eq(cubes.id, cubeId),
  });
  // Pre-restore status. The restore action flips cubes.status to "stopping"
  // BEFORE this handler runs, so reading it off the row here is always
  // "stopping" — which would falsely treat a RUNNING cube as sleeping and
  // re-sleep it after restore (the "cube not running after restore" bug). Use
  // the authoritative value the action captured in the payload; fall back to
  // the row read only for jobs enqueued before this field existed.
  const wasRunning = job.data.wasRunning ?? cube?.status === "running";
  if (!cube) {
    throw new Error(`Cube ${cubeId} not found`);
  }

  // The restore action atomically set the cube to `stopping` before enqueuing.
  // That `stopping` state IS the restore lock (it replaced the snapshot
  // `restoring` flag). A pg-boss retry after a terminal outcome sees the cube in
  // running/sleeping/error and correctly skips — no double-restore.
  if (cube.status !== "stopping") {
    console.log(
      `[snapshot-restore] cube ${cubeId} not stopping (status=${cube.status}) — restore not claimed or already resolved, skipping`
    );
    return;
  }

  // Resolve the cube's Firecracker launch mode (+ jailer uid) ONCE, applying
  // the JAILER_ENABLED policy and persisting any transition. Threaded into
  // every startCube call below and into cubePaths for the host-visible
  // pid/sock/log paths. With JAILER_ENABLED=false this returns "bare" and
  // cubePaths(id,"bare") === the legacy /var/lib/krova/cubes/<id>/… paths.
  const { launchMode, jailerUid } = await resolveLaunchModeForCube({
    id: cubeId,
    serverId: cube.serverId ?? serverId,
    launchMode: cube.launchMode,
    jailerUid: cube.jailerUid,
  });

  // 3. Resolve restic repo config (loads backend creds + per-cube
  //    password). Must succeed before we touch the live VM. We pass
  //    the snapshot's pinned `storageBackendId` explicitly so the
  //    config points at the backend that holds THIS snapshot's repo
  //    — never at a different one even if a newer higher-capacity
  //    backend has been added since.
  if (!snapshot.storageBackendId) {
    throw new Error(
      `Snapshot ${snapshotId} has no storageBackendId — repo backend cannot be resolved`
    );
  }
  const { config: repoConfig } = await loadResticRepoConfig(
    cubeId,
    snapshot.storageBackendId
  );

  // 4. Load server and SSH key. Guarded connect so a host-down doesn't strand
  //    the row in `restoring` forever — the restore hasn't touched the cube's
  //    rootfs yet, so the cube is still in its prior (running/sleeping) state.
  let client: Awaited<ReturnType<typeof connectToServer>>["client"];
  try {
    client = (await connectToServer(serverId)).client;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[snapshot-restore] connect failed snapshotId=${snapshotId}: ${reason}`
    );
    await log.error(`Snapshot restore failed: ${reason}`);
    // The snapshot's restic data was never touched — it stays a usable,
    // re-restorable `complete` snapshot. The rootfs was never touched either,
    // so return the cube to its pre-restore state (the action set it to
    // `stopping`); leaving it `stopping` would strand it for cube.stale-check.
    await db
      .update(cubeSnapshots)
      .set({ status: "complete" })
      .where(eq(cubeSnapshots.id, snapshotId));
    await db
      .update(cubes)
      .set({
        status: wasRunning ? "running" : "sleeping",
        // The VM was never stopped on this path (connect failed before any
        // kill) and no prorated charge ran, so the running clock is unbroken —
        // PRESERVE lastBilledAt for a was-running cube (writing a fresh `now`
        // would drop the unbilled window = free compute, Rule 51). Only the
        // sleeping case nulls it (Rule 52).
        ...(wasRunning ? {} : { lastBilledAt: null }),
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId));
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Snapshot restore failed: ${reason} (cube unchanged)`,
    });
    return;
  }

  try {
    const cubeDir = `/var/lib/krova/cubes/${cubeId}`;
    const rootfsPath = `${cubeDir}/rootfs.ext4`;
    const backupPath = `${cubeDir}/rootfs.ext4.bak`;
    // restic restores into this temp dir; we atomically rename the result over
    // the live rootfs only after it's validated, so the live file is never a
    // corrupt hybrid (the C1 data-loss fix, 2026-05-30).
    const restoreTmpDir = `${cubeDir}/.restore-tmp`;
    const restoredFile = `${restoreTmpDir}/rootfs.ext4`;
    // Mode-aware pid file (Pattern C). With launchMode="bare" this is the
    // legacy ${cubeDir}/firecracker.pid — byte-identical to before.
    const pidFile = cubePaths(cubeId, launchMode).pidFile;

    // 4a. Pre-flight: check disk space. restic restores into a TEMP file
    //     (~1x rootfs) which we atomically rename over the live rootfs after
    //     validation; the previous rootfs is kept as `.bak` for rollback (a
    //     free rename at cutover, not a copy). Peak co-resident is therefore
    //     ~2x rootfs (live + temp restore) plus 2 GB headroom.
    const dfResult = await execCommand(
      client,
      `stat -c %s ${rootfsPath} 2>/dev/null || echo 0`,
      10_000
    );
    const rootfsSizeBytes = Number.parseInt(dfResult.stdout.trim(), 10);
    const neededGb = Math.ceil((rootfsSizeBytes * 2) / 1024 / 1024 / 1024) + 2;
    const availResult = await execCommand(
      client,
      `df -BG --output=avail /var/lib/krova/cubes | tail -1 | tr -d ' G'`,
      10_000
    );
    const availableGb = Number.parseInt(availResult.stdout.trim(), 10);
    if (!isNaN(availableGb) && !isNaN(neededGb) && availableGb < neededGb) {
      throw new Error(
        `Insufficient disk space for restore: ${availableGb}GB available, ${neededGb}GB needed (rollback copy + restored rootfs)`
      );
    }

    // 4b. Charge prorated usage before stopping (matches cube-sleep behavior).
    //     Failure is non-fatal but MUST be audit-logged (Fix #3 from billing
    //     audit) — the restore advances `lastBilledAt` to a fresh `now` below
    //     so a silently-dropped charge would be unrecoverable.
    if (cube.lastBilledAt) {
      await chargeProratedUsageWithAudit(cube, {
        flow: "snapshot restore",
        logPrefix: "[snapshot-restore]",
        metadata: { serverId, snapshotId },
      });
    }

    // 4c. Stop the running VM (must stop to replace rootfs safely)
    await log.step("Stop running VM", async () => {
      await execCommand(
        client,
        `PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill "$PID" 2>/dev/null; sleep 2; PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`,
        15_000
      );
    });

    // 4d. Verify the VM process is actually stopped before touching the rootfs.
    //     Zombie-aware: a SIGKILL'd jailed FC (PID 1 of its --new-pid-ns)
    //     briefly lingers as a resource-free zombie; the old single-shot
    //     `kill -0` counted that as "running" and FAILED restores on jailed
    //     cubes ("VM process still running after kill" — the 2026-05-30
    //     incident). The shared helper polls + treats a zombie as exited.
    await assertFirecrackerExited(client, pidFile, cubeId);

    // 5-8. The cube is `stopping` from here through the final startCube.
    //      Restic restore of a multi-GB rootfs can run 10+ min; without
    //      heartbeating, `cube.stale-check`'s 10-min threshold would flag
    //      the cube as stuck and enqueue a `cube.delete` that would race
    //      this handler over the rootfs file we're actively replacing
    //      (Rule 34). Wrap the slow span in `withCubeHeartbeat` so
    //      `cubes.updatedAt` is pulsed every ~2 min.
    if (!cube.internalIp || cube.vcpus <= 0 || cube.ramMb <= 0) {
      throw new Error(
        `Cannot restart Cube ${cubeId}: missing config (ip=${cube.internalIp}, vcpus=${cube.vcpus}, ram=${cube.ramMb})`
      );
    }
    const ip = cube.internalIp;
    const restoreHasVirtioMem = await withCubeHeartbeat(cubeId, async () => {
      // 5. Recover from any PRIOR interrupted restore (idempotent re-entry —
      //    the snapshot row stays `restoring`, so a pg-boss retry re-runs us).
      //    Because restore writes to a temp file + atomic rename (below), the
      //    live rootfs.ext4 is never a corrupt hybrid: the only interrupted
      //    states are {rootfs.ext4 intact} or {rootfs.ext4 missing mid-cutover
      //    + .bak holding the original}. Put the original back if we died
      //    mid-cutover, then clear stale temp/backup so we start clean.
      await log.step("Recover any interrupted prior restore", async () => {
        await execCommand(
          client,
          `[ -f ${rootfsPath} ] || { [ -f ${backupPath} ] && mv ${backupPath} ${rootfsPath}; }; rm -rf ${restoreTmpDir}; rm -f ${backupPath}`,
          60_000
        );
      });

      // 6. Restic restore into a TEMP dir — NOT in place. The snapshot stored
      //    the relative path `rootfs.ext4`, so `--target=<tmp>` writes
      //    <tmp>/rootfs.ext4. The live rootfs.ext4 is UNTOUCHED until the
      //    atomic cutover in step 8, so a worker death during this multi-GB
      //    stream leaves the customer's current disk fully intact.
      await log.step(
        `Restic restore snapshot ${resticSnapshotId.slice(0, 8)}`,
        async () => {
          await execCommand(client, `mkdir -p ${restoreTmpDir}`, 10_000);
          await resticRestore(
            client,
            repoConfig,
            resticSnapshotId,
            restoreTmpDir
          );
        }
      );

      // 7. Validate the restored image BEFORE it goes live (mirrors
      //    cube-from-snapshot/import). e2fsck exit bit 2+ (>=4) = errors left
      //    uncorrected → abort WITHOUT touching the live rootfs (no data loss).
      await log.step("Verify restored rootfs (e2fsck)", async () => {
        const fsck = await execCommand(
          client,
          `${ioNicePrefix()}e2fsck -fy ${restoredFile}`,
          300_000
        );
        if (fsck.exitCode >= 4) {
          throw new Error(
            `Restored rootfs failed e2fsck (exit ${fsck.exitCode}) — aborting before cutover; live disk untouched: ${fsck.stderr.slice(0, 300)}`
          );
        }
      });

      // 8. Atomic cutover — the ONLY step that touches the live rootfs, and
      //    every operation is an atomic rename on the same filesystem: move
      //    the current rootfs aside as `.bak` (rollback source), then move the
      //    validated restore into place. rootfs.ext4 is therefore always a
      //    COMPLETE ext4 (old or new), never a partial write.
      await log.step("Cut over to restored rootfs", async () => {
        await execCommand(
          client,
          `mv ${rootfsPath} ${backupPath} && mv ${restoredFile} ${rootfsPath}; rm -rf ${restoreTmpDir}`,
          60_000
        );
      });

      // 8b. Re-assert the guest network config on the restored rootfs BEFORE
      //     boot. The snapshot captured the rootfs at an EARLIER point — if the
      //     cube has since been re-IP'd (Phase 2 new-scheme migration), the
      //     restored rootfs carries a stale 10.0.0.x systemd-networkd unit and
      //     would boot unreachable. Loop-mount the canonical host rootfs (it is
      //     hardlinked into the jailer chroot, so a host loop-mount of
      //     `rootfsPath` works for both bare and jailed cubes — cubePaths has no
      //     rootfs field; the canonical path stays at the cube dir per jailer.ts)
      //     and rewrite the dual-stack unit + resolv.conf for the cube's CURRENT
      //     IP. Guaranteed umount in the finally. (Same mount mechanics as
      //     cube-import-rootfs.ts.)
      const netMountDir = `/tmp/krova-mount-${cubeId}`;
      await log.step("Re-assert guest network config", async () => {
        await execCommand(client, `rm -rf ${netMountDir}`);
        await execCommand(client, `mkdir -p ${netMountDir}`);
        const mountRes = await execCommand(
          client,
          `mount -o loop ${rootfsPath} ${netMountDir}`,
          120_000
        );
        if (mountRes.exitCode !== 0) {
          throw new Error(`Failed to mount rootfs: ${mountRes.stderr}`);
        }
        try {
          await writeCubeGuestNetworkConfig(client, netMountDir, ip);
        } finally {
          await execCommand(client, `umount ${netMountDir}`, 60_000).catch(
            () => {}
          );
          await execCommand(client, `rmdir ${netMountDir}`).catch(() => {});
        }
      });

      // 9. Restart the VM with the restored rootfs
      await log.info("Restarting Firecracker VM with restored rootfs");
      const { sleepCube, startCube } = await import("@/lib/ssh/firecracker");
      const { hasVirtioMem } = await startCube(client, cubeId, {
        vcpus: cube.vcpus,
        ramMb: cube.ramMb,
        internalIp: ip,
        launchMode,
        jailerUid,
        // Re-pin to the cube's NUMA node on this (same) host — restore never
        // moves the cube, so cubeNumaLaunchOpts reads the correct server.
        ...(await cubeNumaLaunchOpts(cubeId)),
      });

      // 7b. If the cube was sleeping pre-restore, re-pause it so the
      //     customer's intentional sleep state is preserved across the
      //     restore. They asked to restore a snapshot, not to wake the cube.
      //     Mirrors cube-resize's "if (!wasRunning) sleepCube(...)" pattern.
      if (!wasRunning) {
        await log.step(
          "Re-sleep cube (restoring pre-restore sleeping state)",
          async () => {
            await sleepCube(client, cubeId, launchMode);
          }
        );
      }

      // 8. Remove backup (restore succeeded)
      await execCommand(client, `rm -f ${backupPath}`).catch(() => {});

      return hasVirtioMem;
    });

    // startCube re-read /var/lib/krova/images/vmlinux fresh from disk, so the
    // cube is now running whatever kernel is on the server. Sync the DB field.
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
        "[snapshot-restore] kernel version refresh failed (non-fatal):",
        err instanceof Error ? err.message : err
      );
    }

    // 9. Update snapshot status back to complete and cube to running
    await db
      .update(cubeSnapshots)
      .set({ status: "complete" })
      .where(eq(cubeSnapshots.id, snapshotId));

    await db
      .update(cubes)
      .set({
        // Preserve pre-restore status — a sleeping cube must stay sleeping
        // after restore (Rule 52 + customer-intent fairness). lastBilledAt
        // null when sleeping (sleep-storage pass on next tick handles disk);
        // lastStartedAt only advances on an actual customer-visible boot.
        status: wasRunning ? "running" : "sleeping",
        lastBilledAt: wasRunning ? new Date() : null,
        ...(wasRunning ? { lastStartedAt: new Date() } : {}),
        hasVirtioMem: restoreHasVirtioMem,
        ...(refreshedKernelVersion === null
          ? {}
          : { bootedKernelVersion: refreshedKernelVersion }),
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId));

    // 10. Write lifecycle log
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Snapshot "${snapshot.name}" restored successfully`,
    });

    // 11. Fire Pusher event with the actual post-restore status (preserves
    //      sleeping for a cube that was sleeping pre-restore).
    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      status: wasRunning ? "running" : "sleeping",
      snapshotId,
      snapshotStatus: "restored",
    });

    dispatchWebhookEvent(spaceId, "snapshot.restored", {
      snapshot: buildSnapshotPayload({
        cubeId,
        id: snapshotId,
        kind: snapshot.kind,
        name: snapshot.name,
        sizeBytes: snapshot.sizeBytes,
      }),
    });

    audit({
      action: "snapshot.restore_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Snapshot "${snapshot.name}" restored`,
      metadata: { snapshotId },
      source: "worker",
    });

    console.log(`[snapshot-restore] completed snapshotId=${snapshotId}`);
    await log.info(
      `Snapshot "${snapshot.name}" restored — cube ${wasRunning ? "running" : "sleeping"}`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[snapshot-restore] failed snapshotId=${snapshotId}:`,
      reason
    );
    await log.error(`Snapshot restore failed: ${reason}`);

    // Roll back to the pre-restore rootfs if a `.bak` exists. FIRST kill any
    // Firecracker that step-9 `startCube` may already have spawned against the
    // restored rootfs — moving `.bak` over a file an FC process holds open
    // would corrupt it. Also clear the temp restore dir.
    const backupPath = `/var/lib/krova/cubes/${cubeId}/rootfs.ext4.bak`;
    const rootfsPath = `/var/lib/krova/cubes/${cubeId}/rootfs.ext4`;
    const restoreTmpDir = `/var/lib/krova/cubes/${cubeId}/.restore-tmp`;
    const recoveryPidFile = cubePaths(cubeId, launchMode).pidFile;
    await execCommand(
      client,
      `PID=$(cat ${recoveryPidFile} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null; sleep 1; rm -rf ${restoreTmpDir}; test -f ${backupPath} && mv ${backupPath} ${rootfsPath} || true`
    ).catch(() => {});

    // Try to restart the VM with original rootfs
    let cubeRecovered = false;
    try {
      if (cube.internalIp && cube.vcpus > 0 && cube.ramMb > 0) {
        const { sleepCube, startCube } = await import("@/lib/ssh/firecracker");
        const { hasVirtioMem: recoveryHasVirtioMem } = await startCube(
          client,
          cubeId,
          {
            vcpus: cube.vcpus,
            ramMb: cube.ramMb,
            internalIp: cube.internalIp,
            launchMode,
            jailerUid,
            ...(await cubeNumaLaunchOpts(cubeId)),
          }
        );
        // Restore the pre-restore sleep state on recovery too — a sleeping
        // cube that failed its restore attempt must come back as sleeping,
        // not silently wake up.
        if (!wasRunning) {
          await sleepCube(client, cubeId, launchMode).catch(() => {});
        }
        let recoveryKernelVersion: number | null = null;
        try {
          const [serverRow] = await db
            .select({ currentKernelVersion: servers.currentKernelVersion })
            .from(servers)
            .where(eq(servers.id, serverId))
            .limit(1);
          if (serverRow) {
            recoveryKernelVersion = serverRow.currentKernelVersion;
          }
        } catch (vErr) {
          console.warn(
            "[snapshot-restore] kernel version refresh failed (recovery, non-fatal):",
            vErr instanceof Error ? vErr.message : vErr
          );
        }
        await db
          .update(cubes)
          .set({
            status: wasRunning ? "running" : "sleeping",
            lastBilledAt: wasRunning ? new Date() : null,
            ...(wasRunning ? { lastStartedAt: new Date() } : {}),
            hasVirtioMem: recoveryHasVirtioMem,
            ...(recoveryKernelVersion === null
              ? {}
              : { bootedKernelVersion: recoveryKernelVersion }),
            updatedAt: new Date(),
          })
          .where(eq(cubes.id, cubeId));
        cubeRecovered = true;
        // Clean up backup file after successful recovery
        await execCommand(client, `rm -f ${backupPath}`).catch(() => {});
      }
    } catch {
      // Rule 52: clear lastBilledAt when flipping to error. chargeProratedUsage
      // at the top of the handler advanced it before the restore started;
      // leaving it set would let the hourly cron compute-charge an error cube.
      await db
        .update(cubes)
        .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
        .where(eq(cubes.id, cubeId));
      // Clean up backup file even on error to avoid orphaning disk space
      await execCommand(client, `rm -f ${backupPath}`).catch(() => {});
    }

    // If recovery's relaunch was SKIPPED entirely (invalid config: no internal
    // IP / vcpus<=0 / ram<=0 — the `if` above was false and never threw), the
    // cube is still stuck in `stopping`, where cube.stale-check would
    // salvage-delete it. Flip it to a clean terminal `error` an operator can
    // revive. Scoped to `stopping` so it never disturbs the recovered
    // (running/sleeping) or already-error (catch) outcomes (Rule 52: clear
    // lastBilledAt when landing in error).
    if (!cubeRecovered) {
      await db
        .update(cubes)
        .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
        .where(and(eq(cubes.id, cubeId), eq(cubes.status, "stopping")))
        .catch(() => {});
    }

    // The snapshot's restic data is intact regardless of how the restore ended
    // (restore only READS the repo) — it stays a usable, re-restorable
    // `complete` snapshot. The OPERATION's failure is recorded on the cube
    // (error/recovered) + lifecycle log + audit below, not on the snapshot.
    await db
      .update(cubeSnapshots)
      .set({ status: "complete" })
      .where(eq(cubeSnapshots.id, snapshotId));

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Snapshot "${snapshot.name}" restore failed: ${reason}${
        cubeRecovered
          ? ` (cube recovered as ${wasRunning ? "running" : "sleeping"})`
          : ""
      }`,
    });

    await triggerCubeLifecycleEvent(cubeId, spaceId, {
      // Recovery preserves the pre-restore status (sleeping stays sleeping).
      status: cubeRecovered ? (wasRunning ? "running" : "sleeping") : "error",
      snapshotId,
      snapshotStatus: "failed",
    });

    audit({
      action: "snapshot.restore_failed",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Snapshot "${snapshot.name}" restore failed: ${reason}${cubeRecovered ? " (cube recovered)" : ""}`,
      metadata: { snapshotId, error: reason, cubeRecovered },
      source: "worker",
    });

    // The failure is fully handled above (cube recovered, snapshot normalized to
    // complete, lifecycle + audit written). Return rather than throw: a pg-boss
    // retry would re-check `cube.status === "stopping"`, which the recovery just
    // cleared, so the retry can only mis-fire if another flow later set the cube
    // stopping (the stale-job race). Worker-killed re-entry is preserved
    // separately via job expiry while the cube is still `stopping`.
    return;
  } finally {
    client.end();
  }
}

export async function handleSnapshotRestore(
  jobs: Job<SnapshotRestorePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleSnapshotRestoreJob(job);
  }
}
