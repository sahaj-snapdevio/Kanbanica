import type { Job } from "pg-boss";

import {
  isContactSyncConfigured,
  syncUserToEmailit,
} from "@/lib/emailit/sync-contact";
import type { EmailitSyncContactPayload } from "@/lib/worker/job-types";

/**
 * emailit.sync-contact — upserts a single user into the EmailIt marketing
 * audience. Enqueued on signup and whenever a user changes their marketing
 * opt-in. No-ops cleanly when contact sync is not configured.
 */
export async function handleEmailitSyncContact(
  jobs: Job<EmailitSyncContactPayload>[]
): Promise<void> {
  if (!isContactSyncConfigured()) {
    console.log(
      "[worker:emailit-sync] skipped — EMAILIT_AUDIENCE_ID not configured"
    );
    return;
  }

  for (const job of jobs) {
    const { userId } = job.data;
    try {
      await syncUserToEmailit(userId);
      console.log(`[worker:emailit-sync] synced user ${userId}`);
    } catch (err) {
      console.error(`[worker:emailit-sync] failed for user ${userId}:`, err);
      throw err;
    }
  }
}
