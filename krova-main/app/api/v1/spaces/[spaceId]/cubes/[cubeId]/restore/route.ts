import type { NextRequest } from "next/server";
import { requireCubeAccess, requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { extractRequestContext } from "@/lib/audit";
import { restoreSnapshotV1Action } from "@/lib/cube-actions/snapshots";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";

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

    const body = await request.json().catch(() => ({}));

    const result = await restoreSnapshotV1Action(
      {
        actor: { kind: "apiKey", apiKeyId },
        membership,
        spaceId,
        cubeId,
        reqCtx: extractRequestContext(request.headers),
      },
      { snapshotId: (body as Record<string, unknown>)?.snapshotId }
    );

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[v1/restore] POST request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
