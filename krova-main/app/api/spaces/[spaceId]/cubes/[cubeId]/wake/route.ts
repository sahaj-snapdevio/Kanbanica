import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { wakeCubeAction } from "@/lib/cube-actions/wake";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
  if (limited) {
    return limited;
  }

  try {
    const { spaceId, cubeId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const result = await wakeCubeAction({
      actor: {
        kind: "session",
        userId: session.user.id,
        userEmail: session.user.email,
      },
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

    return Response.json({ message: "Cube wake initiated", cubeId });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/spaces/[spaceId]/cubes/[cubeId]/wake error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
