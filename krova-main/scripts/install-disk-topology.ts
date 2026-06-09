/**
 * Backfill per-server disk topology (servers.disk_topology) onto existing active
 * servers — they were bootstrapped before the disk-I/O detection landed, so the
 * column is null. The parsed topology drives the hardware-ADAPTIVE disk tuning
 * (SATA-SSD vs NVMe scheduler + QoS caps, device NUMA node for backing placement).
 *
 * Read-only on the host (`lsblk` + `cat /sys/block/*`); writes only the DB row.
 * Idempotent + active-host-safe — touches no cube. New servers get this in the
 * bootstrap phase; this is the one-shot retrofit for the existing fleet.
 * Operator-run per Rule 60 — the agent prepares this command, the operator runs it.
 *
 * Pass a hostname to probe a SINGLE active server first (read-only, so this is
 * low-risk either way).
 *
 * Run: pnpm install:disk-topology [hostname]
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
  const { DISK_TOPOLOGY_PROBE, parseDiskTopology } = await import(
    "@/lib/server/disk-topology"
  );

  const targetHost = process.argv[2]?.trim();
  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
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
      ? `Detecting disk topology on "${targetHost}" only...`
      : `Detecting disk topology on ${rows.length} active server(s)...`
  );
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const res = await execCommand(client, DISK_TOPOLOGY_PROBE, 5000);
        const topo = parseDiskTopology(res.stdout);
        await db
          .update(servers)
          .set({
            diskTopology: topo.length > 0 ? topo : null,
            updatedAt: new Date(),
          })
          .where(eq(servers.id, row.id));
        console.log(
          `  ok ${row.hostname} — ${topo.length} disk(s)${
            topo.length > 0
              ? ` (${topo
                  .map(
                    (d) =>
                      `${d.device}:${d.nvme ? "nvme" : d.rotational ? "hdd" : "ssd"}`
                  )
                  .join(" ")})`
              : " (no physical disks detected → base/no-op tuning)"
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
  console.error("Disk topology detect failed:", err);
  process.exit(1);
});
