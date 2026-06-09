import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PlanComparison } from "@/components/billing/plan-comparison";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { db } from "@/lib/db";
import { getSpacePlanRow, isOwnerFirstSpace } from "@/lib/plan/usage";
import { visiblePlansForSpace } from "@/lib/plan/visibility";
import { getPlatformSettings } from "@/lib/platform-settings";
import { getSession } from "@/lib/server/session";

export default async function BillingPlansPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const session = await getSession();
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

  const memberPermissions = membership.isOwner
    ? [...PERMISSION_VALUES]
    : (
        await db
          .select({ permission: schema.memberPermissions.permission })
          .from(schema.memberPermissions)
          .where(eq(schema.memberPermissions.membershipId, membership.id))
      ).map((p) => p.permission);
  const canManageBilling =
    membership.isOwner || memberPermissions.includes("billing.manage");

  // Anyone with billing.view can see the page; only billing.manage can act.
  // We short-circuit non-managers up the page so the comparison UI isn't a
  // pile of disabled buttons — viewing the plan info is fine, mutating
  // isn't.
  if (!canManageBilling) {
    redirect(`/${spaceId}/billing`);
  }

  const [space] = await db
    .select({
      id: schema.spaces.id,
      providerSubscriptionId: schema.spaces.providerSubscriptionId,
      cancelAtPeriodEnd: schema.spaces.cancelAtPeriodEnd,
    })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);
  if (!space) {
    redirect("/");
  }

  const [plan, visiblePlans, platformSettings, freePlanCreditApplies] =
    await Promise.all([
      getSpacePlanRow(spaceId),
      visiblePlansForSpace(spaceId),
      getPlatformSettings(),
      isOwnerFirstSpace(spaceId),
    ]);

  return (
    <PlanComparison
      cancelAtPeriodEnd={space.cancelAtPeriodEnd}
      currentPlanId={plan.id}
      freePlanCreditApplies={freePlanCreditApplies}
      hasSubscription={!!space.providerSubscriptionId}
      platformSettings={{
        paymentFeePercent: platformSettings.paymentFeePercent,
        paymentFeeFlatUsd: platformSettings.paymentFeeFlatUsd,
      }}
      spaceId={spaceId}
      visiblePlans={visiblePlans}
    />
  );
}
