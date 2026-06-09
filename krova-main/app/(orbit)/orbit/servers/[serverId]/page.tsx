import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JobLogStream } from "@/components/orbit/job-log-stream";
import { RefreshCaddyButton } from "@/components/orbit/refresh-caddy-button";
import { RefreshHardwareButton } from "@/components/orbit/refresh-hardware-button";
import {
  EditServerSheet,
  ServerDetail,
} from "@/components/orbit/server-detail";
import { ServerHealthCheck } from "@/components/orbit/server-health-check";
import { ServerSetupCard } from "@/components/orbit/server-setup-card";
import { UpdateCaddyButton } from "@/components/orbit/update-caddy-button";
import { UpdateImagesButton } from "@/components/orbit/update-images-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

// Always render fresh — phase state changes via worker + Pusher, and we don't
// want Next.js to serve a stale snapshot when the operator hits this page or
// when the client calls router.refresh().
export const dynamic = "force-dynamic";

export default async function ServerDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;

  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId));

  if (!server) {
    notFound();
  }

  // Fetch all regions and SSH keys for the edit form
  const allRegions = await db
    .select({ id: schema.regions.id, name: schema.regions.name })
    .from(schema.regions);

  const allSshKeys = await db
    .select({ id: schema.sshKeys.id, name: schema.sshKeys.name })
    .from(schema.sshKeys);

  // Resolve region name
  let regionName = "—";
  const matchedRegion = allRegions.find((r) => r.id === server.regionId);
  if (matchedRegion) {
    regionName = matchedRegion.name;
  }

  const serverCubes = await db
    .select({
      id: schema.cubes.id,
      name: schema.cubes.name,
      status: schema.cubes.status,
      transferState: schema.cubes.transferState,
      vcpus: schema.cubes.vcpus,
      ramMb: schema.cubes.ramMb,
      diskLimitGb: schema.cubes.diskLimitGb,
      spaceName: schema.spaces.name,
      createdAt: schema.cubes.createdAt,
    })
    .from(schema.cubes)
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.cubes.spaceId))
    .where(eq(schema.cubes.serverId, serverId));

  // Compute allocated resources per the platform rule (see
  // `reconcileServerResources` in `lib/server/allocate.ts`):
  //   - CPU + RAM: exclude sleeping cubes (Firecracker paused/killed, host
  //     CPU and RAM are free).
  //   - Disk: include sleeping cubes (rootfs file is still on disk).
  //   - Both exclude `deleted` and `error`.
  const liveCubes = serverCubes.filter(
    (cube) => cube.status !== "deleted" && cube.status !== "error"
  );
  const cpuRamCubes = liveCubes.filter((cube) => cube.status !== "sleeping");
  const allocatedCpus = cpuRamCubes.reduce((s, cube) => s + cube.vcpus, 0);
  const allocatedRamMb = cpuRamCubes.reduce((s, cube) => s + cube.ramMb, 0);
  const allocatedDiskGb = liveCubes.reduce(
    (s, cube) => s + cube.diskLimitGb,
    0
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            className="transition-colors hover:text-foreground"
            href="/orbit/servers"
          >
            Servers
          </Link>
          <span>/</span>
          <span>{server.hostname}</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            {server.hostname}
          </h1>
          <div className="flex items-center gap-2">
            <ServerHealthCheck serverId={serverId} />
            {server.setupPhase === "ready" && (
              <>
                <UpdateImagesButton
                  hostname={server.hostname}
                  serverId={serverId}
                />
                <RefreshCaddyButton
                  hostname={server.hostname}
                  serverId={serverId}
                />
                <UpdateCaddyButton
                  hostname={server.hostname}
                  serverId={serverId}
                />
                <RefreshHardwareButton
                  hostname={server.hostname}
                  serverId={serverId}
                />
              </>
            )}
            <EditServerSheet
              regions={allRegions}
              server={{
                ...server,
                regionName,
                allocatedCpus: 0,
                allocatedRamMb: 0,
                allocatedDiskGb: 0,
                maxCpuOvercommit: Number.parseFloat(server.maxCpuOvercommit),
                maxRamOvercommit: Number.parseFloat(server.maxRamOvercommit),
              }}
              sshKeys={allSshKeys}
            />
          </div>
        </div>
      </div>
      <ServerDetail
        activitySlot={
          // Live job log stream for ALL admin-triggered server jobs
          // (update-images, refresh-caddy, future ops). Lives in the Logs
          // tab; survives the ServerSetupCard hiding itself once setupPhase
          // reaches "ready" (that card embeds its own JobLogStream only for the
          // in-flight setup phase, leaving post-ready ops with no log surface).
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <JobLogStream
                channelName={`private-server-${serverId}`}
                logsUrl={`/api/orbit/servers/${serverId}/job-logs?limit=500`}
              />
            </CardContent>
          </Card>
        }
        cubes={serverCubes}
        defaultTab={server.setupPhase === "ready" ? "overview" : "setup"}
        server={{
          ...server,
          regionName,
          allocatedCpus,
          allocatedRamMb,
          allocatedDiskGb,
          maxCpuOvercommit: Number.parseFloat(server.maxCpuOvercommit),
          maxRamOvercommit: Number.parseFloat(server.maxRamOvercommit),
        }}
        setupSlot={
          server.setupPhase === "ready" ? null : (
            <ServerSetupCard
              hostname={server.hostname}
              publicIp={server.publicIp}
              serverId={server.id}
              setupError={server.setupError}
              setupPhase={server.setupPhase}
              setupStartedAt={server.setupStartedAt}
              setupStatus={server.setupStatus}
            />
          )
        }
      />
    </div>
  );
}
