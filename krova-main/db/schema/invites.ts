import { createId } from "@paralleldrive/cuid2"
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { user } from "@/db/schema/auth"
import { spaces } from "@/db/schema/spaces"

export const inviteStatus = pgEnum("invite_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
])

export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    email: text("email").notNull(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    permissions: jsonb("permissions").notNull(),
    cubeAssignments: jsonb("cube_assignments").notNull(),
    token: text("token").notNull().unique(),
    status: inviteStatus("status").notNull().default("pending"),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("invites_space_id_idx").on(t.spaceId),
    index("invites_email_idx").on(t.email),
  ]
)
