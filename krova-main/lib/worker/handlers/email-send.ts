/**
 * Email send handler — the durable, idempotency-safe execution side of
 * the `email_outbox` queue.
 *
 * The pg-boss job payload only carries the outbox row id. The handler:
 *
 *  1. Atomically transitions the row `queued → sending` via a
 *     `WHERE status='queued' RETURNING` update. Two parallel runs of
 *     the same job (pg-boss retry + a sibling replica racing for the
 *     same row) cannot both win — Postgres's row-level write semantics
 *     guarantee exactly one claim. The loser short-circuits.
 *
 *  2. Calls EmailIt with the row's UUID idempotencyKey. EmailIt
 *     honours `Idempotency-Key` with a 24-hour dedup window, so even
 *     if the handler somehow does fire the API call twice (e.g. one
 *     of the rare race windows below), EmailIt itself returns the
 *     cached prior result rather than sending a second email.
 *
 *  3. On 2xx → `sent`, stamping providerMessageId + sentAt.
 *     On retryable failure → back to `queued` with attemptCount++ and
 *     rethrows so pg-boss schedules a retry.
 *     On exhausted retries → `failed`, no rethrow (pg-boss done).
 *
 * Stuck rows (still `sending` long after `claimedAt`) are the only
 * pathological case — handler crashed AFTER EmailIt accepted the
 * email but BEFORE the DB transition to `sent`. We don't auto-retry
 * those (cannot tell if the email was sent or not); the
 * `email.outbox-reap` cron sweeps them to `failed` with a marker so
 * an operator can review.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import { emailOutbox } from "@/db/schema";
import { db } from "@/lib/db";
import { EmailitError } from "@/lib/emailit/client";
import { sendEmailViaApi } from "@/lib/emailit/emails";
import { enqueueJob } from "@/lib/worker/enqueue";
import type { EmailSendPayload } from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Backoff seconds for retryable failures. Index = attempt number that
 * just failed (1-indexed). After the configured `maxAttempts` is hit
 * the row goes to `failed` instead of being re-enqueued.
 */
const RETRY_BACKOFF_SECONDS = [60, 300, 900];

export async function handleEmailSend(
  jobs: Job<EmailSendPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await processEmailSendJob(job);
  }
}

async function processEmailSendJob(job: Job<EmailSendPayload>): Promise<void> {
  const { outboxId } = job.data;
  if (!outboxId) {
    // Defensive: legacy job format from before the outbox migration
    // (no rows expected in production but worth surfacing if any leak
    // through). We can't send without a row to update, so just log and
    // let pg-boss mark the job done — there's nothing to retry.
    console.error(
      `[email-send] job ${job.id} has no outboxId in payload — ignoring (likely a legacy job from before the outbox migration)`
    );
    return;
  }

  // 1. Atomic claim — single UPDATE transitions queued → sending,
  //    stamps claimedAt + updatedAt, and increments attemptCount in
  //    one shot. Postgres row-level write semantics ensure that two
  //    parallel handlers racing for the same row can't both succeed
  //    — the loser gets an empty `returning()` and short-circuits.
  const [claimed] = await db
    .update(emailOutbox)
    .set({
      status: "sending",
      claimedAt: new Date(),
      updatedAt: new Date(),
      attemptCount: sql`${emailOutbox.attemptCount} + 1`,
    })
    .where(and(eq(emailOutbox.id, outboxId), eq(emailOutbox.status, "queued")))
    .returning();

  if (!claimed) {
    // Row is no longer `queued`. Inspect to decide:
    //   - 'sent'/'failed'   → done, no-op (this run is a duplicate)
    //   - 'sending'         → another worker is processing OR a prior
    //                         crash left it stuck. Either way we DO
    //                         NOT re-send — the reaper sweeps stuck
    //                         rows. Treat as success for pg-boss so
    //                         it doesn't retry forever.
    const row = await db.query.emailOutbox.findFirst({
      where: eq(emailOutbox.id, outboxId),
    });
    if (!row) {
      console.warn(
        `[email-send] outbox row ${outboxId} not found — was it deleted? skipping`
      );
      return;
    }
    console.log(
      `[email-send] outbox ${outboxId} already ${row.status} (attempt ${row.attemptCount}) — skipping`
    );
    return;
  }

  // `claimed.attemptCount` reflects the post-increment value because
  // `.returning()` returns the row state AFTER the UPDATE.
  const newAttemptCount = claimed.attemptCount;
  const remainingAttempts = claimed.maxAttempts - newAttemptCount;

  // 2. Call EmailIt. The idempotencyKey is the row's UUID — EmailIt
  //    dedupes any repeat within 24h, even if we somehow trigger it.
  try {
    const result = await sendEmailViaApi({
      to: claimed.payload.to,
      subject: claimed.payload.subject,
      html: claimed.payload.html,
      text: claimed.payload.text,
      idempotencyKey: claimed.idempotencyKey,
      meta: { outbox_id: claimed.id },
    });

    // 3a. Success → mark sent. From this point on, any retry will see
    //     status='sent' and short-circuit.
    await db
      .update(emailOutbox)
      .set({
        status: "sent",
        providerMessageId: result.id,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailOutbox.id, outboxId));

    console.log(
      `[email-send] sent outbox=${outboxId} to="${claimed.payload.to}" subject="${claimed.payload.subject}" provider=${result.id} attempt=${newAttemptCount}`
    );
  } catch (err) {
    const reason = describeEmailError(err);
    console.error(
      `[email-send] failed outbox=${outboxId} attempt=${newAttemptCount}: ${reason}`
    );

    if (remainingAttempts > 0 && isRetryable(err)) {
      // 3b. Transient failure with attempts remaining → reset row to
      //     `queued` and explicitly enqueue a fresh pg-boss job with
      //     backoff. pg-boss `retryLimit` is 0 on this queue
      //     intentionally — the row state machine is the single source
      //     of truth, and re-enqueueing a NEW job (rather than
      //     `throw err`ing to retry the same job id) keeps pg-boss's
      //     view and the outbox row's view consistent.
      await db
        .update(emailOutbox)
        .set({
          status: "queued",
          claimedAt: null,
          lastError: reason,
          updatedAt: new Date(),
        })
        .where(eq(emailOutbox.id, outboxId));

      const backoffIndex = Math.min(
        newAttemptCount - 1,
        RETRY_BACKOFF_SECONDS.length - 1
      );
      const delaySeconds = RETRY_BACKOFF_SECONDS[backoffIndex];
      await enqueueJob(
        JOB_NAMES.EMAIL_SEND,
        { outboxId },
        { startAfter: delaySeconds }
      );
      console.log(
        `[email-send] requeued outbox=${outboxId} (attempt ${newAttemptCount}/${claimed.maxAttempts}) in ${delaySeconds}s`
      );
      return;
    }

    // 3c. Terminal failure (non-retryable or attempts exhausted) →
    //     mark failed and return cleanly. No requeue, pg-boss job
    //     ends successfully (because we returned without throwing).
    await db
      .update(emailOutbox)
      .set({
        status: "failed",
        lastError: reason,
        updatedAt: new Date(),
      })
      .where(eq(emailOutbox.id, outboxId));
  }
}

/** Format the error for `last_error` storage — bounded length, no PII. */
function describeEmailError(err: unknown): string {
  if (err instanceof EmailitError) {
    return `EmailIt ${err.status}: ${err.message}`.slice(0, 500);
  }
  if (err instanceof Error) {
    return err.message.slice(0, 500);
  }
  return String(err).slice(0, 500);
}

/**
 * Decide whether an EmailIt failure is worth retrying.
 *
 * Retryable: 5xx (server-side issue), 429 (rate limit), network errors
 *            (no `EmailitError` thrown — usually `TypeError: fetch failed`).
 * NOT retryable: 4xx other than 429 — bad payload, invalid recipient,
 *                unverified sender, etc. Re-sending won't fix any of
 *                those; surface as `failed` so the operator can fix.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof EmailitError) {
    return err.status >= 500 || err.status === 429;
  }
  // Non-EmailitError (e.g. network failure) — assume retryable.
  return true;
}
