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

interface BackendRow {
  bucket: string;
  capacityGb: number | null;
  createdAt: Date;
  endpoint: string;
  id: string;
  isActive: boolean;
  lastHealthCheck: Date | null;
  name: string;
  region: string;
  updatedAt: Date;
  usedBytes: number;
}

function publicRow(
  row: typeof schema.storageBackends.$inferSelect
): BackendRow {
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

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const rows = await db.select().from(schema.storageBackends);
    return Response.json({ storageBackends: rows.map(publicRow) });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/storage-backends error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin(request);

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

    if (
      !name ||
      !endpoint ||
      !region ||
      !bucket ||
      !accessKeyId ||
      !secretAccessKey
    ) {
      return Response.json(
        {
          error:
            "Missing required fields: name, endpoint, region, bucket, accessKeyId, secretAccessKey",
        },
        { status: 400 }
      );
    }

    const validatedName = validateName(name);
    if (!validatedName) {
      return Response.json({ error: "Invalid name" }, { status: 400 });
    }
    const validatedEndpoint = validateS3Endpoint(endpoint);
    if (!validatedEndpoint) {
      return Response.json({ error: "Invalid endpoint URL" }, { status: 400 });
    }
    const validatedRegion = validateS3Region(region);
    if (!validatedRegion) {
      return Response.json({ error: "Invalid region" }, { status: 400 });
    }
    const validatedBucket = validateS3Bucket(bucket);
    if (!validatedBucket) {
      return Response.json({ error: "Invalid bucket name" }, { status: 400 });
    }

    if (typeof accessKeyId !== "string" || accessKeyId.trim().length === 0) {
      return Response.json(
        { error: "accessKeyId must be a non-empty string" },
        { status: 400 }
      );
    }
    if (
      typeof secretAccessKey !== "string" ||
      secretAccessKey.trim().length === 0
    ) {
      return Response.json(
        { error: "secretAccessKey must be a non-empty string" },
        { status: 400 }
      );
    }

    const validatedCapacity =
      capacityGb === undefined || capacityGb === null
        ? null
        : validateCapacityGb(capacityGb);
    if (validatedCapacity === undefined) {
      return Response.json(
        { error: "Invalid capacity (must be a positive integer or omitted)" },
        { status: 400 }
      );
    }

    const [backend] = await db
      .insert(schema.storageBackends)
      .values({
        name: validatedName,
        endpoint: validatedEndpoint,
        region: validatedRegion,
        bucket: validatedBucket,
        accessKeyIdEnc: encryptValue(accessKeyId.trim()),
        secretAccessKeyEnc: encryptValue(secretAccessKey.trim()),
        capacityGb: validatedCapacity,
        isActive: isActive === undefined ? true : Boolean(isActive),
      })
      .returning();

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "storage_backend.create",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "storage_backend",
      entityId: backend.id,
      description: `Admin created storage backend "${validatedName}"`,
      metadata: {
        name: validatedName,
        endpoint: validatedEndpoint,
        region: validatedRegion,
        bucket: validatedBucket,
        capacityGb: validatedCapacity,
        isActive: backend.isActive,
      },
      source: "api",
      ...reqCtx,
    });

    enqueueJob(JOB_NAMES.STORAGE_HEALTH_CHECK, {}).catch((err) => {
      console.error(
        "[storage-backends] failed to enqueue initial health check:",
        err
      );
    });

    return Response.json(
      { storageBackend: publicRow(backend) },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/storage-backends error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
