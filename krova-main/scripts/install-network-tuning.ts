/**
 * One-off: apply host network tuning — raised conntrack UDP timeouts (audit W2)
 * + a forwarded-TCP MSS clamp (audit W3) — on every active server, then persist
 * iptables. New servers get these in the `network` setup phase; this retrofits
 * existing ones. Idempotent + ACTIVE-HOST-SAFE: a sysctl change and an
 * idempotent `-C || -A` iptables rule never drop a live cube's connections.
 *
 * Reuses the EXACT command builders from applyHostNetworking (Rule 14) so new
 * and existing servers converge on identical bytes.
 *
 * Run: pnpm install:network-tuning
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
  const {
    conntrackTuneCommand,
    mssClampCommand,
    persistIptablesCommand,
    resolveBins,
  } = await import("@/lib/server/cube-network-host");

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Applying network tuning (conntrack + MSS clamp) on ${rows.length} active server(s)...`
  );
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const { ipt, ip6t } = await resolveBins(client);
        // conntrack timeouts → MSS clamp (both families) → persist for reboot.
        const steps: Array<[string, string]> = [
          ["conntrack", conntrackTuneCommand()],
          ["mss-v4", mssClampCommand(ipt)],
          ["mss-v6", mssClampCommand(ip6t)],
          ["persist", persistIptablesCommand()],
        ];
        let ok = true;
        for (const [label, cmd] of steps) {
          const r = await execCommand(client, cmd, 60_000);
          if (r.exitCode !== 0) {
            ok = false;
            console.error(
              `  x ${row.hostname} [${label}]: exit ${r.exitCode} ${r.stderr.slice(-200)}`
            );
            break;
          }
        }
        if (ok) {
          console.log(`  ok ${row.hostname}`);
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
