/**
 * Helpers for fan-out enqueuing of `emailit.sync-contact` jobs from the event
 * triggers that mutate fields tracked in a user's EmailIt contact custom
 * fields (cube counts, credit balance, lifecycle stage, space membership,
 * email verification, role, last active).
 *
 * Each call is fire-and-forget — a queue failure must never break the
 * caller's business logic. We log and swallow. A pg-boss `singletonKey`
 * collapses back-to-back enqueues for the same user into one job, so a
 * burst of related events (e.g. cube state changes during a transfer)
 * triggers a single upsert against the EmailIt API.
 */

import { and, eq } from "drizzle-orm";
import { spaceMemberships } from "@/db/schema";
import { db } from "@/lib/db";
import { isContactSyncConfigured } from "@/lib/emailit/sync-contact";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/** Enqueue an EmailIt contact-sync for one user. No-op when sync is unconfigured. */
export async function enqueueEmailitSync(userId: string): Promise<void> {
  if (!isContactSyncConfigured()) {
    return;
  }
  try {
    await enqueueJob(
      JOB_NAMES.EMAILIT_SYNC_CONTACT,
      { userId },
      { singletonKey: `emailit-sync:${userId}` }
    );
  } catch (err) {
    console.error(`[emailit] failed to enqueue sync for ${userId}:`, err);
  }
}

/**
 * Enqueue an EmailIt contact-sync for the owner of a space. The owner is
 * the principal whose contact tracks the space's cube counts + credit, so
 * sync that user (not every member) on space-scoped mutations.
 */
export async function enqueueEmailitSyncForSpaceOwner(
  spaceId: string
): Promise<void> {
  if (!isContactSyncConfigured()) {
    return;
  }
  try {
    const [owner] = await db
      .select({ userId: spaceMemberships.userId })
      .from(spaceMemberships)
      .where(
        and(
          eq(spaceMemberships.spaceId, spaceId),
          eq(spaceMemberships.isOwner, true)
        )
      )
      .limit(1);
    if (!owner) {
      return;
    }
    await enqueueEmailitSync(owner.userId);
  } catch (err) {
    console.error(
      `[emailit] failed to enqueue space-owner sync for ${spaceId}:`,
      err
    );
  }
}
