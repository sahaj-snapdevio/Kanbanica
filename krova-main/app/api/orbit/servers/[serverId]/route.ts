import { and, eq, inArray, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

const VALID_SERVER_STATUSES = [
  "active",
  "inactive",
  "offline",
  "provisioning",
] as const;
type ValidServerStatus = (typeof VALID_SERVER_STATUSES)[number];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    await requireAdmin(request);

    const { serverId } = await params;

    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);

    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    const cubeList = await db
      .select()
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.serverId, serverId),
          ne(schema.cubes.status, "deleted")
        )
      );

    return Response.json({ server, cubes: cubeList });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/servers/[serverId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const session = await requireAdmin(request);

    const { serverId } = await params;
    const body = await request.json();
    // hostname is immutable after creation — it derives all server hostnames
    const {
      status,
      publicIp,
      regionId,
      sshPort,
      totalCpus,
      totalRamMb,
      totalDiskGb,
      maxCpuOvercommit,
      maxRamOvercommit,
      sshKeyId,
    } = body;

    const [existing] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);

    if (!existing) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    if (
      status !== undefined &&
      !VALID_SERVER_STATUSES.includes(status as ValidServerStatus)
    ) {
      return Response.json(
        {
          error: `status must be one of: ${VALID_SERVER_STATUSES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate regionId exists if provided
    if (regionId !== undefined) {
      const [region] = await db
        .select({ id: schema.regions.id })
        .from(schema.regions)
        .where(eq(schema.regions.id, regionId))
        .limit(1);

      if (!region) {
        return Response.json({ error: "Region not found" }, { status: 400 });
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (status !== undefined) {
      updates.status = status as ValidServerStatus;
    }
    if (publicIp !== undefined) {
      updates.publicIp = publicIp;
    }
    if (regionId !== undefined) {
      updates.regionId = regionId;
    }
    if (sshPort !== undefined) {
      updates.sshPort = Number(sshPort);
    }
    if (totalCpus !== undefined) {
      updates.totalCpus = Number(totalCpus);
    }
    if (totalRamMb !== undefined) {
      updates.totalRamMb = Number(totalRamMb);
    }
    if (totalDiskGb !== undefined) {
      updates.totalDiskGb = Number(totalDiskGb);
    }
    if (maxCpuOvercommit !== undefined) {
      updates.maxCpuOvercommit = String(maxCpuOvercommit);
    }
    if (maxRamOvercommit !== undefined) {
      updates.maxRamOvercommit = String(maxRamOvercommit);
    }

    // Update SSH key reference if provided
    if (sshKeyId !== undefined) {
      const [sshKey] = await db
        .select({ id: schema.sshKeys.id })
        .from(schema.sshKeys)
        .where(eq(schema.sshKeys.id, sshKeyId))
        .limit(1);
      if (!sshKey) {
        return Response.json({ error: "SSH key not found" }, { status: 400 });
      }
      updates.sshKeyId = sshKeyId;
    }

    const [updated] = await db
      .update(schema.servers)
      .set(updates)
      .where(eq(schema.servers.id, serverId))
      .returning();

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "server.update",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "server",
      entityId: serverId,
      description: `Admin updated server "${updated.hostname}"`,
      metadata: body,
      source: "api",
      ...reqCtx,
    });

    return Response.json({ server: updated });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("PATCH /api/orbit/servers/[serverId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const session = await requireAdmin(request);

    const { serverId } = await params;

    const [existing] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);

    if (!existing) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    const activeCubes = await db
      .select()
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.serverId, serverId),
          ne(schema.cubes.status, "deleted")
        )
      );

    if (activeCubes.length > 0) {
      return Response.json(
        {
          error:
            "Cannot delete server with active Cubes. Delete or migrate all Cubes first.",
        },
        { status: 409 }
      );
    }

    // Comprehensive cleanup, in transaction:
    //
    // 1. Soft-deleted cubes: their rows STILL exist in `cubes` and FK to
    //    `servers.id` (no cascade) — leaving them would block the server
    //    delete with a FK violation. Hard-delete them.
    //
    // 2. job_logs: keyed by entityType+entityId, no FK. We purge:
    //      a. all rows for entityType='server', entityId=this serverId
    //      b. all rows for entityType='cube', entityId IN (cubes that lived here)
    //    Without this, the deleted server's logs linger forever (until the
    //    daily 30/90-day retention cron eventually catches them).
    //
    // 3. allocated_ports: explicitly deleted (also covered by FK cascade,
    //    belt-and-suspenders).
    //
    // 4. servers row deleted last.
    //
    // audit_logs and lifecycle_logs are intentionally KEPT — they are
    // historical records and outlive the entity itself.
    const historicalCubes = await db
      .select({ id: schema.cubes.id })
      .from(schema.cubes)
      .where(eq(schema.cubes.serverId, serverId));
    const cubeIds = historicalCubes.map((c) => c.id);

    await db.transaction(async (tx) => {
      // Purge job_logs keyed to historical cubes on this server.
      if (cubeIds.length > 0) {
        await tx
          .delete(schema.jobLogs)
          .where(
            and(
              eq(schema.jobLogs.entityType, "cube"),
              inArray(schema.jobLogs.entityId, cubeIds)
            )
          );
      }

      // Hard-delete soft-deleted cube rows so the FK to servers.id doesn't
      // block. We've already verified no cubes are non-deleted.
      if (cubeIds.length > 0) {
        await tx
          .delete(schema.cubes)
          .where(eq(schema.cubes.serverId, serverId));
      }

      // Purge job_logs for the server entity itself.
      await tx
        .delete(schema.jobLogs)
        .where(
          and(
            eq(schema.jobLogs.entityType, "server"),
            eq(schema.jobLogs.entityId, serverId)
          )
        );

      // Allocated ports.
      await tx
        .delete(schema.allocatedPorts)
        .where(eq(schema.allocatedPorts.serverId, serverId));

      // servers row goes last.
      await tx.delete(schema.servers).where(eq(schema.servers.id, serverId));
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "server.delete",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "server",
      entityId: serverId,
      description: `Admin deleted server "${existing.hostname}" (${existing.publicIp})`,
      metadata: {
        hostname: existing.hostname,
        publicIp: existing.publicIp,
        regionId: existing.regionId,
        historicalCubeCount: cubeIds.length,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      success: true,
      cleanup: {
        historicalCubesPurged: cubeIds.length,
        // Box itself (sshd config, platform key in authorized_keys, installed
        // packages) is NOT touched. The operator should wipe / repurpose the
        // box manually if needed. We don't trigger an SSH cleanup because the
        // box may be unreachable at delete time.
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("DELETE /api/orbit/servers/[serverId] error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
