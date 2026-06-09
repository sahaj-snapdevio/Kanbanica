import { CubeIcon, PlusIcon, UploadIcon } from "@phosphor-icons/react/dist/ssr";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CubeList } from "@/components/cube-list";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import { DISK_RATE, RAM_RATE, VCPU_RATE } from "@/config/platform";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import {
  calculateHourlyCost,
  calculateSleepHourlyCost,
  getCreditRateTiers,
  getTierMultiplier,
} from "@/lib/cost";
import { db } from "@/lib/db";
import { serverConnectDomain } from "@/lib/server/server-hostnames";
import { getSession } from "@/lib/server/session";
import { assertBackupStorageAvailable } from "@/lib/storage/capabilities";

export default async function CubesPage({
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

  // Check permissions
  const permissions = membership.isOwner
    ? [...PERMISSION_VALUES]
    : (
        await db
          .select({ permission: schema.memberPermissions.permission })
          .from(schema.memberPermissions)
          .where(eq(schema.memberPermissions.membershipId, membership.id))
      ).map((p) => p.permission);

  const canView = membership.isOwner || permissions.includes("cube.view");
  if (!canView) {
    return (
      <Empty className="min-h-100">
        <EmptyHeader>
          <EmptyTitle>Access Denied</EmptyTitle>
          <EmptyDescription>
            You do not have permission to view Cubes in this space.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // Fetch all Cubes — explicit column projection so the potentially-large
  // `userData` cloud-init text (and other unused columns) are never read.
  const cubeList = await db
    .select({
      id: schema.cubes.id,
      name: schema.cubes.name,
      status: schema.cubes.status,
      transferState: schema.cubes.transferState,
      vcpus: schema.cubes.vcpus,
      ramMb: schema.cubes.ramMb,
      diskLimitGb: schema.cubes.diskLimitGb,
      serverId: schema.cubes.serverId,
      createdAt: schema.cubes.createdAt,
    })
    .from(schema.cubes)
    .where(eq(schema.cubes.spaceId, spaceId))
    .orderBy(desc(schema.cubes.createdAt));

  const cubeIds = cubeList.map((c) => c.id);
  const customDomainRows =
    cubeIds.length > 0
      ? await db
          .select({
            cubeId: schema.domainMappings.cubeId,
            domain: schema.domainMappings.domain,
            cloudflareStatus: schema.domainMappings.cloudflareStatus,
          })
          .from(schema.domainMappings)
          .where(inArray(schema.domainMappings.cubeId, cubeIds))
          .orderBy(
            sql`(${schema.domainMappings.cloudflareStatus} = 'active') desc nulls last`,
            asc(schema.domainMappings.createdAt)
          )
      : [];
  const customDomainByCube = new Map<
    string,
    { domain: string; cloudflareStatus: string | null }
  >();
  for (const row of customDomainRows) {
    if (!customDomainByCube.has(row.cubeId)) {
      customDomainByCube.set(row.cubeId, {
        domain: row.domain,
        cloudflareStatus: row.cloudflareStatus,
      });
    }
  }

  // Fetch servers for domain info and region
  const serverIds = [
    ...new Set(cubeList.map((v) => v.serverId).filter(Boolean)),
  ];
  const serversData =
    serverIds.length > 0
      ? await db
          .select({
            id: schema.servers.id,
            hostname: schema.servers.hostname,
            regionId: schema.servers.regionId,
          })
          .from(schema.servers)
          .where(inArray(schema.servers.id, serverIds))
      : [];
  const serversMap = new Map(
    serversData.map((s) => [
      s.id,
      {
        hostname: s.hostname,
        serverDomain: serverConnectDomain(s.hostname),
        regionId: s.regionId,
      },
    ])
  );

  // Fetch all regions for display.
  const allRegions = await db
    .select({
      id: schema.regions.id,
      name: schema.regions.name,
    })
    .from(schema.regions);
  const regionMap = new Map(allRegions.map((r) => [r.id, r]));

  // Import CTA visibility: shown when the customer has cube.create AND
  // a storage backend exists to upload to. The actual storage-backend
  // check lives behind the redirect on the import page itself; we
  // mirror it here so we don't render a button that always errors.
  const importStorageError = await assertBackupStorageAvailable();
  const canImport = !importStorageError;

  // Credit rates from static config
  const vcpuRate = VCPU_RATE;
  const ramRate = RAM_RATE;
  const diskRate = DISK_RATE;

  // Fetch space for balance check
  const [space] = await db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);

  const creditBalance = space ? Number.parseFloat(space.creditBalance) : 0;
  const canCreate =
    (membership.isOwner || permissions.includes("cube.create")) &&
    creditBalance > 0;

  // Per-cube hourly cost displayed in the cubes list. Must reflect the
  // cube's CURRENT billing state (Rule 53):
  //   - running  → compute formula via calculateHourlyCost (with tier
  //                multiplier — the prior inline math omitted it and
  //                quietly overstated discounted-tier customers' bills)
  //   - sleeping → sleep storage via calculateSleepHourlyCost (full disk,
  //                same per-GB rate as running disk)
  //   - error / pending / booting / stopping → the running rate so the
  //                customer sees what they'll pay once the cube is back
  //                up. Status badges + tooltips elsewhere convey that
  //                no billing is currently in flight.
  const tiers = getCreditRateTiers();
  const rates = { vcpuRate, ramRate, diskRate };
  const cubesWithInfo = cubeList.map((cube) => {
    const server = serversMap.get(cube.serverId);
    const multiplier = getTierMultiplier(cube.vcpus, tiers);
    const costPerHour =
      cube.status === "sleeping"
        ? calculateSleepHourlyCost(
            { diskLimitGb: cube.diskLimitGb },
            { diskRate },
            multiplier
          )
        : calculateHourlyCost(
            {
              vcpus: cube.vcpus,
              ramMb: cube.ramMb,
              diskLimitGb: cube.diskLimitGb,
            },
            rates,
            multiplier
          );

    return {
      ...cube,
      serverDomain: server?.serverDomain ?? "",
      serverHostname: server?.hostname ?? "",
      region: server?.regionId
        ? (regionMap.get(server.regionId!)?.name ?? "—")
        : "—",
      costPerHour,
      createdAt: cube.createdAt.toISOString(),
      customDomain: customDomainByCube.get(cube.id) ?? null,
    };
  });

  const ctaButtons = canCreate ? (
    <>
      {canImport && (
        <Button asChild variant="outline">
          <Link href={`/${spaceId}/cubes/import`}>
            <UploadIcon className="size-4" />
            Import Cube
          </Link>
        </Button>
      )}
      <Button asChild variant="outline">
        <Link href={`/${spaceId}/cubes/new`}>
          <PlusIcon className="size-4" />
          New Cube
        </Link>
      </Button>
    </>
  ) : null;

  return (
    <div className="space-y-6">
      {cubesWithInfo.length === 0 ? (
        <>
          <PageHeader>
            <PageHeaderContent>
              <PageHeaderTitle>Cubes</PageHeaderTitle>
              <PageHeaderDescription>
                Spin up a cube and manage its lifecycle.
              </PageHeaderDescription>
            </PageHeaderContent>
            <PageHeaderActions>{ctaButtons}</PageHeaderActions>
          </PageHeader>
          <Empty className="min-h-100 rounded-lg border">
            <EmptyHeader>
              <EmptyMedia>
                <CubeIcon className="size-10 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>No Cubes</EmptyTitle>
              <EmptyDescription>
                {canCreate
                  ? "Spin up a cube with full SSH access."
                  : "No Cubes have been created in this space yet."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </>
      ) : (
        <CubeList
          actions={<div className="flex items-center gap-2">{ctaButtons}</div>}
          cubes={cubesWithInfo}
          spaceId={spaceId}
        />
      )}
    </div>
  );
}
