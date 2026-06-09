import { createId } from "@paralleldrive/cuid2"
import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const entityType = pgEnum("entity_type", ["cube", "space"])

export const lifecycleLogs = pgTable(
  "lifecycle_logs",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    entityType: entityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lifecycle_logs_entity_type_entity_id_idx").on(
      t.entityType,
      t.entityId
    ),
    index("lifecycle_logs_created_at_idx").on(t.createdAt),
  ]
)
