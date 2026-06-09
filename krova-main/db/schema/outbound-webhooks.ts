import { createId } from "@paralleldrive/cuid2"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { spaces } from "@/db/schema/spaces"

export const outboundWebhookDeliveryStatus = pgEnum(
  "outbound_webhook_delivery_status",
  ["pending", "delivered", "failed"]
)

export const outboundWebhookEndpoints = pgTable(
  "outbound_webhook_endpoints",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /** Optional customer-supplied label so an endpoint is recognizable without parsing its URL. */
    description: text("description"),
    url: text("url").notNull(),
    /** AES-256-GCM encrypted signing secret. Shown once at creation/rotate, never again. */
    encryptedSecret: text("encrypted_secret").notNull(),
    /** Array of event names this endpoint subscribes to. */
    events: text("events").array().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Why the endpoint was disabled. Set when `enabled` flips false to record
     * intent: `customer` (manual toggle), `consecutive_failures` (auto-disable
     * after the flap-protection threshold), `ssrf_blocked` (URL resolves to a
     * private range). Kept around even after re-enable as a forensic breadcrumb.
     */
    disabledReason: text("disabled_reason"),
    /** Running count of consecutive failed deliveries — reset to 0 on success. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("owhe_space_id_idx").on(t.spaceId)]
)

export const outboundWebhookDeliveries = pgTable(
  "outbound_webhook_deliveries",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => outboundWebhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboundWebhookDeliveryStatus("status")
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("owhd_endpoint_id_idx").on(t.endpointId),
    index("owhd_status_created_idx").on(t.status, t.createdAt),
    index("owhd_created_at_idx").on(t.createdAt),
  ]
)
