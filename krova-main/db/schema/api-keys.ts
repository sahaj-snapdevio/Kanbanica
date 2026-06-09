import { createId } from "@paralleldrive/cuid2"
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"

import { spaces } from "@/db/schema/spaces"
import { spaceMemberships } from "@/db/schema/spaces"

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    membershipId: text("membership_id")
      .notNull()
      .references(() => spaceMemberships.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("api_keys_key_hash_idx").on(t.keyHash),
    index("api_keys_space_id_idx").on(t.spaceId),
  ]
)
