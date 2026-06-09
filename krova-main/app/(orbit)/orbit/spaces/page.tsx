import { count, eq } from "drizzle-orm";
import { SpacesTable } from "@/components/orbit/spaces-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export default async function SpacesPage() {
  const spacesData = await db
    .select({
      id: schema.spaces.id,
      name: schema.spaces.name,
      creditBalance: schema.spaces.creditBalance,
      createdAt: schema.spaces.createdAt,
      subscriptionStatus: schema.spaces.subscriptionStatus,
      planId: schema.plans.id,
      planName: schema.plans.name,
    })
    .from(schema.spaces)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.spaces.planId))
    .orderBy(schema.spaces.createdAt);

  // Get owners for each space
  const owners = await db
    .select({
      spaceId: schema.spaceMemberships.spaceId,
      userId: schema.spaceMemberships.userId,
      email: schema.user.email,
    })
    .from(schema.spaceMemberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.spaceMemberships.userId))
    .where(eq(schema.spaceMemberships.isOwner, true));

  const ownerMap = new Map(owners.map((o) => [o.spaceId, o.email]));

  // Get Cube counts per space
  const cubeCounts = await db
    .select({
      spaceId: schema.cubes.spaceId,
      count: count(),
    })
    .from(schema.cubes)
    .groupBy(schema.cubes.spaceId);

  const cubeCountMap = new Map(cubeCounts.map((v) => [v.spaceId, v.count]));

  const spaces = spacesData.map((s) => ({
    id: s.id,
    name: s.name,
    creditBalance: Number.parseFloat(s.creditBalance),
    createdAt: s.createdAt,
    planId: s.planId,
    planName: s.planName,
    subscriptionStatus: s.subscriptionStatus,
    ownerEmail: ownerMap.get(s.id) ?? "N/A",
    cubeCount: cubeCountMap.get(s.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Spaces</PageHeaderTitle>
          <PageHeaderDescription>
            All spaces on the platform with owner and billing info.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <SpacesTable spaces={spaces} />
    </div>
  );
}
