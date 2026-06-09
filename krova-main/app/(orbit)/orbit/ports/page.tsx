import { count, eq, inArray } from "drizzle-orm";
import { PortsTable } from "@/components/orbit/ports-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { PORT_RANGE } from "@/lib/server/ports";

export default async function PortsPage() {
  // Fetch all allocated ports with server info
  const allocatedPortRows = await db
    .select({
      id: schema.allocatedPorts.id,
      port: schema.allocatedPorts.port,
      purpose: schema.allocatedPorts.purpose,
      serverId: schema.allocatedPorts.serverId,
      serverHostname: schema.servers.hostname,
      cubeId: schema.allocatedPorts.cubeId,
    })
    .from(schema.allocatedPorts)
    .innerJoin(
      schema.servers,
      eq(schema.servers.id, schema.allocatedPorts.serverId)
    );

  // Fetch cube names for allocated ports
  const cubeIds = [
    ...new Set(allocatedPortRows.map((p) => p.cubeId).filter(Boolean)),
  ] as string[];

  const cubesData =
    cubeIds.length > 0
      ? await db
          .select({
            id: schema.cubes.id,
            name: schema.cubes.name,
            status: schema.cubes.status,
            spaceId: schema.cubes.spaceId,
            spaceName: schema.spaces.name,
          })
          .from(schema.cubes)
          .innerJoin(schema.spaces, eq(schema.spaces.id, schema.cubes.spaceId))
          .where(inArray(schema.cubes.id, cubeIds))
      : [];

  const cubeMap = new Map(cubesData.map((k) => [k.id, k]));

  // Fetch TCP port mappings (non-deleted)
  const tcpMappings = await db
    .select({
      id: schema.tcpPortMappings.id,
      cubeId: schema.tcpPortMappings.cubeId,
      cubePort: schema.tcpPortMappings.cubePort,
      hostPort: schema.tcpPortMappings.hostPort,
      label: schema.tcpPortMappings.label,
      status: schema.tcpPortMappings.status,
      allocatedPortId: schema.tcpPortMappings.allocatedPortId,
    })
    .from(schema.tcpPortMappings);

  const tcpMappingByAllocatedPort = new Map(
    tcpMappings.map((m) => [m.allocatedPortId, m])
  );

  // Port pool summary per server
  const allServers = await db
    .select({ id: schema.servers.id, hostname: schema.servers.hostname })
    .from(schema.servers);

  const allocatedCounts = await db
    .select({
      serverId: schema.allocatedPorts.serverId,
      count: count(schema.allocatedPorts.id),
    })
    .from(schema.allocatedPorts)
    .groupBy(schema.allocatedPorts.serverId);

  const allocatedMap = new Map(
    allocatedCounts.map((r) => [r.serverId, r.count])
  );

  const serverSummaries = allServers.map((s) => {
    const allocated = allocatedMap.get(s.id) ?? 0;
    return {
      serverId: s.id,
      serverHostname: s.hostname,
      total: PORT_RANGE.total,
      available: PORT_RANGE.total - allocated,
      allocated,
      reserved: 0,
    };
  });

  // Build port rows
  const portRows = allocatedPortRows.map((p) => {
    const cube = p.cubeId ? cubeMap.get(p.cubeId) : null;
    const tcpMapping = tcpMappingByAllocatedPort.get(p.id);

    let purpose: string;
    if (tcpMapping) {
      purpose = tcpMapping.label
        ? `TCP: ${tcpMapping.label} (:${tcpMapping.cubePort})`
        : `TCP: port ${tcpMapping.cubePort}`;
    } else {
      purpose = p.purpose === "tcp" ? "TCP" : "Allocated";
    }

    return {
      id: p.id,
      port: p.port,
      status: "allocated" as const,
      serverHostname: p.serverHostname,
      serverId: p.serverId,
      cubeId: p.cubeId,
      cubeName: cube?.name ?? null,
      cubeStatus: cube?.status ?? null,
      spaceName: cube?.spaceName ?? null,
      purpose,
      tcpMappingStatus: tcpMapping?.status ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Ports</PageHeaderTitle>
          <PageHeaderDescription>
            All allocated port assignments across every server on the platform.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <PortsTable ports={portRows} serverSummaries={serverSummaries} />
    </div>
  );
}
