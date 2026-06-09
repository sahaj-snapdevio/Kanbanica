/**
 * GET /api/v1/spaces/{spaceId}/backups/{backupId}/download
 *
 * Returns a short-lived (15 min) presigned S3 URL for the customer to
 * download their backup `.cube` archive directly from the storage
 * backend. No bytes flow through this route — the browser fetches the
 * object straight from S3 using the presigned URL.
 *
 * Permissions: caller must hold `cube.manage` on the space.
 *
 * Response shape:
 *   { url, filename, sizeBytes, expiresAt }
 *
 * `filename` is a friendly download name (`<slug>-<YYYYMMDD-HHMMSS>.cube`)
 * derived from the original cube name + the backup's completed-at
 * timestamp. The actual S3 object key is opaque to the customer.
 */

import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { getBackendConnection } from "@/lib/storage/backends";
import { presignDownloadUrl } from "@/lib/storage/cube-archive";
import { slugifyHostname } from "@/lib/utils";

const URL_TTL_SECONDS = 15 * 60;

function archiveFilename(cubeName: string, completedAt: Date | null): string {
  const stamp = (completedAt ?? new Date())
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-");
  return `${slugifyHostname(cubeName, "cube")}-${stamp}.cube`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; backupId: string }> }
) {
  try {
    const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
    if (limited) {
      return limited;
    }

    const { spaceId, backupId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.manage");

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
      return Response.json({ error: "Backup not found" }, { status: 404 });
    }
    if (backup.status !== "complete") {
      return Response.json(
        {
          error: `Backup is currently ${backup.status} — only completed backups can be downloaded`,
        },
        { status: 409 }
      );
    }
    if (!backup.storagePath || !backup.storageBackendId) {
      return Response.json(
        { error: "Backup has no storage object reference" },
        { status: 500 }
      );
    }

    const backend = await getBackendConnection(backup.storageBackendId);
    if (!backend) {
      return Response.json(
        { error: "Storage backend not available" },
        { status: 503 }
      );
    }

    const url = await presignDownloadUrl(
      backend,
      backup.storagePath,
      URL_TTL_SECONDS
    );
    const expiresAt = new Date(Date.now() + URL_TTL_SECONDS * 1000);

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "backup.download_requested",
      category: "cube",
      actorType: "user",
      actorId: apiKeyId,
      actorEmail: null,
      entityType: "cube",
      entityId: backup.originalCubeId,
      spaceId,
      description: `Generated download URL for backup "${backup.name}"`,
      metadata: { backupId, apiKeyId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      url,
      filename: archiveFilename(backup.originalCubeName, backup.completedAt),
      sizeBytes: backup.sizeBytes,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "GET /api/v1/spaces/[spaceId]/backups/[backupId]/download error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
