/**
 * Operator-initiated Caddy package upgrade on an active server.
 *
 * Upgrades the Caddy package to the
 * platform-pinned CADDY_VERSION and restarts the service. The `--resume`
 * systemd override (installed by the `install` setup phase) reloads
 * autosave.json on restart, so all `srv0` routes survive — no routing
 * reconcile is needed.
 *
 * Idempotent (Rule 7): re-running on a server already at CADDY_VERSION is a
 * no-op upgrade and the version verification still passes.
 *
 * What this handler does NOT do:
 *   - Reboot the server or restart any Cubes.
 *   - Change setupPhase / setupStatus (the server stays active).
 *   - Touch Caddy routes, DNS, or the Origin CA cert — only the binary.
 */

import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { CADDY_VERSION } from "@/config/platform";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { execCommand } from "@/lib/ssh/exec";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerUpdateCaddyPayload } from "@/lib/worker/job-types";

/**
 * Cross-distro Caddy upgrade script, base64-piped to remote bash so the
 * multi-line if/elif/fi survives ssh2's exec verbatim. Debian/Ubuntu:
 * unhold -> update -> --only-upgrade to the exact pinned version -> re-hold.
 * RHEL family: `dnf/yum upgrade caddy` (the @caddy/caddy COPR keeps only the
 * latest build, so no exact pin is possible there).
 */
function caddyUpgradeScript(): string {
  const script = `set -e
echo "Caddy upgrade — target version: ${CADDY_VERSION}"
if command -v apt-get >/dev/null 2>&1; then
  apt-mark unhold caddy || true
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --only-upgrade caddy=${CADDY_VERSION}
  apt-mark hold caddy
elif command -v dnf >/dev/null 2>&1; then
  dnf upgrade -y caddy
elif command -v yum >/dev/null 2>&1; then
  yum upgrade -y caddy
else
  echo 'Unsupported distro: no apt-get/dnf/yum found' >&2
  exit 1
fi
systemctl restart caddy
`;
  const b64 = Buffer.from(script).toString("base64");
  return `echo '${b64}' | base64 -d | bash`;
}

async function runHandler(job: Job<ServerUpdateCaddyPayload>): Promise<void> {
  const { serverId } = job.data;
  const log = new JobLogger(job.id, "server.update-caddy", "server", serverId);
  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    await log.info(`Caddy upgrade started — target ${CADDY_VERSION}`);

    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // Re-guard the phase — state may have changed between enqueue and run.
    if (server.setupPhase !== "ready") {
      throw new Error(
        `Server "${server.hostname}" is not ready (setupPhase=${server.setupPhase}) — Caddy upgrade is only available on fully-setup servers`
      );
    }

    const conn = await connectToServer(serverId);
    client = conn.client;

    // Upgrade the Caddy package + restart the service.
    await log.step(`Upgrade Caddy to ${CADDY_VERSION}`, async () => {
      const r = await execCommand(client!, caddyUpgradeScript(), 600_000);
      if (r.exitCode !== 0) {
        throw new Error(
          `Caddy upgrade script failed (exit ${r.exitCode}): ${(
            r.stderr || r.stdout || ""
          ).slice(0, 500)}`
        );
      }
    });

    // Step 3: verify the service is active and reports the target version.
    let installed: string | null = null;
    await log.step("Verify Caddy version", async () => {
      await execCommand(client!, "sleep 2", 10_000);
      const active = await execCommand(
        client!,
        "systemctl is-active --quiet caddy && echo active || echo inactive",
        10_000
      );
      if (active.stdout.trim() !== "active") {
        throw new Error("Caddy service is not active after the upgrade");
      }
      const ver = await execCommand(
        client!,
        "caddy version 2>&1 | head -1",
        10_000
      );
      const m = ver.stdout.trim().match(/v?[\d.]+/);
      installed = m ? m[0].replace(/^v/, "") : null;
      if (installed !== CADDY_VERSION) {
        throw new Error(
          `Caddy version mismatch after upgrade: expected ${CADDY_VERSION}, got ${
            installed ?? "unparseable output"
          }`
        );
      }
    });

    await log.info(`Caddy upgrade complete — now running ${installed}`);

    audit({
      action: "server.caddy_updated",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Caddy upgraded to ${installed} on "${server.hostname}"`,
      metadata: { version: installed },
      source: "worker",
    });

    await triggerEvent(`private-server-${serverId}`, "caddy.updated", {
      serverId,
      version: installed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server-update-caddy] failed for ${serverId}:`, err);
    await log.error(`Caddy upgrade failed: ${msg}`);
    audit({
      action: "server.caddy_update_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Caddy upgrade failed: ${msg.slice(0, 200)}`,
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

export async function handleServerUpdateCaddy(
  jobs: Job<ServerUpdateCaddyPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
