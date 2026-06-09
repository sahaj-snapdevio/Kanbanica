import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

export async function PUT(
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

    const body = await request.json();
    const isSsh = Boolean(body.isSsh);

    // Atomic toggle inside a transaction to prevent concurrent isSsh conflicts
    const mapping = await db.transaction(async (tx) => {
      // Lock all mappings for this cube to prevent concurrent toggles
      const cubeMappings = await tx
        .select()
        .from(schema.tcpPortMappings)
        .where(eq(schema.tcpPortMappings.cubeId, cubeId))
        .for("update");

      const target = cubeMappings.find((m) => m.id === mappingId);
      if (!target) {
        return null;
      }

      if (isSsh) {
        // Clear isSsh on all mappings for this cube
        await tx
          .update(schema.tcpPortMappings)
          .set({ isSsh: false, updatedAt: new Date() })
          .where(eq(schema.tcpPortMappings.cubeId, cubeId));
      }

      // Set isSsh on this mapping
      await tx
        .update(schema.tcpPortMappings)
        .set({ isSsh, updatedAt: new Date() })
        .where(eq(schema.tcpPortMappings.id, mappingId));

      return target;
    });

    if (!mapping) {
      return Response.json({ error: "TCP mapping not found" }, { status: 404 });
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: isSsh ? "tcp_mapping.set_ssh" : "tcp_mapping.unset_ssh",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "tcp_mapping",
      entityId: mappingId,
      spaceId,
      description: isSsh
        ? `Set TCP mapping :${mapping.cubePort} as SSH port`
        : `Removed SSH flag from TCP mapping :${mapping.cubePort}`,
      metadata: { cubeId, mappingId, cubePort: mapping.cubePort, isSsh },
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("PUT tcp-mapping ssh error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
