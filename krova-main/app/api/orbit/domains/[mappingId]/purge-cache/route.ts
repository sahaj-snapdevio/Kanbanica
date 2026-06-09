import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { adminPurgeDomainCacheAction } from "@/lib/cube-actions/domains";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mappingId: string }> }
) {
  try {
    const { mappingId } = await params;
    const session = await requireAdmin(request);

    const result = await adminPurgeDomainCacheAction({
      mappingId,
      actor: { userId: session.user.id, userEmail: session.user.email },
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
