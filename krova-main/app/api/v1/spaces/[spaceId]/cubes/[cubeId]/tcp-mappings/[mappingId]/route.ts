import type { NextRequest } from "next/server";
import { requireCubeAccess, requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { extractRequestContext } from "@/lib/audit";
import { removeTcpMappingAction } from "@/lib/cube-actions/tcp-mappings";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ spaceId: string; cubeId: string; mappingId: string }>;
  }
) {
  try {
    const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
    if (limited) {
      return limited;
    }
    const { spaceId, cubeId, mappingId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const result = await removeTcpMappingAction({
      actor: { kind: "apiKey", apiKeyId },
      membership,
      spaceId,
      cubeId,
      mappingId,
      reqCtx: extractRequestContext(request.headers),
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[v1/tcp-mappings] DELETE request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
