/**
 * Bulk-syncs every Krova user into the EmailIt marketing audience as a
 * contact (with custom fields). Run via `pnpm sync:emailit`.
 *
 * Use this for the initial backfill, or any time you add a new custom
 * field and want every existing contact refreshed immediately. Routine
 * freshness is handled by the event-driven `emailit.sync-contact` enqueues
 * fired from the cube / billing / membership / auth code paths — this CLI
 * is the manual sweep, not a recurring job.
 */
import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main() {
  const { syncAllUsers, isContactSyncConfigured } = await import(
    "@/lib/emailit/sync-contact"
  );

  if (!isContactSyncConfigured()) {
    console.error(
      "EMAILIT_AUDIENCE_ID is not set. Create an audience in the EmailIt\n" +
        "dashboard and add its id to .env as EMAILIT_AUDIENCE_ID before running."
    );
    process.exit(1);
  }

  console.log("Syncing all users to the EmailIt audience...\n");

  const result = await syncAllUsers((done, total, email) => {
    console.log(`  [${done}/${total}] ${email}`);
  });

  console.log(
    `\nDone: ${result.synced}/${result.total} synced, ${result.failed} failed.`
  );

  if (result.failed > 0) {
    console.log("\nFailures:");
    for (const e of result.errors) {
      console.log(`  ${e.email}: ${e.error}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
