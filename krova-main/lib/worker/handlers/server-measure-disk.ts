/**
 * Hourly disk-overhead measurement.
 *
 * Krova sells disk 1:1 with the host and never oversells (Rule 53). Cube
 * placement reserves the full `diskLimitGb` per cube and caps total
 * reservations at the server's EFFECTIVE capacity:
 *
 *     effective capacity = totalDiskGb − overheadDiskGb
 *
 * `totalDiskGb` is the whole root partition (measured once at bootstrap). But
 * the partition also holds non-cube data the allocator must respect: the OS,
 * the swap file (4–32 GB), the kernel + rootfs images under
 * /var/lib/krova/images, the restic cache, /tmp snapshot/export staging, and
 * logs. If reservations were allowed to fill the whole partition, that
 * overhead would push real usage past 100% once customers filled their disks.
 *
 * This cron measures the overhead per active host every hour:
 *
 *     overheadDiskGb = max(0, df_used(/) − du(/var/lib/krova/cubes))
 *
 * Both sides are counted in 1-GB blocks of ACTUAL disk usage (not apparent
 * size) so a sparse rootfs is measured the same way `df` sees it — and
 * subtracting the cube footprint leaves exactly the non-cube overhead. The
 * value is written to `servers.overhead_disk_gb`, which
 * `lib/server/disk-capacity.ts` subtracts from `totalDiskGb` for every
 * placement decision.
 *
 * Pure observer of capacity — it never transitions cube state, never touches
 * the `allocated*` counters, never reboots. Like the other periodic system
 * crons it stays quiet (no per-tick JobLogger / audit); it audits ONLY the
 * meaningful signal: a host whose existing reservations now exceed its
 * freshly-measured effective capacity (new placements are already blocked by
 * `serverHasDiskRoom`, but pre-existing reservations on a host whose overhead
 * grew warrant an operator look).
 *
 * Unreachable hosts are skipped this tick (no value written, prior measurement
 * retained) and retried next hour.
 */

import { eq } from "drizzle-orm";
import { servers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { effectiveDiskCapacityGb } from "@/lib/server/disk-capacity";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { execCommand } from "@/lib/ssh/exec";

/** Max concurrent SSH connections — same batch size as cube.state-sync / server.reconcile. */
const BATCH_SIZE = 10;

export async function handleServerMeasureDisk(): Promise<void> {
  const activeServers = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  for (let i = 0; i < activeServers.length; i += BATCH_SIZE) {
    const batch = activeServers.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (s) => {
        try {
          await measureServerDisk(s.id, s.hostname);
        } catch (err) {
          console.error(`[server-measure-disk] failed for ${s.hostname}:`, err);
        }
      })
    );
  }
}

async function measureServerDisk(
  serverId: string,
  hostname: string
): Promise<void> {
  let conn: Awaited<ReturnType<typeof connectToServer>>;
  try {
    conn = await connectToServer(serverId);
  } catch (err) {
    // Host unreachable this tick — keep the prior measurement, retry next hour.
    console.warn(
      `[server-measure-disk] cannot connect to ${hostname}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return;
  }

  const { server, client } = conn;
  try {
    // Real used GB on the root partition (where /var/lib/krova lives — same
    // partition bootstrap measured for totalDiskGb).
    const usedRes = await execCommand(
      client,
      "df -B1G --output=used / | awk 'NR==2 {print $1}'",
      10_000
    );
    // Actual cube footprint in 1-GB blocks. `du` defaults to disk usage (not
    // --apparent-size), so a sparse rootfs is counted as the blocks it really
    // occupies — matching how df counts it. `|| echo 0` covers a host with no
    // cubes dir yet.
    const cubeRes = await execCommand(
      client,
      "du -s -B1G /var/lib/krova/cubes 2>/dev/null | awk '{print $1}' || echo 0",
      30_000
    );

    const usedGb = Number.parseInt(usedRes.stdout.trim(), 10);
    const cubeGbRaw = Number.parseInt(cubeRes.stdout.trim(), 10);

    if (!Number.isFinite(usedGb) || usedGb < 0) {
      console.warn(
        `[server-measure-disk] ${hostname}: unparseable df output "${usedRes.stdout.trim()}", skipping`
      );
      return;
    }
    const cubeFootprintGb =
      Number.isFinite(cubeGbRaw) && cubeGbRaw >= 0 ? cubeGbRaw : 0;
    const overheadGb = Math.max(0, usedGb - cubeFootprintGb);

    await db
      .update(servers)
      .set({
        overheadDiskGb: overheadGb,
        diskMeasuredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(servers.id, serverId));

    // Meaningful signal: existing reservations now exceed real capacity after
    // accounting for the measured overhead. New placements are already
    // blocked, but a host that drifted into over-allocation (e.g. swap grew,
    // images piled up) needs an operator's eyes.
    const effectiveCapacity = effectiveDiskCapacityGb({
      totalDiskGb: server.totalDiskGb,
      overheadDiskGb: overheadGb,
      allocatedDiskGb: server.allocatedDiskGb,
    });
    if (server.allocatedDiskGb > effectiveCapacity) {
      console.warn(
        `[server-measure-disk] ${hostname} OVER-ALLOCATED: reserved=${server.allocatedDiskGb}GB > effective=${effectiveCapacity}GB (total=${server.totalDiskGb}GB, overhead=${overheadGb}GB)`
      );
      audit({
        action: "server.disk_overcommitted",
        category: "server",
        actorType: "system",
        entityType: "server",
        entityId: serverId,
        description: `Measured disk overhead pushed "${hostname}" over capacity: ${server.allocatedDiskGb}GB reserved vs ${effectiveCapacity}GB effective (total ${server.totalDiskGb}GB − overhead ${overheadGb}GB)`,
        metadata: {
          totalDiskGb: server.totalDiskGb,
          allocatedDiskGb: server.allocatedDiskGb,
          overheadDiskGb: overheadGb,
          effectiveCapacityGb: effectiveCapacity,
        },
        source: "worker",
      });
    }
  } finally {
    try {
      client.end();
    } catch {
      /* noop */
    }
  }
}
