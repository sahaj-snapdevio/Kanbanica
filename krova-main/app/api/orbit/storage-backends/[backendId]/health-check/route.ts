import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { decryptValue, Secret } from "@/lib/encrypt";
import { s3ProbeBackend } from "@/lib/storage/s3-direct";
import type { StorageBackendConnection } from "@/lib/storage/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ backendId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { backendId } = await params;

    const [backend] = await db
      .select()
      .from(schema.storageBackends)
      .where(eq(schema.storageBackends.id, backendId))
      .limit(1);

    if (!backend) {
      return Response.json(
        { error: "Storage backend not found" },
        { status: 404 }
      );
    }

    const conn: StorageBackendConnection = {
      id: backend.id,
      name: backend.name,
      endpoint: backend.endpoint,
      region: backend.region,
      bucket: backend.bucket,
      accessKeyId: new Secret(decryptValue(backend.accessKeyIdEnc)),
      secretAccessKey: new Secret(decryptValue(backend.secretAccessKeyEnc)),
    };

    try {
      await s3ProbeBackend(conn);
    } catch (probeErr) {
      const message =
        probeErr instanceof Error ? probeErr.message : String(probeErr);
      return Response.json(
        { error: `Probe failed: ${message}` },
        { status: 502 }
      );
    }

    const [updated] = await db
      .update(schema.storageBackends)
      .set({ lastHealthCheck: new Date(), updatedAt: new Date() })
      .where(eq(schema.storageBackends.id, backendId))
      .returning();

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "storage_backend.health_check",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "storage_backend",
      entityId: backendId,
      description: `Admin triggered health check for storage backend "${backend.name}"`,
      metadata: { endpoint: backend.endpoint, bucket: backend.bucket },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      storageBackend: {
        id: updated.id,
        name: updated.name,
        capacityGb: updated.capacityGb,
        usedBytes: updated.usedBytes,
        lastHealthCheck: updated.lastHealthCheck,
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/orbit/storage-backends/[backendId]/health-check error:",
      error
    );
    return Response.json(
      {
        error:
          error instanceof Error
            ? `Health check failed: ${error.message}`
            : "Health check failed",
      },
      { status: 500 }
    );
  }
}
