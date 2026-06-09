import { eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { requireSpaceMember } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    await requireSpaceMember(request, spaceId);

    const memberships = await db
      .select({
        membership: schema.spaceMemberships,
        user: {
          id: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          image: schema.user.image,
        },
      })
      .from(schema.spaceMemberships)
      .innerJoin(
        schema.user,
        eq(schema.user.id, schema.spaceMemberships.userId)
      )
      .where(eq(schema.spaceMemberships.spaceId, spaceId));

    if (memberships.length === 0) {
      return Response.json([]);
    }

    const membershipIds = memberships.map((m) => m.membership.id);

    // Batch-fetch all permissions and Cube assignments in two queries instead of N*2
    const [allPermissions, allCubeAssignments] = await Promise.all([
      db
        .select()
        .from(schema.memberPermissions)
        .where(inArray(schema.memberPermissions.membershipId, membershipIds)),
      db
        .select()
        .from(schema.memberCubeAssignments)
        .where(
          inArray(schema.memberCubeAssignments.membershipId, membershipIds)
        ),
    ]);

    const permissionsByMember = new Map<string, string[]>();
    for (const p of allPermissions) {
      const list = permissionsByMember.get(p.membershipId) ?? [];
      list.push(p.permission);
      permissionsByMember.set(p.membershipId, list);
    }

    const assignmentsByMember = new Map<string, string[]>();
    for (const a of allCubeAssignments) {
      const list = assignmentsByMember.get(a.membershipId) ?? [];
      list.push(a.cubeId);
      assignmentsByMember.set(a.membershipId, list);
    }

    const result = memberships.map((m) => ({
      ...m.membership,
      user: m.user,
      permissions: permissionsByMember.get(m.membership.id) ?? [],
      cubeAssignments: assignmentsByMember.get(m.membership.id) ?? [],
    }));

    return Response.json(result);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
