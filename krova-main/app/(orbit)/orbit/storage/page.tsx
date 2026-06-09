import { StorageBackendList } from "@/components/orbit/storage-backend-list";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export default async function StoragePage() {
  const rows = await db.select().from(schema.storageBackends);

  const storageBackends = rows.map((row) => ({
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    capacityGb: row.capacityGb,
    usedBytes: row.usedBytes,
    isActive: row.isActive,
    lastHealthCheck: row.lastHealthCheck?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return <StorageBackendList storageBackends={storageBackends} />;
}
