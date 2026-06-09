import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Shared cube-detail loader for the route-based tab structure.
 *
 * The layout and each per-tab page call this helper to fetch the cube
 * row, server, region, and permissions. `React.cache()` memoizes the
 * result for the duration of the request, so the layout + all tabs
 * render with a single round trip per dependency.
 *
 * Auth + auth gates run inside the loader so a customer who doesn't have
 * cube.view (and isn't assigned to the cube) gets a redirect uniformly
 * regardless of which tab page they hit.
 */
export const loadCubeContext = cache(
  async (
    spaceId: string,
    cubeId: string
  ): Promise<{
    cube: typeof schema.cubes.$inferSelect;
    server: typeof schema.servers.$inferSelect | null;
    region: { name: string } | null;
    permissions: string[];
    spaceId: string;
    membershipId: string;
    isOwner: boolean;
  }> => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      redirect("/login");
    }

    const [membership] = await db
      .select()
      .from(schema.spaceMemberships)
      .where(
        and(
          eq(schema.spaceMemberships.userId, session.user.id),
          eq(schema.spaceMemberships.spaceId, spaceId)
        )
      )
      .limit(1);
    if (!membership) {
      redirect("/");
    }

    const permissions = membership.isOwner
      ? [...PERMISSION_VALUES]
      : (
          await db
            .select({ permission: schema.memberPermissions.permission })
            .from(schema.memberPermissions)
            .where(eq(schema.memberPermissions.membershipId, membership.id))
        ).map((p) => p.permission);

    if (!membership.isOwner) {
      const [assignment] = await db
        .select()
        .from(schema.memberCubeAssignments)
        .where(
          and(
            eq(schema.memberCubeAssignments.membershipId, membership.id),
            eq(schema.memberCubeAssignments.cubeId, cubeId)
          )
        )
        .limit(1);
      if (!assignment && !permissions.includes("cube.view")) {
        redirect(`/${spaceId}/cubes`);
      }
    }

    const [cube] = await db
      .select()
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);
    if (!cube) {
      redirect(`/${spaceId}/cubes`);
    }

    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, cube.serverId))
      .limit(1);

    let region: { name: string } | null = null;
    if (server?.regionId) {
      const [r] = await db
        .select({ name: schema.regions.name })
        .from(schema.regions)
        .where(eq(schema.regions.id, server.regionId))
        .limit(1);
      if (r) {
        region = r;
      }
    }

    return {
      cube,
      server: server ?? null,
      region,
      permissions,
      spaceId,
      membershipId: membership.id,
      isOwner: membership.isOwner,
    };
  }
);
