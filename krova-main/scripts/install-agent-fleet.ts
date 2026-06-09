/**
 * One-off: in-place upgrade of the in-guest `krova-agent` Python script
 * on every currently-running cube across every active server.
 *
 * Why this exists:
 *   The agent script lives at `/usr/local/bin/krova-agent` inside each
 *   cube's rootfs. Rootfs files are copied per-cube at provision time
 *   to `/var/lib/krova/cubes/<id>/rootfs.ext4` and are effectively
 *   immutable for the cube's lifetime — so a new agent baked into the
 *   platform rootfs (via `pnpm build:images`) does NOT reach existing
 *   cubes even after `Update Images` + cold restart. This script bridges
 *   that gap.
 *
 * How it works:
 *   For each running cube, we use the EXISTING vsock `exec` verb (which
 *   the old agent already understands) to:
 *     1. Write the new agent bytes (base64-decoded inside the cube) to a
 *        sibling path `/usr/local/bin/krova-agent.new`.
 *     2. chmod +x.
 *     3. Atomic `mv` into place.
 *     4. Backgrounded `systemctl restart krova-agent` after a 500ms sleep
 *        so the vsock response to step 1-3 flushes before the agent
 *        process is killed.
 *
 * Safety properties:
 *   - Idempotent: probes `{"cmd":"metrics"}` (a new verb the old agent
 *     does not have) before doing anything. Cubes that already have the
 *     new agent return ok and are skipped.
 *   - Non-destructive: replaces one file + restarts one systemd unit.
 *     Customer data, the rootfs file on disk, the kernel, sshd, network
 *     and authorized_keys are untouched. Customer SSH sessions are not
 *     interrupted — sshd is a separate process.
 *   - Atomic file swap (write-to-temp + mv) — no half-written file risk
 *     even if the cube is mid-OOM.
 *   - Per-server SSH concurrency capped at 5 to stay well below sshd's
 *     default `MaxSessions=10`.
 *   - Verified — after restart, re-probes `{"cmd":"metrics"}` to confirm
 *     the new agent answered. Cubes whose verify fails are reported and
 *     do not block the rest of the fleet.
 *
 * Known follow-up:
 *   This patches the RUNNING agent. The cube's rootfs file on disk still
 *   has the OLD script baked in, so a future cold-restart (Power Off +
 *   Start) of the cube would revert to the old agent. The proper fix is
 *   per-cube rootfs rebake at next cold-boot, or have the reachability
 *   cron auto-re-inject when it detects a downgraded agent — both are
 *   out of scope for this script.
 *
 * Run: pnpm install:agent-fleet
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Client } from "ssh2";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const AGENT_SOURCE_PATH = join(process.cwd(), "setup/images/krova-agent");
const PER_SERVER_CONCURRENCY = 5;
const PROBE_TIMEOUT_MS = 8000;
const INJECT_TIMEOUT_MS = 15_000;
const POST_RESTART_VERIFY_DELAY_MS = 3000;

type Outcome = "skipped" | "updated" | "failed";

async function main(): Promise<void> {
  const { eq, and } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers, cubes } = await import("@/db/schema");
  const { connectToServer, guestExec, guestMetrics } = await import(
    "@/lib/ssh"
  );

  // `--force` bypasses the metrics-verb idempotency probe and re-injects
  // the agent into every cube. Required when the agent source changes
  // in a way that the probe can't distinguish from the previous
  // already-injected version (e.g., a fix to PTY behavior, a new env
  // var, the chdir($HOME) cosmetic). The default mode (no flag) keeps
  // the idempotent skip-if-metrics-works behavior so casual re-runs
  // don't churn every cube's agent systemd unit.
  const force = process.argv.includes("--force");

  if (!existsSync(AGENT_SOURCE_PATH)) {
    console.error(`✗ Agent source not found at ${AGENT_SOURCE_PATH}`);
    process.exit(1);
  }

  const agentSource = readFileSync(AGENT_SOURCE_PATH, "utf-8");
  const agentB64 = Buffer.from(agentSource, "utf-8").toString("base64");
  console.log(
    `Agent source: ${agentSource.length} bytes (${agentB64.length} bytes base64)${force ? " — FORCE mode (skipping idempotency probe)" : ""}`
  );

  const activeServers = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(`Found ${activeServers.length} active server(s)\n`);

  let totalCubes = 0;
  let skipped = 0;
  let updated = 0;
  let failed = 0;

  for (const server of activeServers) {
    console.log(`== ${server.hostname} ==`);

    let client: Client;
    try {
      const conn = await connectToServer(server.id);
      client = conn.client;
    } catch (err) {
      console.error(
        `  ✗ SSH connect failed: ${err instanceof Error ? err.message : err}`
      );
      failed++;
      continue;
    }

    try {
      const serverCubes = await db
        .select({ id: cubes.id, name: cubes.name })
        .from(cubes)
        .where(and(eq(cubes.serverId, server.id), eq(cubes.status, "running")));

      console.log(`  ${serverCubes.length} running cube(s)`);
      totalCubes += serverCubes.length;

      for (let i = 0; i < serverCubes.length; i += PER_SERVER_CONCURRENCY) {
        const batch = serverCubes.slice(i, i + PER_SERVER_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((cube) =>
            processCube(client, cube, agentB64, force, {
              guestExec,
              guestMetrics,
            })
          )
        );

        for (let j = 0; j < results.length; j++) {
          const cube = batch[j];
          const r = results[j];
          if (r.status === "fulfilled") {
            if (r.value === "skipped") {
              skipped++;
              console.log(`  · ${cube.name} — already up-to-date`);
            } else if (r.value === "updated") {
              updated++;
              console.log(`  ↑ ${cube.name} — agent upgraded`);
            } else {
              failed++;
              console.log(`  ✗ ${cube.name} — verification failed`);
            }
          } else {
            failed++;
            const msg =
              r.reason instanceof Error ? r.reason.message : String(r.reason);
            console.log(`  ✗ ${cube.name} — ${msg}`);
          }
        }
      }
    } finally {
      client.end();
    }

    console.log("");
  }

  console.log(
    `Done — ${totalCubes} cube(s) total: ${skipped} skipped, ${updated} updated, ${failed} failed`
  );
  process.exit(failed === 0 ? 0 : 1);
}

type SshHelpers = {
  guestExec: typeof import("@/lib/ssh").guestExec;
  guestMetrics: typeof import("@/lib/ssh").guestMetrics;
};

async function processCube(
  client: Client,
  cube: { id: string; name: string },
  agentB64: string,
  force: boolean,
  ssh: SshHelpers
): Promise<Outcome> {
  // 1. Probe with `metrics` — a verb the original agent does NOT know.
  //    A successful response means the cube already has at least the
  //    metrics+pty-aware agent. We skip in default mode; in --force
  //    mode we re-inject regardless (used when the agent source has
  //    changed in a way that's not detectable from the metrics probe,
  //    e.g., a PTY behaviour fix). Note: this probe can't distinguish
  //    between "old metrics-aware agent" and "latest agent" — that
  //    would require a version verb the agent doesn't currently
  //    expose. Until then, --force is the explicit upgrade switch.
  if (!force) {
    const probe = await withTimeout(
      ssh.guestMetrics(client, cube.id),
      PROBE_TIMEOUT_MS,
      null
    );
    if (probe !== null) {
      return "skipped";
    }
  }

  // 2. Inject the new agent. The shell command:
  //      a. base64-decodes the agent bytes into /usr/local/bin/krova-agent.new
  //      b. chmod +x
  //      c. atomic mv into the canonical path
  //      d. backgrounds a `sleep 0.5 && systemctl restart krova-agent` so the
  //         agent's response to THIS exec call flushes over vsock before
  //         systemd kills the process
  //      e. echoes "INJECTED" so we can detect partial-failure (file write
  //         or chmod fails) vs. agent-restart-killed-the-response
  const injectCmd =
    `echo '${agentB64}' | base64 -d > /usr/local/bin/krova-agent.new && ` +
    "chmod +x /usr/local/bin/krova-agent.new && " +
    "mv /usr/local/bin/krova-agent.new /usr/local/bin/krova-agent && " +
    "(sleep 0.5 && nohup systemctl restart krova-agent >/dev/null 2>&1 </dev/null &) && " +
    "echo INJECTED";

  // The vsock-exec call may return cleanly with stdout containing
  // "INJECTED", OR it may throw because systemd killed the agent before
  // the response could be sent. Either is acceptable — we verify by
  // re-probing after the restart window.
  try {
    const result = await ssh.guestExec(
      client,
      cube.id,
      injectCmd,
      INJECT_TIMEOUT_MS
    );
    if (result.exitCode !== 0 && !result.stdout.includes("INJECTED")) {
      // The file-write / chmod / mv portion itself errored, before the
      // restart even ran. Verifying would just confirm the old agent is
      // still there.
      return "failed";
    }
  } catch {
    // Agent likely got SIGTERM'd mid-response. The shell command sequence
    // had already completed the file swap by then (the backgrounded sleep
    // runs LAST), so we still try to verify.
  }

  // 3. Verify. Give systemd ~3s to bring the new agent back up, then
  //    probe with `metrics` again. If the new agent answers, the upgrade
  //    landed.
  await sleep(POST_RESTART_VERIFY_DELAY_MS);
  const verify = await withTimeout(
    ssh.guestMetrics(client, cube.id),
    PROBE_TIMEOUT_MS,
    null
  );
  return verify === null ? "failed" : "updated";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(fallback);
    }, ms);
    promise
      .then((v) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(v);
      })
      .catch(() => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

main().catch((err) => {
  console.error("Retrofit failed:", err);
  process.exit(1);
});
