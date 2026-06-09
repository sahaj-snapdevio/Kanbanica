import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { sleepCubeAction } from "@/lib/cube-actions/sleep";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const result = await sleepCubeAction({
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
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ message: "Cube sleep initiated", cubeId });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/spaces/[spaceId]/cubes/[cubeId]/sleep error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
