/**
 * Backfill per-server NUMA topology (servers.numa_node_count / numa_topology)
 * onto existing active servers — they were bootstrapped before the L2 topology
 * detection landed, so their topology columns are at the default (count 1, null).
 *
 * Read-only on the host (just reads /sys/devices/system/node/*); writes only the
 * DB row. Idempotent + active-host-safe — touches no cube. New servers get this
 * in the bootstrap phase; this is the one-shot retrofit for the existing fleet.
 *
 * Run: pnpm install:numa-detect
 */

import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

// One line per NUMA node: "<node>\t<cpulist>". No node* dirs (non-NUMA kernel)
// → empty → single-socket no-op.
const PROBE = `for n in /sys/devices/system/node/node[0-9]*; do [ -d "$n" ] && printf '%s\\t%s\\n' "$(basename "$n" | tr -dc 0-9)" "$(cat "$n/cpulist")"; done`;

async function main(): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers } = await import("@/db/schema");
  const { connectToServer, execCommand } = await import("@/lib/ssh");
  const { parseNumaCpulists } = await import("@/lib/server/numa");

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(`Detecting NUMA topology on ${rows.length} active server(s)...`);
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const res = await execCommand(client, PROBE, 5000);
        const topo = parseNumaCpulists(res.stdout);
        const count = Math.max(1, topo.length);
        await db
          .update(servers)
          .set({
            numaNodeCount: count,
            numaTopology: topo.length > 0 ? topo : null,
            updatedAt: new Date(),
          })
          .where(eq(servers.id, row.id));
        console.log(
          `  ok ${row.hostname} — ${count} node(s)${
            count > 1
              ? ` (${topo.map((t) => `n${t.node}:${t.cpus.length}cpu`).join(" ")})`
              : " (single-socket → L2 no-op)"
          }`
        );
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
  console.error("NUMA detect failed:", err);
  process.exit(1);
});
