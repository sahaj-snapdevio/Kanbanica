import type { NextRequest } from "next/server";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { addDomainAction, listDomainsAction } from "@/lib/cube-actions/domains";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.view");
    await requireCubeAccess(membership, cubeId);

    const mappings = await listDomainsAction({ cubeId });
    return Response.json(mappings);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[domains] request failed:", error);
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
    const { domain: rawDomain, port } = body;

    const result = await addDomainAction(
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
      { rawDomain, port }
    );

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json(result.data.mapping, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[domains] request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
