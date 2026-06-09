import type { NextRequest } from "next/server";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import {
  addTcpMappingAction,
  listTcpMappingsAction,
} from "@/lib/cube-actions/tcp-mappings";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.view");
    await requireCubeAccess(membership, cubeId);

    const mappings = await listTcpMappingsAction({ cubeId });
    return Response.json(mappings);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const body = await request.json();
    const { cubePort, label, whitelistedIps } = body;

    const result = await addTcpMappingAction(
      {
        actor: {
          kind: "session",
          userId: session.user.id,
          userEmail: session.user.email,
        },
        membership,
        spaceId,
        cubeId,
        reqCtx: extractRequestContext(request.headers),
      },
      { cubePort, label, whitelistedIps }
    );

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json(result.data.mapping, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST tcp-mappings error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
