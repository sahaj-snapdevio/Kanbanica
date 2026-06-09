/**
 * Change the cube's SSH port.
 *
 * Every cube has exactly one SSH mapping — created automatically when the
 * cube boots, with sshd on port 22 by default. If the customer moves sshd
 * to a different port inside their cube, they call this endpoint with the
 * new port so the platform can update its iptables forward to match.
 *
 * The actual iptables swap (remove the old rule, add the new one with the
 * existing whitelist preserved) is handed off to the
 * `tcp-mapping.update-cube-port` worker job — see
 * `lib/worker/handlers/tcp-mapping-update-cube-port.ts` for the
 * single-tick atomic flow.
 *
 * Wire format:
 *   PUT /api/spaces/{spaceId}/cubes/{cubeId}/ssh-port
 *   Body: { "cubePort": <int 1..65535> }
 *   200 OK: { "success": true, "cubePort": <int> }
 *   400 / 404 / 409 on validation / not-found / conflict.
 */

import type { NextRequest } from "next/server";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { updateSshPortAction } from "@/lib/cube-actions/ssh-port";

export async function PUT(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ spaceId: string; cubeId: string }>;
  }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const body = (await request.json()) as { cubePort?: unknown };

    const result = await updateSshPortAction(
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
      { cubePort: body.cubePort }
    );

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ success: true, cubePort: result.data.cubePort });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
