import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { spaceMemberships, spaces } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function PostAuthPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const memberships = await db
    .select({
      spaceId: spaces.id,
      joinedAt: spaceMemberships.createdAt,
    })
    .from(spaceMemberships)
    .innerJoin(spaces, eq(spaces.id, spaceMemberships.spaceId))
    .where(eq(spaceMemberships.userId, session.user.id));

  const firstMembership = memberships
    .slice()
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
  const targetSpaceId = firstMembership?.spaceId;

  if (targetSpaceId) {
    redirect(`/${targetSpaceId}`);
  }

  redirect("/");
}
