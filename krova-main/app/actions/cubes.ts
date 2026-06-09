"use server";

import { and, eq, ne } from "drizzle-orm";
import { headers } from "next/headers";
import {
  CPU_OPTIONS,
  DISK_OPTIONS,
  IMAGE_OPTIONS,
  RAM_OPTIONS,
} from "@/config/platform";
import * as schema from "@/db/schema";
import {
  requireActionCubeAccess,
  requireActionMembershipAndPermission,
} from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import {
  calculateHourlyCost,
  getCreditRates,
  getCreditRateTiers,
  getTierMultiplier,
} from "@/lib/cost";
import { checkCreditBalance } from "@/lib/credit-check";
import { describeRange, isValidRangeValue } from "@/lib/cube-options";
import { transitionCubeStatus } from "@/lib/cube-state";
import { db } from "@/lib/db";
import {
  assertCanCreateCubeV2,
  assertCanKeepBackupV2,
  assertCanWakeCubeV2,
  effectiveLimits,
} from "@/lib/plan/limits";
import {
  acquireSpaceLock,
  countActiveCubesTx,
  countSpaceBackups,
  getSpaceOverrides,
  getSpacePlanRow,
} from "@/lib/plan/usage";
import {
  allocateServerAndCreateCube,
  reconcileServerResources,
} from "@/lib/server/allocate";
import { freePortsByCube } from "@/lib/server/ports";
import { assertBackupStorageAvailable } from "@/lib/storage/capabilities";
import { isValidSshPublicKey, validateName } from "@/lib/validators";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function createCube(
  spaceId: string,
  data: {
    name: string;
    vcpus: number;
    ramMb: number;
    diskGb: number;
    imageId: string;
    regionId: string;
    sshPublicKey: string;
    /** Optional cloud-init user_data. Threaded through to match the v1 create
     *  path (cube-list-create.ts) so the ONLY difference between the two create
     *  surfaces is the UI input — not silent data loss the day the dashboard
     *  form adds a user_data field. Null when the form doesn't supply it. */
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
      "cube.create"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const { vcpus, ramMb, diskGb, imageId, regionId, sshPublicKey } = data;

    // Validate region
    if (
      !regionId ||
      typeof regionId !== "string" ||
      regionId.trim().length === 0
    ) {
      return { error: "Region is required" };
    }

    // Verify region exists in the database
    const [region] = await db
      .select({ id: schema.regions.id })
      .from(schema.regions)
      .where(eq(schema.regions.id, regionId))
      .limit(1);

    if (!region) {
      return { error: "The selected region does not exist" };
    }

    // Validate SSH public key
    if (
      !sshPublicKey ||
      typeof sshPublicKey !== "string" ||
      sshPublicKey.trim().length === 0
    ) {
      return { error: "SSH public key is required" };
    }
    if (!isValidSshPublicKey(sshPublicKey)) {
      return {
        error:
          "Invalid SSH public key format. Must start with ssh-ed25519, ssh-rsa, ecdsa-sha2-*, ssh-dss, or sk-*@openssh.com.",
      };
    }

    // Validate name
    const trimmedName = validateName(data.name);
    if (!trimmedName) {
      return {
        error: "Name is required and must be 1–64 printable characters",
      };
    }

    // Validate against static cube plan config
    const cpuRange = CPU_OPTIONS;
    const ramRange = RAM_OPTIONS;
    const diskRange = DISK_OPTIONS;
    const allowedImages = IMAGE_OPTIONS.map((img) => img.value);

    if (!isValidRangeValue(vcpus, cpuRange)) {
      return { error: `CPU must be in range ${describeRange(cpuRange)}` };
    }
    if (!isValidRangeValue(ramMb, ramRange)) {
      return { error: `RAM must be in range ${describeRange(ramRange)}` };
    }
    if (!isValidRangeValue(diskGb, diskRange)) {
      return { error: `Disk must be in range ${describeRange(diskRange)}` };
    }
    if (!imageId || !allowedImages.includes(imageId)) {
      return { error: "Please select a valid operating system image" };
    }

    const diskLimitGb = diskGb;
    const creditResult = await checkCreditBalance(spaceId, {
      vcpus,
      ramMb,
      diskLimitGb,
    });
    if (!("ok" in creditResult)) {
      return creditResult;
    }
    const { hourlyCost } = creditResult;

    // Fetch the plan row + per-space overrides outside the tx; merging is
    // pure so the resolved EffectiveLimits is reused inside the lock.
    const [planRow, spaceOverrides] = await Promise.all([
      getSpacePlanRow(spaceId),
      getSpaceOverrides(spaceId),
    ]);
    const limits = effectiveLimits(planRow, spaceOverrides);

    // Serialized create: advisory lock → count (in-tx) → plan check → allocate,
    // all inside one transaction. Concurrent requests for the same space block
    // on the advisory lock until the first commits, preventing cap breaches.
    const { cube, serverId } = await db.transaction(async (tx) => {
      await acquireSpaceLock(tx, spaceId);
      const activeCubes = await countActiveCubesTx(tx, spaceId);
      const planCheck = assertCanCreateCubeV2(limits, activeCubes, {
        vcpus,
        ramMb,
        diskGb,
      });
      if (!planCheck.ok) {
        throw Object.assign(new Error(planCheck.error), { planError: true });
      }
      return allocateServerAndCreateCube(
        {
          spaceId,
          name: trimmedName,
          vcpus,
          ramMb,
          diskLimitGb,
          imageId,
          regionId,
          userData: data.userData ?? null,
        },
        { tx }
      );
    });

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube" as const,
      entityId: cube.id,
      message: "Cube provisioning started",
    });

    dispatchWebhookEvent(spaceId, "cube.created", {
      cube: buildCubeSummary(cube),
    });

    // Enqueue provision job — rollback on failure (matches redeployBackup pattern)
    try {
      await enqueueJob(JOB_NAMES.CUBE_PROVISION, {
        cubeId: cube.id,
        spaceId,
        serverId,
        vcpus: cube.vcpus,
        ramMb: cube.ramMb,
        diskLimitGb: cube.diskLimitGb,
        imageId: cube.imageId,
        sshPublicKey: sshPublicKey.trim(),
        userData: data.userData ?? null,
      });
    } catch (jobErr) {
      console.error("[createCube] failed to enqueue provision job:", jobErr);

      // Clean up: mark cube as error, free ports, rebuild server counters.
      // Reconcile rather than manual `server.allocatedCpus - vcpus` math —
      // the manual path lacks FOR UPDATE on the server row and would
      // lost-update under concurrent createCube failures. Reconcile reads
      // the cube table (cube is now `error` → excluded by the rule in
      // `reconcileServerResources`) and writes the correct totals.
      // Rule 52: pair status="error" with lastBilledAt=null (defense in depth).
      await db.transaction(async (tx) => {
        await tx
          .update(schema.cubes)
          .set({ status: "error", lastBilledAt: null })
          .where(eq(schema.cubes.id, cube.id));

        await freePortsByCube(tx, cube.id);

        await reconcileServerResources(tx, serverId);
      });

      return { error: "Failed to start provisioning. Please try again." };
    }

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "cube.create",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cube.id,
      spaceId,
      description: `Created cube "${trimmedName}" (${vcpus} vCPU, ${ramMb} MB RAM, ${diskGb} GB disk, image: ${imageId})`,
      metadata: {
        name: trimmedName,
        vcpus,
        ramMb,
        diskGb,
        imageId,
        serverId,
        hourlyCost: Number.parseFloat(hourlyCost.toFixed(4)),
      },
      ...reqCtx,
    });

    return {
      success: true,
      data: { ...cube, costPerHour: Number.parseFloat(hourlyCost.toFixed(4)) },
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error as { planError?: boolean }).planError
    ) {
      return { error: error.message };
    }
    console.error("createCube error:", error);
    if (error instanceof Error) {
      return { error: error.message };
    }
    return {
      error: "Something went wrong while creating the Cube. Please try again.",
    };
  }
}

export async function sleepCube(spaceId: string, cubeId: string) {
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

    const result = await transitionCubeStatus(cubeId, spaceId, {
      fromStatus: "running",
      verb: "sleep",
    });
    if ("error" in result) {
      return result;
    }
    const { cube } = result;

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: "Cube sleep requested",
    });

    await enqueueJob(JOB_NAMES.CUBE_SLEEP, {
      cubeId,
      spaceId,
      serverId: cube.serverId,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "cube.sleep",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Requested sleep for cube "${cube.name}"`,
      metadata: { cubeName: cube.name, serverId: cube.serverId },
      ...reqCtx,
    });

    return { success: true, data: { message: "Cube sleep initiated", cubeId } };
  } catch (error) {
    console.error("sleepCube error:", error);
    return {
      error:
        "Something went wrong while putting the Cube to sleep. Please try again.",
    };
  }
}

export async function wakeCube(spaceId: string, cubeId: string) {
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

    // Read cube first to validate and get resource info for cost check
    const [cube] = await db
      .select()
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);

    if (!cube) {
      return { error: "Cube not found" };
    }

    if (cube.status !== "sleeping") {
      return {
        error: `Cube is currently ${cube.status}. It must be sleeping to wake.`,
      };
    }

    // Check credit balance using shared cost calculator
    const rates = getCreditRates();
    const wakeTiers = getCreditRateTiers();

    const wakeMultiplier = getTierMultiplier(cube.vcpus, wakeTiers);
    const hourlyCost = calculateHourlyCost(
      { vcpus: cube.vcpus, ramMb: cube.ramMb, diskLimitGb: cube.diskLimitGb },
      rates,
      wakeMultiplier
    );

    // Fetch the plan row + per-space overrides outside the tx; merging is
    // pure so the resolved EffectiveLimits is reused inside the lock.
    const [planRow, spaceOverrides] = await Promise.all([
      getSpacePlanRow(spaceId),
      getSpaceOverrides(spaceId),
    ]);
    const limits = effectiveLimits(planRow, spaceOverrides);

    // Single transaction: advisory lock (serializes per-space wake/create) →
    // count active Cubes → plan check → credit check → atomic sleeping→claimed update.
    const claimResult = await db.transaction(async (tx) => {
      // Acquire per-space advisory lock first — blocks concurrent create/wake
      // for the same space until this transaction commits.
      await acquireSpaceLock(tx, spaceId);

      // Count active Cubes inside the locked transaction.
      const activeCubes = await countActiveCubesTx(tx, spaceId);
      const planCheck = assertCanWakeCubeV2(limits, activeCubes);
      if (!planCheck.ok) {
        return { error: planCheck.error as string };
      }

      // Lock space row to read the true current balance
      const [space] = await tx
        .select({ creditBalance: schema.spaces.creditBalance })
        .from(schema.spaces)
        .where(eq(schema.spaces.id, spaceId))
        .for("update")
        .limit(1);

      if (!space) {
        return { error: "Space not found" as const };
      }

      const creditBalance = Number.parseFloat(space.creditBalance);
      if (creditBalance < hourlyCost) {
        return {
          error: "Insufficient credits to wake Cube" as const,
          required: hourlyCost,
          available: creditBalance,
        };
      }

      // Atomic conditional update: only proceed if still sleeping (prevents TOCTOU race)
      const [claimed] = await tx
        .update(schema.cubes)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(schema.cubes.id, cubeId),
            eq(schema.cubes.spaceId, spaceId),
            eq(schema.cubes.status, "sleeping")
          )
        )
        .returning();

      if (!claimed) {
        return {
          error:
            "Cube is no longer sleeping — it may have been modified by another operation" as const,
        };
      }

      return { claimed };
    });

    if ("error" in claimResult) {
      return claimResult;
    }

    // claimResult contains { claimed } - transaction succeeded, cube is claimed for wake
    void claimResult;

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: "Cube wake requested",
    });

    await enqueueJob(JOB_NAMES.CUBE_WAKE, {
      cubeId,
      spaceId,
      serverId: cube.serverId,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "cube.wake",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Requested wake for cube "${cube.name}"`,
      metadata: { cubeName: cube.name, serverId: cube.serverId },
      ...reqCtx,
    });

    return { success: true, data: { message: "Cube wake initiated", cubeId } };
  } catch (error) {
    console.error("wakeCube error:", error);
    return {
      error: "Something went wrong while waking the Cube. Please try again.",
    };
  }
}

export async function deleteCube(
  spaceId: string,
  cubeId: string,
  options?: { preserveBackup?: boolean }
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

    // Refuse delete while a snapshot is actively being CREATED for this cube
    // (audit M4): snapshot-create is mid `restic backup` reading rootfs.ext4,
    // and a delete would `rm -rf` the cube dir out from under it. (A restore
    // puts the cube in `stopping`, which the atomic claim below already
    // refuses, so only the create race needs this explicit guard.)
    const [inFlightSnapshot] = await db
      .select({ id: schema.cubeSnapshots.id })
      .from(schema.cubeSnapshots)
      .where(
        and(
          eq(schema.cubeSnapshots.cubeId, cubeId),
          eq(schema.cubeSnapshots.status, "creating")
        )
      )
      .limit(1);
    if (inFlightSnapshot) {
      return {
        error:
          "A snapshot is currently being created for this Cube. Wait for it to finish before deleting.",
      };
    }

    // Plan-limit enforcement: if the caller wants a pre-deletion backup, the
    // space must have backup headroom. Checked BEFORE the status transition so
    // a rejected delete leaves the Cube untouched. The count → check happens
    // inside a per-space advisory-locked transaction so two concurrent
    // "delete with backup" requests can't both pass the count check and
    // over-allocate backup slots (audit M9, 2026-05-24).
    if (options?.preserveBackup) {
      // Storage backend must be configured first. The delete dialog hides
      // this option when no backend is available; this is defense in depth.
      const storageError = await assertBackupStorageAvailable();
      if (storageError) {
        return storageError;
      }

      const [planRow, spaceOverrides] = await Promise.all([
        getSpacePlanRow(spaceId),
        getSpaceOverrides(spaceId),
      ]);
      const limits = effectiveLimits(planRow, spaceOverrides);
      const backupCheckResult = await db.transaction(async (tx) => {
        await acquireSpaceLock(tx, spaceId);
        const backupCount = await countSpaceBackups(spaceId);
        return assertCanKeepBackupV2(limits, backupCount);
      });
      if (!backupCheckResult.ok) {
        return { error: backupCheckResult.error };
      }
    }

    // Atomic conditional update: set status to "stopping" only if it's in a deletable state.
    // This prevents TOCTOU races where two concurrent deletes both pass the status check.
    // Cubes in "pending" or "booting" cannot be deleted — the boot job has no cancellation
    // path and would race with the delete handler, causing double-cleanup of server resources.
    const [cube] = await db
      .update(schema.cubes)
      .set({ status: "stopping", updatedAt: new Date() })
      .where(
        and(
          eq(schema.cubes.id, cubeId),
          eq(schema.cubes.spaceId, spaceId),
          ne(schema.cubes.status, "deleted"),
          ne(schema.cubes.status, "stopping"),
          ne(schema.cubes.status, "pending"),
          ne(schema.cubes.status, "booting"),
          // Refuse delete mid cross-server transfer: `cube.transfer` is copying
          // rootfs.ext4, and a preserve-backup delete would compress a torn ext4
          // (audit H2/M5). The transfer keeps status='running'/'sleeping', so
          // this guard is separate from the status checks above.
          eq(schema.cubes.transferState, "idle")
        )
      )
      .returning();

    if (!cube) {
      const [existing] = await db
        .select({
          status: schema.cubes.status,
          transferState: schema.cubes.transferState,
        })
        .from(schema.cubes)
        .where(
          and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
        )
        .limit(1);

      if (!existing) {
        return { error: "Cube not found" };
      }
      if (existing.transferState !== "idle") {
        return {
          error:
            "This Cube is being transferred between servers. Try again once the transfer completes.",
        };
      }
      if (existing.status === "pending" || existing.status === "booting") {
        return {
          error:
            "Cannot delete a Cube while it is being deployed. Wait for it to finish booting.",
        };
      }
      return {
        error: `Cube is already being ${existing.status === "deleted" ? "deleted" : "stopped"}`,
      };
    }

    const preserveBackup = options?.preserveBackup ?? false;

    if (preserveBackup) {
      const { createPreDeletionBackup } = await import(
        "@/lib/cubes/create-pre-deletion-backup"
      );
      await createPreDeletionBackup({
        cube,
        createdBy: session.user.id,
        lifecycleMessage: "Cube deletion requested with pre-deletion backup",
        // Pre-deletion semantics: the worker must enqueue `cube.delete`
        // after the backup completes. Helper default is `false` (opt-in)
        // so this MUST be explicit.
        deleteCubeAfter: true,
      });
    } else {
      await db.insert(schema.lifecycleLogs).values({
        entityType: "cube",
        entityId: cubeId,
        message: "Cube deletion requested",
      });

      await enqueueJob(JOB_NAMES.CUBE_DELETE, {
        cubeId,
        spaceId,
        serverId: cube.serverId,
      });
    }

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "cube.delete",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Requested deletion of cube "${cube.name}"${preserveBackup ? " with backup" : ""}`,
      metadata: {
        cubeName: cube.name,
        serverId: cube.serverId,
        vcpus: cube.vcpus,
        ramMb: cube.ramMb,
        preserveBackup,
      },
      ...reqCtx,
    });

    return {
      success: true,
      data: { message: "Cube deletion initiated", cubeId },
    };
  } catch (error) {
    console.error("deleteCube error:", error);
    return {
      error: "Something went wrong while deleting the Cube. Please try again.",
    };
  }
}

export async function restartCube(spaceId: string, cubeId: string) {
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

    // Look up the cube WITHOUT a status transition — cube.cold-restart's
    // handler does its own atomic claim (running → stopping → running).
    // The previous implementation enqueued sleep + wake (delayed 30 s),
    // which (a) wasn't actually a reboot — Firecracker Pause + Resume
    // keeps the kernel/PID/processes intact, and (b) raced when sleep
    // took longer than 30 s. cube.cold-restart kills + relaunches
    // Firecracker, which is what customers expect "Restart" to do
    // (audit H10, 2026-05-24).
    const [cube] = await db
      .select()
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);
    if (!cube) {
      return { error: "Cube not found" };
    }
    if (cube.status !== "running") {
      return {
        error: `Cube is currently ${cube.status}. It must be running to restart.`,
      };
    }

    // Per-cube dedup (queue is policy=exclusive): cold-restart keeps the cube
    // visibly 'running', so a double-click / navigate-back-and-click would
    // otherwise enqueue a second kill+relaunch. A null jobId = already queued.
    const jobId = await enqueueJob(
      JOB_NAMES.CUBE_COLD_RESTART,
      {
        cubeId,
        spaceId,
        serverId: cube.serverId,
        actorId: session.user.id,
        actorEmail: session.user.email,
      },
      { singletonKey: `cube-cold-restart:${cubeId}` }
    );
    if (!jobId) {
      return { error: "A restart is already in progress for this Cube." };
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: "Cube restart requested (cold-restart)",
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "cube.restart",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Requested restart for cube "${cube.name}" (cold-restart)`,
      metadata: { cubeName: cube.name, serverId: cube.serverId },
      ...reqCtx,
    });

    return {
      success: true,
      data: { message: "Cube restart initiated", cubeId },
    };
  } catch (error) {
    console.error("restartCube error:", error);
    return {
      error:
        "Something went wrong while restarting the Cube. Please try again.",
    };
  }
}

export async function powerOffCube(spaceId: string, cubeId: string) {
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

    const result = await transitionCubeStatus(cubeId, spaceId, {
      fromStatus: "running",
      verb: "power off",
    });
    if ("error" in result) {
      return result;
    }
    const { cube } = result;

    // Power-off is distinct from sleep: enqueue the dedicated handler that
    // KILLS the Firecracker process (vs sleep's PATCH /vm state=Paused).
    // The next wake will cold-restart via `cube-wake`'s shut-off branch.
    await enqueueJob(JOB_NAMES.CUBE_POWER_OFF, {
      cubeId,
      spaceId,
      serverId: cube.serverId,
    });

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: "Cube power off requested",
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "cube.power_off",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Requested power off for cube "${cube.name}"`,
      metadata: { cubeName: cube.name, serverId: cube.serverId },
      ...reqCtx,
    });

    return {
      success: true,
      data: { message: "Cube power off initiated", cubeId },
    };
  } catch (error) {
    console.error("powerOffCube error:", error);
    return {
      error:
        "Something went wrong while powering off the Cube. Please try again.",
    };
  }
}
