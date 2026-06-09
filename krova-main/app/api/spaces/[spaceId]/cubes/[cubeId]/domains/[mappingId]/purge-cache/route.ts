import type { NextRequest } from "next/server";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { purgeDomainCacheAction } from "@/lib/cube-actions/domains";

export async function POST(
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

    const result = await purgeDomainCacheAction({
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
      const meta = result.errorMeta;
      const init: { status: number; headers?: Record<string, string> } = {
        status: result.status,
      };
      // Match the rate-limiter convention (lib/rate-limit.ts): a 429 carries a
      // Retry-After header so programmatic clients can back off correctly.
      if (
        result.status === 429 &&
        typeof meta?.retryAfterSeconds === "number"
      ) {
        init.headers = { "Retry-After": String(meta.retryAfterSeconds) };
      }
      return Response.json({ error: result.error, ...(meta ?? {}) }, init);
    }

    return Response.json({ enqueued: true, ...result.data }, { status: 202 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
