import { count, notInArray, sum } from "drizzle-orm";
import { AddServerSheet } from "@/components/orbit/add-server-dialog";
import { ServersTable } from "@/components/orbit/servers-table";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { serverConnectDomain } from "@/lib/server/server-hostnames";

export default async function ServersPage() {
  // Fetch regions for the Add Server form
  const regionRows = await db
    .select({
      id: schema.regions.id,
      name: schema.regions.name,
      slug: schema.regions.slug,
    })
    .from(schema.regions);

  // Fetch SSH keys for the Add Server form
  const sshKeyRows = await db
    .select({ id: schema.sshKeys.id, name: schema.sshKeys.name })
    .from(schema.sshKeys);

  // Build a region name lookup
  const regionMap = new Map(regionRows.map((r) => [r.id, r.name]));

  const serversData = await db
    .select({
      id: schema.servers.id,
      hostname: schema.servers.hostname,
      publicIp: schema.servers.publicIp,
      regionId: schema.servers.regionId,
      sshPort: schema.servers.sshPort,
      status: schema.servers.status,
      totalCpus: schema.servers.totalCpus,
      totalRamMb: schema.servers.totalRamMb,
      totalDiskGb: schema.servers.totalDiskGb,
      overheadDiskGb: schema.servers.overheadDiskGb,
      maxCpuOvercommit: schema.servers.maxCpuOvercommit,
      maxRamOvercommit: schema.servers.maxRamOvercommit,
      createdAt: schema.servers.createdAt,
    })
    .from(schema.servers);

  // Compute actual resource usage per the platform rule (see
  // `reconcileServerResources` in `lib/server/allocate.ts`):
  //   - CPU + RAM exclude sleeping cubes (Firecracker paused/killed).
  //   - Disk includes sleeping cubes (rootfs file is still on disk).
  //   - Both exclude `deleted` and `error`.
  // The cube-count badge counts live cubes (anything not deleted/error,
  // including sleeping).
  const cpuRamStats = await db
    .select({
      serverId: schema.cubes.serverId,
      totalVcpus: sum(schema.cubes.vcpus),
      totalRamMb: sum(schema.cubes.ramMb),
    })
    .from(schema.cubes)
    .where(notInArray(schema.cubes.status, ["deleted", "error", "sleeping"]))
    .groupBy(schema.cubes.serverId);

  const diskStats = await db
    .select({
      serverId: schema.cubes.serverId,
      totalDiskGb: sum(schema.cubes.diskLimitGb),
      liveCount: count(schema.cubes.id),
    })
    .from(schema.cubes)
    .where(notInArray(schema.cubes.status, ["deleted", "error"]))
    .groupBy(schema.cubes.serverId);

  const cpuRamMap = new Map(cpuRamStats.map((v) => [v.serverId, v]));
  const diskMap = new Map(diskStats.map((v) => [v.serverId, v]));

  const servers = serversData.map((s) => {
    const cpuRam = cpuRamMap.get(s.id);
    const disk = diskMap.get(s.id);
    return {
      ...s,
      serverDomain: serverConnectDomain(s.hostname),
      regionName: (s.regionId ? regionMap.get(s.regionId) : null) ?? "—",
      allocatedCpus: cpuRam ? Number(cpuRam.totalVcpus ?? 0) : 0,
      allocatedRamMb: cpuRam ? Number(cpuRam.totalRamMb ?? 0) : 0,
      allocatedDiskGb: disk ? Number(disk.totalDiskGb ?? 0) : 0,
      maxCpuOvercommit: Number.parseFloat(s.maxCpuOvercommit),
      maxRamOvercommit: Number.parseFloat(s.maxRamOvercommit),
      cubeCount: disk ? Number(disk.liveCount) : 0,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Servers</PageHeaderTitle>
          <PageHeaderDescription>
            Manage infrastructure servers.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <AddServerSheet regions={regionRows} sshKeys={sshKeyRows} />
        </PageHeaderActions>
      </PageHeader>
      <ServersTable servers={servers} />
    </div>
  );
}
