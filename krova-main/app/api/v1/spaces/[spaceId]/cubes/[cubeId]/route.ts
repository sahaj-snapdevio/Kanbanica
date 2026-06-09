import { requireCubeAccess, requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { formatCube } from "@/lib/api/v1-cube-format";
import { audit, extractRequestContext } from "@/lib/audit";
import { deleteCubeAction, getCubeDetailAction } from "@/lib/cube-actions/cube";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { serverConnectDomain } from "@/lib/server/server-hostnames";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.view");
    await requireCubeAccess(membership, cubeId);

    const result = await getCubeDetailAction({ spaceId, cubeId });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    const { cube, server, costPerHour } = result.data;

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.view",
      category: "cube",
      actorType: "user",
      actorId: apiKeyId,
      actorEmail: null,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Viewed cube "${cube.name}" detail via API key`,
      metadata: { cubeName: cube.name, apiKeyId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      cube: formatCube(cube, {
        publicIp: server?.publicIp ?? null,
        costPerHour: Number.parseFloat(costPerHour.toFixed(4)),
        serverDomain: server ? serverConnectDomain(server.hostname) : null,
      }),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/v1/spaces/[spaceId]/cubes/[cubeId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
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

    const result = await deleteCubeAction(
      {
        actor: { kind: "apiKey", apiKeyId },
        membership,
        spaceId,
        cubeId,
        reqCtx: extractRequestContext(request.headers),
      },
      { rejectDuringBoot: false }
    );

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "DELETE /api/v1/spaces/[spaceId]/cubes/[cubeId] error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
