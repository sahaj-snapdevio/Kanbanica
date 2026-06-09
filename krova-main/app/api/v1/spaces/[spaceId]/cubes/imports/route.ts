/**
 * POST /api/v1/spaces/{spaceId}/cubes/imports
 *
 * Initiate a customer-uploaded `.cube` import. The caller passes the
 * archive's declared size (so we can pre-compute the part count + run
 * plan/storage capacity pre-flight checks); we return:
 *
 *   {
 *     importId, uploadId, key, chunkSizeBytes,
 *     parts: [{ partNumber, url }, ...],
 *     expiresAt
 *   }
 *
 * The browser then uploads each part directly to S3 via the presigned
 * PUT URLs and calls POST /cubes/imports/{importId}/complete with the
 * collected ETags.
 *
 * Permissions: `cube.create` on the space.
 *
 * Plan-tier pre-flight: at initiate time we don't yet know the
 * archive's actual config (the manifest is still inside the .cube the
 * customer is about to upload). We pessimistically assume the upload
 * will provision a cube at the SIZE OVERRIDES if provided, else the
 * plan's maximum allowed per-cube size — so a customer at concurrent-
 * cube cap can't even start an import. The cube row's actual size is
 * locked in at /complete time using the values the customer entered
 * in the import sheet (which were pre-populated from the manifest
 * preview).
 */

import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { CPU_OPTIONS, DISK_OPTIONS, RAM_OPTIONS } from "@/config/platform";
import * as schema from "@/db/schema";
import { requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
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
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { selectBackend } from "@/lib/storage/backends";
import {
  createMultipartUpload,
  MAX_UPLOAD_SIZE_BYTES,
  MIN_UPLOAD_SIZE_BYTES,
  UPLOAD_CHUNK_SIZE_BYTES,
} from "@/lib/storage/cube-archive";
import { isValidSshPublicKey, validateName } from "@/lib/validators";

const sshKeyModeSchema = z.enum(["replace", "keep"]);

const initiateSchema = z.object({
  name: z.string().min(1).max(64),
  fileSizeBytes: z.number().int().positive(),
  sshKeyMode: sshKeyModeSchema.default("replace"),
  sshPublicKey: z.string().min(1).optional().nullable(),
  region: z.string().min(1).max(64).optional().nullable(),
  vcpusOverride: z.number().int().positive().optional().nullable(),
  ramMbOverride: z.number().int().positive().optional().nullable(),
  diskGbOverride: z.number().int().positive().optional().nullable(),
  userData: z
    .string()
    .max(16 * 1024)
    .optional()
    .nullable(),
  /** Customer-declared values from the manifest preview. The worker
   *  verifies these against the actual manifest after upload — they
   *  exist here only so the initiate-time plan-tier check can use the
   *  cube's TRUE size rather than the plan-maximum pessimistic guess. */
  expectedConfig: z
    .object({
      vcpus: z.number().int().positive(),
      ramMb: z.number().int().positive(),
      diskLimitGb: z.number().int().positive(),
    })
    .optional()
    .nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
    if (limited) {
      return limited;
    }

    const { spaceId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.create");

    const body = await request.json();
    const parsed = initiateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // 1. Cube name.
    const trimmedName = validateName(input.name);
    if (!trimmedName) {
      return Response.json(
        { error: "name is required and must be 1–64 printable characters" },
        { status: 400 }
      );
    }

    // 2. SSH key mode + key.
    let sshPublicKey: string | null = null;
    if (input.sshKeyMode === "replace") {
      if (!input.sshPublicKey?.trim()) {
        return Response.json(
          { error: "sshPublicKey is required when sshKeyMode='replace'" },
          { status: 400 }
        );
      }
      const trimmedKey = input.sshPublicKey.trim();
      if (!isValidSshPublicKey(trimmedKey)) {
        return Response.json(
          { error: "Invalid sshPublicKey format" },
          { status: 400 }
        );
      }
      sshPublicKey = trimmedKey;
    }

    // 3. File size.
    if (
      input.fileSizeBytes < MIN_UPLOAD_SIZE_BYTES ||
      input.fileSizeBytes > MAX_UPLOAD_SIZE_BYTES
    ) {
      return Response.json(
        {
          error: `fileSizeBytes must be between ${MIN_UPLOAD_SIZE_BYTES} and ${MAX_UPLOAD_SIZE_BYTES}`,
        },
        { status: 400 }
      );
    }

    // 4. Resolve optional region slug.
    let regionId: string | null = null;
    if (input.region) {
      const [region] = await db
        .select({ id: schema.regions.id })
        .from(schema.regions)
        .where(eq(schema.regions.slug, input.region))
        .limit(1);
      if (!region) {
        return Response.json(
          { error: `Unknown region: ${input.region}` },
          { status: 400 }
        );
      }
      regionId = region.id;
    }

    // 5. Range-validate the overrides + the expectedConfig (if any) so
    //    a malformed payload fails fast before we touch S3.
    if (
      input.vcpusOverride != null &&
      !isValidRangeValue(input.vcpusOverride, CPU_OPTIONS)
    ) {
      return Response.json(
        { error: "vcpusOverride out of range" },
        { status: 400 }
      );
    }
    if (
      input.ramMbOverride != null &&
      !isValidRangeValue(input.ramMbOverride, RAM_OPTIONS)
    ) {
      return Response.json(
        { error: "ramMbOverride out of range" },
        { status: 400 }
      );
    }
    if (
      input.diskGbOverride != null &&
      !isValidRangeValue(input.diskGbOverride, DISK_OPTIONS)
    ) {
      return Response.json(
        { error: "diskGbOverride out of range" },
        { status: 400 }
      );
    }

    // diskGbOverride can only GROW the disk, never shrink (would
    // corrupt ext4). Validated against expectedConfig if provided.
    if (
      input.expectedConfig &&
      input.diskGbOverride != null &&
      input.diskGbOverride < input.expectedConfig.diskLimitGb
    ) {
      return Response.json(
        {
          error: `diskGbOverride (${input.diskGbOverride}) cannot be smaller than the archive's diskLimitGb (${input.expectedConfig.diskLimitGb})`,
        },
        { status: 400 }
      );
    }

    // 6. Plan-tier pre-flight inside a per-space-locked transaction.
    //    We size-check against the EFFECTIVE config (overrides win
    //    over expectedConfig win over plan-max pessimistic).
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

    await db.transaction(async (tx) => {
      await acquireSpaceLock(tx, spaceId);
      const activeCubes = await countActiveCubesTx(tx, spaceId);
      const planCheck = assertCanCreateCubeV2(limits, activeCubes, {
        vcpus: effectiveVcpus,
        ramMb: effectiveRamMb,
        diskGb: effectiveDiskGb,
      });
      if (!planCheck.ok) {
        throw Response.json({ error: planCheck.error }, { status: 403 });
      }
    });

    // 7. Pick a storage backend with enough free space.
    const backend = await selectBackend();
    if (!backend) {
      return Response.json(
        { error: "No active storage backend configured" },
        { status: 503 }
      );
    }

    // 8. Reserve the S3 key + create the multipart upload + sign all
    //    part URLs. importId is generated upfront so the key is
    //    available before the row is inserted (rules out a race where
    //    the row exists but the upload hasn't been initiated).
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

    // 9. Persist the import row.
    const [row] = await db
      .insert(schema.cubeImports)
      .values({
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
        createdBy: membership.userId,
      })
      .returning();

    const expiresAt = new Date(Date.now() + upload.expiresInSeconds * 1000);

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.import_initiate",
      category: "cube",
      actorType: "user",
      actorId: apiKeyId,
      actorEmail: null,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Initiated cube import "${trimmedName}"`,
      metadata: {
        importId,
        fileSizeBytes: input.fileSizeBytes,
        chunkSizeBytes: upload.chunkSizeBytes,
        partCount: upload.parts.length,
        sshKeyMode: input.sshKeyMode,
        apiKeyId,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json(
      {
        importId: row.id,
        uploadId: upload.uploadId,
        key: s3Key,
        chunkSizeBytes: upload.chunkSizeBytes,
        parts: upload.parts,
        expiresAt: expiresAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/v1/spaces/[spaceId]/cubes/imports error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
