import { createId } from "@paralleldrive/cuid2";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const emailOutboxStatus = pgEnum("email_outbox_status", [
  "queued",
  "sending",
  "sent",
  "failed",
]);

export interface EmailOutboxPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    idempotencyKey: text("idempotency_key").notNull(),
    status: emailOutboxStatus("status").notNull().default("queued"),
    payload: jsonb("payload").$type<EmailOutboxPayload>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("email_outbox_idempotency_key_unq").on(t.idempotencyKey),
    index("email_outbox_status_idx").on(t.status),
    index("email_outbox_status_claimed_at_idx").on(t.status, t.claimedAt),
  ]
);
