"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import {
  CPU_OPTIONS,
  DISK_OPTIONS,
  IMAGE_OPTIONS,
  RAM_OPTIONS,
} from "@/config/platform";
import * as schema from "@/db/schema";
import {
  getActionSession,
  requireActionMembershipAndPermission,
} from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { isValidRangeValue } from "@/lib/cube-options";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { assertCanCreateCubeV2, effectiveLimits } from "@/lib/plan/limits";
import {
  acquireSpaceLock,
  countActiveCubesTx,
  getSpaceOverrides,
  getSpacePlanRow,
} from "@/lib/plan/usage";
import { allocateServerAndCreateCube } from "@/lib/server/allocate";
import { getBackendConnection, selectBackend } from "@/lib/storage/backends";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  MAX_UPLOAD_SIZE_BYTES,
  MIN_UPLOAD_SIZE_BYTES,
  presignDownloadUrl,
  UPLOAD_CHUNK_SIZE_BYTES,
} from "@/lib/storage/cube-archive";
import { slugifyHostname } from "@/lib/utils";
import { isValidSshPublicKey, validateName } from "@/lib/validators";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

export interface BackupDownloadInfo {
  expiresAt: string;
  filename: string;
  sizeBytes: number | null;
  url: string;
}

/**
 * Generate a short-lived presigned URL for the customer to download a
 * backup `.cube` archive. The URL is bound to the active storage
 * backend that holds the backup; the browser fetches the object
 * directly from S3.
 */
export async function getBackupDownloadUrl(
  spaceId: string,
  backupId: string
): Promise<{ success: true; data: BackupDownloadInfo } | { error: string }> {
  try {
    const sessionOrError = await getActionSession();
    if ("error" in sessionOrError) {
      return sessionOrError;
    }
    const session = sessionOrError;

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const [backup] = await db
      .select()
      .from(schema.cubeBackups)
      .where(
        and(
          eq(schema.cubeBackups.id, backupId),
          eq(schema.cubeBackups.spaceId, spaceId)
        )
      )
      .limit(1);
    if (!backup) {
      return { error: "Backup not found" };
    }
    if (backup.status !== "complete") {
      return {
        error: `Backup is currently ${backup.status}. Only completed backups can be downloaded.`,
      };
    }
    if (!backup.storagePath || !backup.storageBackendId) {
      return { error: "Backup has no storage object reference" };
    }

    const backend = await getBackendConnection(backup.storageBackendId);
    if (!backend) {
      return { error: "Storage backend not available" };
    }

    const url = await presignDownloadUrl(
      backend,
      backup.storagePath,
      DOWNLOAD_URL_TTL_SECONDS
    );
    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000);
    const stamp = (backup.completedAt ?? new Date())
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "")
      .replace("T", "-");
    const filename = `${slugifyHostname(backup.originalCubeName, "cube")}-${stamp}.cube`;

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "backup.download_requested",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: backup.originalCubeId,
      spaceId,
      description: `Generated download URL for backup "${backup.name}"`,
      metadata: { backupId },
      ...reqCtx,
    });

    return {
      success: true,
      data: {
        url,
        filename,
        sizeBytes: backup.sizeBytes,
        expiresAt: expiresAt.toISOString(),
      },
    };
  } catch (err) {
    console.error("[action:getBackupDownloadUrl]", err);
    return {
      error: "Failed to generate download URL. Please try again.",
    };
  }
}

export interface InitiateImportInput {
  diskGbOverride?: number | null;
  expectedConfig?: {
    vcpus: number;
    ramMb: number;
    diskLimitGb: number;
  } | null;
  fileSizeBytes: number;
  name: string;
  ramMbOverride?: number | null;
  region?: string | null;
  sshKeyMode: "replace" | "keep";
  sshPublicKey?: string | null;
  userData?: string | null;
  vcpusOverride?: number | null;
}

export interface InitiateImportResult {
  chunkSizeBytes: number;
  expiresAt: string;
  importId: string;
  key: string;
  parts: { partNumber: number; url: string }[];
  uploadId: string;
}

/**
 * Initiate a customer-uploaded `.cube` import: validate inputs, run
 * the plan-tier pre-flight check, create the S3 multipart upload, and
 * persist the cube_imports row. Returns presigned PUT URLs for the
 * browser to upload parts directly to S3.
 */
export async function initiateCubeImport(
  spaceId: string,
  input: InitiateImportInput
): Promise<{ success: true; data: InitiateImportResult } | { error: string }> {
  try {
    const sessionOrError = await getActionSession();
    if ("error" in sessionOrError) {
      return sessionOrError;
    }
    const session = sessionOrError;

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.create"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const trimmedName = validateName(input.name);
    if (!trimmedName) {
      return {
        error: "Name is required and must be 1–64 printable characters",
      };
    }

    if (input.sshKeyMode !== "replace" && input.sshKeyMode !== "keep") {
      return { error: "sshKeyMode must be 'replace' or 'keep'" };
    }

    let sshPublicKey: string | null = null;
    if (input.sshKeyMode === "replace") {
      const raw = input.sshPublicKey?.trim() ?? "";
      if (!raw) {
        return {
          error:
            "SSH public key is required when 'Replace SSH keys' is selected",
        };
      }
      if (!isValidSshPublicKey(raw)) {
        return { error: "Invalid SSH public key format" };
      }
      sshPublicKey = raw;
    }

    if (
      input.fileSizeBytes < MIN_UPLOAD_SIZE_BYTES ||
      input.fileSizeBytes > MAX_UPLOAD_SIZE_BYTES
    ) {
      return {
        error: `File size must be between ${MIN_UPLOAD_SIZE_BYTES} and ${MAX_UPLOAD_SIZE_BYTES} bytes`,
      };
    }

    if (
      input.vcpusOverride != null &&
      !isValidRangeValue(input.vcpusOverride, CPU_OPTIONS)
    ) {
      return { error: "vcpus override is out of range" };
    }
    if (
      input.ramMbOverride != null &&
      !isValidRangeValue(input.ramMbOverride, RAM_OPTIONS)
    ) {
      return { error: "RAM override is out of range" };
    }
    if (
      input.diskGbOverride != null &&
      !isValidRangeValue(input.diskGbOverride, DISK_OPTIONS)
    ) {
      return { error: "Disk override is out of range" };
    }
    if (
      input.expectedConfig &&
      input.diskGbOverride != null &&
      input.diskGbOverride < input.expectedConfig.diskLimitGb
    ) {
      return {
        error: `Disk override (${input.diskGbOverride} GB) cannot be smaller than the archive's disk size (${input.expectedConfig.diskLimitGb} GB)`,
      };
    }

    let regionId: string | null = null;
    if (input.region) {
      const [region] = await db
        .select({ id: schema.regions.id })
        .from(schema.regions)
        .where(eq(schema.regions.slug, input.region))
        .limit(1);
      if (!region) {
        return { error: `Unknown region: ${input.region}` };
      }
      regionId = region.id;
    }

    const [planRow, spaceOverrides] = await Promise.all([
      getSpacePlanRow(spaceId),
      getSpaceOverrides(spaceId),
    ]);
    const limits = effectiveLimits(planRow, spaceOverrides);
    const effectiveVcpus =
      input.vcpusOverride ?? input.expectedConfig?.vcpus ?? limits.maxVcpus;
    const effectiveRamMb =
      input.ramMbOverride ?? input.expectedConfig?.ramMb ?? limits.maxRamMb;
    const effectiveDiskGb =
      input.diskGbOverride ??
      input.expectedConfig?.diskLimitGb ??
      limits.maxDiskGb;

    const planCheckError = await db.transaction(
      async (tx): Promise<string | null> => {
        await acquireSpaceLock(tx, spaceId);
        const activeCubes = await countActiveCubesTx(tx, spaceId);
        const planCheck = assertCanCreateCubeV2(limits, activeCubes, {
          vcpus: effectiveVcpus,
          ramMb: effectiveRamMb,
          diskGb: effectiveDiskGb,
        });
        if (!planCheck.ok) {
          return planCheck.error;
        }
        return null;
      }
    );
    if (planCheckError) {
      return { error: planCheckError };
    }

    const backend = await selectBackend();
    if (!backend) {
      return { error: "No active storage backend configured" };
    }

    const importId = createId();
    const envPrefix =
      env.NODE_ENV === "production" ? "production" : "development";
    const s3Key = `${envPrefix}/imports/${spaceId}/${importId}.cube`;

    const upload = await createMultipartUpload(
      backend,
      s3Key,
      input.fileSizeBytes,
      { chunkSizeBytes: UPLOAD_CHUNK_SIZE_BYTES, expiresInSeconds: 3600 }
    );

    await db.insert(schema.cubeImports).values({
      id: importId,
      spaceId,
      name: trimmedName,
      status: "uploading",
      storageBackendId: backend.id,
      s3Key,
      s3UploadId: upload.uploadId,
      expectedSizeBytes: input.fileSizeBytes,
      chunkSizeBytes: upload.chunkSizeBytes,
      sshKeyMode: input.sshKeyMode,
      sshPublicKey,
      regionId,
      userData: input.userData ?? null,
      vcpusOverride: input.vcpusOverride ?? null,
      ramMbOverride: input.ramMbOverride ?? null,
      diskGbOverride: input.diskGbOverride ?? null,
      createdBy: session.user.id,
    });

    const expiresAt = new Date(Date.now() + upload.expiresInSeconds * 1000);

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "cube.import_initiate",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Initiated cube import "${trimmedName}"`,
      metadata: {
        importId,
        fileSizeBytes: input.fileSizeBytes,
        partCount: upload.parts.length,
        sshKeyMode: input.sshKeyMode,
      },
      ...reqCtx,
    });

    return {
      success: true,
      data: {
        importId,
        uploadId: upload.uploadId,
        key: s3Key,
        chunkSizeBytes: upload.chunkSizeBytes,
        parts: upload.parts,
        expiresAt: expiresAt.toISOString(),
      },
    };
  } catch (err) {
    console.error("[action:initiateCubeImport]", err);
    return { error: "Failed to start the import. Please try again." };
  }
}

export interface CompleteImportInput {
  config: {
    vcpus: number;
    ramMb: number;
    diskLimitGb: number;
    imageId: string;
    userData?: string | null;
  };
  parts: { partNumber: number; etag: string }[];
}

/**
 * Finalize a `.cube` upload — completes the S3 multipart, creates the
 * cube row, and enqueues the import worker job.
 */
export async function completeCubeImport(
  spaceId: string,
  importId: string,
  input: CompleteImportInput
): Promise<{ success: true; data: { cubeId: string } } | { error: string }> {
  try {
    const sessionOrError = await getActionSession();
    if ("error" in sessionOrError) {
      return sessionOrError;
    }
    const session = sessionOrError;

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.create"
    );
    if ("error" in permResult) {
      return permResult;
    }

    if (!isValidRangeValue(input.config.vcpus, CPU_OPTIONS)) {
      return { error: "config.vcpus out of range" };
    }
    if (!isValidRangeValue(input.config.ramMb, RAM_OPTIONS)) {
      return { error: "config.ramMb out of range" };
    }
    if (!isValidRangeValue(input.config.diskLimitGb, DISK_OPTIONS)) {
      return { error: "config.diskLimitGb out of range" };
    }
    const allowedImages = IMAGE_OPTIONS.map((i) => i.value);
    if (!allowedImages.includes(input.config.imageId)) {
      return { error: "Unknown image" };
    }

    const [claimed] = await db
      .update(schema.cubeImports)
      .set({ status: "finalizing", updatedAt: new Date() })
      .where(
        and(
          eq(schema.cubeImports.id, importId),
          eq(schema.cubeImports.spaceId, spaceId),
          eq(schema.cubeImports.status, "uploading")
        )
      )
      .returning();
    if (!claimed) {
      return { error: "Import is not in uploading state" };
    }

    if (
      claimed.diskGbOverride != null &&
      input.config.diskLimitGb !== claimed.diskGbOverride
    ) {
      await markImportFailed(
        importId,
        "config.diskLimitGb does not match the initiate-time override"
      );
      return {
        error: `Disk size (${input.config.diskLimitGb} GB) does not match the initiate-time override (${claimed.diskGbOverride} GB)`,
      };
    }

    const backend = await getBackendConnection(claimed.storageBackendId);
    if (!backend) {
      await markImportFailed(importId, "Storage backend not available");
      return { error: "Storage backend not available" };
    }

    let actualSizeBytes: number;
    try {
      const completed = await completeMultipartUpload(
        backend,
        claimed.s3Key,
        claimed.s3UploadId,
        input.parts
      );
      actualSizeBytes = completed.sizeBytes;
    } catch (err) {
      await abortMultipartUpload(
        backend,
        claimed.s3Key,
        claimed.s3UploadId
      ).catch(() => {});
      const reason = err instanceof Error ? err.message : String(err);
      await markImportFailed(
        importId,
        `CompleteMultipartUpload failed: ${reason}`
      );
      return { error: `Upload finalization failed: ${reason}` };
    }

    const declared = claimed.expectedSizeBytes;
    const drift = Math.abs(actualSizeBytes - declared) / declared;
    if (drift > 0.05) {
      await markImportFailed(
        importId,
        `Actual upload size ${actualSizeBytes} differs from declared ${declared} by >5%`
      );
      return {
        error: "Actual upload size differs significantly from declared size",
      };
    }

    const [planRow, spaceOverrides] = await Promise.all([
      getSpacePlanRow(spaceId),
      getSpaceOverrides(spaceId),
    ]);
    const limits = effectiveLimits(planRow, spaceOverrides);

    let cubeId: string;
    let createdCube: Awaited<
      ReturnType<typeof allocateServerAndCreateCube>
    >["cube"];
    try {
      const result = await db.transaction(async (tx) => {
        await acquireSpaceLock(tx, spaceId);
        const activeCubes = await countActiveCubesTx(tx, spaceId);
        const planCheck = assertCanCreateCubeV2(limits, activeCubes, {
          vcpus: input.config.vcpus,
          ramMb: input.config.ramMb,
          diskGb: input.config.diskLimitGb,
        });
        if (!planCheck.ok) {
          throw new Error(`PLAN:${planCheck.error}`);
        }
        return allocateServerAndCreateCube(
          {
            spaceId,
            name: claimed.name,
            vcpus: input.config.vcpus,
            ramMb: input.config.ramMb,
            diskLimitGb: input.config.diskLimitGb,
            imageId: input.config.imageId,
            regionId: claimed.regionId ?? undefined,
            userData: input.config.userData ?? claimed.userData ?? null,
          },
          { tx }
        );
      });
      cubeId = result.cube.id;
      createdCube = result.cube;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await markImportFailed(importId, `allocateServer failed: ${reason}`);
      if (reason.startsWith("PLAN:")) {
        return { error: reason.slice("PLAN:".length) };
      }
      return {
        error: "Failed to allocate a server for the imported cube",
      };
    }

    await db
      .update(schema.cubeImports)
      .set({
        status: "provisioning",
        cubeId,
        updatedAt: new Date(),
      })
      .where(eq(schema.cubeImports.id, importId));

    await enqueueJob(JOB_NAMES.CUBE_IMPORT_ROOTFS, { importId });

    dispatchWebhookEvent(spaceId, "cube.created", {
      cube: buildCubeSummary(createdCube),
      source: { type: "import", importId },
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "cube.import_finalize",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Finalized cube import "${claimed.name}"`,
      metadata: { importId, actualSizeBytes, cubeId },
      ...reqCtx,
    });

    return { success: true, data: { cubeId } };
  } catch (err) {
    console.error("[action:completeCubeImport]", err);
    return { error: "Failed to finalize the import. Please try again." };
  }
}

/**
 * Cancel an in-progress upload. Only allowed when status is
 * `uploading`; later states need the worker / reaper to resolve.
 */
export async function cancelCubeImport(
  spaceId: string,
  importId: string
): Promise<{ success: true } | { error: string }> {
  try {
    const sessionOrError = await getActionSession();
    if ("error" in sessionOrError) {
      return sessionOrError;
    }
    const session = sessionOrError;

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.create"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const [row] = await db
      .select()
      .from(schema.cubeImports)
      .where(
        and(
          eq(schema.cubeImports.id, importId),
          eq(schema.cubeImports.spaceId, spaceId)
        )
      )
      .limit(1);
    if (!row) {
      return { error: "Import not found" };
    }
    if (row.status !== "uploading") {
      return {
        error: `Cannot cancel import in '${row.status}' state — only 'uploading' imports are cancellable`,
      };
    }

    const backend = await getBackendConnection(row.storageBackendId);
    if (backend) {
      await abortMultipartUpload(backend, row.s3Key, row.s3UploadId).catch(
        (err) => {
          console.warn("[action:cancelCubeImport] abort failed:", err);
        }
      );
    }

    await db
      .update(schema.cubeImports)
      .set({
        status: "failed",
        error: "Cancelled by customer",
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(schema.cubeImports.id, importId));

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "cube.import_cancel",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Cancelled cube import "${row.name}"`,
      metadata: { importId },
      ...reqCtx,
    });

    return { success: true };
  } catch (err) {
    console.error("[action:cancelCubeImport]", err);
    return { error: "Failed to cancel the import. Please try again." };
  }
}

/**
 * Poll the current state of an import. Used by the import sheet UI
 * to wait for the worker to finish provisioning.
 */
export async function getCubeImportStatus(
  spaceId: string,
  importId: string
): Promise<
  | {
      success: true;
      data: {
        status: (typeof schema.cubeImports.$inferSelect)["status"];
        cubeId: string | null;
        error: string | null;
      };
    }
  | { error: string }
> {
  try {
    const sessionOrError = await getActionSession();
    if ("error" in sessionOrError) {
      return sessionOrError;
    }
    const session = sessionOrError;

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.view"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const [row] = await db
      .select({
        status: schema.cubeImports.status,
        cubeId: schema.cubeImports.cubeId,
        error: schema.cubeImports.error,
      })
      .from(schema.cubeImports)
      .where(
        and(
          eq(schema.cubeImports.id, importId),
          eq(schema.cubeImports.spaceId, spaceId)
        )
      )
      .limit(1);
    if (!row) {
      return { error: "Import not found" };
    }

    return {
      success: true,
      data: {
        status: row.status,
        cubeId: row.cubeId,
        error: row.error,
      },
    };
  } catch (err) {
    console.error("[action:getCubeImportStatus]", err);
    return { error: "Failed to fetch import status" };
  }
}

async function markImportFailed(
  importId: string,
  reason: string
): Promise<void> {
  await db
    .update(schema.cubeImports)
    .set({
      status: "failed",
      error: reason.slice(0, 2000),
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(schema.cubeImports.id, importId))
    .catch(() => {});
}
