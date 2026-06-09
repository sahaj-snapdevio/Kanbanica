import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { CubeImportForm } from "@/components/cube-import-form";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { db } from "@/lib/db";
import { loadEffectiveLimits, toClientLimits } from "@/lib/plan/limits";
import { getSession } from "@/lib/server/session";
import { assertBackupStorageAvailable } from "@/lib/storage/capabilities";

export default async function ImportCubePage({
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

  // Import requires a storage backend to be configured — without one,
  // there's nowhere to upload the .cube archive. Same gate as the
  // Backups nav uses.
  const storageError = await assertBackupStorageAvailable();
  if (storageError) {
    redirect(`/${spaceId}/cubes`);
  }

  const planLimits = toClientLimits(await loadEffectiveLimits(spaceId));

  const availableRegions = await db
    .select({
      id: schema.regions.id,
      name: schema.regions.name,
      slug: schema.regions.slug,
    })
    .from(schema.regions);

  return (
    <CubeImportForm
      planLimits={planLimits}
      regions={availableRegions}
      spaceId={spaceId}
    />
  );
}
