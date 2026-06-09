import { eq } from "drizzle-orm";
import { CubesTable } from "@/components/orbit/cubes-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export default async function CubesPage() {
  const cubesData = await db
    .select({
      id: schema.cubes.id,
      name: schema.cubes.name,
      status: schema.cubes.status,
      transferState: schema.cubes.transferState,
      vcpus: schema.cubes.vcpus,
      ramMb: schema.cubes.ramMb,
      diskLimitGb: schema.cubes.diskLimitGb,
      spaceId: schema.cubes.spaceId,
      spaceName: schema.spaces.name,
      serverId: schema.cubes.serverId,
      serverHostname: schema.servers.hostname,
      regionName: schema.regions.name,
      createdAt: schema.cubes.createdAt,
    })
    .from(schema.cubes)
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.cubes.spaceId))
    .innerJoin(schema.servers, eq(schema.servers.id, schema.cubes.serverId))
    .leftJoin(schema.regions, eq(schema.regions.id, schema.servers.regionId));

  const serversData = await db
    .select({
      id: schema.servers.id,
      hostname: schema.servers.hostname,
    })
    .from(schema.servers);

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Cubes</PageHeaderTitle>
          <PageHeaderDescription>
            All Cubes across every space on the platform.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <CubesTable
        cubes={cubesData.map((c) => ({
          ...c,
          regionName: c.regionName ?? "—",
        }))}
        servers={serversData}
      />
    </div>
  );
}
