/**
 * One-off: retrofit the security-only unattended-upgrades policy + the tamed
 * needrestart config into the IN-GUEST rootfs of every currently-running
 * Ubuntu cube across every active server, in place, over the vsock `exec`
 * verb. Mirrors scripts/install-agent-fleet.ts.
 *
 * Why this exists:
 *   Cube rootfs files are copied per-cube at provision and are immutable
 *   thereafter, so `pnpm build:images` + Update Images only reaches NEW
 *   cubes. This patches the RUNNING guest of existing cubes. NOTE: a cube
 *   cold-restart boots from the on-disk rootfs (which still lacks the policy
 *   for pre-policy cubes), so re-run after such events.
 *
 * No-restart guarantee:
 *   The needrestart drop-in (restart=l + override_rc on krova-agent + ssh) is
 *   written FIRST, and every apt call runs with NEEDRESTART_MODE=l
 *   DEBIAN_FRONTEND=noninteractive. needrestart honors that env even on a cube
 *   whose rootfs predates the drop-in, so sshd and krova-agent are never
 *   bounced. The script issues no `systemctl restart` against either unit.
 *
 * Idempotent: skips the apt-install on cubes that already have
 * unattended-upgrades (probe via dpkg-query); --force re-runs it. Config files
 * are always (re)written — cheap overwrite, no restart.
 *
 * Run: pnpm install:unattended-upgrades [--force]
 */

import { existsSync } from "fs";
import type { Client } from "ssh2";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const PER_SERVER_CONCURRENCY = 5;
const PROBE_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 10_000;
const APT_TIMEOUT_MS = 120_000;

type Outcome = "skipped" | "updated" | "failed";

// MUST stay byte-identical to setup/images/build-all-images.sh.
const NEEDRESTART_CONF = `# Krova Cube overrides — see /etc/needrestart/needrestart.conf for full list
$nrconf{kernelhints} = 0;
$nrconf{ucodehints} = 0;
$nrconf{restart} = "l";
$nrconf{override_rc} = {
    qr(^krova-agent.*) => 0,
    qr(^ssh(d)?.*) => 0,
};
`;

const AUTO_UPGRADES_CONF = `APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
`;

const UU_KROVA_CONF = `// Krova Cube policy. Kernel is host-supplied (empty /boot) so a guest reboot
// is meaningless AND Firecracker treats it as shutdown -> auto-relaunch.
// Security-only scope is the Ubuntu package default (50unattended-upgrades).
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
`;

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

async function main(): Promise<void> {
  const { eq, and, inArray } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers, cubes } = await import("@/db/schema");
  const { connectToServer, guestExec } = await import("@/lib/ssh");
  const { CUBE_IMAGES } = await import("@/config/platform");

  const force = process.argv.includes("--force");
  const ubuntuImageIds = CUBE_IMAGES.filter((i) => i.vendor === "ubuntu").map(
    (i) => i.id
  );

  const activeServers = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Found ${activeServers.length} active server(s)${force ? " — FORCE mode" : ""}\n`
  );

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
        .where(
          and(
            eq(cubes.serverId, server.id),
            eq(cubes.status, "running"),
            eq(cubes.transferState, "idle"),
            inArray(cubes.imageId, ubuntuImageIds)
          )
        );

      console.log(`  ${serverCubes.length} running Ubuntu cube(s)`);
      totalCubes += serverCubes.length;

      for (let i = 0; i < serverCubes.length; i += PER_SERVER_CONCURRENCY) {
        const batch = serverCubes.slice(i, i + PER_SERVER_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((cube) => processCube(client, cube, force, guestExec))
        );

        for (let j = 0; j < results.length; j++) {
          const cube = batch[j];
          const r = results[j];
          if (r.status === "fulfilled") {
            if (r.value === "skipped") {
              skipped++;
              console.log(`  · ${cube.name} — already configured`);
            } else {
              updated++;
              console.log(`  ↑ ${cube.name} — unattended-upgrades configured`);
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

async function processCube(
  client: Client,
  cube: { id: string; name: string },
  force: boolean,
  guestExec: typeof import("@/lib/ssh").guestExec
): Promise<Outcome> {
  // Idempotency probe: is unattended-upgrades already installed?
  let alreadyInstalled = false;
  if (!force) {
    const probe = await guestExec(
      client,
      cube.id,
      "dpkg-query -s unattended-upgrades 2>/dev/null | grep -q '^Status: install ok installed' && echo INSTALLED || true",
      PROBE_TIMEOUT_MS
    );
    alreadyInstalled = probe.stdout.includes("INSTALLED");
  }

  // STEP 1 — needrestart protection FIRST, before any apt call.
  await guestExec(
    client,
    cube.id,
    `mkdir -p /etc/needrestart/conf.d && echo '${b64(NEEDRESTART_CONF)}' | base64 -d > /etc/needrestart/conf.d/99-krova.conf`,
    WRITE_TIMEOUT_MS
  );

  // STEP 2 — apt periodic + policy config (always (re)written, cheap).
  await guestExec(
    client,
    cube.id,
    `mkdir -p /etc/apt/apt.conf.d && echo '${b64(AUTO_UPGRADES_CONF)}' | base64 -d > /etc/apt/apt.conf.d/20auto-upgrades && echo '${b64(UU_KROVA_CONF)}' | base64 -d > /etc/apt/apt.conf.d/52unattended-upgrades-krova`,
    WRITE_TIMEOUT_MS
  );

  if (alreadyInstalled) {
    return "skipped";
  }

  // STEP 3 — install u-u. NEEDRESTART_MODE=l guarantees no service bounce even
  // on a cube whose rootfs predates the drop-in written in STEP 1.
  await guestExec(
    client,
    cube.id,
    "DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get update -qq && DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y -qq unattended-upgrades",
    APT_TIMEOUT_MS
  );

  // STEP 4 — enable the daily timers. Enabling/starting timer units does not
  // restart krova-agent or sshd.
  await guestExec(
    client,
    cube.id,
    "systemctl enable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true",
    WRITE_TIMEOUT_MS
  );

  return "updated";
}

main().catch((err) => {
  console.error("Retrofit failed:", err);
  process.exit(1);
});
