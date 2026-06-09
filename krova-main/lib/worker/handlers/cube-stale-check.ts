import { and, eq, inArray, lt } from "drizzle-orm";
import { cubes, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { createPreDeletionBackup } from "@/lib/cubes/create-pre-deletion-backup";
import { db } from "@/lib/db";
import { notifyAdminsOfCubeError } from "@/lib/email/notify-error";
import { triggerCubeLifecycleEvent } from "@/lib/pusher";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

const STALE_THRESHOLD_MINUTES = 10;

export async function handleCubeStaleCheck(): Promise<void> {
  const threshold = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

  // Fetches the full cube row because `createPreDeletionBackup` expects
  // the complete `CubeRow` type. A column projection would break the
  // signature; the slight overhead of the wide JSONB blobs at every
  // 5-min tick is acceptable for a sweep that typically only fires when
  // something is actually stuck.
  const staleCubes = await db
    .select()
    .from(cubes)
    .where(
      and(
        inArray(cubes.status, ["pending", "booting", "stopping"]),
        lt(cubes.updatedAt, threshold)
      )
    );

  if (staleCubes.length === 0) {
    return;
  }

  console.log(`[cube-stale-check] found ${staleCubes.length} stale Cube(s)`);

  for (const cube of staleCubes) {
    // Mark as error (atomic: only update if not already handled by another
    // process). Rule 52: clear lastBilledAt — a stuck cube in `stopping`
    // came from a `running` state and may carry the running-compute clock;
    // an error cube must not stay billable for compute.
    const [claimed] = await db
      .update(cubes)
      .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(cubes.id, cube.id),
          inArray(cubes.status, ["pending", "booting", "stopping"])
        )
      )
      .returning({ id: cubes.id });

    if (!claimed) {
      console.log(
        `[cube-stale-check] cube ${cube.id} status changed concurrently, skipping`
      );
      continue;
    }

    // A cube that has actually run before (lastStartedAt is set) has a
    // rootfs worth preserving — try a pre-deletion backup so the customer
    // can redeploy if the auto-cleanup turns out to have been a false
    // positive. backup.create's finally block still enqueues cube.delete
    // after the backup completes (or fails), so cleanup still happens.
    //
    // A cube that never started (pending stuck in cube.provision crash,
    // or a backup.redeploy that never reached the running-status flip)
    // has no host-side rootfs to compress, so we skip backup and go
    // straight to delete.
    const hasRootfs = !!cube.lastStartedAt;
    let backupAttempted = false;

    if (hasRootfs) {
      try {
        const { backupId } = await createPreDeletionBackup({
          cube,
          createdBy: null,
          lifecycleMessage: `Auto-cleanup: pre-deletion backup created (stuck in ${cube.status} for over ${STALE_THRESHOLD_MINUTES} minutes)`,
          backupName: `${cube.name} (auto-salvage ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)`,
          // Salvage path: the cube is already stuck and being torn down.
          // The worker MUST enqueue `cube.delete` after the backup so the
          // stuck cube finishes cleaning up. Helper default is `false`
          // (opt-in) so this MUST be explicit.
          deleteCubeAfter: true,
        });
        backupAttempted = true;
        console.log(
          `[cube-stale-check] cube ${cube.id} stuck in ${cube.status} — created salvage backup ${backupId}, backup.create will enqueue cube.delete on completion`
        );
      } catch (err) {
        console.error(
          `[cube-stale-check] failed to create salvage backup for cube ${cube.id}, falling back to direct delete:`,
          err
        );
      }
    }

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cube.id,
      message: `Cube marked as error — stuck in ${cube.status} for over ${STALE_THRESHOLD_MINUTES} minutes. ${
        backupAttempted
          ? "Salvage backup created; auto-cleanup will run after backup completes."
          : "Auto-cleanup enqueued."
      }`,
    });

    audit({
      action: "cube.stale_detected",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cube.id,
      spaceId: cube.spaceId,
      description: `Cube marked as error — stuck in ${cube.status} for over ${STALE_THRESHOLD_MINUTES} minutes`,
      metadata: {
        cubeId: cube.id,
        stuckStatus: cube.status,
        duration: `${STALE_THRESHOLD_MINUTES}m`,
        backupAttempted,
      },
      source: "worker",
    });

    await triggerCubeLifecycleEvent(cube.id, cube.spaceId, {
      status: "error",
      reason: `Timed out — stuck in ${cube.status} for over ${STALE_THRESHOLD_MINUTES} minutes`,
    });

    // Notify admin error recipients
    await notifyAdminsOfCubeError({
      cubeName: cube.name,
      cubeId: cube.id,
      spaceId: cube.spaceId,
      serverId: cube.serverId,
      reason: `Stuck in ${cube.status} for over ${STALE_THRESHOLD_MINUTES} minutes — auto-cleanup triggered${backupAttempted ? " (salvage backup created)" : ""}`,
    }).catch((err) => {
      console.error(
        `[cube-stale-check] failed to send admin error notification for ${cube.id}:`,
        err
      );
    });

    // If we didn't enqueue backup.create (no rootfs, or backup creation
    // failed), enqueue cube.delete directly. Otherwise, backup.create's
    // finally block will handle the delete enqueue after the backup runs.
    if (!backupAttempted) {
      await enqueueJob(JOB_NAMES.CUBE_DELETE, {
        cubeId: cube.id,
        spaceId: cube.spaceId,
        serverId: cube.serverId,
      });
      console.log(
        `[cube-stale-check] cube ${cube.id} marked as error, delete job enqueued (no salvage backup)`
      );
    }
  }

  console.log(
    `[cube-stale-check] processed ${staleCubes.length} stale Cube(s)`
  );
}
