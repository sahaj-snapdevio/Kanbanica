/**
 * Admin detail page for a single Cube.
 *
 * This is the admin "control room" — it mirrors the customer-facing cube
 * detail page (live status, networking, snapshots, domains, members,
 * activity) and adds an admin actions ribbon (resize, transfer, force
 * sleep, force delete, purge) plus an explicit "Open as customer" button
 * that impersonates the space owner and routes to the customer-side cube
 * page. Admin clicks NEVER silently impersonate any more.
 *
 * Layout: a header + admin-actions ribbon stay pinned at the top; the cube's
 * sections live in a CubeDetailTabs shell (Overview / Networking / Snapshots /
 * Members / Activity) with the real-time Live-status card kept in a persistent
 * right rail so its metrics stay visible no matter which tab is open.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CubeLiveStatusCard } from "@/components/cube-live-status-card";
import { CubeStatusBadge } from "@/components/cube-status-badge";
import { LocalDate } from "@/components/local-date";
import { CubeActionsBar } from "@/components/orbit/cube-actions-bar";
import { CubeAdminActions } from "@/components/orbit/cube-admin-actions";
import { CubeDetailTabs } from "@/components/orbit/cube-detail-tabs";
import { JobLogStream } from "@/components/orbit/job-log-stream";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IMAGE_OPTIONS } from "@/config/platform";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import {
  cloudflareStatusVariant,
  domainStatusVariant,
  snapshotStatusVariant,
} from "@/lib/status-display";

export const dynamic = "force-dynamic";

export default async function OrbitCubeDetailPage({
  params,
}: {
  params: Promise<{ cubeId: string }>;
}) {
  const { cubeId } = await params;

  // Aliased join so a cube mid-transfer can resolve its destination server's
  // hostname instead of surfacing a raw server ID.
  const destServer = alias(schema.servers, "destServer");

  const [row] = await db
    .select({
      id: schema.cubes.id,
      name: schema.cubes.name,
      status: schema.cubes.status,
      vcpus: schema.cubes.vcpus,
      ramMb: schema.cubes.ramMb,
      diskLimitGb: schema.cubes.diskLimitGb,
      hasVirtioMem: schema.cubes.hasVirtioMem,
      imageId: schema.cubes.imageId,
      internalIp: schema.cubes.internalIp,
      internalIpv6: schema.cubes.internalIpv6,
      bootedKernelVersion: schema.cubes.bootedKernelVersion,
      lastStartedAt: schema.cubes.lastStartedAt,
      lastReachabilityAt: schema.cubes.lastReachabilityAt,
      reachabilityJsonb: schema.cubes.reachabilityJsonb,
      lastMetricsJsonb: schema.cubes.lastMetricsJsonb,
      spaceId: schema.cubes.spaceId,
      spaceName: schema.spaces.name,
      serverId: schema.cubes.serverId,
      serverHostname: schema.servers.hostname,
      serverCurrentKernelVersion: schema.servers.currentKernelVersion,
      regionName: schema.regions.name,
      transferState: schema.cubes.transferState,
      transferDestinationServerId: schema.cubes.transferDestinationServerId,
      transferDestinationServerHostname: destServer.hostname,
      transferStartedAt: schema.cubes.transferStartedAt,
      createdAt: schema.cubes.createdAt,
      serverTotalCpus: schema.servers.totalCpus,
      serverTotalRamMb: schema.servers.totalRamMb,
      serverTotalDiskGb: schema.servers.totalDiskGb,
      serverOverheadDiskGb: schema.servers.overheadDiskGb,
      serverAllocatedCpus: schema.servers.allocatedCpus,
      serverAllocatedRamMb: schema.servers.allocatedRamMb,
      serverAllocatedDiskGb: schema.servers.allocatedDiskGb,
      serverMaxCpuOvercommit: schema.servers.maxCpuOvercommit,
      serverMaxRamOvercommit: schema.servers.maxRamOvercommit,
    })
    .from(schema.cubes)
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.cubes.spaceId))
    .innerJoin(schema.servers, eq(schema.servers.id, schema.cubes.serverId))
    .leftJoin(schema.regions, eq(schema.regions.id, schema.servers.regionId))
    .leftJoin(
      destServer,
      eq(destServer.id, schema.cubes.transferDestinationServerId)
    )
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);

  if (!row) {
    notFound();
  }

  // Space owner (used by "Open as customer" + identity card)
  const [owner] = await db
    .select({
      userId: schema.spaceMemberships.userId,
      email: schema.user.email,
      name: schema.user.name,
    })
    .from(schema.spaceMemberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.spaceMemberships.userId))
    .where(
      and(
        eq(schema.spaceMemberships.spaceId, row.spaceId),
        eq(schema.spaceMemberships.isOwner, true)
      )
    )
    .limit(1);

  // Networking — TCP mappings (full list — usually small)
  const tcpMappings = await db
    .select({
      id: schema.tcpPortMappings.id,
      cubePort: schema.tcpPortMappings.cubePort,
      hostPort: schema.tcpPortMappings.hostPort,
      isSsh: schema.tcpPortMappings.isSsh,
      status: schema.tcpPortMappings.status,
      label: schema.tcpPortMappings.label,
    })
    .from(schema.tcpPortMappings)
    .where(eq(schema.tcpPortMappings.cubeId, cubeId))
    .orderBy(
      desc(schema.tcpPortMappings.isSsh),
      schema.tcpPortMappings.cubePort
    );

  // Snapshots — count + last 5
  const snapshots = await db
    .select({
      id: schema.cubeSnapshots.id,
      name: schema.cubeSnapshots.name,
      status: schema.cubeSnapshots.status,
      sizeBytes: schema.cubeSnapshots.sizeBytes,
      kind: schema.cubeSnapshots.kind,
      createdAt: schema.cubeSnapshots.createdAt,
    })
    .from(schema.cubeSnapshots)
    .where(eq(schema.cubeSnapshots.cubeId, cubeId))
    .orderBy(desc(schema.cubeSnapshots.createdAt))
    .limit(5);

  // Domain mappings — full list (also usually small per-cube)
  const domains = await db
    .select({
      id: schema.domainMappings.id,
      domain: schema.domainMappings.domain,
      port: schema.domainMappings.port,
      status: schema.domainMappings.status,
      cloudflareStatus: schema.domainMappings.cloudflareStatus,
    })
    .from(schema.domainMappings)
    .where(eq(schema.domainMappings.cubeId, cubeId));

  // Members of the space with cube access (owner + anyone with cube.manage
  // or cube.view). Lets the admin see who can touch this cube on the
  // customer side without leaving the page.
  const members = await db
    .select({
      membershipId: schema.spaceMemberships.id,
      userId: schema.spaceMemberships.userId,
      email: schema.user.email,
      name: schema.user.name,
      isOwner: schema.spaceMemberships.isOwner,
    })
    .from(schema.spaceMemberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.spaceMemberships.userId))
    .where(eq(schema.spaceMemberships.spaceId, row.spaceId));

  const permissionRows = members.length
    ? await db
        .select({
          membershipId: schema.memberPermissions.membershipId,
          permission: schema.memberPermissions.permission,
        })
        .from(schema.memberPermissions)
        .where(
          inArray(
            schema.memberPermissions.membershipId,
            members.map((m) => m.membershipId)
          )
        )
    : [];
  const permsByMembership = new Map<string, string[]>();
  for (const p of permissionRows) {
    const list = permsByMembership.get(p.membershipId) ?? [];
    list.push(p.permission);
    permsByMembership.set(p.membershipId, list);
  }
  const membersWithAccess = members.filter((m) => {
    if (m.isOwner) {
      return true;
    }
    const perms = permsByMembership.get(m.membershipId) ?? [];
    return perms.includes("cube.manage") || perms.includes("cube.view");
  });

  const imageLabel =
    IMAGE_OPTIONS.find((o) => o.value === row.imageId)?.label ?? row.imageId;

  const activeSshMapping = tcpMappings.find((t) => t.isSsh);
  const activeSnapshotCount = snapshots.filter(
    (s) => s.status !== "failed"
  ).length;

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            className="transition-colors hover:text-foreground"
            href="/orbit/cubes"
          >
            Cubes
          </Link>
          <span>/</span>
          <span>{row.name}</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {row.name}
            </h1>
            <CubeStatusBadge
              status={row.status}
              transferState={row.transferState}
            />
            {row.transferState !== "idle" && (
              <Badge variant="secondary">Transfer: {row.transferState}</Badge>
            )}
            {row.bootedKernelVersion !== null &&
              row.bootedKernelVersion < row.serverCurrentKernelVersion && (
                <Badge title="Cold-restart to upgrade" variant="outline">
                  Kernel v{row.bootedKernelVersion} (host v
                  {row.serverCurrentKernelVersion})
                </Badge>
              )}
          </div>
          <CubeActionsBar
            cube={{
              id: row.id,
              name: row.name,
              vcpus: row.vcpus,
              ramMb: row.ramMb,
              diskLimitGb: row.diskLimitGb,
              hasVirtioMem: row.hasVirtioMem,
              status: row.status,
              transferState: row.transferState,
            }}
            server={{
              totalCpus: row.serverTotalCpus,
              totalRamMb: row.serverTotalRamMb,
              totalDiskGb: row.serverTotalDiskGb,
              overheadDiskGb: row.serverOverheadDiskGb,
              allocatedCpus: row.serverAllocatedCpus,
              allocatedRamMb: row.serverAllocatedRamMb,
              allocatedDiskGb: row.serverAllocatedDiskGb,
              maxCpuOvercommit: row.serverMaxCpuOvercommit,
              maxRamOvercommit: row.serverMaxRamOvercommit,
            }}
          />
        </div>
      </div>

      {/* ─── Admin actions ribbon ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Admin actions</CardTitle>
        </CardHeader>
        <CardContent>
          <CubeAdminActions
            cubeId={row.id}
            cubeName={row.name}
            spaceId={row.spaceId}
            spaceOwnerId={owner?.userId ?? null}
            status={row.status}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: tabbed sections */}
        <div className="lg:col-span-2">
          <CubeDetailTabs
            activity={
              // Live job-log stream for any admin-triggered cube job
              // (transfer, cold-restart, etc.) plus customer-initiated jobs
              // that touch the cube. Pusher subscription requires space
              // membership today, so the admin path falls back to 3-second SWR
              // polling — still fully live on the timescale of a transfer.
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <JobLogStream
                    channelName={`private-cube-${cubeId}`}
                    logsUrl={`/api/orbit/cubes/${cubeId}/job-logs?limit=500`}
                  />
                </CardContent>
              </Card>
            }
            members={
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>Members with cube access</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {membersWithAccess.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {membersWithAccess.length > 0 ? (
                    <ul className="divide-y">
                      {membersWithAccess.map((m) => {
                        const perms =
                          permsByMembership.get(m.membershipId) ?? [];
                        return (
                          <li
                            className="flex items-center justify-between gap-3 py-2 text-sm"
                            key={m.membershipId}
                          >
                            <div className="min-w-0">
                              <Link
                                className="truncate font-medium hover:underline"
                                href={`/orbit/users/${m.userId}`}
                              >
                                {m.email}
                              </Link>
                              {m.name && (
                                <div className="text-xs text-muted-foreground">
                                  {m.name}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {m.isOwner ? (
                                <Badge variant="default">Owner</Badge>
                              ) : (
                                <Badge variant="secondary">
                                  {perms.includes("cube.manage")
                                    ? "Manage"
                                    : "View"}
                                </Badge>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nobody currently has access to this cube.
                    </p>
                  )}
                </CardContent>
              </Card>
            }
            networking={
              <>
                {/* TCP port mappings */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                      <span>Networking</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {tcpMappings.length} mapping
                        {tcpMappings.length === 1 ? "" : "s"}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {tcpMappings.length > 0 ? (
                      <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                          <tr className="text-left">
                            <th className="pb-2 font-normal">Type</th>
                            <th className="pb-2 font-normal">Cube port</th>
                            <th className="pb-2 font-normal">Host port</th>
                            <th className="pb-2 font-normal">Status</th>
                            <th className="pb-2 font-normal">Label</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tcpMappings.map((m) => (
                            <tr className="border-t" key={m.id}>
                              <td className="py-2">
                                {m.isSsh ? (
                                  <Badge variant="secondary">SSH</Badge>
                                ) : (
                                  <span className="text-muted-foreground">
                                    TCP
                                  </span>
                                )}
                              </td>
                              <td className="py-2 font-mono tabular-nums">
                                {m.cubePort}
                              </td>
                              <td className="py-2 font-mono tabular-nums">
                                {m.hostPort}
                              </td>
                              <td className="py-2 capitalize">{m.status}</td>
                              <td className="py-2 text-muted-foreground">
                                {m.label ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No TCP mappings configured.
                      </p>
                    )}
                    {activeSshMapping && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        SSH endpoint: {row.serverHostname}:
                        {activeSshMapping.hostPort} → cube :
                        {activeSshMapping.cubePort}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Custom domains */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                      <span>Custom domains</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {domains.length}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {domains.length > 0 ? (
                      <ul className="divide-y">
                        {domains.map((d) => (
                          <li
                            className="flex items-center justify-between gap-3 py-2 text-sm"
                            key={d.id}
                          >
                            <Link
                              className="truncate font-mono hover:underline"
                              href={`/orbit/domains?cubeId=${cubeId}`}
                            >
                              {d.domain}
                            </Link>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant={domainStatusVariant(d.status)}>
                                {d.status}
                              </Badge>
                              <Badge
                                variant={cloudflareStatusVariant(
                                  d.cloudflareStatus
                                )}
                              >
                                {d.cloudflareStatus ?? "—"}
                              </Badge>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No custom domains attached.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </>
            }
            overview={
              <>
                {/* Details */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Space</dt>
                        <dd>
                          <Link
                            className="font-medium hover:underline"
                            href={`/orbit/spaces/${row.spaceId}`}
                          >
                            {row.spaceName}
                          </Link>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Owner</dt>
                        <dd>
                          {owner ? (
                            <Link
                              className="font-medium hover:underline"
                              href={`/orbit/users/${owner.userId}`}
                            >
                              {owner.email}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              — (no owner)
                            </span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Server</dt>
                        <dd>
                          <Link
                            className="font-medium hover:underline"
                            href={`/orbit/servers/${row.serverId}`}
                          >
                            {row.serverHostname}
                          </Link>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Region</dt>
                        <dd className="font-medium">{row.regionName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Image</dt>
                        <dd className="font-medium">{imageLabel}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Resources</dt>
                        <dd className="font-medium tabular-nums">
                          {row.vcpus} vCPU · {row.ramMb} MB RAM ·{" "}
                          {row.diskLimitGb} GB disk
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Internal IP</dt>
                        <dd className="font-medium">{row.internalIp ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Internal IPv6</dt>
                        <dd className="font-medium">
                          {row.internalIpv6 ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Kernel</dt>
                        <dd className="font-medium">
                          {row.bootedKernelVersion === null
                            ? "—"
                            : `v${row.bootedKernelVersion}`}{" "}
                          <span className="text-muted-foreground">
                            (host v{row.serverCurrentKernelVersion})
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Last started</dt>
                        <dd className="font-medium">
                          <LocalDate iso={row.lastStartedAt} mode="relative" />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Created</dt>
                        <dd className="font-medium">
                          <LocalDate iso={row.createdAt} />
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>

                {/* Transfer in progress */}
                {row.transferState !== "idle" && (
                  <Card className="border-amber-500/30 bg-amber-500/5 dark:border-amber-400/40 dark:bg-amber-500/10">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
                        Transfer in progress
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                            State
                          </dt>
                          <dd className="font-mono text-base font-medium text-foreground capitalize">
                            {row.transferState}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                            Destination
                          </dt>
                          <dd className="font-medium text-foreground">
                            {row.transferDestinationServerId ? (
                              row.transferDestinationServerHostname ? (
                                <Link
                                  className="hover:underline"
                                  href={`/orbit/servers/${row.transferDestinationServerId}`}
                                >
                                  {row.transferDestinationServerHostname}
                                </Link>
                              ) : (
                                <code className="text-xs">
                                  {row.transferDestinationServerId}
                                </code>
                              )
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                            Started
                          </dt>
                          <dd className="font-medium text-foreground">
                            <LocalDate iso={row.transferStartedAt} />
                          </dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                )}
              </>
            }
            snapshots={
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>Snapshots</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {activeSnapshotCount}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {snapshots.length > 0 ? (
                    <ul className="divide-y">
                      {snapshots.map((s) => (
                        <li
                          className="flex items-center justify-between gap-3 py-2 text-sm"
                          key={s.id}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{s.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {s.kind === "auto" ? "Auto" : "Manual"} ·{" "}
                              <LocalDate iso={s.createdAt} mode="relative" />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className="text-xs font-mono tabular-nums text-muted-foreground"
                              title="Deduplicated new data this snapshot added (incremental) — not its restore size"
                            >
                              {s.sizeBytes
                                ? `+${formatBytes(s.sizeBytes)}`
                                : "—"}
                            </span>
                            <Badge variant={snapshotStatusVariant(s.status)}>
                              {s.status}
                            </Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No snapshots taken yet.
                    </p>
                  )}
                </CardContent>
              </Card>
            }
          />
        </div>

        {/* Right: persistent live-status rail (visible across all tabs) */}
        <div className="space-y-6 lg:col-span-1">
          {row.status !== "deleted" && (
            <CubeLiveStatusCard
              cubeId={row.id}
              currentStatus={row.status}
              initialLastReachabilityAt={
                row.lastReachabilityAt?.toISOString() ?? null
              }
              initialMetrics={row.lastMetricsJsonb}
              initialReachability={row.reachabilityJsonb}
              spaceId={row.spaceId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
