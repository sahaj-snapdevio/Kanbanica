/**
 * Public-API version of "change the cube's SSH port". Mirrors the
 * dashboard endpoint at
 * `app/api/spaces/[spaceId]/cubes/[cubeId]/ssh-port/route.ts` — same wire
 * format, same validation, same worker handoff
 * (`tcp-mapping.update-cube-port`).
 *
 * The shared business logic lives in `lib/cube-actions/ssh-port.ts`. The
 * two routes differ only in auth (session vs API key), rate limiting, and
 * the actor metadata attached to the audit log + worker job.
 *
 * Wire format:
 *   PUT /api/v1/spaces/{spaceId}/cubes/{cubeId}/ssh-port
 *   Headers: X-API-KEY: kro_…
 *   Body: { "cubePort": <int 1..65535> }
 *   200 OK: { "success": true, "cubePort": <int> }
 *   400 / 404 / 409 on validation / not-found / conflict.
 */

import type { NextRequest } from "next/server";
import { requireCubeAccess, requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { extractRequestContext } from "@/lib/audit";
import { updateSshPortAction } from "@/lib/cube-actions/ssh-port";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";

export async function PUT(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ spaceId: string; cubeId: string }>;
  }
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

    const body = (await request.json()) as { cubePort?: unknown };

    const result = await updateSshPortAction(
      {
        actor: { kind: "apiKey", apiKeyId },
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
    console.error("[v1/ssh-port] PUT request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
