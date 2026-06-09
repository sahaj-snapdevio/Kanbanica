import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { encryptValue } from "@/lib/encrypt";
import {
  validateCapacityGb,
  validateS3Bucket,
  validateS3Endpoint,
  validateS3Region,
} from "@/lib/storage/validators";
import { validateName } from "@/lib/validators";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

function publicRow(row: typeof schema.storageBackends.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    capacityGb: row.capacityGb,
    usedBytes: row.usedBytes,
    isActive: row.isActive,
    lastHealthCheck: row.lastHealthCheck,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ backendId: string }> }
) {
  try {
    await requireAdmin(request);
    const { backendId } = await params;

    const [row] = await db
      .select()
      .from(schema.storageBackends)
      .where(eq(schema.storageBackends.id, backendId))
      .limit(1);

    if (!row) {
      return Response.json(
        { error: "Storage backend not found" },
        { status: 404 }
      );
    }
    return Response.json({ storageBackend: publicRow(row) });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/storage-backends/[backendId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ backendId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { backendId } = await params;

    const body = await request.json();
    const {
      name,
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      capacityGb,
      isActive,
    } = body;

    const [existing] = await db
      .select()
      .from(schema.storageBackends)
      .where(eq(schema.storageBackends.id, backendId))
      .limit(1);

    if (!existing) {
      return Response.json(
        { error: "Storage backend not found" },
        { status: 404 }
      );
    }

    if (
      name === undefined &&
      endpoint === undefined &&
      region === undefined &&
      bucket === undefined &&
      accessKeyId === undefined &&
      secretAccessKey === undefined &&
      capacityGb === undefined &&
      isActive === undefined
    ) {
      return Response.json(
        { error: "At least one field is required" },
        { status: 400 }
      );
    }

    const updates: Partial<typeof schema.storageBackends.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (name !== undefined) {
      const v = validateName(name);
      if (!v) {
        return Response.json({ error: "Invalid name" }, { status: 400 });
      }
      updates.name = v;
    }
    if (endpoint !== undefined) {
      const v = validateS3Endpoint(endpoint);
      if (!v) {
        return Response.json(
          { error: "Invalid endpoint URL" },
          { status: 400 }
        );
      }
      updates.endpoint = v;
    }
    if (region !== undefined) {
      const v = validateS3Region(region);
      if (!v) {
        return Response.json({ error: "Invalid region" }, { status: 400 });
      }
      updates.region = v;
    }
    if (bucket !== undefined) {
      const v = validateS3Bucket(bucket);
      if (!v) {
        return Response.json({ error: "Invalid bucket name" }, { status: 400 });
      }
      updates.bucket = v;
    }
    if (accessKeyId !== undefined) {
      if (typeof accessKeyId !== "string" || accessKeyId.trim().length === 0) {
        return Response.json({ error: "Invalid accessKeyId" }, { status: 400 });
      }
      updates.accessKeyIdEnc = encryptValue(accessKeyId.trim());
    }
    if (secretAccessKey !== undefined) {
      if (
        typeof secretAccessKey !== "string" ||
        secretAccessKey.trim().length === 0
      ) {
        return Response.json(
          { error: "Invalid secretAccessKey" },
          { status: 400 }
        );
      }
      updates.secretAccessKeyEnc = encryptValue(secretAccessKey.trim());
    }
    if (capacityGb !== undefined) {
      const v = validateCapacityGb(capacityGb);
      if (v === undefined) {
        return Response.json({ error: "Invalid capacity" }, { status: 400 });
      }
      updates.capacityGb = v;
    }
    if (isActive !== undefined) {
      updates.isActive = Boolean(isActive);
    }

    const [updated] = await db
      .update(schema.storageBackends)
      .set(updates)
      .where(eq(schema.storageBackends.id, backendId))
      .returning();

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "storage_backend.update",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "storage_backend",
      entityId: backendId,
      description: `Admin updated storage backend "${updated.name}"`,
      // Don't leak credentials into audit metadata — only safe identifying fields.
      metadata: {
        name: updated.name,
        endpoint: updated.endpoint,
        region: updated.region,
        bucket: updated.bucket,
        capacityGb: updated.capacityGb,
        isActive: updated.isActive,
        rotatedAccessKeyId: accessKeyId !== undefined,
        rotatedSecretAccessKey: secretAccessKey !== undefined,
      },
      source: "api",
      ...reqCtx,
    });

    if (
      endpoint !== undefined ||
      region !== undefined ||
      bucket !== undefined ||
      accessKeyId !== undefined ||
      secretAccessKey !== undefined
    ) {
      enqueueJob(JOB_NAMES.STORAGE_HEALTH_CHECK, {}).catch((err) => {
        console.error(
          "[storage-backends] failed to enqueue health check after update:",
          err
        );
      });
    }

    return Response.json({ storageBackend: publicRow(updated) });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "PATCH /api/orbit/storage-backends/[backendId] error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ backendId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { backendId } = await params;

    const [existing] = await db
      .select()
      .from(schema.storageBackends)
      .where(eq(schema.storageBackends.id, backendId))
      .limit(1);

    if (!existing) {
      return Response.json(
        { error: "Storage backend not found" },
        { status: 404 }
      );
    }

    const [snapshotRef] = await db
      .select({ id: schema.cubeSnapshots.id })
      .from(schema.cubeSnapshots)
      .where(eq(schema.cubeSnapshots.storageBackendId, backendId))
      .limit(1);

    if (snapshotRef) {
      return Response.json(
        {
          error:
            "Cannot delete backend with existing snapshots. Delete or move all snapshots first.",
        },
        { status: 409 }
      );
    }

    const [backupRef] = await db
      .select({ id: schema.cubeBackups.id })
      .from(schema.cubeBackups)
      .where(eq(schema.cubeBackups.storageBackendId, backendId))
      .limit(1);

    if (backupRef) {
      return Response.json(
        {
          error:
            "Cannot delete backend with existing backups. Delete or move all backups first.",
        },
        { status: 409 }
      );
    }

    await db
      .delete(schema.storageBackends)
      .where(eq(schema.storageBackends.id, backendId));

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "storage_backend.delete",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "storage_backend",
      entityId: backendId,
      description: `Admin deleted storage backend "${existing.name}"`,
      metadata: {
        name: existing.name,
        endpoint: existing.endpoint,
        bucket: existing.bucket,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "DELETE /api/orbit/storage-backends/[backendId] error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
