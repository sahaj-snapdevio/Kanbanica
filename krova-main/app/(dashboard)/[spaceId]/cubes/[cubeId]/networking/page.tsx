import { eq, inArray } from "drizzle-orm";
import { CubeDetailNetworkingTab } from "@/components/cube-detail-networking-tab";
import * as schema from "@/db/schema";
import { loadCubeContext } from "@/lib/cubes/load-cube-context";
import { db } from "@/lib/db";
import { serverConnectDomain } from "@/lib/server/server-hostnames";

export const dynamic = "force-dynamic";

export default async function CubeNetworkingTabPage({
  params,
}: {
  params: Promise<{ spaceId: string; cubeId: string }>;
}) {
  const { spaceId, cubeId } = await params;
  const ctx = await loadCubeContext(spaceId, cubeId);
  const canManage = ctx.permissions.includes("cube.manage");

  const domainMappings = await db
    .select()
    .from(schema.domainMappings)
    .where(eq(schema.domainMappings.cubeId, cubeId));

  const tcpMappings = await db
    .select()
    .from(schema.tcpPortMappings)
    .where(eq(schema.tcpPortMappings.cubeId, cubeId));

  const mappingIds = tcpMappings.map((m) => m.id);
  const allWhitelistIps =
    mappingIds.length > 0
      ? await db
          .select()
          .from(schema.tcpMappingWhitelistedIps)
          .where(inArray(schema.tcpMappingWhitelistedIps.mappingId, mappingIds))
      : [];
  const whitelistByMapping = new Map<string, typeof allWhitelistIps>();
  for (const ip of allWhitelistIps) {
    const existing = whitelistByMapping.get(ip.mappingId) ?? [];
    existing.push(ip);
    whitelistByMapping.set(ip.mappingId, existing);
  }

  return (
    <div className="space-y-6">
      <CubeDetailNetworkingTab
        canManage={canManage}
        cubeId={cubeId}
        cubeStatus={ctx.cube.status}
        domainMappings={domainMappings.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        }))}
        serverDomain={
          ctx.server ? serverConnectDomain(ctx.server.hostname) : ""
        }
        spaceId={spaceId}
        tcpMappings={tcpMappings.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
          whitelistedIps: (whitelistByMapping.get(m.id) ?? []).map((w) => ({
            id: w.id,
            cidr: w.cidr,
          })),
        }))}
      />
    </div>
  );
}
