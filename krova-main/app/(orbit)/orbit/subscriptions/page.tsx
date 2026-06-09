import { eq, isNotNull, sql } from "drizzle-orm";
import { SubscriptionsTable } from "@/app/(orbit)/orbit/subscriptions/_components/subscriptions-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrbitSubscriptionsPage() {
  const rows = await db
    .select({
      spaceId: schema.spaces.id,
      spaceName: schema.spaces.name,
      subscriptionStatus: schema.spaces.subscriptionStatus,
      currentPeriodEnd: schema.spaces.currentPeriodEnd,
      polarCustomerId: schema.spaces.polarCustomerId,
      providerSubscriptionId: schema.spaces.providerSubscriptionId,
      paymentProvider: schema.spaces.paymentProvider,
      subscriptionEventAt: schema.spaces.subscriptionEventAt,
      planId: schema.plans.id,
      planName: schema.plans.name,
      planPriceUsd: schema.plans.priceUsd,
    })
    .from(schema.spaces)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.spaces.planId))
    .where(isNotNull(schema.spaces.providerSubscriptionId))
    .orderBy(sql`${schema.spaces.currentPeriodEnd} ASC NULLS LAST`);

  // Owner email per space (one query, mapped in memory).
  const owners = await db
    .select({
      spaceId: schema.spaceMemberships.spaceId,
      email: schema.user.email,
    })
    .from(schema.spaceMemberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.spaceMemberships.userId))
    .where(eq(schema.spaceMemberships.isOwner, true));
  const ownerMap = new Map(owners.map((o) => [o.spaceId, o.email]));

  const subscriptions = rows.map((r) => ({
    spaceId: r.spaceId,
    spaceName: r.spaceName,
    ownerEmail: ownerMap.get(r.spaceId) ?? "—",
    planId: r.planId,
    planName: r.planName,
    mrrUsd: Number.parseFloat(r.planPriceUsd),
    status: r.subscriptionStatus ?? "unknown",
    currentPeriodEnd: r.currentPeriodEnd,
    polarCustomerId: r.polarCustomerId,
    providerSubscriptionId: r.providerSubscriptionId,
    paymentProvider: r.paymentProvider,
    subscriptionEventAt: r.subscriptionEventAt,
  }));

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Subscriptions</PageHeaderTitle>
          <PageHeaderDescription>
            Every space with an active or terminated provider subscription.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <SubscriptionsTable subscriptions={subscriptions} />
    </div>
  );
}
