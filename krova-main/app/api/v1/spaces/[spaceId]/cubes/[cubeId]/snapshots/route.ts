import type { NextRequest } from "next/server";
import { requireCubeAccess, requirePermission } from "@/lib/api/auth-helpers";
import { withIdempotency } from "@/lib/api/idempotency";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { extractRequestContext } from "@/lib/audit";
import {
  createSnapshotV1Action,
  listSnapshotsAction,
} from "@/lib/cube-actions/snapshots";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { assertBackupStorageAvailable } from "@/lib/storage/capabilities";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { membership } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.view");
    await requireCubeAccess(membership, cubeId);

    const snapshots = await listSnapshotsAction({ spaceId, cubeId });
    return Response.json({ snapshots });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[v1/snapshots] GET request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
    if (limited) {
      return limited;
    }
    const { spaceId, cubeId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const storageError = await assertBackupStorageAvailable();
    if (storageError) {
      return Response.json({ error: storageError.error }, { status: 503 });
    }

    const idempotencyKey = request.headers.get("idempotency-key");
    return await withIdempotency(idempotencyKey, spaceId, async () => {
      const body = await request.json().catch(() => ({}));

      const result = await createSnapshotV1Action(
        {
          actor: { kind: "apiKey", apiKeyId },
          membership,
          spaceId,
          cubeId,
          reqCtx: extractRequestContext(request.headers),
        },
        { rawName: (body as Record<string, unknown>)?.name }
      );

      if (!result.ok) {
        return Response.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return Response.json({ snapshot: result.data.snapshot }, { status: 201 });
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[v1/snapshots] POST request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
