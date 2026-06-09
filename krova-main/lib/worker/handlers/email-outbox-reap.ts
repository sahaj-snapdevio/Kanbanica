/**
 * Stuck-row reaper for the email outbox.
 *
 * The normal lifecycle for an outbox row is
 *   queued → sending → (sent | queued-for-retry | failed)
 *
 * A row stuck in `sending` past the grace window means the worker
 * died AFTER successfully claiming the row and AFTER calling EmailIt,
 * but BEFORE the DB transition to `sent` (or to `queued` for retry).
 * We cannot determine whether the email actually reached EmailIt
 * — and we cannot safely re-send, because EmailIt's 24-hour
 * `Idempotency-Key` window protects us from in-window duplicates but
 * not from a re-send 24h+ after the original claim.
 *
 * Rather than guess, we sweep these to `failed` with a marker error
 * so an operator can review and decide. In practice this should be
 * vanishingly rare — it requires the worker process to die in a very
 * narrow window between the API call returning and the SQL UPDATE
 * committing.
 *
 * Schedule: every 15 minutes (`*\/15 * * * *`) via boss.schedule in
 * lib/worker/boss.ts. Grace window: 10 minutes — comfortably wider
 * than the EMAIL_SEND queue's `expireInSeconds: 600` so pg-boss has
 * already given up on the original job by the time we reap.
 */

import { and, eq, lt } from "drizzle-orm";
import { emailOutbox } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

/** Grace window — rows in `sending` older than this are reaped. */
const STUCK_GRACE_MS = 10 * 60 * 1000;

const STUCK_REASON =
  "Stuck in `sending` past 10-minute grace window — worker likely " +
  "crashed between EmailIt API success and DB commit. Reaped to " +
  "`failed` to avoid an unsafe re-send. Review row to decide if " +
  "manual resend is warranted.";

export async function handleEmailOutboxReap(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_GRACE_MS);

  // Atomic sweep — only rows still in `sending` past the cutoff are
  // affected. `returning()` gives us the ids reaped so we can audit.
  const reaped = await db
    .update(emailOutbox)
    .set({
      status: "failed",
      lastError: STUCK_REASON,
      updatedAt: new Date(),
    })
    .where(
      and(eq(emailOutbox.status, "sending"), lt(emailOutbox.claimedAt, cutoff))
    )
    .returning({
      id: emailOutbox.id,
      attemptCount: emailOutbox.attemptCount,
      to: emailOutbox.payload,
    });

  if (reaped.length === 0) {
    return;
  }

  console.warn(
    `[email-outbox-reap] reaped ${reaped.length} stuck row(s): ${reaped
      .map((r) => r.id)
      .join(", ")}`
  );

  audit({
    action: "email_outbox.reaped",
    category: "platform",
    actorType: "system",
    entityType: "email_outbox",
    description: `Reaped ${reaped.length} stuck email_outbox row(s)`,
    metadata: {
      count: reaped.length,
      ids: reaped.map((r) => r.id),
    },
    source: "worker",
  });
}
