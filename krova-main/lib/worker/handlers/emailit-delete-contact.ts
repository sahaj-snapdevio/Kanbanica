import type { Job } from "pg-boss";

import { deleteEmailitContact } from "@/lib/emailit/contacts";
import { isContactSyncConfigured } from "@/lib/emailit/sync-contact";
import type { EmailitDeleteContactPayload } from "@/lib/worker/job-types";

/**
 * emailit.delete-contact — permanently remove a contact from the EmailIt
 * marketing audience. Enqueued just before a `user` row is hard-deleted so we
 * still have the `emailitContactId`/`email` to target. Resilient to transient
 * EmailIt API failures (pg-boss retries) and no-ops cleanly when contact sync
 * is not configured or the user never synced.
 */
export async function handleEmailitDeleteContact(
  jobs: Job<EmailitDeleteContactPayload>[]
): Promise<void> {
  if (!isContactSyncConfigured()) {
    console.log(
      "[worker:emailit-delete] skipped — EMAILIT_AUDIENCE_ID not configured"
    );
    return;
  }

  for (const job of jobs) {
    const idOrEmail = job.data.contactId ?? job.data.email;
    if (!idOrEmail) {
      console.log(
        "[worker:emailit-delete] skipped — no contactId or email supplied"
      );
      continue;
    }
    try {
      const removed = await deleteEmailitContact(idOrEmail);
      console.log(
        `[worker:emailit-delete] ${removed ? "deleted" : "not found"}: ${idOrEmail}`
      );
    } catch (err) {
      console.error(`[worker:emailit-delete] failed for ${idOrEmail}:`, err);
      throw err;
    }
  }
}
