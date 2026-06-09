/**
 * Per-server NUMA-node assignment for L2 placement (least-loaded policy).
 *
 * Mirrors lib/server/jailer-uids.ts: a per-server advisory lock (disjoint seed
 * `4` — 0/1/2/3 are acquireSpaceLock / per-user / jailer-uid / bridge-subnet)
 * serializes the per-node load read + the write, so two cubes provisioning on
 * one host at the same time can never both pick the same "least-loaded" node off
 * a stale read. The chosen node is persisted on `cubes.numa_node`; the cpuset is
 * applied later at launch (lib/ssh/firecracker.ts) from the server's topology +
 * this node.
 *
 * Load per node = Σ(co-located cubes' vcpus) + Σ(ramMb)/1024 — CPU-dominant with
 * RAM as a sub-unit tiebreak, so an 8-vCPU cube outweighs a 1-vCPU cube and the
 * spread tracks real pressure rather than cube count.
 *
 * NO-OP cases (return null, leave the cube unpinned): single-socket host
 * (numaNodeCount <= 1) or undetected topology. The caller only applies cpuset
 * when numa_node is non-null, so this is the fail-safe gate for commodity hosts.
 */

import { and, eq, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { HOUSEKEEPING_CORES_PER_HOST } from "@/config/platform";
import * as schema from "@/db/schema";
import {
  cubeLoadWeight,
  type NumaTopology,
  nodeCpusetCpus,
  parseIdSet,
  selectLeastLoadedNode,
} from "@/lib/server/numa";

type Tx = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

/**
 * Assign the least-loaded NUMA node for a cube on `serverId` and persist it on
 * the cube row. Must run inside a transaction. Returns the node id, or null when
 * the host is single-socket / topology is undetected (cube left unpinned).
 *
 * The cube's OWN row is excluded from the load tally, so a same-server relaunch
 * re-evaluates fresh (it MAY land on a different node if load shifted since —
 * acceptable, it only takes effect on a cold boot).
 */
export async function assignNumaNode(
  tx: Tx,
  serverId: string,
  cubeId: string
): Promise<number | null> {
  const [srv] = await tx
    .select({
      topo: schema.servers.numaTopology,
      count: schema.servers.numaNodeCount,
    })
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .limit(1);

  const topo = (srv?.topo ?? null) as NumaTopology | null;
  // No-op: single-socket or undetected topology → leave the cube unpinned.
  if (!topo || topo.length <= 1 || (srv?.count ?? 1) <= 1) {
    await tx
      .update(schema.cubes)
      .set({ numaNode: null })
      .where(eq(schema.cubes.id, cubeId));
    return null;
  }

  // Serialize node selection per server (seed 4). Auto-released at tx end.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`numa_node:${serverId}`}, 4))`
  );

  const peers = await tx
    .select({
      node: schema.cubes.numaNode,
      vcpus: schema.cubes.vcpus,
      ramMb: schema.cubes.ramMb,
    })
    .from(schema.cubes)
    .where(
      and(
        eq(schema.cubes.serverId, serverId),
        ne(schema.cubes.id, cubeId),
        isNotNull(schema.cubes.numaNode),
        // Match the CPU/RAM tally convention (reconcileServerResources): a
        // deleted/error cube holds no host CPU and a sleeping cube releases its
        // CPU to the pool — exclude all three so they don't inflate node load
        // (review C1; also neutralizes phantom load from an uncleared numa_node).
        notInArray(schema.cubes.status, ["deleted", "error", "sleeping"])
      )
    );

  const loadByNode: Record<number, number> = {};
  for (const p of peers) {
    const n = p.node as number;
    loadByNode[n] =
      (loadByNode[n] ?? 0) +
      cubeLoadWeight({ vcpus: Number(p.vcpus), ramMb: p.ramMb });
  }

  // Usable cores per node AFTER the housekeeping carve-out, so the pick is
  // weighed per-usable-core — the node(s) owning the globally-lowest cores donate
  // them, so a donor node is not systematically over-subscribed (review ISSUE-1b).
  const usableByNode: Record<number, number> = {};
  for (const t of topo) {
    usableByNode[t.node] = parseIdSet(
      nodeCpusetCpus(topo, t.node, HOUSEKEEPING_CORES_PER_HOST)
    ).size;
  }

  const node = selectLeastLoadedNode(topo, loadByNode, usableByNode);

  // Oversell / coreless guard — mirror shouldBindCpuset's launch-time guard HERE,
  // at assignment, so the persisted state matches how the cube actually launches.
  // If the chosen node has fewer usable cores than the cube's vCPUs (a cube larger
  // than a node on a small dual-socket host, or — via the +∞ ratio — every node is
  // coreless), DON'T pin it: persist null so the cube boots unpinned host-wide
  // (never throttled below its sold vCPUs) AND isn't counted as phantom load on a
  // node it never actually runs on (which would skew later placements).
  const [self] = await tx
    .select({ vcpus: schema.cubes.vcpus })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);
  if (!self || (usableByNode[node] ?? 0) < self.vcpus) {
    await tx
      .update(schema.cubes)
      .set({ numaNode: null })
      .where(eq(schema.cubes.id, cubeId));
    return null;
  }

  await tx
    .update(schema.cubes)
    .set({ numaNode: node })
    .where(eq(schema.cubes.id, cubeId));
  return node;
}

/** Clear a cube's NUMA node (delete / transfer-out). Idempotent. */
export async function clearNumaNode(tx: Tx, cubeId: string): Promise<void> {
  await tx
    .update(schema.cubes)
    .set({ numaNode: null })
    .where(eq(schema.cubes.id, cubeId));
}
