import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * DELETE /api/orbit/ports/[portId]
 *
 * Operator-only escape hatch: free an allocated host-port row. Designed for
 * cleanup of orphaned allocations whose owning cube has already been torn
 * down but whose row leaked (e.g. crash mid-delete). Refuses to delete a
 * port that still references a non-deleted cube — for those the operator
 * should delete or transfer the cube instead.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ portId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { portId } = await params;

    const [port] = await db
      .select({
        id: schema.allocatedPorts.id,
        port: schema.allocatedPorts.port,
        serverId: schema.allocatedPorts.serverId,
        cubeId: schema.allocatedPorts.cubeId,
        purpose: schema.allocatedPorts.purpose,
      })
      .from(schema.allocatedPorts)
      .where(eq(schema.allocatedPorts.id, portId))
      .limit(1);

    if (!port) {
      return Response.json(
        { error: "Port allocation not found" },
        { status: 404 }
      );
    }

    if (port.cubeId) {
      const [owner] = await db
        .select({ status: schema.cubes.status, name: schema.cubes.name })
        .from(schema.cubes)
        .where(eq(schema.cubes.id, port.cubeId))
        .limit(1);
      if (owner && owner.status !== "deleted") {
        return Response.json(
          {
            error: `Port ${port.port} is still owned by cube "${owner.name}" (status: ${owner.status}). Delete or transfer the cube first.`,
          },
          { status: 409 }
        );
      }
    }

    await db
      .delete(schema.allocatedPorts)
      .where(eq(schema.allocatedPorts.id, portId));

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "port.force_free",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "allocated_port",
      entityId: portId,
      description: `Admin force-freed orphaned port ${port.port}`,
      metadata: {
        port: port.port,
        serverId: port.serverId,
        purpose: port.purpose,
        previousCubeId: port.cubeId,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("DELETE /api/orbit/ports/[portId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
