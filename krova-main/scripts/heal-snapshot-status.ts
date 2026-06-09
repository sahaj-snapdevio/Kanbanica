// One-shot heal for cube_snapshots rows wrongly left in `failed`/`restoring`.
//
// A snapshot's status should describe only the snapshot — a failed RESTORE (a
// read-only op on the snapshot) used to brick it to `failed`, and a
// post-`complete` create step throwing could downgrade a good snapshot. This
// un-bricks intact rows (they have restic data → back to `complete`) and clears
// auto-snapshot noise (auto rows with no data → delete). Manual `failed` notes
// with no data are LEFT as the dismissible note.
//
//   tsx scripts/heal-snapshot-status.ts            # dry-run, prints per-bucket counts
//   tsx scripts/heal-snapshot-status.ts --apply    # commit
//
// Bounded + idempotent (Rule 40): re-running after --apply is a no-op. The
// `cube_snapshots` table is small, so a single bounded UPDATE/DELETE per bucket
// (chunked) is safe.

import { inArray } from "drizzle-orm";
import { existsSync } from "fs";
import { classifySnapshotForHeal } from "@/lib/snapshots/failure-policy";

// Load local .env BEFORE the env-dependent `@/lib/*` modules are imported.
// Those imports are done dynamically inside main() because static ESM imports
// are hoisted and would read env before this runs (mirrors the other scripts).
if (existsSync(".env")) {
  process.loadEnvFile();
}

const APPLY = process.argv.includes("--apply");
const CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function main(): Promise<void> {
  const [{ db }, { audit }, { cubeSnapshots }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/audit"),
    import("@/db/schema"),
  ]);

  const rows = await db
    .select({
      id: cubeSnapshots.id,
      status: cubeSnapshots.status,
      kind: cubeSnapshots.kind,
      storagePath: cubeSnapshots.storagePath,
    })
    .from(cubeSnapshots)
    .where(inArray(cubeSnapshots.status, ["failed", "restoring"]));

  const healIds: string[] = [];
  const deleteIds: string[] = [];
  let leftAlone = 0;

  for (const row of rows) {
    const action = classifySnapshotForHeal(row);
    if (action === "heal-to-complete") {
      healIds.push(row.id);
    } else if (action === "delete") {
      deleteIds.push(row.id);
    } else {
      leftAlone += 1;
    }
  }

  console.log(
    `[heal-snapshot-status] scanned ${rows.length} failed/restoring rows`
  );
  console.log(`  → heal to complete (intact data): ${healIds.length}`);
  console.log(`  → delete (auto noise, no data):    ${deleteIds.length}`);
  console.log(`  → leave (manual failed notes):     ${leftAlone}`);

  if (!APPLY) {
    console.log("\nDry-run. Re-run with --apply to commit.");
    process.exit(0);
  }

  for (const ids of chunk(healIds, CHUNK)) {
    await db
      .update(cubeSnapshots)
      .set({ status: "complete" })
      .where(inArray(cubeSnapshots.id, ids));
  }
  for (const ids of chunk(deleteIds, CHUNK)) {
    await db.delete(cubeSnapshots).where(inArray(cubeSnapshots.id, ids));
  }

  await audit({
    action: "snapshot.heal_status",
    category: "cube",
    actorType: "system",
    entityType: "system",
    entityId: "snapshots",
    description: `Healed snapshot statuses: ${healIds.length} → complete, ${deleteIds.length} deleted, ${leftAlone} left`,
    metadata: { healed: healIds.length, deleted: deleteIds.length, leftAlone },
    source: "system",
  });

  console.log(
    `\n[heal-snapshot-status] applied: ${healIds.length} healed, ${deleteIds.length} deleted.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[heal-snapshot-status] failed:", err);
  process.exit(1);
});
