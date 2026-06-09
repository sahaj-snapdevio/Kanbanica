/**
 * Admin list of every Cube backup across the platform. Currently
 * missing — backups had no admin surface at all. Limited to 200 most
 * recent rows, filterable by status, searchable on name + cube name +
 * space name.
 */

import { desc, eq } from "drizzle-orm";
import { BackupsTable } from "@/app/(orbit)/orbit/backups/_components/backups-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrbitBackupsPage() {
  const rows = await db
    .select({
      id: schema.cubeBackups.id,
      name: schema.cubeBackups.name,
      status: schema.cubeBackups.status,
      sizeBytes: schema.cubeBackups.sizeBytes,
      diskSizeGb: schema.cubeBackups.diskSizeGb,
      createdAt: schema.cubeBackups.createdAt,
      completedAt: schema.cubeBackups.completedAt,
      originalCubeId: schema.cubeBackups.originalCubeId,
      originalCubeName: schema.cubeBackups.originalCubeName,
      redeployedCubeId: schema.cubeBackups.redeployedCubeId,
      spaceId: schema.cubeBackups.spaceId,
      spaceName: schema.spaces.name,
      backendLabel: schema.storageBackends.name,
    })
    .from(schema.cubeBackups)
    .leftJoin(schema.spaces, eq(schema.spaces.id, schema.cubeBackups.spaceId))
    .leftJoin(
      schema.storageBackends,
      eq(schema.storageBackends.id, schema.cubeBackups.storageBackendId)
    )
    .orderBy(desc(schema.cubeBackups.createdAt))
    .limit(200);

  const backups = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status as "pending" | "creating" | "complete" | "failed",
    sizeBytes: r.sizeBytes ?? null,
    diskSizeGb: r.diskSizeGb,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    originalCubeId: r.originalCubeId,
    originalCubeName: r.originalCubeName,
    redeployedCubeId: r.redeployedCubeId,
    spaceId: r.spaceId,
    spaceName: r.spaceName ?? "—",
    backendLabel: r.backendLabel ?? "—",
  }));

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Backups</PageHeaderTitle>
          <PageHeaderDescription>
            Every Cube backup across the platform. Limited to the 200 most
            recent.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <BackupsTable backups={backups} />
    </div>
  );
}
