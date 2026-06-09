import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"

import { plans } from "@/db/schema/plans"
import { spaces } from "@/db/schema/spaces"

/**
 * Assigns a custom-visibility plan to a specific space. A custom plan is
 * subscribeable by a space iff a row exists here. Public plans are
 * subscribeable by every space without an entry here.
 */
export const planSpaceVisibility = pgTable(
  "plan_space_visibility",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.spaceId] })]
)
