/**
 * POST /api/v1/spaces/{spaceId}/cubes/imports/{importId}/complete
 *
 * Finalize a customer-initiated `.cube` upload. The browser sends the
 * collected per-part ETags + the final cube configuration (which the
 * customer derived from the manifest preview + their overrides).
 *
 *   {
 *     parts: [{ partNumber, etag }, ...],
 *     config: { vcpus, ramMb, diskLimitGb, imageId, userData? }
 *   }
 *
 * Flow:
 *   1. Atomically claim the cube_imports row (uploading → finalizing).
 *   2. Validate config against the platform ranges + plan-tier limits.
 *   3. Complete the S3 multipart upload + sanity-check actual size.
 *   4. Run `allocateServerAndCreateCube` in the SAME transaction as
 *      the per-space lock + concurrent-cube count check.
 *   5. Update cube_imports → status='provisioning', cube_id set.
 *   6. Enqueue `cube.import-rootfs` worker job.
 *   7. Return { cubeId, status: 'provisioning' }.
 *
 * The worker is the final authority — it re-reads the manifest from
 * the uploaded archive and rejects any cube whose declared
 * diskLimitGb is smaller than the manifest's (would corrupt ext4).
 * The vcpus/ramMb the customer chose are just labels at boot time,
 * so we don't second-guess them against the manifest.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  CPU_OPTIONS,
  DISK_OPTIONS,
  IMAGE_OPTIONS,
  RAM_OPTIONS,
} from "@/config/platform";
import * as schema from "@/db/schema";
import { requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { audit, extractRequestContext } from "@/lib/audit";
import { isValidRangeValue } from "@/lib/cube-options";
import { db } from "@/lib/db";
import { assertCanCreateCubeV2, effectiveLimits } from "@/lib/plan/limits";
import {
  acquireSpaceLock,
  countActiveCubesTx,
  getSpaceOverrides,
  getSpacePlanRow,
} from "@/lib/plan/usage";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { allocateServerAndCreateCube } from "@/lib/server/allocate";
import { getBackendConnection } from "@/lib/storage/backends";
import {
  abortMultipartUpload,
  completeMultipartUpload,
} from "@/lib/storage/cube-archive";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

const completeSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string().min(1),
      })
    )
    .min(1),
  config: z.object({
    vcpus: z.number().int().positive(),
    ramMb: z.number().int().positive(),
    diskLimitGb: z.number().int().positive(),
    imageId: z.string().min(1).max(64),
    userData: z
      .string()
      .max(16 * 1024)
      .optional()
      .nullable(),
  }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; importId: string }> }
) {
  try {
    const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
    if (limited) {
      return limited;
    }

    const { spaceId, importId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.create");

    const body = await request.json();
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // Validate config ranges + image id (matches createCube semantics).
    if (!isValidRangeValue(input.config.vcpus, CPU_OPTIONS)) {
      return Response.json(
        { error: "config.vcpus out of range" },
        { status: 400 }
      );
    }
    if (!isValidRangeValue(input.config.ramMb, RAM_OPTIONS)) {
      return Response.json(
        { error: "config.ramMb out of range" },
        { status: 400 }
      );
    }
    if (!isValidRangeValue(input.config.diskLimitGb, DISK_OPTIONS)) {
      return Response.json(
        { error: "config.diskLimitGb out of range" },
        { status: 400 }
      );
    }
    const allowedImages = IMAGE_OPTIONS.map((i) => i.value);
    if (!allowedImages.includes(input.config.imageId)) {
      return Response.json(
        {
          error: `config.imageId must be one of: ${allowedImages.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // 1. Claim the import row atomically.
    const [claimedImport] = await db
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
    if (!claimedImport) {
      return Response.json(
        { error: "Import is not in uploading state" },
        { status: 409 }
      );
    }

    // diskLimitGb in config must be >= the customer's diskGbOverride
    // (if they declared one at initiate time). Belt-and-suspenders
    // against a UI bug.
    if (
      claimedImport.diskGbOverride != null &&
      input.config.diskLimitGb !== claimedImport.diskGbOverride
    ) {
      await failImport(
        importId,
        "config.diskLimitGb does not match the initiate-time override"
      );
      return Response.json(
        {
          error: `config.diskLimitGb (${input.config.diskLimitGb}) must equal the initiate-time diskGbOverride (${claimedImport.diskGbOverride})`,
        },
        { status: 400 }
      );
    }

    const backend = await getBackendConnection(claimedImport.storageBackendId);
    if (!backend) {
      await failImport(importId, "Storage backend not available");
      return Response.json(
        { error: "Storage backend not available" },
        { status: 503 }
      );
    }

    // 2. Complete the multipart upload on S3.
    let actualSizeBytes: number;
    try {
      const completed = await completeMultipartUpload(
        backend,
        claimedImport.s3Key,
        claimedImport.s3UploadId,
        input.parts
      );
      actualSizeBytes = completed.sizeBytes;
    } catch (err) {
      // Abort the multipart on a hard completion failure so we don't
      // leak in-progress part storage.
      await abortMultipartUpload(
        backend,
        claimedImport.s3Key,
        claimedImport.s3UploadId
      ).catch(() => {});
      const reason = err instanceof Error ? err.message : String(err);
      await failImport(importId, `CompleteMultipartUpload failed: ${reason}`);
      return Response.json(
        { error: `Upload finalization failed: ${reason}` },
        { status: 502 }
      );
    }

    // Sanity check: actual size should be within ±5% of the customer-
    // declared expectedSize. Drift larger than that means either a UI
    // bug or a malicious client gaming the initiate plan-check.
    const declared = claimedImport.expectedSizeBytes;
    const drift = Math.abs(actualSizeBytes - declared) / declared;
    if (drift > 0.05) {
      await failImport(
        importId,
        `Actual upload size ${actualSizeBytes} differs from declared ${declared} by >5%`
      );
      return Response.json(
        {
          error: "Actual upload size differs significantly from declared size",
        },
        { status: 400 }
      );
    }

    // 3. Resolve plan + per-space overrides outside the tx (pure
    //    merge), then run the per-space-locked create flow.
    const [planRow, spaceOverrides] = await Promise.all([
      getSpacePlanRow(spaceId),
      getSpaceOverrides(spaceId),
    ]);
    const limits = effectiveLimits(planRow, spaceOverrides);

    let cubeId: string;
    try {
      const { cube } = await db.transaction(async (tx) => {
        await acquireSpaceLock(tx, spaceId);
        const activeCubes = await countActiveCubesTx(tx, spaceId);
        const planCheck = assertCanCreateCubeV2(limits, activeCubes, {
          vcpus: input.config.vcpus,
          ramMb: input.config.ramMb,
          diskGb: input.config.diskLimitGb,
        });
        if (!planCheck.ok) {
          throw Response.json({ error: planCheck.error }, { status: 403 });
        }
        return allocateServerAndCreateCube(
          {
            spaceId,
            name: claimedImport.name,
            vcpus: input.config.vcpus,
            ramMb: input.config.ramMb,
            diskLimitGb: input.config.diskLimitGb,
            imageId: input.config.imageId,
            regionId: claimedImport.regionId ?? undefined,
            userData: input.config.userData ?? claimedImport.userData ?? null,
          },
          { throwResponse: true, tx }
        );
      });
      cubeId = cube.id;
    } catch (err) {
      if (err instanceof Response) {
        await failImport(importId, "allocateServer threw a Response");
        return err;
      }
      const reason = err instanceof Error ? err.message : String(err);
      await failImport(importId, `allocateServer failed: ${reason}`);
      throw err;
    }

    // 4. Update import row → provisioning + record the new cube id +
    //    enqueue the worker job.
    await db
      .update(schema.cubeImports)
      .set({
        status: "provisioning",
        cubeId,
        updatedAt: new Date(),
      })
      .where(eq(schema.cubeImports.id, importId));

    await enqueueJob(JOB_NAMES.CUBE_IMPORT_ROOTFS, { importId });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.import_finalize",
      category: "cube",
      actorType: "user",
      actorId: apiKeyId,
      actorEmail: null,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Finalized cube import "${claimedImport.name}"`,
      metadata: {
        importId,
        actualSizeBytes,
        cubeId,
        apiKeyId,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      importId,
      cubeId,
      status: "provisioning",
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/v1/spaces/[spaceId]/cubes/imports/[importId]/complete error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function failImport(importId: string, reason: string): Promise<void> {
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
