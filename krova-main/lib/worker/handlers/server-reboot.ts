/**
 * Server "reboot" setup phase: reboot the freshly-provisioned host once, between
 * `network` and `verify`, so the boot-time settings applied earlier take effect
 * AND are proven to survive a real boot — the kvm `nx_huge_pages=never`
 * modprobe.d option (only loads on kvm (re)load), the KSM-off tmpfiles rule, and
 * the bridge/iptables/Caddy persistence. The subsequent `verify` phase then runs
 * all readiness checks against the POST-reboot host, so a server can only reach
 * `ready` if its entire config genuinely survives a reboot.
 *
 * PRODUCTION SAFETY: this phase only ever runs mid-setup (a server reaches
 * setupPhase="reboot" while status="inactive", before it has ever hosted a
 * cube). It ALSO hard-refuses if the server has ANY non-deleted cube (Rule 58
 * preflight), so it is structurally impossible to reboot a host that is serving
 * customers — the failure mode the operator most wants to avoid.
 */
import { and, count, eq, ne } from "drizzle-orm";
import type { Job } from "pg-boss";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  claimPhaseRunning,
  completePhase,
  failPhase,
} from "@/lib/server/setup-phase";
import {
  connectToServer,
  isServerReachable,
} from "@/lib/ssh/connect-to-server";
import { execCommand } from "@/lib/ssh/exec";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerRebootPayload } from "@/lib/worker/job-types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Wait budgets — kept comfortably inside the queue's expireInSeconds (1200s).
const DOWN_TIMEOUT_MS = 120_000; // host should drop within 2 min of `reboot`
const UP_TIMEOUT_MS = 480_000; // host should return within 8 min
const POLL_INTERVAL_MS = 5000;
const CONNECT_RETRIES = 3;

async function readBootId(
  client: Awaited<ReturnType<typeof connectToServer>>["client"]
): Promise<string> {
  const r = await execCommand(
    client,
    "cat /proc/sys/kernel/random/boot_id",
    10_000
  );
  return r.stdout.trim();
}

async function runHandler(job: Job<ServerRebootPayload>): Promise<void> {
  const { serverId } = job.data;
  const phase = "reboot" as const;
  const claimed = await claimPhaseRunning(serverId, phase);
  if (!claimed) {
    return;
  }

  const log = new JobLogger(job.id, "server.reboot", "server", serverId);
  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    await log.info("Reboot phase started");

    // PREFLIGHT (Rule 58): never reboot a host that has cubes. A server in the
    // setup pipeline has none; this makes a serving host structurally safe.
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.serverId, serverId),
          ne(schema.cubes.status, "deleted")
        )
      );
    if (n > 0) {
      throw new Error(
        `refusing to reboot: server has ${n} non-deleted cube(s) — reboot is a setup-only phase`
      );
    }

    // Connect + record the pre-reboot boot id (proof-of-reboot baseline).
    const conn = await connectToServer(serverId);
    client = conn.client;
    const bootIdBefore = await readBootId(client);
    if (!bootIdBefore) {
      throw new Error(
        "could not read pre-reboot boot_id — refusing to reboot without a proof-of-reboot baseline"
      );
    }
    await log.info(`Pre-reboot boot_id=${bootIdBefore}`);

    // Issue the reboot backgrounded so the SSH command returns before the box
    // goes down (a foreground `reboot` would kill the channel mid-command and
    // surface as a spurious error).
    await execCommand(
      client,
      "nohup sh -c 'sleep 2; systemctl reboot' >/dev/null 2>&1 & echo reboot-scheduled",
      10_000
    ).catch(() => {
      // The channel may drop as the host begins shutting down — expected.
    });
    try {
      client.end();
    } catch {
      /* noop */
    }
    client = null;
    await log.info("Reboot issued — waiting for host to go down…");

    // Phase 1: wait for the host to become UNREACHABLE (confirms it went down).
    const downBy = Date.now() + DOWN_TIMEOUT_MS;
    let wentDown = false;
    while (Date.now() < downBy) {
      if (!(await isServerReachable(serverId, 4000))) {
        wentDown = true;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!wentDown) {
      throw new Error(
        "host did not go down within 2 min of the reboot command"
      );
    }
    await log.info("Host went down — waiting for it to come back…");

    // Phase 2: wait for the host to become REACHABLE again.
    const upBy = Date.now() + UP_TIMEOUT_MS;
    let cameUp = false;
    while (Date.now() < upBy) {
      if (await isServerReachable(serverId, 4000)) {
        cameUp = true;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!cameUp) {
      throw new Error("host did not return within 8 min after reboot");
    }
    await log.info("Host SSH port is back — reconnecting to confirm reboot…");

    // Reconnect — sshd can lag the open TCP port by a few seconds, so retry.
    let reconn: Awaited<ReturnType<typeof connectToServer>> | null = null;
    for (let i = 0; i < CONNECT_RETRIES; i++) {
      try {
        reconn = await connectToServer(serverId);
        break;
      } catch {
        await sleep(POLL_INTERVAL_MS);
      }
    }
    if (!reconn) {
      throw new Error("host returned but SSH did not become usable");
    }
    client = reconn.client;

    // Prove it actually rebooted: boot_id must change. An unchanged id means
    // the box never really cycled — fail rather than silently advance.
    const bootIdAfter = await readBootId(client);
    if (!bootIdAfter || bootIdAfter === bootIdBefore) {
      throw new Error(
        "boot_id unchanged or unreadable after reboot — host did not actually reboot"
      );
    }
    await log.info(`Post-reboot boot_id=${bootIdAfter} — reboot confirmed`);

    // Seed servers.lastBootId so reboot-recovery's boot-id check has a baseline
    // (same convention as cube.state-sync's initial seed).
    if (bootIdAfter) {
      await db
        .update(schema.servers)
        .set({ lastBootId: bootIdAfter, updatedAt: new Date() })
        .where(eq(schema.servers.id, serverId));
    }

    await log.info("Reboot phase complete");
    await completePhase(serverId, phase); // → setupPhase=verify

    audit({
      action: "server.setup.reboot_complete",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server ${conn.server.hostname} rebooted cleanly during setup`,
      source: "worker",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server-reboot] failed for ${serverId}:`, err);
    await log.error(`Reboot phase failed: ${msg}`);
    await failPhase(serverId, phase, msg);
    audit({
      action: "server.setup.reboot_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server reboot phase failed: ${msg.slice(0, 200)}`,
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

export async function handleServerReboot(
  jobs: Job<ServerRebootPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
