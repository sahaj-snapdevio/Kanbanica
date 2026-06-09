"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { headers } from "next/headers";
import * as schema from "@/db/schema";
import {
  requireActionCubeAccess,
  requireActionMembershipAndPermission,
} from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { createPreDeletionBackup } from "@/lib/cubes/create-pre-deletion-backup";
import { db } from "@/lib/db";
import {
  assertCanCreateCubeV2,
  loadEffectiveLimits,
  loadEffectiveLimitsTx,
} from "@/lib/plan/limits";
import {
  assertCanCreateBackup,
  assertCanCreateManualSnapshot,
  countManualSnapshotsForCube,
} from "@/lib/plan/snapshot-limits";
import {
  acquireSpaceLock,
  countActiveCubesTx,
  countSpaceBackups,
} from "@/lib/plan/usage";
import { allocateServerAndCreateCube } from "@/lib/server/allocate";
import { assertBackupStorageAvailable } from "@/lib/storage/capabilities";
import { isValidSshPublicKey, validateName } from "@/lib/validators";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary, buildSnapshotPayload } from "@/lib/webhook-payloads";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function createSnapshot(
  spaceId: string,
  cubeId: string,
  name: string
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const accessError = await requireActionCubeAccess(
      permResult.membership,
      cubeId
    );
    if (accessError) {
      return accessError;
    }

    // Storage backend must be configured before a snapshot can be created.
    // The Snapshots UI is also hidden when this fails; the guard here is
    // defense in depth for direct action calls.
    const storageError = await assertBackupStorageAvailable();
    if (storageError) {
      return storageError;
    }

    // Validate name
    const trimmedName = validateName(name);
    if (!trimmedName) {
      return {
        error: "Name is required and must be 1–64 printable characters",
      };
    }

    // Load cube — must be running or sleeping (rootfs exists on disk in both states)
    const cube = await db.query.cubes.findFirst({
      where: and(
        eq(schema.cubes.id, cubeId),
        eq(schema.cubes.spaceId, spaceId)
      ),
    });
    if (!cube) {
      return { error: "Cube not found" };
    }
    if (cube.status !== "running" && cube.status !== "sleeping") {
      return {
        error: `Cube is currently ${cube.status}. It must be running or sleeping to create a snapshot.`,
      };
    }
    // Rule 58 preflight: a cube mid cross-server transfer keeps status
    // running/sleeping while its rootfs.ext4 is being copied — snapshotting it
    // would capture a torn ext4 (audit H2).
    if (cube.transferState !== "idle") {
      return {
        error:
          "This Cube is being transferred between servers. Try again once the transfer completes.",
      };
    }

    // Per-plan manual snapshot cap. Counted across non-failed `kind='manual'`
    // snapshots — auto snapshots don't count, and a pinned-from-auto snapshot
    // DOES count (it flipped to kind=manual on pin and is now customer-owned).
    //
    // Double-fire audit: the count + insert run inside a per-cube advisory-lock
    // transaction (seed 4 = snapshot domain, same as exportSnapshot) so two
    // concurrent "Create snapshot" clicks can't BOTH pass the cap and create two
    // rows past the limit — the second blocks on the lock until the first's row
    // is committed, then re-counts and is cap-rejected.
    const created = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${cubeId}, 4))`
      );
      const limits = await loadEffectiveLimits(spaceId);
      const manualCount = await countManualSnapshotsForCube(cubeId);
      const capCheck = assertCanCreateManualSnapshot(limits, manualCount);
      if (!capCheck.ok) {
        return { error: capCheck.error };
      }
      const [snapshot] = await tx
        .insert(schema.cubeSnapshots)
        .values({
          cubeId,
          spaceId,
          name: trimmedName,
          status: "pending",
          kind: "manual",
          createdBy: session.user.id,
        })
        .returning();
      return { snapshot };
    });
    if ("error" in created) {
      return { error: created.error };
    }
    const snapshot = created.snapshot;

    // Enqueue background job (AFTER the row is committed, so the worker finds it)
    await enqueueJob(JOB_NAMES.SNAPSHOT_CREATE, {
      snapshotId: snapshot.id,
      cubeId,
      spaceId,
      serverId: cube.serverId,
    });

    // Write lifecycle log
    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Snapshot "${trimmedName}" creation started`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "snapshot.create",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Started snapshot "${trimmedName}"`,
      metadata: { snapshotId: snapshot.id, cubeName: cube.name },
      ...reqCtx,
    });

    return { success: true, data: { snapshotId: snapshot.id } };
  } catch (err) {
    console.error("[action:createSnapshot]", err);
    return {
      error:
        "Something went wrong while creating the snapshot. Please try again.",
    };
  }
}

export async function restoreSnapshot(
  spaceId: string,
  cubeId: string,
  snapshotId: string
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const accessError = await requireActionCubeAccess(
      permResult.membership,
      cubeId
    );
    if (accessError) {
      return accessError;
    }

    // Load cube
    const cube = await db.query.cubes.findFirst({
      where: and(
        eq(schema.cubes.id, cubeId),
        eq(schema.cubes.spaceId, spaceId)
      ),
    });
    if (!cube) {
      return { error: "Cube not found" };
    }
    if (cube.status !== "running" && cube.status !== "sleeping") {
      return {
        error: `Cube is currently ${cube.status}. It must be running or sleeping to restore a snapshot.`,
      };
    }
    // Rule 58 preflight: restore OVERWRITES the live rootfs. A cube mid
    // cross-server transfer is having that same file copied — restoring now
    // would race the transfer and corrupt the disk (audit H2). The atomic
    // claim below also re-checks transferState to close the TOCTOU window.
    if (cube.transferState !== "idle") {
      return {
        error:
          "This Cube is being transferred between servers. Try again once the transfer completes.",
      };
    }
    // Capture the TRUE pre-restore status BEFORE the transaction below flips it
    // to "stopping". The handler reads this from the payload to decide whether
    // to leave the cube running or re-sleep it after restore — it can't read it
    // off the row once it's "stopping".
    const wasRunning = cube.status === "running";

    // Load snapshot — must be complete and belong to the same space
    const snapshot = await db.query.cubeSnapshots.findFirst({
      where: and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      ),
    });
    if (!snapshot) {
      return { error: "Snapshot not found" };
    }
    if (snapshot.status !== "complete") {
      return {
        error: `This snapshot is currently ${snapshot.status === "failed" ? "in a failed state" : snapshot.status}. Only completed snapshots can be restored.`,
      };
    }

    // Atomically claim the cube as stopping — this IS the restore lock.
    // The snapshot stays `complete` for its whole life (a failed restore
    // must not brick it; the worker handler never marks it `restoring`).
    const claimed = await db.transaction(async (tx) => {
      // Atomic conditional update: only proceed if cube is still in a valid state
      const [updatedCube] = await tx
        .update(schema.cubes)
        .set({ status: "stopping", updatedAt: new Date() })
        .where(
          and(
            eq(schema.cubes.id, cubeId),
            eq(schema.cubes.spaceId, spaceId),
            // Only claim if still running or sleeping
            ne(schema.cubes.status, "deleted"),
            ne(schema.cubes.status, "stopping"),
            ne(schema.cubes.status, "error"),
            ne(schema.cubes.status, "pending"),
            ne(schema.cubes.status, "booting"),
            // …and only if NOT mid cross-server transfer (audit H2 — closes the
            // TOCTOU between the preflight check above and this claim).
            eq(schema.cubes.transferState, "idle")
          )
        )
        .returning();
      // The cube `stopping` claim IS the restore lock now — the snapshot stays
      // `complete` for its whole life (a failed restore must not brick it).
      return Boolean(updatedCube);
    });

    if (!claimed) {
      return {
        error: "Cube is no longer in a valid state for snapshot restore",
      };
    }

    // Enqueue background job
    await enqueueJob(JOB_NAMES.SNAPSHOT_RESTORE, {
      snapshotId,
      cubeId,
      spaceId,
      serverId: cube.serverId,
      wasRunning,
    });

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Restoring from snapshot "${snapshot.name}"`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "snapshot.restore",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Started restore from snapshot "${snapshot.name}"`,
      metadata: { snapshotId, cubeName: cube.name },
      ...reqCtx,
    });

    return { success: true };
  } catch (err) {
    console.error("[action:restoreSnapshot]", err);
    return {
      error:
        "Something went wrong while starting the restore. Please try again.",
    };
  }
}

export async function deleteSnapshot(
  spaceId: string,
  cubeId: string,
  snapshotId: string
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const accessError = await requireActionCubeAccess(
      permResult.membership,
      cubeId
    );
    if (accessError) {
      return accessError;
    }

    // Load snapshot — must belong to this cube and space
    const snapshot = await db.query.cubeSnapshots.findFirst({
      where: and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      ),
    });
    if (!snapshot) {
      return { error: "Snapshot not found" };
    }
    if (snapshot.status === "pending" || snapshot.status === "creating") {
      return {
        error: `This snapshot is currently ${snapshot.status}. Wait for it to finish before deleting.`,
      };
    }
    // An active restore/boot holds the cube's rootfs; refuse to delete a
    // snapshot of that cube until it settles. (Snapshots no longer carry a
    // `restoring` status — the cube is the source of truth.)
    const cubeForGuard = await db.query.cubes.findFirst({
      where: eq(schema.cubes.id, cubeId),
      columns: { status: true },
    });
    if (
      cubeForGuard &&
      (cubeForGuard.status === "stopping" || cubeForGuard.status === "booting")
    ) {
      return {
        error:
          "This Cube is currently restarting (e.g. a restore in progress). Try again once it settles.",
      };
    }
    if (snapshot.kind === "auto") {
      return {
        error:
          "Auto snapshots are system-managed and cannot be deleted directly. Pin this snapshot to convert it to a manual snapshot, then delete it.",
      };
    }

    // A `failed` snapshot is a dismissible note that holds no restic data
    // (storagePath is null). "Dismiss" = delete the row directly — there is
    // nothing in the repo to forget, so we skip the SNAPSHOT_DELETE worker job.
    if (snapshot.status === "failed" && !snapshot.storagePath) {
      await db
        .delete(schema.cubeSnapshots)
        .where(eq(schema.cubeSnapshots.id, snapshotId));
      await db.insert(schema.lifecycleLogs).values({
        entityType: "cube" as const,
        entityId: cubeId,
        message: `Dismissed failed snapshot note "${snapshot.name}"`,
      });
      const reqCtxFailed = extractRequestContext(await headers());
      audit({
        action: "snapshot.delete",
        category: "cube",
        actorType: "user",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `Dismissed failed snapshot "${snapshot.name}"`,
        metadata: { snapshotId, dismissed: true },
        ...reqCtxFailed,
      });
      return { success: true };
    }

    // Enqueue deletion job (handles storage backend cleanup + DB record)
    try {
      await enqueueJob(JOB_NAMES.SNAPSHOT_DELETE, {
        snapshotId,
        cubeId,
        spaceId,
      });
    } catch (err) {
      console.error("[deleteSnapshot] failed to enqueue deletion job:", err);
      return {
        error: "Failed to schedule snapshot deletion. Please try again.",
      };
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube" as const,
      entityId: cubeId,
      message: `Snapshot "${snapshot.name}" deletion requested`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "snapshot.delete",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Deleted snapshot "${snapshot.name}"`,
      metadata: { snapshotId },
      ...reqCtx,
    });

    return { success: true };
  } catch (err) {
    console.error("[action:deleteSnapshot]", err);
    return {
      error:
        "Something went wrong while deleting the snapshot. Please try again.",
    };
  }
}

/**
 * Start a customer-initiated `.cube` export of a completed snapshot. The
 * worker materializes on the source cube's host (restic dump → zstd →
 * tar), uploads to S3, presigns a 24h GET URL, and emails the space
 * owner. The reaper deletes the `.cube` from S3 after `expiresAt`.
 *
 * Defenses:
 *  - Rate limit: refuses if an export of the same snapshot is already
 *    in flight (`pending` or `materializing`). Customer can re-export
 *    once the prior one completes (or fails).
 *  - Storage backend must exist (export upload target).
 *  - Snapshot must be `complete` and belong to (spaceId, cubeId).
 */
export async function exportSnapshot(
  spaceId: string,
  cubeId: string,
  snapshotId: string
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const accessError = await requireActionCubeAccess(
      permResult.membership,
      cubeId
    );
    if (accessError) {
      return accessError;
    }

    const storageError = await assertBackupStorageAvailable();
    if (storageError) {
      return storageError;
    }

    const snapshot = await db.query.cubeSnapshots.findFirst({
      where: and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      ),
    });
    if (!snapshot) {
      return { error: "Snapshot not found" };
    }
    if (snapshot.status !== "complete") {
      return {
        error: `Snapshot is currently ${snapshot.status}. Only completed snapshots can be exported.`,
      };
    }

    const cube = await db.query.cubes.findFirst({
      where: eq(schema.cubes.id, cubeId),
      columns: { serverId: true },
    });
    if (!cube) {
      return { error: "Cube not found" };
    }

    // Placeholder `expiresAt` = now + 25h. The handler overwrites with
    // `completedAt + 24h` when the upload finishes. If the handler dies
    // before that, the reaper still treats the row as expired after 25h
    // and cleans it up.
    const placeholderExpiresAt = new Date(Date.now() + 25 * 3600 * 1000);

    // Reject duplicate dispatch: at most one in-flight export per snapshot.
    // The check + insert run inside a transaction under a per-snapshot advisory
    // lock (seed 4 — disjoint from space=0 / user=1 / jailer-uid=2 /
    // bridge-subnet=3) so two concurrent requests can't BOTH pass the check and
    // create two exports → two restic dumps + two S3 objects + two emailed
    // links (audit M-2 TOCTOU).
    const dispatch = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${snapshotId}, 4))`
      );
      const [inflight] = await tx
        .select({ id: schema.snapshotExports.id })
        .from(schema.snapshotExports)
        .where(
          and(
            eq(schema.snapshotExports.snapshotId, snapshotId),
            inArray(schema.snapshotExports.status, ["pending", "materializing"])
          )
        )
        .limit(1);
      if (inflight) {
        return { inflight: true as const };
      }
      const [created] = await tx
        .insert(schema.snapshotExports)
        .values({
          snapshotId,
          spaceId,
          status: "pending",
          expiresAt: placeholderExpiresAt,
          requestedBy: session.user.id,
        })
        .returning();
      return { row: created };
    });

    if ("inflight" in dispatch) {
      return {
        error:
          "An export of this snapshot is already in progress. Check your email shortly — the download link will arrive when it's ready.",
      };
    }
    const row = dispatch.row;

    await enqueueJob(JOB_NAMES.SNAPSHOT_EXPORT, {
      exportId: row.id,
      snapshotId,
      cubeId,
      spaceId,
      serverId: cube.serverId,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "snapshot.export_requested",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Requested export of snapshot "${snapshot.name}"`,
      metadata: { exportId: row.id, snapshotId },
      ...reqCtx,
    });

    return { success: true, data: { exportId: row.id } };
  } catch (err) {
    console.error("[action:exportSnapshot]", err);
    return {
      error:
        "Something went wrong while starting the export. Please try again.",
    };
  }
}

/**
 * Clone a completed snapshot into a brand-new cube. The new cube is
 * allocated to a server (same per-space lock + plan-tier gate as
 * `createCube`), then a `cube.from-snapshot` job materializes the rootfs
 * via restic dump onto the destination server and boots.
 *
 * Disk can only grow, not shrink — ext4 corrupts on shrink. The action
 * rejects a smaller-disk request early; the handler also defends.
 */
export async function cloneSnapshotToNewCube(
  spaceId: string,
  cubeId: string,
  snapshotId: string,
  input: {
    name: string;
    regionId: string;
    vcpus: number;
    ramMb: number;
    diskLimitGb: number;
    sshPublicKey: string;
    userData?: string | null;
  }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const accessError = await requireActionCubeAccess(
      permResult.membership,
      cubeId
    );
    if (accessError) {
      return accessError;
    }

    const trimmedName = validateName(input.name);
    if (!trimmedName) {
      return { error: "Cube name must be 1–64 printable characters" };
    }
    if (!isValidSshPublicKey(input.sshPublicKey)) {
      return { error: "Invalid SSH public key" };
    }

    const snapshot = await db.query.cubeSnapshots.findFirst({
      where: and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      ),
    });
    if (!snapshot) {
      return { error: "Snapshot not found" };
    }
    if (snapshot.status !== "complete") {
      return { error: "Snapshot must be complete before cloning" };
    }

    const sourceCube = await db.query.cubes.findFirst({
      where: eq(schema.cubes.id, cubeId),
    });
    if (!sourceCube) {
      return { error: "Source cube not found" };
    }

    if (input.diskLimitGb < sourceCube.diskLimitGb) {
      return {
        error: `Disk cannot shrink below the source cube's ${sourceCube.diskLimitGb} GB (ext4 cannot shrink).`,
      };
    }

    // Allocate inside a per-space lock so plan caps + concurrent-cube count
    // are serialized with the insert. Mirrors the createCube flow.
    let allocated: Awaited<ReturnType<typeof allocateServerAndCreateCube>>;
    try {
      allocated = await db.transaction(async (tx) => {
        await acquireSpaceLock(tx, spaceId);
        const limits = await loadEffectiveLimitsTx(tx, spaceId);
        const activeCount = await countActiveCubesTx(tx, spaceId);
        const planCheck = assertCanCreateCubeV2(limits, activeCount, {
          vcpus: input.vcpus,
          ramMb: input.ramMb,
          diskGb: input.diskLimitGb,
        });
        if (!planCheck.ok) {
          throw new Error(`PLAN:${planCheck.error}`);
        }
        return allocateServerAndCreateCube(
          {
            spaceId,
            name: trimmedName,
            vcpus: input.vcpus,
            ramMb: input.ramMb,
            diskLimitGb: input.diskLimitGb,
            imageId: sourceCube.imageId,
            regionId: input.regionId,
            userData: input.userData ?? sourceCube.userData ?? null,
          },
          { tx }
        );
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason.startsWith("PLAN:")) {
        return { error: reason.slice("PLAN:".length) };
      }
      console.error("[action:cloneSnapshotToNewCube]", err);
      return { error: "Failed to allocate a server for the new cube" };
    }

    await enqueueJob(JOB_NAMES.CUBE_FROM_SNAPSHOT, {
      cubeId: allocated.cube.id,
      spaceId,
      serverId: allocated.serverId,
      sourceCubeId: cubeId,
      sourceSnapshotId: snapshotId,
      sshPublicKey: input.sshPublicKey,
    });

    dispatchWebhookEvent(spaceId, "cube.created", {
      cube: buildCubeSummary(allocated.cube),
      source: { type: "snapshot_clone", snapshotId, sourceCubeId: cubeId },
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "snapshot.cloned_to_cube",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: allocated.cube.id,
      spaceId,
      description: `Cloned snapshot "${snapshot.name}" to new cube "${trimmedName}"`,
      metadata: { sourceCubeId: cubeId, sourceSnapshotId: snapshotId },
      ...reqCtx,
    });

    return { success: true, data: { cubeId: allocated.cube.id } };
  } catch (err) {
    console.error("[action:cloneSnapshotToNewCube]", err);
    return { error: "Something went wrong while cloning the snapshot." };
  }
}

/**
 * Promote a completed snapshot to a backup. Reuses the
 * `createPreDeletionBackup` helper to insert the `cube_backups` row with
 * the cubeConfig captured at action time, then enqueues
 * `snapshot.promote-to-backup` which restic-dumps the source snapshot
 * (rather than compressing the live rootfs) and uploads to the backups
 * prefix. The source cube and source snapshot are both untouched.
 *
 * The backup counts against the plan's `maxBackups` cap (refused on
 * Trial which has cap=0).
 */
export async function promoteSnapshotToBackup(
  spaceId: string,
  cubeId: string,
  snapshotId: string,
  name: string
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }
    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }
    const accessError = await requireActionCubeAccess(
      permResult.membership,
      cubeId
    );
    if (accessError) {
      return accessError;
    }

    const storageError = await assertBackupStorageAvailable();
    if (storageError) {
      return storageError;
    }

    const trimmed = validateName(name);
    if (!trimmed) {
      return { error: "Backup name must be 1–64 printable characters" };
    }

    const snapshot = await db.query.cubeSnapshots.findFirst({
      where: and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      ),
    });
    if (!snapshot) {
      return { error: "Snapshot not found" };
    }
    if (snapshot.status !== "complete") {
      return { error: "Snapshot must be complete before promoting to backup" };
    }

    const cube = await db.query.cubes.findFirst({
      where: eq(schema.cubes.id, cubeId),
    });
    if (!cube) {
      return { error: "Cube not found" };
    }

    // Plan-tier cap check — refuses Trial (maxBackups=0) and any
    // paid plan already at its retained-backup limit.
    //
    // Double-fire audit: the count + the backup-row insert run inside a
    // per-space advisory-lock transaction (acquireSpaceLock — the same lock the
    // clone/redeploy/import create paths use) so two concurrent "Save as Backup"
    // clicks can't both pass the maxBackups cap. The second request blocks on
    // the lock until the first's backup row is committed, then re-counts and is
    // cap-rejected. createPreDeletionBackup commits its own row (autocommit)
    // while this tx holds the lock, so the re-count sees it.
    const promoted = await db.transaction(async (tx) => {
      await acquireSpaceLock(tx, spaceId);
      const limits = await loadEffectiveLimits(spaceId);
      const backupCount = await countSpaceBackups(spaceId);
      const capCheck = assertCanCreateBackup(limits, backupCount);
      if (!capCheck.ok) {
        return { error: capCheck.error };
      }
      // The shared helper captures the cubeConfig snapshot we need for
      // redeployment. skipEnqueue:true — we fire the promote-from-snapshot
      // handler ourselves (it restic-dumps the snapshot instead of compressing
      // the live rootfs, which already captured the desired bytes).
      const { backupId: bid } = await createPreDeletionBackup({
        cube,
        createdBy: session.user.id,
        lifecycleMessage: `Promoting snapshot "${snapshot.name}" to backup "${trimmed}"`,
        backupName: trimmed,
        deleteCubeAfter: false,
        skipEnqueue: true,
      });
      return { backupId: bid };
    });
    if ("error" in promoted) {
      return { error: promoted.error };
    }
    const { backupId } = promoted;

    await enqueueJob(JOB_NAMES.SNAPSHOT_PROMOTE_TO_BACKUP, {
      snapshotId,
      cubeId,
      spaceId,
      serverId: cube.serverId,
      backupId,
      backupName: trimmed,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "snapshot.promote_to_backup_requested",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Requested promotion of snapshot "${snapshot.name}" to backup "${trimmed}"`,
      metadata: { snapshotId, backupId },
      ...reqCtx,
    });

    return { success: true, data: { backupId } };
  } catch (err) {
    console.error("[action:promoteSnapshotToBackup]", err);
    return {
      error: "Something went wrong while promoting the snapshot to a backup.",
    };
  }
}

/**
 * Pin an auto-tagged snapshot — flip `kind` from `auto` to `manual`.
 * After the pin, the snapshot:
 *  - Counts against the plan's `maxManualSnapshotsPerCube` cap (refused
 *    if cap is already full).
 *  - Survives the daily `snapshot.auto-prune` (the pruner queries DB
 *    rows with `kind='manual'` and passes each one's restic id as
 *    `--keep-id` to `restic forget`).
 *  - Becomes customer-deletable.
 *
 * The restic-side tag stays `auto`; we do NOT call `restic rewrite` at
 * pin time (avoiding a non-trivial dependency on a specific restic
 * version). The DB column is the source of truth.
 */
export async function pinAutoSnapshot(
  spaceId: string,
  cubeId: string,
  snapshotId: string
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const accessError = await requireActionCubeAccess(
      permResult.membership,
      cubeId
    );
    if (accessError) {
      return accessError;
    }

    const snapshot = await db.query.cubeSnapshots.findFirst({
      where: and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      ),
    });
    if (!snapshot) {
      return { error: "Snapshot not found" };
    }
    if (snapshot.kind !== "auto") {
      return { error: "Snapshot is already manual" };
    }
    if (snapshot.status !== "complete") {
      return { error: "Snapshot is not in a complete state" };
    }

    // Pinning consumes a manual slot — cap-check before flipping.
    const limits = await loadEffectiveLimits(spaceId);
    const manualCount = await countManualSnapshotsForCube(cubeId);
    const capCheck = assertCanCreateManualSnapshot(limits, manualCount);
    if (!capCheck.ok) {
      return { error: capCheck.error };
    }

    await db
      .update(schema.cubeSnapshots)
      .set({ kind: "manual" })
      .where(eq(schema.cubeSnapshots.id, snapshotId));

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "snapshot.pinned",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Pinned auto snapshot "${snapshot.name}" to manual`,
      metadata: { snapshotId },
      ...reqCtx,
    });

    dispatchWebhookEvent(spaceId, "snapshot.pinned", {
      snapshot: buildSnapshotPayload({
        cubeId,
        id: snapshotId,
        kind: "manual",
        name: snapshot.name,
        sizeBytes: snapshot.sizeBytes,
      }),
    });

    return { success: true };
  } catch (err) {
    console.error("[action:pinAutoSnapshot]", err);
    return { error: "Something went wrong while pinning the snapshot." };
  }
}
