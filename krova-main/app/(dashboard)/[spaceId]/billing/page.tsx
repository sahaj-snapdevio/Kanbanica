import { and, count, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SpaceBilling } from "@/components/space-billing";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { getBillingSummary, getSpaceBurnRate } from "@/lib/billing";
import { getCreditRates, getCreditRateTiers } from "@/lib/cost";
import { db } from "@/lib/db";
import { effectiveLimits } from "@/lib/plan/limits";
import {
  getSpaceOverrides,
  getSpacePlanRow,
  isOwnerFirstSpace,
} from "@/lib/plan/usage";
import { getPlatformSettings } from "@/lib/platform-settings";
import { getSession } from "@/lib/server/session";

export default async function BillingPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Check membership
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

  // Get permissions
  const permissions = membership.isOwner
    ? [...PERMISSION_VALUES]
    : (
        await db
          .select({ permission: schema.memberPermissions.permission })
          .from(schema.memberPermissions)
          .where(eq(schema.memberPermissions.membershipId, membership.id))
      ).map((p) => p.permission);

  const canView = membership.isOwner || permissions.includes("billing.view");
  if (!canView) {
    return (
      <Empty className="min-h-100">
        <EmptyHeader>
          <EmptyTitle>Access Denied</EmptyTitle>
          <EmptyDescription>
            You do not have permission to view billing in this space.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const canManageBilling =
    membership.isOwner || permissions.includes("billing.manage");

  // Fetch space
  const [space] = await db
    .select({
      creditBalance: schema.spaces.creditBalance,
      createdAt: schema.spaces.createdAt,
      lowBalanceThreshold: schema.spaces.lowBalanceThreshold,
      subscriptionStatus: schema.spaces.subscriptionStatus,
      providerSubscriptionId: schema.spaces.providerSubscriptionId,
      cancelAtPeriodEnd: schema.spaces.cancelAtPeriodEnd,
      currentPeriodEnd: schema.spaces.currentPeriodEnd,
      overageEnabled: schema.spaces.overageEnabled,
      overageCapUsd: schema.spaces.overageCapUsd,
      thisPeriodOverageUsd: schema.spaces.thisPeriodOverageUsd,
    })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId));

  if (!space) {
    redirect("/");
  }

  // Phase 5 — resolve the plan row + per-space overrides + operator-tunable
  // platform settings (fee math + form bounds). The visible plan catalog
  // moved to `/billing/plans/page.tsx` so it isn't reloaded here.
  const [plan, overrides, platformSettings, freePlanCreditApplies] =
    await Promise.all([
      getSpacePlanRow(spaceId),
      getSpaceOverrides(spaceId),
      getPlatformSettings(),
      // The default-plan one-time included credit is granted to the OWNER's
      // first owned space only. Drives the PlanFeatureList label so a
      // non-first space on the free plan doesn't show `$X one-time` it never
      // received.
      isOwnerFirstSpace(spaceId),
    ]);
  const isFreePlan = Number.parseFloat(plan.priceUsd) <= 0;

  // Use shared billing helpers
  const [rates, tiers] = await Promise.all([
    getCreditRates(),
    getCreditRateTiers(),
  ]);
  const { vcpuRate, ramRate, diskRate } = rates;

  // Billing summary and burn rate are independent — fetch in parallel
  const [summary, usage] = await Promise.all([
    getBillingSummary(spaceId),
    getSpaceBurnRate(spaceId, { vcpuRate, ramRate, diskRate }, tiers),
  ]);

  // Recent billing events (first page) and total event count are independent.
  // The fetch limit MUST match the client's default page size in
  // `space-billing.tsx` (10) — `<DataTable />` runs in server-pagination
  // mode here, which trusts the row count we hand it and does NOT re-slice
  // client-side. If we over-fetch, every initial render shows the surplus
  // rows even though the pagination bar reads "10 per page" (Phase A bug
  // surfaced 2026-05-25).
  const [events, [countResult]] = await Promise.all([
    db
      .select({
        id: schema.billingEvents.id,
        cubeId: schema.billingEvents.cubeId,
        amount: schema.billingEvents.amount,
        type: schema.billingEvents.type,
        description: schema.billingEvents.description,
        createdAt: schema.billingEvents.createdAt,
        cubeName: schema.cubes.name,
      })
      .from(schema.billingEvents)
      .leftJoin(schema.cubes, eq(schema.billingEvents.cubeId, schema.cubes.id))
      .where(eq(schema.billingEvents.spaceId, spaceId))
      .orderBy(desc(schema.billingEvents.createdAt))
      .limit(10),
    db
      .select({ count: count(schema.billingEvents.id) })
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.spaceId, spaceId)),
  ]);

  return (
    <div className="space-y-6">
      <SpaceBilling
        cancelAtPeriodEnd={space.cancelAtPeriodEnd}
        canManageBilling={canManageBilling}
        creditBalance={Number.parseFloat(space.creditBalance)}
        currentPeriodEnd={space.currentPeriodEnd?.toISOString() ?? null}
        currentPlan={{
          id: plan.id,
          name: plan.name,
          priceUsd: plan.priceUsd,
          includedCreditUsd: plan.includedCreditUsd,
          // Effective limits = plan defaults merged with per-space
          // overrides. Drives the 6-row feature breakdown in the hero
          // plan card so customers see what THEY actually get (not just
          // the plan's defaults).
          limits: (() => {
            const lim = effectiveLimits(plan, overrides);
            return {
              maxConcurrentCubes: lim.maxConcurrentCubes,
              maxVcpus: lim.maxVcpus,
              maxRamMb: lim.maxRamMb,
              maxDiskGb: lim.maxDiskGb,
              maxSeats: lim.maxSeats,
              maxBackups: lim.maxBackups,
              maxDomains: lim.maxDomains,
            };
          })(),
        }}
        freePlanCreditApplies={freePlanCreditApplies}
        hasSubscription={!!space.providerSubscriptionId}
        initialEvents={events.map((e) => ({
          id: e.id,
          cubeId: e.cubeId,
          cubeName: e.cubeName ?? null,
          amount: Number.parseFloat(e.amount),
          type: e.type,
          description: e.description,
          createdAt: e.createdAt.toISOString(),
        }))}
        isFreePlan={isFreePlan}
        lowBalanceThreshold={Number.parseFloat(space.lowBalanceThreshold)}
        overageCapUsd={Number.parseFloat(space.overageCapUsd)}
        overageEnabled={space.overageEnabled}
        platformSettings={{
          paymentFeePercent: platformSettings.paymentFeePercent,
          paymentFeeFlatUsd: platformSettings.paymentFeeFlatUsd,
          creditTopupMinUsd: platformSettings.creditTopupMinUsd,
          creditTopupMaxUsd: platformSettings.creditTopupMaxUsd,
          creditTopupDefaultUsd: platformSettings.creditTopupDefaultUsd,
          overageCapMinUsd: platformSettings.overageCapMinUsd,
          overageCapMaxUsd: platformSettings.overageCapMaxUsd,
          lowBalanceThresholdMinUsd: platformSettings.lowBalanceThresholdMinUsd,
        }}
        rates={{ vcpuRate, ramRate, diskRate }}
        spaceId={spaceId}
        subscriptionStatus={space.subscriptionStatus}
        summary={summary}
        thisPeriodOverageUsd={Number.parseFloat(space.thisPeriodOverageUsd)}
        totalEvents={Number(countResult?.count ?? 0)}
        usage={{
          ...usage,
          estimatedDailyBurn: usage.hourlyBurn * 24,
          estimatedMonthlyBurn: usage.hourlyBurn * 730,
        }}
      />
      {/* The standalone PlanCard that used to sit here is now redundant —
          the new SpaceBilling hero renders the full 6-row effective-limits
          breakdown alongside the balance. */}
    </div>
  );
}
