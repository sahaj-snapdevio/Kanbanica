import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr";
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { BackupList } from "@/components/backup-list";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import type { CubeBackupConfig } from "@/db/schema/backups";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { getCreditRates } from "@/lib/cost";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server/session";
import { getStorageCapabilities } from "@/lib/storage/capabilities";

export default async function BackupsPage({
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

  // When no storage backend is configured, the Backups nav is already
  // hidden in DashboardShell. This guard catches direct/bookmarked URLs
  // and sends the customer to the space dashboard.
  const { canCreateBackup } = await getStorageCapabilities();
  if (!canCreateBackup) {
    redirect(`/${spaceId}`);
  }

  const permissions = membership.isOwner
    ? [...PERMISSION_VALUES]
    : (
        await db
          .select({ permission: schema.memberPermissions.permission })
          .from(schema.memberPermissions)
          .where(eq(schema.memberPermissions.membershipId, membership.id))
      ).map((p) => p.permission);

  // Backups + credit rates — fetched in parallel. Region picker and
  // plan-limit clamps now live on the dedicated redeploy page, so this
  // list view doesn't need either.
  const [backups, rates] = await Promise.all([
    db
      .select()
      .from(schema.cubeBackups)
      .where(eq(schema.cubeBackups.spaceId, spaceId))
      .orderBy(desc(schema.cubeBackups.createdAt)),
    getCreditRates(),
  ]);
  const { diskRate } = rates;

  if (backups.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Backups</PageHeaderTitle>
            <PageHeaderDescription>
              Salvaged disk snapshots of deleted Cubes — redeploy from any
              backup to bring an identical Cube back online.
            </PageHeaderDescription>
          </PageHeaderContent>
        </PageHeader>
        <Empty>
          <EmptyMedia>
            <ArchiveIcon className="size-8 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No backups yet</EmptyTitle>
            <EmptyDescription>
              When you delete a Cube, you can choose to preserve a backup of its
              disk and configuration. Backups appear here and can be used to
              redeploy an identical Cube later.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Backups</PageHeaderTitle>
          <PageHeaderDescription>
            Salvaged disk snapshots of deleted Cubes — redeploy from any backup
            to bring an identical Cube back online.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <BackupList
        backups={backups.map((b) => {
          const config = b.cubeConfig as CubeBackupConfig;
          const storageCostPerHour = b.diskSizeGb * diskRate;
          return {
            id: b.id,
            name: b.name,
            status: b.status,
            originalCubeId: b.originalCubeId,
            originalCubeName: b.originalCubeName,
            sizeBytes: b.sizeBytes,
            diskSizeGb: b.diskSizeGb,
            storageCostPerHour,
            redeployedCubeId: b.redeployedCubeId,
            config: {
              vcpus: config.vcpus,
              ramMb: config.ramMb,
              diskLimitGb: config.diskLimitGb,
              imageId: config.imageId,
              regionId: config.regionId,
              regionName: config.regionName,
              domainMappings: config.domainMappings,
              tcpMappings: config.tcpMappings,
            },
            completedAt: b.completedAt?.toISOString() ?? null,
            createdAt: b.createdAt.toISOString(),
          };
        })}
        canCreate={permissions.includes("cube.create")}
        canManage={permissions.includes("cube.manage")}
        spaceId={spaceId}
      />
    </div>
  );
}
