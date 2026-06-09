/**
 * Server network phase: create the br0 bridge for Cube TAPs, then apply the
 * shared dual-stack host networking (IPv4+IPv6 forwarding, NAT66, egress-only
 * FORWARD, stateful default-deny INPUT, persistence) via `applyHostNetworking`.
 *
 * Idempotent — the bridge step is guarded, and `applyHostNetworking` is
 * `-C`/`grep`-guarded throughout. Forwarding sysctls live in their own
 * `98-krova-forwarding.conf` (never `99-krova.conf` — C2: the install phase's
 * vm-tuning file is no longer clobbered here).
 */
import type { Job } from "pg-boss";
import { audit } from "@/lib/audit";
import { applyHostNetworking } from "@/lib/server/cube-network-host";
import {
  claimPhaseRunning,
  completePhase,
  failPhase,
} from "@/lib/server/setup-phase";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { execCommand } from "@/lib/ssh/exec";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerNetworkPayload } from "@/lib/worker/job-types";

async function runHandler(job: Job<ServerNetworkPayload>): Promise<void> {
  const { serverId } = job.data;
  const phase = "network" as const;
  const claimed = await claimPhaseRunning(serverId, phase);
  if (!claimed) {
    return;
  }

  const log = new JobLogger(job.id, "server.network", "server", serverId);
  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    await log.info("Network phase started");
    const conn = await connectToServer(serverId);
    client = conn.client;

    // `bridge_subnet` is allocated at server-create (in a tx) and must be
    // non-null before the network phase runs — it is the `S` that every
    // host-side address derives from.
    if (conn.server.bridgeSubnet === null) {
      throw new Error(`server ${serverId} has no bridge_subnet`);
    }
    const bridgeSubnet = conn.server.bridgeSubnet;

    // Create the bridge itself (guarded). Addresses are NOT set here — they
    // come from applyHostNetworking, which derives the dual-stack gateway from
    // `bridge_subnet` so the host and guests can never drift.
    await log.step("br0 bridge", async () => {
      const result = await execCommand(
        client!,
        "ip link show br0 >/dev/null 2>&1 || (ip link add name br0 type bridge && ip link set br0 up)",
        10_000
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `exit ${result.exitCode}: ${result.stderr.slice(-500) || result.stdout.slice(-500)}`
        );
      }
    });

    await log.step("host networking (dual-stack + firewall)", async () => {
      await applyHostNetworking(client!, bridgeSubnet);
    });

    await log.info("Network phase complete");
    await completePhase(serverId, phase);
    audit({
      action: "server.setup.network_complete",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server ${conn.server.hostname} network configured`,
      source: "worker",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server-network] failed for ${serverId}:`, err);
    await log.error(`Network phase failed: ${msg}`);
    await failPhase(serverId, phase, msg);
    audit({
      action: "server.setup.network_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server network phase failed: ${msg.slice(0, 200)}`,
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

export async function handleServerNetwork(
  jobs: Job<ServerNetworkPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
