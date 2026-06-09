import type { NextRequest } from "next/server";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { removeTcpMappingAction } from "@/lib/cube-actions/tcp-mappings";

// SSH-port editing used to live here as a PATCH handler. It has been moved
// to its own resource because the SSH mapping is a platform-managed
// singleton with different invariants than the customer-created TCP
// mappings handled by this route. See:
//   PUT  /api/spaces/[spaceId]/cubes/[cubeId]/ssh-port
//   app/api/spaces/[spaceId]/cubes/[cubeId]/ssh-port/route.ts
//   CLAUDE.md Rule 47
//
// Operations still served by this file + sibling routes for regular
// (non-SSH) TCP mappings:
//   POST   /tcp-mappings                            — create
//   DELETE /tcp-mappings/[mappingId]                — remove (below)
//   PUT    /tcp-mappings/[mappingId]/whitelist      — edit whitelist
//   POST   /tcp-mappings/[mappingId]/exposure       — toggle on/off
//   POST   /tcp-mappings/[mappingId]/ssh            — toggle isSsh flag

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

    const result = await removeTcpMappingAction({
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
