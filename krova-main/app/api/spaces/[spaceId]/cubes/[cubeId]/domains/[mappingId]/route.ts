import type { NextRequest } from "next/server";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { removeDomainAction } from "@/lib/cube-actions/domains";

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ spaceId: string; cubeId: string; mappingId: string }>;
  }
) {
  try {
    const { spaceId, cubeId, mappingId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const result = await removeDomainAction({
      actor: {
        kind: "session",
        userId: session.user.id,
        userEmail: session.user.email,
      },
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
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
