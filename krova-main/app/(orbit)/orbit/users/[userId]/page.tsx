import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserDetail } from "@/components/orbit/user-detail";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  const [userData] = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      role: schema.user.role,
      image: schema.user.image,
      banned: schema.user.banned,
      banReason: schema.user.banReason,
      banExpires: schema.user.banExpires,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId));

  if (!userData) {
    notFound();
  }

  const memberships = await db
    .select({
      id: schema.spaceMemberships.id,
      spaceId: schema.spaceMemberships.spaceId,
      spaceName: schema.spaces.name,
      isOwner: schema.spaceMemberships.isOwner,
      joinedAt: schema.spaceMemberships.createdAt,
    })
    .from(schema.spaceMemberships)
    .innerJoin(
      schema.spaces,
      eq(schema.spaces.id, schema.spaceMemberships.spaceId)
    )
    .where(eq(schema.spaceMemberships.userId, userId));

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            className="transition-colors hover:text-foreground"
            href="/orbit/users"
          >
            Users
          </Link>
          <span>/</span>
          <span>{userData.email}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {userData.name}
        </h1>
      </div>
      <UserDetail
        memberships={memberships}
        user={{
          ...userData,
          banned: userData.banned ?? false,
        }}
      />
    </div>
  );
}
