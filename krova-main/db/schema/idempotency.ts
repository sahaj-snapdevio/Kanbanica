import { createId } from "@paralleldrive/cuid2"
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

import { spaces } from "@/db/schema/spaces"

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    idempotencyKey: text("idempotency_key").notNull(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("idempotency_keys_key_space_idx").on(t.idempotencyKey, t.spaceId),
  ]
)
