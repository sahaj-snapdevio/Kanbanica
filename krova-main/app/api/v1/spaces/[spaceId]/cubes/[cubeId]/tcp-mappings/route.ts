import type { NextRequest } from "next/server";
import { requireCubeAccess, requirePermission } from "@/lib/api/auth-helpers";
import { withIdempotency } from "@/lib/api/idempotency";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { formatTcpMapping } from "@/lib/api/v1-cube-format";
import { extractRequestContext } from "@/lib/audit";
import {
  addTcpMappingAction,
  listTcpMappingsAction,
} from "@/lib/cube-actions/tcp-mappings";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { membership } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.view");
    await requireCubeAccess(membership, cubeId);

    const mappings = await listTcpMappingsAction({ cubeId });
    return Response.json({
      tcpMappings: mappings.map((m) => formatTcpMapping(m, m.whitelistedIps)),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[v1/tcp-mappings] GET request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
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

    const idempotencyKey = request.headers.get("idempotency-key");
    return await withIdempotency(idempotencyKey, spaceId, async () => {
      const body = await request.json();
      const { cubePort, label, whitelistedIps } = body;

      const result = await addTcpMappingAction(
        {
          actor: { kind: "apiKey", apiKeyId },
          membership,
          spaceId,
          cubeId,
          reqCtx: extractRequestContext(request.headers),
        },
        { cubePort, label, whitelistedIps }
      );

      if (!result.ok) {
        return Response.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return Response.json(
        {
          tcpMapping: formatTcpMapping(
            result.data.mapping,
            result.data.mapping.whitelistedIps
          ),
        },
        { status: 201 }
      );
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("[v1/tcp-mappings] POST request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
