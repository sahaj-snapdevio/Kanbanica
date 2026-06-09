/**
 * One-off: install the krova-cpu-perf governor unit (performance governor +
 * turbo) on every active server. New servers get it during the install phase;
 * this retrofits existing ones (2026-06-02 audit C1). Idempotent — safe to
 * re-run. Without it the host inherits the distro default governor, which can
 * park cores near base clock so cubes never reach turbo even with BIOS turbo on.
 *
 * Run: pnpm install:cpu-governor
 */

import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main(): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers } = await import("@/db/schema");
  const { connectToServer, execCommand } = await import("@/lib/ssh");
  const { cpuPerformanceScript } = await import(
    "@/lib/worker/handlers/server-install"
  );

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Installing CPU performance governor on ${rows.length} active server(s)...`
  );
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const result = await execCommand(
          client,
          cpuPerformanceScript(),
          30_000
        );
        if (result.exitCode === 0) {
          const gov = await execCommand(
            client,
            "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo none",
            10_000
          );
          console.log(`  ok ${row.hostname} (governor=${gov.stdout.trim()})`);
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
  console.error("Retrofit failed:", err);
  process.exit(1);
});
