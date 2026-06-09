import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { CreateCubeForm } from "@/components/create-cube-form";
import {
  CPU_OPTIONS,
  DISK_OPTIONS,
  DISK_RATE,
  IMAGE_OPTIONS,
  RAM_OPTIONS,
  RAM_RATE,
  VCPU_RATE,
} from "@/config/platform";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { getCreditRateTiers } from "@/lib/cost";
import { db } from "@/lib/db";
import { loadEffectiveLimits, toClientLimits } from "@/lib/plan/limits";
import { getSession } from "@/lib/server/session";

export default async function NewCubePage({
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

  // Check cube.create permission
  const permissions = membership.isOwner
    ? [...PERMISSION_VALUES]
    : (
        await db
          .select({ permission: schema.memberPermissions.permission })
          .from(schema.memberPermissions)
          .where(eq(schema.memberPermissions.membershipId, membership.id))
      ).map((p) => p.permission);

  const canCreate = membership.isOwner || permissions.includes("cube.create");
  if (!canCreate) {
    redirect(`/${spaceId}/cubes`);
  }

  // Credit rates from static config
  const vcpuRate = VCPU_RATE;
  const ramRate = RAM_RATE;
  const diskRate = DISK_RATE;

  // Cube plan options from static config
  const cubeOptions = {
    cpuOptions: CPU_OPTIONS,
    ramOptions: RAM_OPTIONS,
    imageOptions: IMAGE_OPTIONS,
    diskOptions: DISK_OPTIONS,
  };

  // The space's plan + override-merged ceilings — drives the slider caps in
  // CreateCubeForm so the picker can't even propose a value the server would
  // reject in `assertCanCreateCubeV2`.
  const planLimits = toClientLimits(await loadEffectiveLimits(spaceId));

  // Fetch all regions
  const availableRegions = await db
    .select({
      id: schema.regions.id,
      name: schema.regions.name,
      slug: schema.regions.slug,
    })
    .from(schema.regions);

  const tiers = getCreditRateTiers();

  return (
    <div>
      <CreateCubeForm
        creditRateConfig={{ vcpuRate, ramRate, diskRate }}
        cubeOptions={cubeOptions}
        planLimits={planLimits}
        regions={availableRegions}
        spaceId={spaceId}
        tiers={tiers}
      />
    </div>
  );
}
