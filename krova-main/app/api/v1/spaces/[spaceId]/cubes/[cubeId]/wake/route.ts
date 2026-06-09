import { requireCubeAccess, requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { extractRequestContext } from "@/lib/audit";
import { wakeCubeAction } from "@/lib/cube-actions/wake";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";

export async function POST(
  request: Request,
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

    const result = await wakeCubeAction({
      actor: { kind: "apiKey", apiKeyId },
      membership,
      spaceId,
      cubeId,
      reqCtx: extractRequestContext(request.headers),
    });

    if (!result.ok) {
      return Response.json(
        { error: result.error, ...(result.errorMeta ?? {}) },
        { status: result.status }
      );
    }

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/v1/spaces/[spaceId]/cubes/[cubeId]/wake error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
