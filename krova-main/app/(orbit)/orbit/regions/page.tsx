import { count, isNotNull } from "drizzle-orm";
import { RegionsManagement } from "@/components/orbit/regions-management";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export default async function RegionsPage() {
  const regionRows = await db.select().from(schema.regions);

  // Count servers per region
  const serverCounts = await db
    .select({
      regionId: schema.servers.regionId,
      count: count(schema.servers.id),
    })
    .from(schema.servers)
    .where(isNotNull(schema.servers.regionId))
    .groupBy(schema.servers.regionId);

  const serverCountMap = new Map(
    serverCounts.map((s) => [s.regionId, Number(s.count)])
  );

  const regions = regionRows.map((r) => ({
    ...r,
    serverCount: serverCountMap.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));

  return <RegionsManagement regions={regions} />;
}
