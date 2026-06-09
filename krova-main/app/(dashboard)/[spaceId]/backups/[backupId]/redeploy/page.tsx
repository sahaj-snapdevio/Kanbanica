import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { CubeRedeployForm } from "@/components/cube-redeploy-form";
import * as schema from "@/db/schema";
import type { CubeBackupConfig } from "@/db/schema/backups";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { db } from "@/lib/db";
import { loadEffectiveLimits, toClientLimits } from "@/lib/plan/limits";
import { getSession } from "@/lib/server/session";

export default async function RedeployBackupPage({
  params,
}: {
  params: Promise<{ spaceId: string; backupId: string }>;
}) {
  const { spaceId, backupId } = await params;
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
    redirect(`/${spaceId}/backups`);
  }

  const [backup] = await db
    .select()
    .from(schema.cubeBackups)
    .where(
      and(
        eq(schema.cubeBackups.id, backupId),
        eq(schema.cubeBackups.spaceId, spaceId)
      )
    )
    .limit(1);
  if (!backup) {
    notFound();
  }
  if (backup.status !== "complete") {
    redirect(`/${spaceId}/backups`);
  }

  const config = backup.cubeConfig as CubeBackupConfig;

  const planLimits = toClientLimits(await loadEffectiveLimits(spaceId));

  const availableRegions = await db
    .select({
      id: schema.regions.id,
      name: schema.regions.name,
    })
    .from(schema.regions);

  return (
    <CubeRedeployForm
      backup={{
        id: backup.id,
        name: backup.name,
        config: {
          vcpus: config.vcpus,
          ramMb: config.ramMb,
          diskLimitGb: config.diskLimitGb,
          imageId: config.imageId,
          regionId: config.regionId,
          regionName: config.regionName,
          domainMappings: config.domainMappings ?? [],
          tcpMappings: (config.tcpMappings ?? []).map((t) => ({
            cubePort: t.cubePort,
            label: t.label,
          })),
        },
      }}
      planLimits={planLimits}
      regions={availableRegions}
      spaceId={spaceId}
    />
  );
}
