/**
 * One-off: apply the host disk-I/O tuning (byte-based dirty-page caps, mdadm
 * scrub throttle, adaptive mq-deadline scheduler on SATA-SSD members, weekly
 * fstrim.timer) to every active server. New servers get it during the install
 * phase when DISK_HOST_TUNING_ENABLED is on; this retrofits existing ones.
 *
 * Active-host-safe + idempotent — sysctl + udev apply live (no reboot, no cube
 * restart). Reuses the SAME exported builder as server-install (Rule 14). The
 * flag DISK_HOST_TUNING_ENABLED gates whether the install phase runs it on new
 * hosts; THIS retrofit applies it regardless (so the operator can prep the fleet
 * before flipping the flag — the writes themselves are inert defaults that only
 * help). Operator-run per Rule 60.
 *
 * CANARY ONE SERVER FIRST: pass a hostname to apply to a SINGLE active server
 * (recommended — verify on one host, then run fleet-wide). This is per-HOST
 * tuning, so it affects every cube on that host; the smallest safe scope is one
 * server, NOT one cube.
 *
 * Run: pnpm install:disk-tuning [hostname]
 *   pnpm install:disk-tuning banana   # one server first
 *   pnpm install:disk-tuning          # all active servers
 */

import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main(): Promise<void> {
  const { and, eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers } = await import("@/db/schema");
  const { connectToServer, execCommand } = await import("@/lib/ssh");
  const { diskHostTuningScript } = await import(
    "@/lib/worker/handlers/server-install"
  );

  const targetHost = process.argv[2]?.trim();
  const rows = await db
    .select({
      id: servers.id,
      hostname: servers.hostname,
      diskWriteMbps: servers.diskWriteMbps,
    })
    .from(servers)
    .where(
      targetHost
        ? and(eq(servers.status, "active"), eq(servers.hostname, targetHost))
        : eq(servers.status, "active")
    );

  if (targetHost && rows.length === 0) {
    console.error(
      `No ACTIVE server named "${targetHost}". Check the hostname (Orbit → Servers).`
    );
    process.exit(1);
  }
  console.log(
    targetHost
      ? `Applying disk I/O tuning on "${targetHost}" only...`
      : `Applying disk I/O tuning on ${rows.length} active server(s)...`
  );
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        // NEVER benchmark here — this runs on LIVE hosts (contention would
        // under-report + disturb cubes). Use the measurement taken at install
        // (clean host) if present; otherwise the script falls back to per-class.
        const result = await execCommand(
          client,
          diskHostTuningScript(row.diskWriteMbps),
          30_000
        );
        if (result.exitCode === 0) {
          const check = await execCommand(
            client,
            "echo dirty_bytes=$(cat /proc/sys/vm/dirty_bytes) raid_max=$(cat /proc/sys/dev/raid/speed_limit_max 2>/dev/null || echo n/a)",
            10_000
          );
          const basis = row.diskWriteMbps
            ? `measured ${row.diskWriteMbps} MB/s`
            : "per-class heuristic";
          console.log(
            `  ok ${row.hostname} [${basis}] (${check.stdout.trim()})`
          );
        } else {
          console.error(
            `  x ${row.hostname}: exit ${result.exitCode} ${result.stderr.slice(-300)}`
          );
        }
      } finally {
        client.end();
      }
    } catch (err) {
      console.error(
        `  x ${row.hostname}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Disk tuning retrofit failed:", err);
  process.exit(1);
});
