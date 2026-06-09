/**
 * Backfill `cubes.numa_node` onto the EXISTING fleet so cubes provisioned before
 * L2 (NUMA-aware placement) was enabled get a least-loaded node and pin on their
 * NEXT cold-restart. Without this, only NEWLY-created cubes pin — existing cubes
 * stay unpinned forever because numa_node is assigned only at create time.
 *
 * DB-only (topology already lives in servers.numa_topology via install:numa-detect
 * / bootstrap), idempotent, ACTIVE-HOST-SAFE — it writes only the DB column, never
 * touches a running cube/VM. Dry-run by default.
 *
 * Run: pnpm install:numa-backfill            (dry-run — prints the plan)
 *      pnpm install:numa-backfill --apply    (commit)
 */

import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  // --server <id> [--server <id> ...] scopes the run to specific hosts (canary
  // one dual-socket server first before the whole fleet).
  const serverIds: string[] = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === "--server") {
      serverIds.push(process.argv[i + 1]);
    }
  }
  const { NUMA_PLACEMENT_ENABLED } = await import("@/config/platform");
  const { backfillNumaNodes } = await import("@/lib/server/numa-backfill");

  console.log(
    apply
      ? "Backfilling cubes.numa_node (APPLY)..."
      : "Backfilling cubes.numa_node (dry-run; pass --apply to commit)..."
  );
  if (serverIds.length > 0) {
    console.log(`  scoped to server(s): ${serverIds.join(", ")}`);
  }
  if (!NUMA_PLACEMENT_ENABLED) {
    console.warn(
      "  ! NUMA_PLACEMENT_ENABLED is OFF — assigned nodes stay inert (cubes won't pin) until you enable the flag + redeploy. Backfilling anyway so they're ready."
    );
  }

  const res = await backfillNumaNodes({
    apply,
    ...(serverIds.length > 0 ? { serverIds } : {}),
  });

  for (const s of res.servers) {
    if (s.topologyMissing) {
      console.warn(
        `  ! ${s.hostname} — ${s.nodeCount} node(s) but topology NOT detected; run "pnpm install:numa-detect" first, then re-run. (skipped)`
      );
      continue;
    }
    const spread: Record<number, number> = {};
    for (const a of s.assignments) {
      spread[a.node] = (spread[a.node] ?? 0) + 1;
    }
    const spreadStr =
      Object.entries(spread)
        .map(([n, c]) => `n${n}:${c}`)
        .join(" ") || "none";
    const tail = [
      `${s.alreadyAssigned} already assigned`,
      s.skippedNotEligible > 0
        ? `${s.skippedNotEligible} skipped (transient/transfer)`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `  ${apply ? "ok" : "would"} ${s.hostname} — ${s.assignments.length} cube(s) ${
        apply ? "assigned" : "to assign"
      } (${spreadStr})${tail ? ` — ${tail}` : ""}`
    );
  }

  if (res.singleSocketServers > 0) {
    console.log(
      `  ${res.singleSocketServers} single-socket server(s) — L2 no-op, skipped.`
    );
  }

  console.log(
    `\n${apply ? "Assigned" : "Would assign"} ${res.totalAssigned} cube(s) total.`
  );
  if (apply && res.totalAssigned > 0) {
    console.log(
      "These cubes pick up their cpuset on their NEXT COLD-RESTART — this only wrote the DB column, no running cube was touched."
    );
  } else if (!apply && res.totalAssigned > 0) {
    console.log("Re-run with --apply to commit.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("NUMA backfill failed:", err);
  process.exit(1);
});
