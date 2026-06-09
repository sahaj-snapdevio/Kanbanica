/**
 * Operator-initiated hardware-totals refresh on an active server.
 *
 * Re-runs the same `nproc` / `/proc/meminfo` / `df -B1G /` probes that the
 * `bootstrap` setup phase used to populate `servers.totalCpus` /
 * `totalRamMb` / `totalDiskGb`, then writes the fresh values. Read-only on
 * the host — no destructive commands, no reboot, no phase-state change.
 *
 * Use after an operator physically upgrades RAM, adds disk, or changes the
 * CPU on the server: the bootstrap-time totals go stale on the first
 * hardware change, which makes the `lib/server/allocate.ts` capacity check
 * either over-restrict (showing the server as full when it still has
 * headroom) or over-commit. Idempotent — safe to re-run on every operator
 * click.
 *
 * What this handler does NOT do:
 *   - Reboot the server.
 *   - Restart any running Cubes.
 *   - Change `setupPhase` or `setupStatus`.
 *   - Touch the `allocated*` counters (those reflect customer cube usage —
 *     a separate concern, refreshed via `reconcileServerResources`).
 */

import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  DISK_TOPOLOGY_PROBE,
  type DiskTopology,
  parseDiskTopology,
} from "@/lib/server/disk-topology";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { execCommand } from "@/lib/ssh/exec";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerRefreshHardwarePayload } from "@/lib/worker/job-types";

async function runHandler(
  job: Job<ServerRefreshHardwarePayload>
): Promise<void> {
  const { serverId } = job.data;
  const log = new JobLogger(
    job.id,
    "server.refresh_hardware",
    "server",
    serverId
  );
  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    await log.info("Hardware refresh started (operator-initiated)");

    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    const conn = await connectToServer(serverId);
    client = conn.client;

    let totalCpus = 0;
    let totalRamMb = 0;
    let totalDiskGb = 0;
    let diskTopology: DiskTopology = [];
    await log.step("Probe hardware totals", async () => {
      const cpuRes = await execCommand(client!, "nproc", 5000);
      const ramRes = await execCommand(
        client!,
        "awk '/^MemTotal:/ {printf \"%d\", $2/1024}' /proc/meminfo",
        5000
      );
      const diskRes = await execCommand(
        client!,
        "df -B1G --output=size / | awk 'NR==2 {print $1}'",
        5000
      );
      totalCpus = Number.parseInt(cpuRes.stdout.trim(), 10);
      totalRamMb = Number.parseInt(ramRes.stdout.trim(), 10);
      totalDiskGb = Number.parseInt(diskRes.stdout.trim(), 10);
      if (
        cpuRes.exitCode !== 0 ||
        ramRes.exitCode !== 0 ||
        diskRes.exitCode !== 0 ||
        !Number.isFinite(totalCpus) ||
        totalCpus <= 0 ||
        !Number.isFinite(totalRamMb) ||
        totalRamMb <= 0 ||
        !Number.isFinite(totalDiskGb) ||
        totalDiskGb <= 0
      ) {
        throw new Error(
          `Hardware detection failed: cpus="${cpuRes.stdout.trim()}" ram="${ramRes.stdout.trim()}" disk="${diskRes.stdout.trim()}"`
        );
      }
      // Disk topology (best-effort — informational, must NOT fail the totals
      // refresh). UNGATED (Rule 35); tolerant parser → [] on odd layouts.
      const diskTopoRes = await execCommand(client!, DISK_TOPOLOGY_PROBE, 5000);
      diskTopology = parseDiskTopology(diskTopoRes.stdout);
    });

    const before = {
      totalCpus: server.totalCpus,
      totalRamMb: server.totalRamMb,
      totalDiskGb: server.totalDiskGb,
    };
    const changed =
      before.totalCpus !== totalCpus ||
      before.totalRamMb !== totalRamMb ||
      before.totalDiskGb !== totalDiskGb;

    await db
      .update(schema.servers)
      .set({
        totalCpus,
        totalRamMb,
        totalDiskGb,
        diskTopology: diskTopology.length > 0 ? diskTopology : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.servers.id, serverId));

    const summary = changed
      ? `Hardware refreshed: ${before.totalCpus}→${totalCpus} CPUs · ${before.totalRamMb}→${totalRamMb} MB RAM · ${before.totalDiskGb}→${totalDiskGb} GB disk`
      : `Hardware unchanged: ${totalCpus} CPUs · ${totalRamMb} MB RAM · ${totalDiskGb} GB disk`;
    await log.info(summary);

    audit({
      action: "server.hardware_refreshed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Operator refreshed hardware totals on "${server.hostname}" — ${summary}`,
      metadata: {
        before,
        after: { totalCpus, totalRamMb, totalDiskGb },
        changed,
      },
      source: "worker",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server-refresh-hardware] failed for ${serverId}:`, err);
    await log.error(`Hardware refresh failed: ${msg}`);
    audit({
      action: "server.hardware_refresh_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Operator-initiated hardware refresh failed: ${msg.slice(0, 200)}`,
      metadata: { error: msg.slice(0, 1000) },
      source: "worker",
    });
  } finally {
    if (client) {
      try {
        client.end();
      } catch {
        /* noop */
      }
    }
  }
}

export async function handleServerRefreshHardware(
  jobs: Job<ServerRefreshHardwarePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
