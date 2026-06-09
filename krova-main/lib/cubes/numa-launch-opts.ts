/**
 * Resolve a cube's NUMA launch opts (its assigned node + the host's per-node
 * topology) for threading into createCube/startCube → launchJailed. One DB read,
 * uniform call shape, so every relaunch handler wires it identically:
 *
 *   const r = await startCube(client, cubeId, {
 *     ...,
 *     ...(await cubeNumaLaunchOpts(cubeId)),
 *   });
 *
 * Fail-safe: null fields when the cube has no node (single-socket / undetected /
 * flag-off-allocation) or the host has no topology → launchJailed leaves the cube
 * unpinned (today's behavior). Joins on `cubes.server_id`, so it is CORRECT for
 * every launch where the cube already lives on the launch host. A cross-server
 * transfer boots the destination UNPINNED (its `startCube` passes no numa opts)
 * and then RE-ASSIGNS `cubes.numa_node` against the destination's topology in the
 * transfer handler (after the residency flip, via `assignNumaNode`), so by the
 * destination's NEXT cold-restart this resolver returns the correct node for the
 * new host — never the stale source node.
 */

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import type { NumaTopology } from "@/lib/server/numa";

export async function cubeNumaLaunchOpts(cubeId: string): Promise<{
  numaNode: number | null;
  numaTopology: NumaTopology | null;
}> {
  const [row] = await db
    .select({
      numaNode: schema.cubes.numaNode,
      topo: schema.servers.numaTopology,
    })
    .from(schema.cubes)
    .innerJoin(schema.servers, eq(schema.cubes.serverId, schema.servers.id))
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);
  return {
    numaNode: row?.numaNode ?? null,
    numaTopology: (row?.topo ?? null) as NumaTopology | null,
  };
}
