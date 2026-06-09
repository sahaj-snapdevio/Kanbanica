/**
 * Per-server custom-domain query.
 *
 * Returns the live custom-domain → Cube routing pairs for one server, in the
 * shape `reconcileCaddyRoutes` (lib/ssh/caddy.ts) needs to rebuild the Caddy
 * `srv0` routes array. Used by the `server.refresh-caddy` worker job.
 */

import { and, eq, isNotNull } from "drizzle-orm";
import { cubes, domainMappings } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * All live customer custom domains routed to Cubes on the given server.
 *
 * Joins `domain_mappings` → `cubes` and keeps only rows where the mapping is
 * `active` (route is meant to be live), the mapping has a routing `port`, and
 * the Cube has an `internalIp` — the two values a reverse-proxy route needs.
 * Rows missing either are skipped: a Cube with no internal IP is not
 * provisioned and a mapping with no port has no upstream to dial.
 */
export async function getActiveCustomDomainsForServer(
  serverId: string
): Promise<Array<{ domain: string; cubeInternalIp: string; port: number }>> {
  const rows = await db
    .select({
      domain: domainMappings.domain,
      port: domainMappings.port,
      cubeInternalIp: cubes.internalIp,
    })
    .from(domainMappings)
    .innerJoin(cubes, eq(cubes.id, domainMappings.cubeId))
    .where(
      and(
        eq(cubes.serverId, serverId),
        eq(domainMappings.status, "active"),
        isNotNull(domainMappings.port),
        isNotNull(cubes.internalIp)
      )
    );

  // `port` and `internalIp` are non-null here thanks to the isNotNull
  // filters above, but Drizzle still types them nullable — assert to satisfy
  // the function's return shape.
  return rows.map((r) => ({
    domain: r.domain,
    cubeInternalIp: r.cubeInternalIp as string,
    port: r.port as number,
  }));
}
