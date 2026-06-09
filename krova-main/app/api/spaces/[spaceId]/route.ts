import { and, count, eq, inArray, ne } from "drizzle-orm";
import type { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { requirePermission, requireSpaceMember } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    await requireSpaceMember(request, spaceId);

    const [space] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId));
    if (!space) {
      return Response.json({ error: "Space not found" }, { status: 404 });
    }

    const [memberCount] = await db
      .select({ count: count() })
      .from(schema.spaceMemberships)
      .where(eq(schema.spaceMemberships.spaceId, spaceId));

    const [cubeCount] = await db
      .select({ count: count() })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, spaceId),
          ne(schema.cubes.status, "deleted")
        )
      );

    return Response.json({
      ...space,
      memberCount: memberCount.count,
      cubeCount: cubeCount.count,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "members.manage");

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }

    const [updated] = await db
      .update(schema.spaces)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(eq(schema.spaces.id, spaceId))
      .returning();

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: `Space renamed to "${name.trim()}"`,
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "space.rename",
      category: "space",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Space renamed to "${name.trim()}"`,
      metadata: { newName: name.trim() },
      source: "api",
      ...reqCtx,
    });

    return Response.json(updated);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);

    if (!membership.isOwner) {
      return Response.json(
        { error: "Only the owner can delete a space" },
        { status: 403 }
      );
    }

    await db.transaction(async (tx) => {
      // Enqueue cube.delete for all non-deleted Cubes
      const activeCubes = await tx
        .select()
        .from(schema.cubes)
        .where(
          and(
            eq(schema.cubes.spaceId, spaceId),
            ne(schema.cubes.status, "deleted")
          )
        );

      for (const cube of activeCubes) {
        await enqueueJob(JOB_NAMES.CUBE_DELETE, {
          cubeId: cube.id,
          spaceId,
          serverId: cube.serverId,
        });
      }

      // Find members who have no other spaces — delete their accounts
      const members = await tx
        .select({ userId: schema.spaceMemberships.userId })
        .from(schema.spaceMemberships)
        .where(eq(schema.spaceMemberships.spaceId, spaceId));

      const memberUserIds = members
        .map((m) => m.userId)
        .filter((id) => id !== session.user.id);

      if (memberUserIds.length > 0) {
        const usersWithOtherSpaces = await tx
          .select({ userId: schema.spaceMemberships.userId })
          .from(schema.spaceMemberships)
          .where(
            and(
              inArray(schema.spaceMemberships.userId, memberUserIds),
              ne(schema.spaceMemberships.spaceId, spaceId)
            )
          );

        const usersWithOtherSpaceIds = new Set(
          usersWithOtherSpaces.map((u) => u.userId)
        );
        const membersWithNoOtherSpaces = memberUserIds.filter(
          (id) => !usersWithOtherSpaceIds.has(id)
        );

        if (membersWithNoOtherSpaces.length > 0) {
          await tx
            .delete(schema.user)
            .where(inArray(schema.user.id, membersWithNoOtherSpaces));
        }
      }

      await tx.insert(schema.lifecycleLogs).values({
        entityType: "space",
        entityId: spaceId,
        message: "Space deleted",
      });

      // Delete the space (cascades memberships, Cubes, etc.)
      await tx.delete(schema.spaces).where(eq(schema.spaces.id, spaceId));
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "space.delete",
      category: "space",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: "Space deleted",
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
