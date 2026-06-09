import type { NextRequest } from "next/server";
import { requireCubeAccess, requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { extractRequestContext } from "@/lib/audit";
import { purgeDomainCacheAction } from "@/lib/cube-actions/domains";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ spaceId: string; cubeId: string; mappingId: string }>;
  }
) {
  try {
    const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
    if (limited) {
      return limited;
    }
    const { spaceId, cubeId, mappingId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const result = await purgeDomainCacheAction({
      actor: { kind: "apiKey", apiKeyId },
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
    console.error("[v1/domain-purge-cache] POST request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
