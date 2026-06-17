"use server";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceMember, user } from "@/db/schema";
import { canAccessSpace } from "@/lib/permissions";

export interface MentionMember {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export async function getWorkspaceMentionMembers(
  workspaceId: string,
  spaceId: string,
): Promise<MentionMember[] | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" };

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(workspaceMember.userId, user.id))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, "ACTIVE"),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    name: r.name?.trim() || r.email,
    email: r.email,
    image: r.image ?? null,
  }));
}
