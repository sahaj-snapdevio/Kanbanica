import { asc, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { CubeSnapshots } from "@/components/cube-snapshots";
import * as schema from "@/db/schema";
import { loadCubeContext } from "@/lib/cubes/load-cube-context";
import { db } from "@/lib/db";
import { loadEffectiveLimits, toClientLimits } from "@/lib/plan/limits";
import { getStorageCapabilities } from "@/lib/storage/capabilities";

export const dynamic = "force-dynamic";

export default async function CubeSnapshotsTabPage({
  params,
}: {
  params: Promise<{ spaceId: string; cubeId: string }>;
}) {
  const { spaceId, cubeId } = await params;
  const ctx = await loadCubeContext(spaceId, cubeId);

  // Deep-link defense — if a customer bookmarked /snapshots before the
  // storage backend was removed (or before one was ever provisioned),
  // send them back to the cube's main view. The Snapshots tab is also
  // hidden in CubeDetailTabs so this should rarely fire.
  const { canCreateSnapshot } = await getStorageCapabilities();
  if (!canCreateSnapshot) {
    redirect(`/${spaceId}/cubes/${cubeId}`);
  }

  const snapshotsRaw = await db
    .select({
      id: schema.cubeSnapshots.id,
      name: schema.cubeSnapshots.name,
      status: schema.cubeSnapshots.status,
      sizeBytes: schema.cubeSnapshots.sizeBytes,
      kind: schema.cubeSnapshots.kind,
      createdBy: schema.cubeSnapshots.createdBy,
      completedAt: schema.cubeSnapshots.completedAt,
      createdAt: schema.cubeSnapshots.createdAt,
    })
    .from(schema.cubeSnapshots)
    .where(eq(schema.cubeSnapshots.cubeId, cubeId))
    .orderBy(desc(schema.cubeSnapshots.createdAt));

  const creatorIds = [
    ...new Set(
      snapshotsRaw.map((s) => s.createdBy).filter((id): id is string => !!id)
    ),
  ];
  const creators =
    creatorIds.length > 0
      ? await db
          .select({ id: schema.user.id, email: schema.user.email })
          .from(schema.user)
          .where(inArray(schema.user.id, creatorIds))
      : [];
  const creatorByUser = new Map(creators.map((c) => [c.id, c.email]));

  // Region list + effective plan limits power the "Clone to new cube" sheet.
  // Both load in parallel since they're independent.
  const [regions, effectiveLimits] = await Promise.all([
    db
      .select({ id: schema.regions.id, name: schema.regions.name })
      .from(schema.regions)
      .orderBy(asc(schema.regions.name)),
    loadEffectiveLimits(spaceId),
  ]);

  return (
    <CubeSnapshots
      canManage={ctx.permissions.includes("cube.manage")}
      cubeDiskGb={ctx.cube.diskLimitGb}
      cubeId={cubeId}
      cubeRamMb={ctx.cube.ramMb}
      cubeStatus={ctx.cube.status}
      cubeVcpus={ctx.cube.vcpus}
      planLimits={toClientLimits(effectiveLimits)}
      regions={regions}
      snapshots={snapshotsRaw.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        sizeBytes: s.sizeBytes,
        kind: s.kind,
        createdBy: s.createdBy,
        createdByEmail: s.createdBy
          ? (creatorByUser.get(s.createdBy) ?? null)
          : null,
        completedAt: s.completedAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      }))}
      spaceId={spaceId}
    />
  );
}
