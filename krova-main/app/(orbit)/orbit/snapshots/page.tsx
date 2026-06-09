import { desc, eq } from "drizzle-orm";
import { SnapshotsTable } from "@/app/(orbit)/orbit/snapshots/_components/snapshots-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrbitSnapshotsPage() {
  const rows = await db
    .select({
      id: schema.cubeSnapshots.id,
      name: schema.cubeSnapshots.name,
      status: schema.cubeSnapshots.status,
      sizeBytes: schema.cubeSnapshots.sizeBytes,
      kind: schema.cubeSnapshots.kind,
      createdAt: schema.cubeSnapshots.createdAt,
      cubeId: schema.cubeSnapshots.cubeId,
      cubeName: schema.cubes.name,
      spaceId: schema.cubeSnapshots.spaceId,
      spaceName: schema.spaces.name,
      backendLabel: schema.storageBackends.name,
    })
    .from(schema.cubeSnapshots)
    .leftJoin(schema.cubes, eq(schema.cubes.id, schema.cubeSnapshots.cubeId))
    .leftJoin(schema.spaces, eq(schema.spaces.id, schema.cubeSnapshots.spaceId))
    .leftJoin(
      schema.storageBackends,
      eq(schema.storageBackends.id, schema.cubeSnapshots.storageBackendId)
    )
    .orderBy(desc(schema.cubeSnapshots.createdAt))
    .limit(200);

  const snapshots = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    sizeBytes: r.sizeBytes ?? null,
    kind: r.kind,
    createdAt: r.createdAt,
    cubeId: r.cubeId,
    cubeName: r.cubeName ?? "—",
    spaceId: r.spaceId,
    spaceName: r.spaceName ?? "—",
    backendLabel: r.backendLabel ?? "—",
  }));

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Snapshots</PageHeaderTitle>
          <PageHeaderDescription>
            All Cube snapshots across the platform. Limited to the 200 most
            recent.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <SnapshotsTable snapshots={snapshots} />
    </div>
  );
}
