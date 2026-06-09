/**
 * Centralized server allocation logic.
 * Handles server resource reconciliation, best-fit selection, SSH port allocation,
 * and Cube record creation — inside a single transaction.
 *
 * Used by server actions and API routes. Never duplicate.
 */

import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, notInArray, sum } from "drizzle-orm";
import { NUMA_PLACEMENT_ENABLED } from "@/config/platform";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import {
  serverCpuRamCapacity,
  serverHasCpuRamRoom,
} from "@/lib/server/cpu-ram-capacity";
import { serverHasDiskRoom } from "@/lib/server/disk-capacity";
import { assignNumaNode } from "@/lib/server/numa-nodes";
import { allocatePort } from "@/lib/server/ports";

export interface AllocateServerInput {
  diskLimitGb: number;
  imageId: string;
  name: string;
  ramMb: number;
  regionId?: string; // filter servers by region
  spaceId: string;
  /** Cloud-init user_data script written into the guest rootfs at provision time. Max 16 KB. */
  userData?: string | null;
  vcpus: number;
}

export interface AllocateServerResult {
  cube: typeof schema.cubes.$inferSelect;
  serverId: string;
}

/** Drizzle transaction handle type. */
type TxHandle = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Transaction helper: reconcile server resources, find best-fit server,
 * allocate SSH port, and create Cube record.
 *
 * When `opts.tx` is provided the work runs inside that caller-supplied
 * transaction instead of opening a new one. All existing callers that
 * omit `tx` continue to work unchanged — they get their own transaction.
 */
export async function allocateServerAndCreateCube(
  input: AllocateServerInput,
  opts?: { reconcile?: boolean; throwResponse?: boolean; tx?: TxHandle }
): Promise<AllocateServerResult> {
  const reconcile = opts?.reconcile ?? true;
  const throwResponse = opts?.throwResponse ?? false;

  const cubeId = createId();

  // If a caller-supplied transaction is provided, run directly inside it.
  // Otherwise open a fresh transaction as before.
  const run = async (tx: TxHandle): Promise<AllocateServerResult> => {
    // Reconcile allocated resources from actual active Cubes
    if (reconcile) {
      await reconcileServerResources(tx);
    }

    // Find best-fit server with FOR UPDATE lock
    const serverConditions = [eq(schema.servers.status, "active")];

    if (input.regionId) {
      serverConditions.push(eq(schema.servers.regionId, input.regionId));
    }

    const candidates = await tx
      .select()
      .from(schema.servers)
      .where(and(...serverConditions))
      .orderBy(asc(schema.servers.allocatedRamMb))
      .for("update");

    if (candidates.length === 0) {
      const reason = input.regionId
        ? `No active servers found in region ${input.regionId}`
        : "No active servers found";
      console.error(`[allocate] ${reason}`);
      if (throwResponse) {
        throw Response.json({ error: reason }, { status: 422 });
      }
      throw new Error(reason);
    }

    // Find the first server with sufficient capacity (CPU, RAM, and disk)
    const server = candidates.find(
      (s) =>
        serverHasCpuRamRoom(s, input.vcpus, input.ramMb) &&
        serverHasDiskRoom(s, input.diskLimitGb)
    );

    if (!server) {
      // Log why each candidate was rejected
      for (const s of candidates) {
        const { maxCpu, maxRam } = serverCpuRamCapacity(s);
        console.error(
          `[allocate] server ${s.hostname} rejected: ` +
            `cpu=${s.allocatedCpus}+${input.vcpus}/${maxCpu}, ` +
            `ram=${s.allocatedRamMb}+${input.ramMb}/${maxRam}, ` +
            `disk=${s.allocatedDiskGb}+${input.diskLimitGb}/${s.totalDiskGb}`
        );
      }
      if (throwResponse) {
        throw Response.json(
          {
            error:
              "No server available with sufficient capacity in selected region",
          },
          { status: 422 }
        );
      }
      throw new Error(
        "No server available with sufficient capacity in selected region"
      );
    }

    const serverId = server.id;

    // Update server allocated resources
    await tx
      .update(schema.servers)
      .set({
        allocatedCpus: server.allocatedCpus + input.vcpus,
        allocatedRamMb: server.allocatedRamMb + input.ramMb,
        allocatedDiskGb: server.allocatedDiskGb + input.diskLimitGb,
        updatedAt: new Date(),
      })
      .where(eq(schema.servers.id, serverId));

    // Create Cube record first (allocated_ports has FK to cubes)
    const [newCube] = await tx
      .insert(schema.cubes)
      .values({
        id: cubeId,
        spaceId: input.spaceId,
        serverId,
        name: input.name,
        status: "pending",
        vcpus: input.vcpus,
        ramMb: input.ramMb,
        diskLimitGb: input.diskLimitGb,
        imageId: input.imageId,
        userData: input.userData ?? null,
      })
      .returning();

    // L2 (NUMA): assign the least-loaded node (persisted on the cube row); the
    // cpuset is applied at launch. Gated — a single-socket / undetected host
    // leaves numa_node null (unpinned). No-op when the flag is off.
    if (NUMA_PLACEMENT_ENABLED) {
      await assignNumaNode(tx, serverId, cubeId);
    }

    // Allocate SSH port dynamically (finds next free port in 30000–50000).
    const portEntry = await allocatePort(tx, serverId, cubeId, "ssh");
    if (!portEntry) {
      if (throwResponse) {
        throw Response.json(
          { error: "No SSH ports available on the selected server" },
          { status: 422 }
        );
      }
      throw new Error("No SSH ports available on the selected server");
    }

    // Write lifecycle log
    await tx.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: "Cube created",
    });

    return { cube: newCube, serverId };
  };

  if (opts?.tx) {
    return run(opts.tx);
  }
  return db.transaction(run);
}

/**
 * Reconcile allocated resources for one or more servers based on the actual
 * cube rows. Fixes drift caused by missed decrements (e.g. worker crash
 * during rollback) AND encodes the platform's "sleeping cubes free CPU+RAM
 * but still occupy disk" rule in one place.
 *
 * The rule:
 *   - `deleted` / `error` cubes consume nothing.
 *   - `sleeping` cubes consume disk only (the rootfs file is still on the
 *     host filesystem), NOT CPU/RAM (Firecracker is paused or killed, so
 *     the host scheduler/RAM is free for other workloads).
 *   - All other live statuses (`pending`, `booting`, `running`, `stopping`)
 *     consume CPU + RAM + disk.
 *
 * Call this after any transition that changes a cube's status to/from a
 * resource-consuming state — sleep, wake, power-off, state-sync mismatch,
 * delete, resize, transfer, failed-provision rollback. The single rule lives
 * here so callers don't need to compute deltas against the prior status.
 *
 * When `serverId` is provided, scopes the recompute to that one server
 * (cheap — single SELECT-aggregate + UPDATE). When omitted, iterates every
 * active server (use for global drift repair only).
 */
export async function reconcileServerResources(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  serverId?: string
): Promise<void> {
  const targets = serverId
    ? [{ id: serverId }]
    : await tx
        .select({ id: schema.servers.id })
        .from(schema.servers)
        .where(eq(schema.servers.status, "active"));

  for (const srv of targets) {
    // CPU + RAM exclude sleeping cubes (paused/killed Firecracker doesn't
    // hold host CPU or memory). Disk includes sleeping cubes (rootfs file
    // remains on the host filesystem).
    const [active] = await tx
      .select({
        totalVcpus: sum(schema.cubes.vcpus),
        totalRamMb: sum(schema.cubes.ramMb),
      })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.serverId, srv.id),
          notInArray(schema.cubes.status, ["deleted", "error", "sleeping"])
        )
      );

    const [disk] = await tx
      .select({ totalDiskGb: sum(schema.cubes.diskLimitGb) })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.serverId, srv.id),
          notInArray(schema.cubes.status, ["deleted", "error"])
        )
      );

    await tx
      .update(schema.servers)
      .set({
        allocatedCpus: Number(active?.totalVcpus ?? 0),
        allocatedRamMb: Number(active?.totalRamMb ?? 0),
        allocatedDiskGb: Number(disk?.totalDiskGb ?? 0),
        updatedAt: new Date(),
      })
      .where(eq(schema.servers.id, srv.id));
  }
}
