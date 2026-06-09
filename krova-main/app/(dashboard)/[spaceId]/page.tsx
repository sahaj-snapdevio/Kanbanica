import { and, count, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SpaceDashboard } from "@/components/space-dashboard";
import { DISK_RATE, RAM_RATE, VCPU_RATE } from "@/config/platform";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { getSpaceBurnRate } from "@/lib/billing";
import { getCreditRateTiers } from "@/lib/cost";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server/session";

export default async function SpacePage({
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

  // Fetch space, cubes, recent billing events, and member count in parallel
  // (all depend only on spaceId — no inter-dependency)
  const [[space], cubes, recentEvents, [memberCount]] = await Promise.all([
    db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1),
    db
      .select({
        id: schema.cubes.id,
        name: schema.cubes.name,
        status: schema.cubes.status,
        vcpus: schema.cubes.vcpus,
        ramMb: schema.cubes.ramMb,
        diskLimitGb: schema.cubes.diskLimitGb,
        createdAt: schema.cubes.createdAt,
      })
      .from(schema.cubes)
      .where(eq(schema.cubes.spaceId, spaceId)),
    db
      .select({
        id: schema.billingEvents.id,
        type: schema.billingEvents.type,
        amount: schema.billingEvents.amount,
        description: schema.billingEvents.description,
        createdAt: schema.billingEvents.createdAt,
      })
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.spaceId, spaceId))
      .orderBy(desc(schema.billingEvents.createdAt))
      .limit(5),
    db
      .select({ count: count(schema.spaceMemberships.id) })
      .from(schema.spaceMemberships)
      .where(eq(schema.spaceMemberships.spaceId, spaceId)),
  ]);

  if (!space) {
    redirect("/");
  }

  // Compute cube stats
  const activeCubes = cubes.filter((c) => c.status !== "deleted");
  const runningCubes = cubes.filter((c) => c.status === "running");
  const sleepingCubes = cubes.filter((c) => c.status === "sleeping");
  const errorCubes = cubes.filter((c) => c.status === "error");

  const totalVcpus = runningCubes.reduce((s, c) => s + c.vcpus, 0);
  const totalRamMb = runningCubes.reduce((s, c) => s + c.ramMb, 0);
  const totalDiskGb = runningCubes.reduce((s, c) => s + c.diskLimitGb, 0);

  // Hourly burn through the shared `getSpaceBurnRate` helper so the dashboard
  // figure includes sleep-storage cost (Rule 14 — never reimplement billing
  // math). A previous inline reduce only summed running-compute, which made
  // a sleep-only space falsely report $0/hr and an infinite runway while the
  // worker was actively debiting sleep storage every tick.
  const tiers = getCreditRateTiers();
  const burnRate = await getSpaceBurnRate(
    spaceId,
    {
      vcpuRate: VCPU_RATE,
      ramRate: RAM_RATE,
      diskRate: DISK_RATE,
    },
    tiers
  );
  const hourlyBurn = burnRate.hourlyBurn;

  const creditBalance = Number.parseFloat(space.creditBalance);

  // Check permissions
  const permissions = membership.isOwner
    ? [...PERMISSION_VALUES]
    : (
        await db
          .select({ permission: schema.memberPermissions.permission })
          .from(schema.memberPermissions)
          .where(eq(schema.memberPermissions.membershipId, membership.id))
      ).map((p) => p.permission);

  const canCreate =
    (membership.isOwner || permissions.includes("cube.create")) &&
    creditBalance > 0;

  return (
    <SpaceDashboard
      canCreate={canCreate}
      creditBalance={creditBalance}
      cubeStats={{
        total: activeCubes.length,
        running: runningCubes.length,
        sleeping: sleepingCubes.length,
        error: errorCubes.length,
      }}
      hourlyBurn={hourlyBurn}
      memberCount={memberCount?.count ?? 0}
      recentEvents={recentEvents.map((e) => ({
        ...e,
        amount: Number.parseFloat(e.amount),
        createdAt: e.createdAt.toISOString(),
      }))}
      resources={{
        vcpus: totalVcpus,
        ramMb: totalRamMb,
        diskGb: totalDiskGb,
      }}
      spaceId={spaceId}
      spaceName={space.name}
    />
  );
}
