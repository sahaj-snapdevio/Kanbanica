import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CubeTerminalClient } from "@/components/cube-terminal-client";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPusherClientConfig } from "@/lib/pusher";

export const dynamic = "force-dynamic";

export default async function CubeTerminalPage({
  params,
}: {
  params: Promise<{ spaceId: string; cubeId: string }>;
}) {
  const { spaceId, cubeId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  // Membership + cube.manage permission + cube access
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

  const permissions: readonly string[] = membership.isOwner
    ? PERMISSION_VALUES
    : (
        await db
          .select({ permission: schema.memberPermissions.permission })
          .from(schema.memberPermissions)
          .where(eq(schema.memberPermissions.membershipId, membership.id))
      ).map((p) => p.permission);
  if (!permissions.includes("cube.manage")) {
    redirect(`/${spaceId}/cubes/${cubeId}`);
  }

  if (!membership.isOwner) {
    const assignments = await db
      .select({ cubeId: schema.memberCubeAssignments.cubeId })
      .from(schema.memberCubeAssignments)
      .where(eq(schema.memberCubeAssignments.membershipId, membership.id))
      .limit(1);
    if (assignments.length > 0) {
      const [specific] = await db
        .select()
        .from(schema.memberCubeAssignments)
        .where(
          and(
            eq(schema.memberCubeAssignments.membershipId, membership.id),
            eq(schema.memberCubeAssignments.cubeId, cubeId)
          )
        )
        .limit(1);
      if (!specific) {
        redirect(`/${spaceId}/cubes`);
      }
    }
  }

  const [cube] = await db
    .select({
      id: schema.cubes.id,
      name: schema.cubes.name,
      status: schema.cubes.status,
      transferState: schema.cubes.transferState,
    })
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);
  if (!cube) {
    redirect(`/${spaceId}/cubes`);
  }

  const pusherClientConfig = getPusherClientConfig();

  return (
    <CubeTerminalClient
      cubeId={cube.id}
      cubeName={cube.name}
      cubeStatus={cube.status}
      cubeTransferState={cube.transferState}
      pusherClientConfig={pusherClientConfig}
      spaceId={spaceId}
    />
  );
}
