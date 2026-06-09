import { count } from "drizzle-orm";
import { UsersTable } from "@/components/orbit/users-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export default async function UsersPage() {
  const usersData = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      role: schema.user.role,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(schema.user.createdAt);

  const spaceCounts = await db
    .select({
      userId: schema.spaceMemberships.userId,
      count: count(),
    })
    .from(schema.spaceMemberships)
    .groupBy(schema.spaceMemberships.userId);

  const spaceCountMap = new Map(spaceCounts.map((s) => [s.userId, s.count]));

  const users = usersData.map((u) => ({
    ...u,
    spaceCount: spaceCountMap.get(u.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Users</PageHeaderTitle>
          <PageHeaderDescription>
            All registered users on the platform.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <UsersTable users={users} />
    </div>
  );
}
