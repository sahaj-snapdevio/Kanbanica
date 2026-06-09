import { createId } from "@paralleldrive/cuid2"
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

/**
 * Outbound email outbox — durable, idempotency-safe email queue.
 *
 * Every email enqueued via `enqueueEmail()` creates a row here in
 * `queued` status BEFORE the pg-boss job is enqueued. The worker
 * (`email-send.ts`) atomically claims `queued → sending` via a
 * `WHERE status='queued' RETURNING` update, calls EmailIt, then
 * transitions to `sent` (success) or `queued` again (transient
 * failure with retries remaining) or `failed` (terminal).
 *
 * Why this exists: pg-boss guarantees at-least-once delivery, NOT
 * exactly-once. Without an atomic DB transition guarding the API call,
 * a worker crash between EmailIt success and pg-boss job completion
 * causes the next retry to re-send the email — observed in production
 * as duplicate sends. The atomic claim on a status column makes the
 * external send happen exactly once per outbox row, no matter how many
 * times pg-boss retries the job.
 *
 * EmailIt v2 supports an `Idempotency-Key` request header (max 256
 * chars, alphanumeric + dash + underscore) with a 24-hour dedup window
 * — see https://emailit.com/docs/api-reference/emails/send. The
 * outbox row's `idempotencyKey` (a UUID) is passed verbatim, so a
 * duplicate API call within 24h is deduped server-side too. The
 * row-state machine is still the primary dedup mechanism (it covers
 * the cases EmailIt's window misses — e.g. retries 24h+ after a
 * stuck row).
 *
 * Stuck rows (still `sending` after the grace window) indicate a
 * worker crash between EmailIt success and the DB commit — the
 * `email-outbox.reap` cron sweeps these to `failed` with a marker
 * error so an operator can review. We never retry a stuck row
 * because we cannot tell whether the email was actually sent.
 */

export const emailOutboxStatus = pgEnum("email_outbox_status", [
  "queued",
  "sending",
  "sent",
  "failed",
])

export interface EmailOutboxPayload {
  to: string
  subject: string
  html: string
  text?: string
}

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    /** Random UUID written into `X-Idempotency-Key` on every EmailIt call. */
    idempotencyKey: text("idempotency_key").notNull(),
    status: emailOutboxStatus("status").notNull().default("queued"),
    /** `{ to, subject, html, text }` — see EmailOutboxPayload. */
    payload: jsonb("payload").$type<EmailOutboxPayload>().notNull(),
    /** Number of send attempts so far (incremented each `sending` claim). */
    attemptCount: integer("attempt_count").notNull().default(0),
    /** Hard cap on attempts — when attemptCount reaches this and the send
     *  still failed, status moves to `failed`. Configurable per-row so
     *  e.g. transactional email and bulk notifications can have different
     *  retry budgets. Default 3 (covers brief network/EmailIt blips). */
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** EmailIt's `msg_xxx` id, written on successful send. */
    providerMessageId: text("provider_message_id"),
    /** Last failure reason — only meaningful on `failed` and on
     *  intermediate `queued` rows that have attemptCount > 0. */
    lastError: text("last_error"),
    /** When the row last transitioned into `sending`. Used by the
     *  stuck-row reaper to identify rows where the worker crashed
     *  between API success and the DB commit. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** When the row transitioned to `sent`. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Uniqueness on the idempotency key prevents accidental double-insert
    // from a re-enqueue site (e.g. two parallel auth requests for the same
    // magic link — should produce two outbox rows with DIFFERENT keys, but
    // the unique constraint catches a bug where a caller reuses the key).
    uniqueIndex("email_outbox_idempotency_key_unq").on(t.idempotencyKey),
    // Status filter for the reaper cron + admin filter.
    index("email_outbox_status_idx").on(t.status),
    // Reaper cron: status='sending' AND claimedAt < now() - grace.
    index("email_outbox_status_claimed_at_idx").on(t.status, t.claimedAt),
  ]
)
