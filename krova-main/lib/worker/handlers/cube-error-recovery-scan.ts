/**
 * cube.error-recovery-scan — every 5 min, find cubes parked in `error` that
 * are still under the attempt cap and enqueue a per-cube `cube.error-recovery`
 * job for each one whose host is currently reachable.
 *
 * Reachability is probed per-server (one lightweight TCP connect to the SSH
 * port) so a cube on a down host is simply SKIPPED this tick — no attempt is
 * burned, and it's retried next tick once the host returns. Cubes whose host
 * is reachable get a recovery job (singletonKey=cubeId so a duplicate enqueue
 * across ticks collapses to one in-flight job).
 *
 * Pure observer of `error` state — it never mutates the cube row itself; the
 * per-cube handler owns all status transitions and attempt accounting.
 */

import { and, eq, gt, isNotNull, lt } from "drizzle-orm";
import { MAX_ERROR_RECOVERY_ATTEMPTS } from "@/config/platform";
import { cubes, servers } from "@/db/schema";
import { db } from "@/lib/db";
import { subnetOf } from "@/lib/server/cube-network";
import { isServerReachable } from "@/lib/ssh";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function handleCubeErrorRecoveryScan(): Promise<void> {
  // Error cubes still under the cap, not mid-transfer, on an active server.
  const rows = await db
    .select({
      cubeId: cubes.id,
      spaceId: cubes.spaceId,
      serverId: cubes.serverId,
      internalIp: cubes.internalIp,
      bridgeSubnet: servers.bridgeSubnet,
    })
    .from(cubes)
    .innerJoin(servers, eq(cubes.serverId, servers.id))
    .where(
      and(
        eq(cubes.status, "error"),
        eq(cubes.transferState, "idle"),
        // Only revive cubes that successfully ran at least once — a cube that
        // errored during its FIRST provision has a possibly-incomplete rootfs
        // and shouldn't be auto-booted (leave it for manual handling).
        isNotNull(cubes.lastStartedAt),
        lt(cubes.errorRecoveryAttempts, MAX_ERROR_RECOVERY_ATTEMPTS),
        eq(servers.status, "active"),
        // Config-presence: a cube with no internal IP or non-positive vcpus/ram
        // can NEVER self-recover (startCube would fail on the missing config),
        // so excluding it here stops it from burning all 3 recovery attempts on
        // a doomed relaunch. It stays in `error` for manual handling (the admin
        // was already notified when it first errored).
        isNotNull(cubes.internalIp),
        gt(cubes.vcpus, 0),
        gt(cubes.ramMb, 0)
      )
    );

  if (rows.length === 0) {
    return;
  }

  // Probe each distinct server once; only enqueue for reachable hosts.
  const reachabilityByServer = new Map<string, boolean>();
  let enqueued = 0;
  let skippedUnreachable = 0;
  let skippedMidReIp = 0;

  for (const row of rows) {
    // Phase-6 re-IP safety: a cube whose internal_ip subnet no longer matches
    // its host's bridge_subnet is mid-conversion (the migration may be re-IP'ing
    // it right now, or it's a skipped paused cube left on the legacy subnet
    // pending a cold wake). Either way, racing it with a startCube here would
    // boot it on a stale IP. Skip until the subnets agree — the migration's own
    // startCube (or the cube-wake cold-convert guard) is the right path. A cube
    // with no IP (never booted) is excluded earlier by the lastStartedAt filter.
    if (row.internalIp != null && row.bridgeSubnet != null) {
      let cubeSubnet: number | null = null;
      try {
        cubeSubnet = subnetOf(row.internalIp);
      } catch {
        cubeSubnet = null;
      }
      // Skip off-scheme cubes too: subnetOf() throws (→ null) on any non-198.18
      // IP, so a legacy/garbage IP must be treated as a MISMATCH and left for
      // manual handling — auto-recovery would boot it onto stale guest
      // networking and it would come up unreachable (mirrors cube-wake's
      // fail-loud 198.18 guard). The old `!== null &&` let off-scheme cubes
      // through — the opposite of the intent.
      if (cubeSubnet === null || cubeSubnet !== row.bridgeSubnet) {
        skippedMidReIp++;
        continue;
      }
    }

    let reachable = reachabilityByServer.get(row.serverId);
    if (reachable === undefined) {
      reachable = await isServerReachable(row.serverId);
      reachabilityByServer.set(row.serverId, reachable);
    }
    if (!reachable) {
      skippedUnreachable++;
      continue;
    }

    const jobId = await enqueueJob(
      JOB_NAMES.CUBE_ERROR_RECOVERY,
      {
        cubeId: row.cubeId,
        spaceId: row.spaceId,
        serverId: row.serverId,
      },
      { singletonKey: row.cubeId }
    );
    if (jobId) {
      enqueued++;
    }
  }

  console.log(
    `[cube-error-recovery-scan] error cubes=${rows.length} enqueued=${enqueued} skipped(host down)=${skippedUnreachable} skipped(mid re-IP)=${skippedMidReIp}`
  );
}
