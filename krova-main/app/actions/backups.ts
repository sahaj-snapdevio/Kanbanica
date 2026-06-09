"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { CPU_OPTIONS, DISK_OPTIONS, RAM_OPTIONS } from "@/config/platform";
import * as schema from "@/db/schema";
import type { CubeBackupConfig } from "@/db/schema/backups";
import { requireActionMembershipAndPermission } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { checkCreditBalance } from "@/lib/credit-check";
import { formatRam, isValidRangeValue } from "@/lib/cube-options";
import { db } from "@/lib/db";
import { assertCanCreateCubeV2, effectiveLimits } from "@/lib/plan/limits";
import {
  acquireSpaceLock,
  countActiveCubesTx,
  getSpaceOverrides,
  getSpacePlanRow,
} from "@/lib/plan/usage";
import {
  allocateServerAndCreateCube,
  reconcileServerResources,
} from "@/lib/server/allocate";
import { freePortsByCube } from "@/lib/server/ports";
import { isValidSshPublicKey, validateName } from "@/lib/validators";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function deleteBackup(spaceId: string, backupId: string) {
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

    // Load backup
    const backup = await db.query.cubeBackups.findFirst({
      where: and(
        eq(schema.cubeBackups.id, backupId),
        eq(schema.cubeBackups.spaceId, spaceId)
      ),
    });
    if (!backup) {
      return { error: "Backup not found" };
    }

    if (backup.status === "pending" || backup.status === "creating") {
      return {
        error: `This backup is currently ${backup.status}. Wait for it to finish before deleting.`,
      };
    }

    // Enqueue deletion job (handles storage backend cleanup + DB record)
    await enqueueJob(JOB_NAMES.BACKUP_DELETE, { backupId, spaceId });

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space" as const,
      entityId: spaceId,
      message: `Backup "${backup.name}" deletion requested`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "backup.delete",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Deleted backup "${backup.name}"`,
      metadata: { backupId, originalCubeId: backup.originalCubeId },
      ...reqCtx,
    });

    return { success: true };
  } catch (err) {
    console.error("[action:deleteBackup]", err);
    return {
      error:
        "Something went wrong while deleting the backup. Please try again.",
    };
  }
}

export async function redeployBackup(
  spaceId: string,
  backupId: string,
  data: {
    name: string;
    sshKeyMode?: "replace" | "keep";
    sshPublicKey?: string;
    regionId?: string;
    /** Optional resize overrides applied to the redeployed cube. vCPU
     *  and RAM are runtime-only and can be set to any plan-allowed
     *  value. Disk can only GROW from the backup's saved value (ext4
     *  cannot be shrunk in-place); the worker runs `truncate -s` +
     *  `resize2fs` upward before booting. */
    vcpus?: number;
    ramMb?: number;
    diskGb?: number;
    reason?: string;
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

    // Load backup — must be complete
    const backup = await db.query.cubeBackups.findFirst({
      where: and(
        eq(schema.cubeBackups.id, backupId),
        eq(schema.cubeBackups.spaceId, spaceId)
      ),
    });
    if (!backup) {
      return { error: "Backup not found" };
    }
    if (backup.status !== "complete") {
      return {
        error: `Backup is ${backup.status}. Only completed backups can be redeployed.`,
      };
    }

    const config = backup.cubeConfig as CubeBackupConfig;

    // Validate backup config integrity
    if (
      !config?.vcpus ||
      !config?.ramMb ||
      !config?.diskLimitGb ||
      !config?.imageId
    ) {
      return { error: "Backup configuration is corrupted. Cannot redeploy." };
    }

    // Validate backup config values against current cube plan ranges
    if (!isValidRangeValue(config.vcpus, CPU_OPTIONS)) {
      return {
        error: `Backup CPU config (${config.vcpus}) is outside current plan limits. Contact support.`,
      };
    }
    if (!isValidRangeValue(config.ramMb, RAM_OPTIONS)) {
      return {
        error: `Backup RAM config (${config.ramMb}MB) is outside current plan limits. Contact support.`,
      };
    }
    if (!isValidRangeValue(config.diskLimitGb, DISK_OPTIONS)) {
      return {
        error: `Backup disk config (${config.diskLimitGb}GB) is outside current plan limits. Contact support.`,
      };
    }

    // Resolve the effective per-cube size from optional overrides.
    // `vcpus` / `ramMb` can move freely within platform + plan ranges.
    // `diskGb` is restricted to >= backup's saved diskLimitGb because
    // shrinking ext4 in-place would corrupt the rootfs.
    const finalVcpus = data.vcpus ?? config.vcpus;
    const finalRamMb = data.ramMb ?? config.ramMb;
    const finalDiskGb = data.diskGb ?? config.diskLimitGb;
    if (!isValidRangeValue(finalVcpus, CPU_OPTIONS)) {
      return { error: "vcpus override is out of range" };
    }
    if (!isValidRangeValue(finalRamMb, RAM_OPTIONS)) {
      return { error: "ramMb override is out of range" };
    }
    if (!isValidRangeValue(finalDiskGb, DISK_OPTIONS)) {
      return { error: "diskGb override is out of range" };
    }
    if (finalDiskGb < config.diskLimitGb) {
      return {
        error: `Disk (${finalDiskGb} GB) cannot be smaller than the backup's saved disk size (${config.diskLimitGb} GB)`,
      };
    }

    // SSH key mode — defaults to "replace" for backwards compat with
    // older callers that didn't pass the field.
    const sshKeyMode = data.sshKeyMode ?? "replace";
    if (sshKeyMode !== "replace" && sshKeyMode !== "keep") {
      return { error: "sshKeyMode must be 'replace' or 'keep'" };
    }

    // Validate name
    const trimmedName = validateName(data.name);
    if (!trimmedName) {
      return {
        error: "Name is required and must be 1–64 printable characters",
      };
    }

    // SSH key validation — only required when sshKeyMode='replace'.
    // When mode='keep' the worker leaves the rootfs's existing
    // authorized_keys untouched; customer must hold the matching
    // private key on their end.
    let trimmedSshKey: string | null = null;
    if (sshKeyMode === "replace") {
      if (
        !data.sshPublicKey ||
        typeof data.sshPublicKey !== "string" ||
        data.sshPublicKey.trim().length === 0
      ) {
        return {
          error:
            "SSH public key is required when 'Replace SSH keys' is selected",
        };
      }
      if (!isValidSshPublicKey(data.sshPublicKey)) {
        return {
          error:
            "Invalid SSH public key format. Must start with ssh-ed25519, ssh-rsa, ecdsa-sha2-*, ssh-dss, or sk-*@openssh.com.",
        };
      }
      trimmedSshKey = data.sshPublicKey.trim();
    }

    // Check credit balance against the FINAL size (overrides applied).
    const creditResult = await checkCreditBalance(spaceId, {
      vcpus: finalVcpus,
      ramMb: finalRamMb,
      diskLimitGb: finalDiskGb,
    });
    if (!("ok" in creditResult)) {
      return creditResult;
    }
    const { hourlyCost } = creditResult;

    // Use the original region or allow override
    const regionId = data.regionId || config.regionId;

    // Region is always required for redeployment
    if (!regionId) {
      return { error: "A region must be selected for redeployment" };
    }

    // Validate region exists
    const region = await db.query.regions.findFirst({
      where: eq(schema.regions.id, regionId),
    });
    if (!region) {
      return {
        error:
          "The selected region no longer exists. Please choose a different region.",
      };
    }

    // Fetch the plan row + per-space overrides outside the tx; merging is
    // pure so the resolved EffectiveLimits is reused inside the lock.
    const [planRow, spaceOverrides] = await Promise.all([
      getSpacePlanRow(spaceId),
      getSpaceOverrides(spaceId),
    ]);
    const limits = effectiveLimits(planRow, spaceOverrides);

    // Serialized create: advisory lock → count (in-tx) → plan check → allocate,
    // all inside one transaction. Concurrent create/wake for the same space
    // block on the advisory lock until the first commits, preventing cap breaches.
    const { cube, serverId } = await db.transaction(async (tx) => {
      await acquireSpaceLock(tx, spaceId);
      const activeCubes = await countActiveCubesTx(tx, spaceId);
      const planCheck = assertCanCreateCubeV2(limits, activeCubes, {
        vcpus: finalVcpus,
        ramMb: finalRamMb,
        diskGb: finalDiskGb,
      });
      if (!planCheck.ok) {
        const msg = `The redeployed cube (${finalVcpus} vCPU / ${formatRam(finalRamMb)} / ${finalDiskGb} GB disk) is larger than your current ${limits.label} plan allows. Adjust the sizes or upgrade your plan.`;
        throw Object.assign(new Error(msg), { planError: true });
      }
      return allocateServerAndCreateCube(
        {
          spaceId,
          name: trimmedName,
          vcpus: finalVcpus,
          ramMb: finalRamMb,
          diskLimitGb: finalDiskGb,
          imageId: config.imageId,
          regionId,
        },
        { tx }
      );
    });

    dispatchWebhookEvent(spaceId, "cube.created", {
      cube: buildCubeSummary(cube),
      source: { type: "backup_redeploy", backupId },
    });

    // Enqueue redeploy job
    try {
      await enqueueJob(JOB_NAMES.BACKUP_REDEPLOY, {
        backupId,
        spaceId,
        newCubeId: cube.id,
        serverId,
        sshKeyMode,
        sshPublicKey: trimmedSshKey,
        originalDiskLimitGb: config.diskLimitGb,
      });
    } catch (jobErr) {
      console.error("[redeployBackup] failed to enqueue redeploy job:", jobErr);

      // Clean up: mark cube as error, free ports, rebuild server counters.
      // Reconcile rather than manual `server.allocatedCpus - finalVcpus`
      // math — the manual path lacks FOR UPDATE on the server row and would
      // lost-update under concurrent redeploy failures. Reconcile reads
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

        await tx.insert(schema.lifecycleLogs).values({
          entityType: "cube" as const,
          entityId: cube.id,
          message: "Cube redeployment failed: could not enqueue job",
        });
      });

      return { error: "Failed to start redeployment. Please try again." };
    }

    // Record the redeployment on the backup
    await db
      .update(schema.cubeBackups)
      .set({ redeployedCubeId: cube.id })
      .where(eq(schema.cubeBackups.id, backupId));

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "backup.redeploy",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cube.id,
      spaceId,
      description: `Redeploying from backup "${backup.name}" as "${trimmedName}"`,
      metadata: {
        backupId,
        newCubeId: cube.id,
        originalCubeId: backup.originalCubeId,
        hourlyCost: Number.parseFloat(hourlyCost.toFixed(4)),
      },
      ...reqCtx,
    });

    return {
      success: true,
      data: {
        cubeId: cube.id,
        costPerHour: Number.parseFloat(hourlyCost.toFixed(4)),
      },
    };
  } catch (error) {
    console.error("[action:redeployBackup]", error);
    if (error instanceof Error) {
      return { error: error.message };
    }
    return {
      error:
        "Something went wrong while redeploying from backup. Please try again.",
    };
  }
}
