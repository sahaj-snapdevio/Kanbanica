/**
 * cleanup-stuck-snapshots — delete `cube_snapshots` rows stranded in
 * `creating` with no data ever uploaded (`storage_path IS NULL`).
 *
 * Why these exist: if the bare-metal host is unreachable (EHOSTUNREACH) at
 * the moment `snapshot.create` runs, the row was already flipped
 * `pending → creating` before the SSH connect. The connect failure used to
 * escape uncaught, the pg-boss retry short-circuited on `status != 'pending'`,
 * and the row was stranded in `creating` forever — no cron reaps it
 * (`snapshot.auto-prune` only touches `status='complete'`). The 2026-05-28
 * `mango` outage produced a batch of these. The handler is now guarded so new
 * ones can't strand; this command cleans up the historical zombies.
 *
 * Safe to delete because `storage_path IS NULL` means nothing reached restic
 * (no S3 orphan left behind) — identical to the no-upload orphan-delete the
 * handler's own catch performs. The `--min-age-hours` floor (default 1h) keeps
 * it clear of a genuinely in-flight first snapshot, whose restic backup can
 * legitimately hold `creating` + null storagePath for up to the 30-min
 * `resticBackup` timeout.
 *
 * Usage:
 *   pnpm snapshots:cleanup-stuck                      # dry-run (default) — list only
 *   pnpm snapshots:cleanup-stuck --delete             # delete eligible rows
 *   pnpm snapshots:cleanup-stuck --min-age-hours=6    # widen the in-flight safety window
 */

import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

function parseArgs(): { doDelete: boolean; minAgeHours: number } {
  let doDelete = false;
  let minAgeHours = 1;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--delete") {
      doDelete = true;
    } else if (arg.startsWith("--min-age-hours=")) {
      const n = Number(arg.split("=")[1]);
      if (!Number.isFinite(n) || n < 0) {
        console.error(`Invalid --min-age-hours value: ${arg}`);
        process.exit(1);
      }
      minAgeHours = n;
    } else {
      console.error(`Unknown flag: ${arg}`);
      console.error(
        "Usage: pnpm snapshots:cleanup-stuck [--delete] [--min-age-hours=N]"
      );
      process.exit(1);
    }
  }
  return { doDelete, minAgeHours };
}

async function main(): Promise<void> {
  const { doDelete, minAgeHours } = parseArgs();

  const [
    { audit },
    { findStuckCreatingSnapshots, deleteStuckCreatingSnapshots },
  ] = await Promise.all([
    import("@/lib/audit"),
    import("@/lib/cubes/stuck-snapshots"),
  ]);

  // One cutoff reading drives both the list and the delete (no drift).
  const cutoff = new Date(Date.now() - minAgeHours * 60 * 60 * 1000);
  const rows = await findStuckCreatingSnapshots(cutoff);

  console.log("");
  console.log(
    `Stuck "creating" snapshots (storage_path NULL, older than ${minAgeHours}h): ${rows.length}`
  );
  for (const r of rows) {
    console.log(
      `  ${r.createdAt.toISOString()}  ${r.kind.padEnd(6)}  cube=${r.cubeId}  ${r.name}`
    );
  }

  if (rows.length === 0) {
    console.log("Nothing to clean up.");
    process.exit(0);
  }

  if (!doDelete) {
    console.log("");
    console.log("Dry-run — pass --delete to remove these rows.");
    process.exit(0);
  }

  const deletedIds = await deleteStuckCreatingSnapshots(cutoff);

  audit({
    action: "snapshot.stuck_cleanup",
    category: "cube",
    actorType: "admin",
    entityType: "space",
    description: `Cleaned up ${deletedIds.length} snapshot row(s) stranded in "creating" (no data uploaded) via snapshots:cleanup-stuck`,
    metadata: {
      deletedCount: deletedIds.length,
      minAgeHours,
      snapshotIds: deletedIds,
    },
    source: "system",
  });

  console.log("");
  console.log(`Deleted ${deletedIds.length} stuck "creating" snapshot row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
