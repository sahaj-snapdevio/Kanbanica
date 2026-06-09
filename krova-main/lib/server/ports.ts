/**
 * Dynamic port allocation for servers.
 *
 * Instead of pre-seeding 20k rows per server, we track only allocated ports.
 * An available port is any port in PORT_RANGE_START–PORT_RANGE_END
 * that has no row in the `allocated_ports` table for that server.
 */

import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

const PORT_RANGE_START = 30_000;
const PORT_RANGE_END = 50_000;

type Tx = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

/**
 * Find the next available port on a server and allocate it.
 * Must be called inside a transaction for concurrency safety.
 *
 * @returns The allocated port entry, or null if no ports available.
 */
export async function allocatePort(
  tx: Tx,
  serverId: string,
  cubeId: string,
  purpose: "ssh" | "tcp" = "ssh"
): Promise<typeof schema.allocatedPorts.$inferSelect | null> {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Get all currently allocated ports for this server
      const usedPorts = await tx
        .select({ port: schema.allocatedPorts.port })
        .from(schema.allocatedPorts)
        .where(eq(schema.allocatedPorts.serverId, serverId))
        .for("update");

      const usedSet = new Set(usedPorts.map((p) => p.port));

      // Find first available port in range
      let port: number | null = null;
      for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
        if (!usedSet.has(p)) {
          port = p;
          break;
        }
      }

      if (port === null) {
        console.error(
          `[allocatePort] all ${PORT_RANGE_END - PORT_RANGE_START + 1} ports exhausted on server ${serverId}`
        );
        return null;
      }

      // Insert the allocation — may fail with unique constraint if a concurrent
      // call allocated the same port between our read and insert.
      const [entry] = await tx
        .insert(schema.allocatedPorts)
        .values({ serverId, port, cubeId, purpose })
        .returning();

      return entry;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.message.includes("unique") || err.message.includes("duplicate"))
      ) {
        continue; // retry with fresh port list
      }
      throw err;
    }
  }

  console.error(
    `[allocatePort] all ${MAX_RETRIES} retries exhausted for server ${serverId} cube ${cubeId} — concurrent allocation conflicts`
  );
  return null; // all retries exhausted
}

/**
 * Free an allocated port by its ID.
 */
export async function freePort(tx: Tx, portId: string): Promise<void> {
  await tx
    .delete(schema.allocatedPorts)
    .where(eq(schema.allocatedPorts.id, portId));
}

/**
 * Free all allocated ports for a cube.
 */
export async function freePortsByCube(tx: Tx, cubeId: string): Promise<void> {
  await tx
    .delete(schema.allocatedPorts)
    .where(eq(schema.allocatedPorts.cubeId, cubeId));
}

/**
 * Find the cube's SSH host-port allocation ON A SPECIFIC server.
 *
 * `bootCube` uses this to bind the SSH iptables DNAT to the port allocated on
 * the cube's OWN host. Filtering by `serverId` (not just `cubeId`) is the guard
 * against a stranded cross-server allocation — e.g. one left behind by a failed
 * transfer — which would otherwise make the boot forward the wrong host port.
 */
export async function findSshAllocation(
  serverId: string,
  cubeId: string
): Promise<{ id: string; port: number } | null> {
  const [row] = await db
    .select({
      id: schema.allocatedPorts.id,
      port: schema.allocatedPorts.port,
    })
    .from(schema.allocatedPorts)
    .where(
      and(
        eq(schema.allocatedPorts.cubeId, cubeId),
        eq(schema.allocatedPorts.purpose, "ssh"),
        eq(schema.allocatedPorts.serverId, serverId)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Restore a cube's TCP port mappings to allocations on `sourceServerId` and free
 * its allocations on `destinationServerId`.
 *
 * cube-transfer step 8 re-points each mapping's `host_port` + `allocated_port_id`
 * to a FRESH destination allocation before the cube's `server_id` flips. If the
 * transfer then fails-before-flip or is cancelled, the cube stays on the source
 * but its mappings still reference a destination allocation — a drift
 * (`allocated_ports.server_id != cubes.server_id`) that lets a co-located cube
 * later re-grab the host port (the duplicate-host-port class). Naively deleting
 * the destination allocations is NOT safe either: `tcp_port_mappings`'
 * `allocated_port_id` is `onDelete: cascade`, so it would cascade-delete the
 * mapping and leave the cube with no SSH endpoint.
 *
 * This re-points every mapping whose CURRENT allocation is on the destination
 * back to a SOURCE allocation FIRST — reusing the cube's existing, now-orphaned
 * source allocations by purpose (transfer prunes source allocations only on the
 * success path, so on a failure they are still present) and minting a fresh one
 * via `allocatePort` only when none is free — and THEN deletes the destination
 * allocations. Afterwards every mapping's allocation lives on the source server
 * and `host_port == allocation.port`.
 *
 * MUST run inside a transaction. Idempotent: a no-op for any mapping that is
 * already backed by a source allocation (e.g. a transfer that failed before
 * step 8 ran).
 */
export async function revertMappingsToSourceServer(
  tx: Tx,
  cubeId: string,
  sourceServerId: string,
  destinationServerId: string
): Promise<void> {
  // Each mapping joined to the server its CURRENT allocation lives on.
  const rows = await tx
    .select({
      mappingId: schema.tcpPortMappings.id,
      isSsh: schema.tcpPortMappings.isSsh,
      allocId: schema.allocatedPorts.id,
      allocServerId: schema.allocatedPorts.serverId,
    })
    .from(schema.tcpPortMappings)
    .innerJoin(
      schema.allocatedPorts,
      eq(schema.allocatedPorts.id, schema.tcpPortMappings.allocatedPortId)
    )
    .where(eq(schema.tcpPortMappings.cubeId, cubeId));

  const onDestination = rows.filter(
    (r) => r.allocServerId === destinationServerId
  );

  if (onDestination.length > 0) {
    // The cube's source allocations (still present — pruned only on the
    // transfer success path). Lock them so no concurrent allocator on the
    // source races our re-point + the `allocatePort` fallback below.
    const sourceAllocs = await tx
      .select({
        id: schema.allocatedPorts.id,
        port: schema.allocatedPorts.port,
        purpose: schema.allocatedPorts.purpose,
      })
      .from(schema.allocatedPorts)
      .where(
        and(
          eq(schema.allocatedPorts.cubeId, cubeId),
          eq(schema.allocatedPorts.serverId, sourceServerId)
        )
      )
      .for("update");

    // Pool of source allocations NOT already referenced by a mapping, keyed by
    // purpose, so re-points reuse the cube's original ports where possible.
    const referenced = new Set(
      rows
        .filter((r) => r.allocServerId === sourceServerId)
        .map((r) => r.allocId)
    );
    const freeByPurpose = new Map<string, { id: string; port: number }[]>();
    for (const a of sourceAllocs) {
      if (referenced.has(a.id)) {
        continue;
      }
      const list = freeByPurpose.get(a.purpose) ?? [];
      list.push({ id: a.id, port: a.port });
      freeByPurpose.set(a.purpose, list);
    }

    for (const m of onDestination) {
      const purpose = m.isSsh ? "ssh" : "tcp";
      const reuse = freeByPurpose.get(purpose)?.shift();
      let target: { id: string; port: number };
      if (reuse) {
        target = reuse;
      } else {
        // No spare source allocation — mint a fresh one on the source server.
        const fresh = await allocatePort(tx, sourceServerId, cubeId, purpose);
        if (!fresh) {
          throw new Error(
            `revertMappingsToSourceServer: no free port on source server ${sourceServerId} for cube ${cubeId}`
          );
        }
        target = { id: fresh.id, port: fresh.port };
      }
      await tx
        .update(schema.tcpPortMappings)
        .set({
          hostPort: target.port,
          allocatedPortId: target.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.tcpPortMappings.id, m.mappingId));
    }
  }

  // Safe now: no mapping references a destination allocation, so the delete
  // can't cascade a mapping away.
  await tx
    .delete(schema.allocatedPorts)
    .where(
      and(
        eq(schema.allocatedPorts.cubeId, cubeId),
        eq(schema.allocatedPorts.serverId, destinationServerId)
      )
    );
}

/**
 * Port range constants (for use in Orbit admin UI).
 */
export const PORT_RANGE = {
  start: PORT_RANGE_START,
  end: PORT_RANGE_END,
  total: PORT_RANGE_END - PORT_RANGE_START + 1,
} as const;
