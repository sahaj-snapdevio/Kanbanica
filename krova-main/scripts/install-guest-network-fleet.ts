/**
 * Retrofit the v4-first / fast-fail `/etc/resolv.conf` and the `IPv6AcceptRA=no`
 * systemd-networkd unit into the IN-GUEST rootfs of every currently-running cube
 * across every active server, in place, over the vsock `exec` channel. Mirrors
 * scripts/install-unattended-upgrades-fleet.ts.
 *
 * Why this exists:
 *   The guest network files (`buildGuestNetworkFiles`) are written ONLY into an
 *   offline loop-mounted rootfs at provision/transfer/restore, so editing the
 *   builder + rebuilding images reaches only NEW or COLD-restarted cubes. This
 *   patches the RUNNING guest of existing cubes so the DNS fast-fail takes
 *   effect immediately on the live fleet.
 *
 * ZERO live-link touch — the safety guarantee for running customer cubes:
 *   The per-cube work lives in `retrofitCubeGuestNetwork` (lib/ssh/guest-network-
 *   retrofit.ts), which writes exactly TWO files and runs NO `networkctl reload`,
 *   NO `systemctl restart`, and NO `ip link` — proven by lib/ssh/guest-network-
 *   retrofit.test.ts. So this can never drop eth0 or kill an active SSH /
 *   TCP-mapped / browser-terminal session. `/etc/resolv.conf` is re-read by
 *   glibc on the next lookup (the DNS fast-fail symptom fix is live at once),
 *   while `10-eth0.network` (`IPv6AcceptRA=no`) applies on the cube's NEXT cold
 *   restart, ending the v6 flap then.
 *
 * Idempotent: skips a cube whose live `/etc/resolv.conf` already matches the
 * target; --force re-writes. Per-server SSH concurrency capped at 5.
 * transferState='idle' filter so a write never races a cube.transfer rsync of
 * the same rootfs.
 *
 * Run: pnpm install:guest-network [--force]
 */

import { existsSync } from "fs";
import type { Client } from "ssh2";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const PER_SERVER_CONCURRENCY = 5;

async function main(): Promise<void> {
  const { eq, and, isNotNull } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers, cubes } = await import("@/db/schema");
  const { connectToServer, guestExec } = await import("@/lib/ssh");
  const { retrofitCubeGuestNetwork } = await import(
    "@/lib/ssh/guest-network-retrofit"
  );

  const force = process.argv.includes("--force");

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
        .select({
          id: cubes.id,
          name: cubes.name,
          internalIp: cubes.internalIp,
        })
        .from(cubes)
        .where(
          and(
            eq(cubes.serverId, server.id),
            eq(cubes.status, "running"),
            eq(cubes.transferState, "idle"),
            isNotNull(cubes.internalIp)
          )
        );

      console.log(`  ${serverCubes.length} running cube(s)`);
      totalCubes += serverCubes.length;

      for (let i = 0; i < serverCubes.length; i += PER_SERVER_CONCURRENCY) {
        const batch = serverCubes.slice(i, i + PER_SERVER_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((cube) =>
            retrofitCubeGuestNetwork(client, cube, force, guestExec)
          )
        );

        for (let j = 0; j < results.length; j++) {
          const cube = batch[j];
          const r = results[j];
          if (r.status === "fulfilled") {
            if (r.value === "skipped") {
              skipped++;
              console.log(`  · ${cube.name} — already current`);
            } else {
              updated++;
              console.log(
                `  ↑ ${cube.name} — resolv.conf (live) + 10-eth0.network (next cold boot)`
              );
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

main().catch((err) => {
  console.error("Guest-network retrofit failed:", err);
  process.exit(1);
});
