import { and, desc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { deleteCubeAction, getCubeDetailAction } from "@/lib/cube-actions/cube";
import { db } from "@/lib/db";
import { serverConnectDomain } from "@/lib/server/server-hostnames";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.view");
    await requireCubeAccess(membership, cubeId);

    const result = await getCubeDetailAction({ spaceId, cubeId });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    const { cube, server, costPerHour } = result.data;

    // Dashboard-only extras: full lifecycle logs + domain mappings rendered
    // in the cube detail page sidebar. The v1 API surface omits these.
    const logs = await db
      .select()
      .from(schema.lifecycleLogs)
      .where(
        and(
          eq(schema.lifecycleLogs.entityType, "cube"),
          eq(schema.lifecycleLogs.entityId, cubeId)
        )
      )
      .orderBy(desc(schema.lifecycleLogs.createdAt));

    const domains = await db
      .select()
      .from(schema.domainMappings)
      .where(eq(schema.domainMappings.cubeId, cubeId))
      .orderBy(desc(schema.domainMappings.createdAt));

    return Response.json({
      cube: {
        ...cube,
        costPerHour,
        serverDomain: server ? serverConnectDomain(server.hostname) : null,
      },
      lifecycleLogs: logs,
      domainMappings: domains,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/spaces/[spaceId]/cubes/[cubeId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const result = await deleteCubeAction(
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
      { rejectDuringBoot: true }
    );

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ message: "Cube deletion initiated", cubeId });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("DELETE /api/spaces/[spaceId]/cubes/[cubeId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
