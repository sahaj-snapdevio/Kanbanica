import { createId } from "@paralleldrive/cuid2";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const emailEvents = pgTable(
  "email_events",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    providerEventId: text("provider_event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    providerEmailId: text("provider_email_id"),
    recipient: text("recipient"),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
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
);
