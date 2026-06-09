#!/usr/bin/env tsx
/**
 * One-shot diagnostic: SSH each server and report what's actually
 * installed, compared against what's pinned in config/platform.ts.
 *
 * Usage:
 *   pnpm check:server-versions                  # all servers
 *   pnpm check:server-versions <serverId|host>  # one server
 *
 * Read-only — does not write to the DB or change anything on the host.
 * Phase A's weekly cron only knows about constants in this repo; this
 * script (and the matching Orbit health-check section) closes the loop
 * by asking each running server "what do you actually have installed
 * right now?". Run after a setup phase, after `Update Images`, or any
 * time you want a sanity check.
 *
 * Both this script and the Orbit /health endpoint call into
 * `lib/security/server-versions.ts` so the two surfaces always agree.
 */

import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

import { eq, or } from "drizzle-orm";
import {
  CADDY_VERSION,
  FIRECRACKER_VERSION,
  KERNEL_VERSION,
} from "@/config/platform";
import { servers as serversTable } from "@/db/schema";
import { db } from "@/lib/db";
import {
  probeDistroPackages,
  probeServerVersions,
  type VersionRow,
  type VersionStatus,
} from "@/lib/security/server-versions";
import { connectToServer } from "@/lib/ssh/connect-to-server";

const STATUS_GLYPH: Record<VersionStatus, string> = {
  match: "✓",
  drift: "✗",
  behind: "↓",
  ahead: "↑",
  missing: "?",
  info: "·",
};

async function checkServer(serverId: string, hostname: string): Promise<void> {
  const heading = `── ${hostname} (${serverId.slice(0, 8)}) ${"─".repeat(Math.max(0, 60 - hostname.length))}`;
  console.log(`\n${heading}`);

  let conn: Awaited<ReturnType<typeof connectToServer>> | null = null;
  try {
    conn = await connectToServer(serverId);
    const pinned = await probeServerVersions(conn.client);
    const distro = await probeDistroPackages(conn.client);
    const rows: VersionRow[] = [...pinned, ...distro];

    const labelW = Math.max(...rows.map((r) => r.name.length));
    const installedW = Math.max(
      "INSTALLED".length,
      ...rows.map((r) => (r.installed ?? "—").length)
    );
    const pinnedW = Math.max(
      "PINNED".length,
      ...rows.map((r) => (r.pinned ?? "—").length)
    );
    console.log(
      `  ${"PROBE".padEnd(labelW)}  ${"INSTALLED".padEnd(installedW)}  ${"PINNED".padEnd(pinnedW)}`
    );
    console.log(`  ${"-".repeat(labelW + installedW + pinnedW + 4)}`);
    for (const r of rows) {
      console.log(
        `${STATUS_GLYPH[r.status]} ${r.name.padEnd(labelW)}  ${(r.installed ?? "—").padEnd(installedW)}  ${(r.pinned ?? "—").padEnd(pinnedW)}`
      );
    }

    const drifted = pinned.filter((r) => r.status !== "match");
    if (drifted.length > 0) {
      console.log(
        `\n${drifted.length} pinned component(s) need attention: ${drifted
          .map((r) => `${STATUS_GLYPH[r.status]} ${r.name}`)
          .join(", ")}`
      );
    } else {
      console.log(`\nAll ${pinned.length} pinned components match.`);
    }
  } catch (err) {
    console.error(
      `  ERROR: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    if (conn?.client) {
      try {
        conn.client.end();
      } catch {
        /* noop */
      }
    }
  }
}

async function main() {
  const arg = process.argv[2];

  let rows: Array<{ id: string; hostname: string }>;
  if (arg) {
    rows = await db
      .select({ id: serversTable.id, hostname: serversTable.hostname })
      .from(serversTable)
      .where(or(eq(serversTable.id, arg), eq(serversTable.hostname, arg)));
    if (rows.length === 0) {
      console.error(`No server found matching "${arg}"`);
      process.exit(1);
    }
  } else {
    rows = await db
      .select({ id: serversTable.id, hostname: serversTable.hostname })
      .from(serversTable);
    if (rows.length === 0) {
      console.error("No servers in database.");
      process.exit(1);
    }
  }

  console.log(
    `\nKrova server version check\nPinned (config/platform.ts): kernel=${KERNEL_VERSION}, firecracker=${FIRECRACKER_VERSION}, caddy=${CADDY_VERSION}`
  );
  console.log(`Servers to check: ${rows.length}`);

  for (const row of rows) {
    await checkServer(row.id, row.hostname);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
