/**
 * Retrofit the `krova` cgroup-v2 parent (+ `cpu` delegation) and the
 * boot-persistent `krova-cgroup-prep` systemd oneshot onto every active server,
 * so per-cube `cpu.weight` fairness works once `CPU_CGROUP_ENABLED` is flipped on
 * (audit C2 / L1). New servers get this in the `install` phase; this is the
 * live-fleet retrofit.
 *
 * Idempotent + ACTIVE-HOST-SAFE: it only creates an EMPTY parent cgroup +
 * delegates a controller + installs an inert oneshot — it touches no running
 * cube and the dedicated `krova` parent is decoupled from the jailer's default
 * `firecracker` parent, so launches are unaffected until you flip the flag.
 *
 * Rollout order: deploy (flag off, inert) → `pnpm install:cpu-cgroup` (prep) →
 * canary one cold-booted cube → flip `CPU_CGROUP_ENABLED = true` → deploy.
 *
 * Run: pnpm install:cpu-cgroup
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
  const { cpuCgroupPrepScript } = await import("@/lib/ssh/cpu-cgroup");

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Preparing the krova cpu.weight cgroup on ${rows.length} active server(s)...`
  );
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const r = await execCommand(client, cpuCgroupPrepScript(), 30_000);
        if (r.exitCode === 0) {
          console.log(`  ok ${row.hostname} — ${r.stdout.trim().slice(-80)}`);
        } else {
          console.error(
            `  x ${row.hostname}: exit ${r.exitCode} ${r.stderr.slice(-200)}`
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
