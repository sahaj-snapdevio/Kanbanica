/**
 * GET /api/v1/spaces/{spaceId}/cubes/imports/{importId}
 * DELETE /api/v1/spaces/{spaceId}/cubes/imports/{importId}
 *
 * GET returns the current state of an import (used by the customer UI
 * to poll until status is `complete` or `failed`).
 *
 * DELETE cancels an in-progress upload — only allowed while status is
 * `uploading` (after /complete is called the import has consumed S3
 * resources and must run to terminal state). Aborts the S3 multipart
 * upload and marks the row `failed`.
 *
 * Both require `cube.view` (GET) / `cube.create` (DELETE).
 */

import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { getBackendConnection } from "@/lib/storage/backends";
import { abortMultipartUpload } from "@/lib/storage/cube-archive";

function formatImport(row: typeof schema.cubeImports.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    cubeId: row.cubeId,
    error: row.error,
    expectedSizeBytes: row.expectedSizeBytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; importId: string }> }
) {
  try {
    const { spaceId, importId } = await params;
    const { membership } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.view");

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
      return Response.json({ error: "Import not found" }, { status: 404 });
    }

    return Response.json({ import: formatImport(row) });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "GET /api/v1/spaces/[spaceId]/cubes/imports/[importId] error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
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
      return Response.json({ error: "Import not found" }, { status: 404 });
    }
    if (row.status !== "uploading") {
      return Response.json(
        {
          error: `Cannot cancel import in status '${row.status}' — only 'uploading' imports are cancellable`,
        },
        { status: 409 }
      );
    }

    const backend = await getBackendConnection(row.storageBackendId);
    if (backend) {
      await abortMultipartUpload(backend, row.s3Key, row.s3UploadId).catch(
        (err) => {
          console.warn(
            `[cube-imports DELETE] abort failed for ${importId}:`,
            err
          );
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

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.import_cancel",
      category: "cube",
      actorType: "user",
      actorId: apiKeyId,
      actorEmail: null,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Cancelled cube import "${row.name}"`,
      metadata: { importId, apiKeyId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "DELETE /api/v1/spaces/[spaceId]/cubes/imports/[importId] error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
