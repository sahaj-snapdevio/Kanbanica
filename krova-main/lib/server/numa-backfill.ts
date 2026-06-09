/**
 * One-shot backfill of `cubes.numa_node` for the EXISTING fleet (L2 NUMA).
 *
 * A cube's NUMA node is assigned ONLY at create time (lib/server/allocate.ts,
 * gated on NUMA_PLACEMENT_ENABLED). Cubes provisioned before L2 was enabled have
 * `numa_node = NULL` forever, so they boot UNPINNED even after the flag is on —
 * the relaunch paths (wake / cold-restart / auto-relaunch) only READ numa_node,
 * they never assign it (lib/cubes/numa-launch-opts.ts). This module assigns a
 * least-loaded node to every eligible existing cube on a multi-socket host via
 * the SAME `assignNumaNode` allocator used at create time, so the placement
 * policy is byte-identical. The cpuset is applied on the cube's NEXT cold-restart
 * — this writes ONLY the DB column, it never touches a running cube/VM. (A cube
 * larger than a node is assigned a node here but `launchJailed`'s oversell guard
 * keeps it unpinned at boot — never throttled below its sold vCPUs.)
 *
 * DB-only: topology already lives in `servers.numa_topology` (bootstrap /
 * install:numa-detect), so no host SSH is needed (Rule 60 — operator-run, but it
 * touches no host either way). Idempotent — only cubes with `numa_node IS NULL`
 * are touched, so a re-run is a no-op. Single-socket / undetected hosts are a
 * no-op (assignNumaNode returns null). Dry-run by default at the CLI. `serverIds`
 * scopes the run to specific hosts (operator canary — one server first).
 */

import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  type SQL,
} from "drizzle-orm";
import * as schema from "@/db/schema";
import { type AuditLogEntry, auditBatch } from "@/lib/audit";
import { db } from "@/lib/db";
import { cubeLoadWeight, type NumaTopology } from "@/lib/server/numa";
import { assignNumaNode } from "@/lib/server/numa-nodes";

// Stable, on-host states whose rootfs is real and which will cold-boot again:
// running / sleeping / error. Excludes the transient provision/teardown states
// (pending/booting/stopping/deleted) — assignNumaNode at create already covers a
// concurrently-provisioning cube, and a deleted/transient row must not be touched.
const ELIGIBLE_STATUSES = ["running", "sleeping", "error"] as const;

const isEligibleStatus = (status: string): boolean =>
  (ELIGIBLE_STATUSES as readonly string[]).includes(status);

// Thrown to roll back the dry-run preview transaction (see below).
const ROLLBACK = Symbol("numa-backfill-dryrun-rollback");

export type NumaBackfillServer = {
  serverId: string;
  hostname: string;
  nodeCount: number;
  /** Multi-socket host whose topology hasn't been detected — run install:numa-detect first. */
  topologyMissing: boolean;
  assignments: { cubeId: string; node: number }[];
  /** Cubes that already have a node (idempotency visibility). */
  alreadyAssigned: number;
  /** Null-node cubes skipped because mid-transfer or in a transient status. */
  skippedNotEligible: number;
};

export type NumaBackfillResult = {
  applied: boolean;
  servers: NumaBackfillServer[];
  /** Active single-socket servers — L2 no-op, reported for completeness. */
  singleSocketServers: number;
  totalAssigned: number;
};

/**
 * Assign least-loaded NUMA nodes to every eligible null-node cube on each active
 * multi-socket server. `apply: false` previews the exact placement without
 * persisting; `apply: true` commits + audits. `serverIds` (optional) scopes the
 * run to those servers only (operator canary / deterministic tests).
 */
export async function backfillNumaNodes(opts: {
  apply: boolean;
  serverIds?: string[];
}): Promise<NumaBackfillResult> {
  const scope: SQL[] = [eq(schema.servers.status, "active")];
  if (opts.serverIds && opts.serverIds.length > 0) {
    scope.push(inArray(schema.servers.id, opts.serverIds));
  }

  const multiSocket = await db
    .select({
      id: schema.servers.id,
      hostname: schema.servers.hostname,
      nodeCount: schema.servers.numaNodeCount,
      topo: schema.servers.numaTopology,
    })
    .from(schema.servers)
    .where(and(...scope, gt(schema.servers.numaNodeCount, 1)));

  const [singleRow] = await db
    .select({ c: count() })
    .from(schema.servers)
    .where(and(...scope, lte(schema.servers.numaNodeCount, 1)));
  const singleSocketServers = singleRow?.c ?? 0;

  const servers: NumaBackfillServer[] = [];
  const auditEntries: AuditLogEntry[] = [];

  for (const srv of multiSocket) {
    const topo = (srv.topo ?? null) as NumaTopology | null;
    if (!topo || topo.length <= 1) {
      servers.push({
        serverId: srv.id,
        hostname: srv.hostname,
        nodeCount: srv.nodeCount,
        topologyMissing: true,
        assignments: [],
        alreadyAssigned: 0,
        skippedNotEligible: 0,
      });
      continue;
    }

    // alreadyAssigned / nullNonDeleted are DISPLAY-ONLY snapshots from independent
    // reads — under a live worker they can drift by a row between queries. That's
    // fine: the apply path re-checks each cube's eligibility atomically under a row
    // lock before writing (below), so the counts being best-effort never affects
    // correctness, only the printed report.
    const [assignedRow] = await db
      .select({ c: count() })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.serverId, srv.id),
          isNotNull(schema.cubes.numaNode),
          ne(schema.cubes.status, "deleted")
        )
      );
    const alreadyAssigned = assignedRow?.c ?? 0;

    const [nullRow] = await db
      .select({ c: count() })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.serverId, srv.id),
          isNull(schema.cubes.numaNode),
          ne(schema.cubes.status, "deleted")
        )
      );
    const nullNonDeleted = nullRow?.c ?? 0;

    const candidates = await db
      .select({
        id: schema.cubes.id,
        spaceId: schema.cubes.spaceId,
        vcpus: schema.cubes.vcpus,
        ramMb: schema.cubes.ramMb,
      })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.serverId, srv.id),
          isNull(schema.cubes.numaNode),
          inArray(schema.cubes.status, [...ELIGIBLE_STATUSES]),
          eq(schema.cubes.transferState, "idle")
        )
      );

    // Greedy bin-packing: place the heaviest cube first onto the least-loaded
    // node. The same sorted order drives BOTH the dry-run preview and the apply
    // path, so the preview matches the committed result exactly. id tiebreak →
    // deterministic.
    candidates.sort(
      (a, b) =>
        cubeLoadWeight(b) - cubeLoadWeight(a) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );

    const skippedNotEligible = nullNonDeleted - candidates.length;
    const assignments: { cubeId: string; node: number }[] = [];

    if (opts.apply) {
      for (const c of candidates) {
        // One committed tx per cube. Re-check eligibility under a ROW LOCK,
        // atomic with the write: the candidate list was read earlier, so a cube
        // may have started a transfer / been deleted since (TOCTOU). assignNumaNode
        // writes unconditionally (it's shared with the create path where the cube
        // is always fresh-eligible), so the re-check lives here. assignNumaNode's
        // per-tx peer read also sees prior commits, so load builds across the batch.
        const node = await db.transaction(async (tx) => {
          const [fresh] = await tx
            .select({
              numaNode: schema.cubes.numaNode,
              status: schema.cubes.status,
              transferState: schema.cubes.transferState,
            })
            .from(schema.cubes)
            .where(eq(schema.cubes.id, c.id))
            .for("update")
            .limit(1);
          if (
            !fresh ||
            fresh.numaNode !== null ||
            fresh.transferState !== "idle" ||
            !isEligibleStatus(fresh.status)
          ) {
            return null;
          }
          return assignNumaNode(tx, srv.id, c.id);
        });
        if (node !== null) {
          assignments.push({ cubeId: c.id, node });
          auditEntries.push({
            action: "cube.numa_backfilled",
            category: "cube",
            actorType: "system",
            entityType: "cube",
            entityId: c.id,
            spaceId: c.spaceId,
            description: `NUMA node ${node} assigned via backfill — applies on next cold-restart`,
            metadata: { serverId: srv.id, node },
            source: "system",
          });
        }
      }
    } else {
      // Dry-run: run the WHOLE server's assignments in ONE transaction so each
      // assignNumaNode call sees the prior IN-TX writes (a tx sees its own
      // uncommitted writes) — identical placement to the per-cube committed apply
      // path — then ROLL BACK so nothing persists. Reuses assignNumaNode
      // verbatim, so the preview can never drift from apply (Rule 14: no policy
      // duplication). The advisory lock (seed 4) is re-entrant within one tx.
      await db
        .transaction(async (tx) => {
          for (const c of candidates) {
            const node = await assignNumaNode(tx, srv.id, c.id);
            if (node !== null) {
              assignments.push({ cubeId: c.id, node });
            }
          }
          throw ROLLBACK;
        })
        .catch((err) => {
          if (err !== ROLLBACK) {
            throw err;
          }
        });
    }

    servers.push({
      serverId: srv.id,
      hostname: srv.hostname,
      nodeCount: srv.nodeCount,
      topologyMissing: false,
      assignments,
      alreadyAssigned,
      skippedNotEligible,
    });
  }

  if (auditEntries.length > 0) {
    await auditBatch(auditEntries);
  }

  // Sum from per-server assignments so BOTH the apply and dry-run paths report
  // the same total (the dry-run branch populates `assignments` but never writes).
  const totalAssigned = servers.reduce(
    (sum, s) => sum + s.assignments.length,
    0
  );

  return { applied: opts.apply, servers, singleSocketServers, totalAssigned };
}
