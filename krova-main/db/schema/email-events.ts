import { createId } from "@paralleldrive/cuid2"
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
 * Inbound EmailIt webhook events — delivery telemetry for transactional
 * email (email.delivered, email.bounced, email.complained, email.failed,
 * email.rejected, email.suppressed, …).
 *
 * Append-only. Idempotent on `emailitEventId` (EmailIt's evt_xxx id) so a
 * webhook retry never double-inserts. The full webhook payload is kept in
 * `payload` so the table stays useful even though EmailIt does not publish
 * a stable per-field webhook schema.
 *
 * Pruned after 90 days by the `email.events-prune-cron` daily job.
 */
export const emailEvents = pgTable(
  "email_events",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    /** EmailIt event id (evt_xxx) — unique; the idempotency key. */
    emailitEventId: text("emailit_event_id").notNull().unique(),
    /** Event type, e.g. "email.delivered", "email.bounced". */
    eventType: text("event_type").notNull(),
    /** EmailIt email object id (em_xxx) the event concerns, when present. */
    emailitEmailId: text("emailit_email_id"),
    /** Recipient address extracted from the payload, when present. */
    recipient: text("recipient"),
    /** Full raw webhook payload — resilient to EmailIt schema drift. */
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    /** When EmailIt reports the event occurred (parsed from `created_at`). */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("email_events_event_type_idx").on(t.eventType),
    index("email_events_recipient_idx").on(t.recipient),
    index("email_events_received_at_idx").on(t.receivedAt),
  ]
)
