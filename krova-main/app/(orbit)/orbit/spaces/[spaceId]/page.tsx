import { and, count, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SpaceDetail } from "@/components/orbit/space-detail";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { getSpacePlanRow } from "@/lib/plan/usage";

export default async function SpaceDetailPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;

  const [space] = await db
    .select({
      id: schema.spaces.id,
      name: schema.spaces.name,
      creditBalance: schema.spaces.creditBalance,
      createdAt: schema.spaces.createdAt,
      overrideMaxConcurrentCubes: schema.spaces.overrideMaxConcurrentCubes,
      overrideMaxVcpus: schema.spaces.overrideMaxVcpus,
      overrideMaxRamMb: schema.spaces.overrideMaxRamMb,
      overrideMaxDiskGb: schema.spaces.overrideMaxDiskGb,
      overrideMaxSeats: schema.spaces.overrideMaxSeats,
      overrideMaxBackups: schema.spaces.overrideMaxBackups,
      overrideMaxDomains: schema.spaces.overrideMaxDomains,
      overrideIncludedCreditUsd: schema.spaces.overrideIncludedCreditUsd,
      overrideAllowTopup: schema.spaces.overrideAllowTopup,
      overrideAllowOverage: schema.spaces.overrideAllowOverage,
      overrideOverageCapMaxUsd: schema.spaces.overrideOverageCapMaxUsd,
      subscriptionStatus: schema.spaces.subscriptionStatus,
      currentPeriodEnd: schema.spaces.currentPeriodEnd,
      polarCustomerId: schema.spaces.polarCustomerId,
      providerSubscriptionId: schema.spaces.providerSubscriptionId,
      paymentProvider: schema.spaces.paymentProvider,
      subscriptionEventAt: schema.spaces.subscriptionEventAt,
    })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId));

  if (!space) {
    notFound();
  }

  // Plan row drives the "plan default" hints in the overrides card.
  const plan = await getSpacePlanRow(spaceId);

  const members = await db
    .select({
      id: schema.spaceMemberships.id,
      userId: schema.spaceMemberships.userId,
      email: schema.user.email,
      name: schema.user.name,
      isOwner: schema.spaceMemberships.isOwner,
      joinedAt: schema.spaceMemberships.createdAt,
    })
    .from(schema.spaceMemberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.spaceMemberships.userId))
    .where(eq(schema.spaceMemberships.spaceId, spaceId));

  const spaceCubes = await db
    .select({
      id: schema.cubes.id,
      name: schema.cubes.name,
      status: schema.cubes.status,
      transferState: schema.cubes.transferState,
      vcpus: schema.cubes.vcpus,
      ramMb: schema.cubes.ramMb,
      serverId: schema.cubes.serverId,
      serverHostname: schema.servers.hostname,
      regionName: schema.regions.name,
      createdAt: schema.cubes.createdAt,
    })
    .from(schema.cubes)
    .innerJoin(schema.servers, eq(schema.servers.id, schema.cubes.serverId))
    .leftJoin(schema.regions, eq(schema.regions.id, schema.servers.regionId))
    .where(eq(schema.cubes.spaceId, spaceId));

  // Counts shown in the Force-Delete confirmation so the operator sees the
  // blast radius before clicking. Mirrors what the DELETE handler will tear
  // down: non-deleted cubes (cube.delete jobs), snapshot files, backup files.
  const [activeCubeCountRow] = await db
    .select({ count: count(schema.cubes.id) })
    .from(schema.cubes)
    .where(
      and(eq(schema.cubes.spaceId, spaceId), ne(schema.cubes.status, "deleted"))
    );
  const [snapshotCountRow] = await db
    .select({ count: count(schema.cubeSnapshots.id) })
    .from(schema.cubeSnapshots)
    .where(eq(schema.cubeSnapshots.spaceId, spaceId));
  const [backupCountRow] = await db
    .select({ count: count(schema.cubeBackups.id) })
    .from(schema.cubeBackups)
    .where(eq(schema.cubeBackups.spaceId, spaceId));

  const deletionScope = {
    cubes: Number(activeCubeCountRow?.count ?? 0),
    snapshots: Number(snapshotCountRow?.count ?? 0),
    backups: Number(backupCountRow?.count ?? 0),
  };

  const billingEventsData = await db
    .select({
      id: schema.billingEvents.id,
      amount: schema.billingEvents.amount,
      type: schema.billingEvents.type,
      description: schema.billingEvents.description,
      createdAt: schema.billingEvents.createdAt,
    })
    .from(schema.billingEvents)
    .where(eq(schema.billingEvents.spaceId, spaceId))
    .orderBy(schema.billingEvents.createdAt)
    .limit(50);

  // Last 5 plan-credit grants — surfaced in the new RecentGrantsCard so an
  // operator can see what included credit has been applied for this space
  // without leaving the page.
  const grantsData = await db
    .select({
      id: schema.subscriptionCreditGrants.id,
      planName: schema.plans.name,
      periodStart: schema.subscriptionCreditGrants.periodStart,
      periodEnd: schema.subscriptionCreditGrants.periodEnd,
      amount: schema.subscriptionCreditGrants.amount,
      reason: schema.subscriptionCreditGrants.reason,
      createdAt: schema.subscriptionCreditGrants.createdAt,
    })
    .from(schema.subscriptionCreditGrants)
    .innerJoin(
      schema.plans,
      eq(schema.plans.id, schema.subscriptionCreditGrants.planId)
    )
    .where(eq(schema.subscriptionCreditGrants.spaceId, spaceId))
    .orderBy(desc(schema.subscriptionCreditGrants.createdAt))
    .limit(5);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            className="transition-colors hover:text-foreground"
            href="/orbit/spaces"
          >
            Spaces
          </Link>
          <span>/</span>
          <span>{space.name}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{space.name}</h1>
      </div>
      <SpaceDetail
        billingEvents={billingEventsData.map((e) => ({
          ...e,
          amount: Number.parseFloat(e.amount),
        }))}
        cubes={spaceCubes.map((c) => ({
          ...c,
          regionName: c.regionName ?? "—",
          spaceId: space.id,
          spaceName: space.name,
        }))}
        deletionScope={deletionScope}
        members={members}
        overrides={{
          overrideMaxConcurrentCubes: space.overrideMaxConcurrentCubes,
          overrideMaxVcpus: space.overrideMaxVcpus,
          overrideMaxRamMb: space.overrideMaxRamMb,
          overrideMaxDiskGb: space.overrideMaxDiskGb,
          overrideMaxSeats: space.overrideMaxSeats,
          overrideMaxBackups: space.overrideMaxBackups,
          overrideMaxDomains: space.overrideMaxDomains,
          overrideIncludedCreditUsd:
            space.overrideIncludedCreditUsd === null
              ? null
              : Number.parseFloat(space.overrideIncludedCreditUsd),
          overrideAllowTopup: space.overrideAllowTopup,
          overrideAllowOverage: space.overrideAllowOverage,
          overrideOverageCapMaxUsd:
            space.overrideOverageCapMaxUsd === null
              ? null
              : Number.parseFloat(space.overrideOverageCapMaxUsd),
        }}
        plan={{
          id: plan.id,
          name: plan.name,
          maxConcurrentCubes: plan.maxConcurrentCubes,
          maxVcpus: plan.maxVcpus,
          maxRamMb: plan.maxRamMb,
          maxDiskGb: plan.maxDiskGb,
          maxSeats: plan.maxSeats,
          maxBackups: plan.maxBackups,
          maxDomains: plan.maxDomains,
          includedCreditUsd: Number.parseFloat(plan.includedCreditUsd),
          allowTopup: plan.allowTopup,
          allowOverage: plan.allowOverage,
        }}
        recentGrants={grantsData.map((g) => ({
          id: g.id,
          planName: g.planName,
          periodStart: g.periodStart,
          periodEnd: g.periodEnd,
          amount: Number.parseFloat(g.amount),
          reason: g.reason,
          createdAt: g.createdAt,
        }))}
        space={{
          id: space.id,
          name: space.name,
          creditBalance: Number.parseFloat(space.creditBalance),
          createdAt: space.createdAt,
        }}
        subscription={{
          status: space.subscriptionStatus,
          currentPeriodEnd: space.currentPeriodEnd,
          polarCustomerId: space.polarCustomerId,
          providerSubscriptionId: space.providerSubscriptionId,
          paymentProvider: space.paymentProvider,
          subscriptionEventAt: space.subscriptionEventAt,
        }}
      />
    </div>
  );
}
