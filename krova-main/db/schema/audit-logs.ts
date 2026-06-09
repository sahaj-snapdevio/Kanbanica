import { createId } from "@paralleldrive/cuid2"
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export const auditActorType = pgEnum("audit_actor_type", [
  "user",
  "admin",
  "system",
])

export const auditCategory = pgEnum("audit_category", [
  "auth",
  "space",
  "member",
  "invite",
  "cube",
  "app",
  "domain",
  "tcp_mapping",
  "ssh_key",
  "billing",
  "server",
  "platform",
  "webhook",
])

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey().$defaultFn(createId),

    // What happened
    action: text("action").notNull(), // e.g. "cube.create", "member.remove", "billing.charge"
    category: auditCategory("category").notNull(),

    // Who did it
    actorType: auditActorType("actor_type").notNull(),
    actorId: text("actor_id"), // userId — null for system actions
    actorEmail: text("actor_email"), // denormalized so logs survive user deletion

    // What was affected
    entityType: text("entity_type").notNull(), // e.g. "cube", "space", "user", "server"
    entityId: text("entity_id"), // primary key of affected entity

    // Scope
    spaceId: text("space_id"), // null for platform-level actions

    // Rich context for analytics
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    description: text("description"), // human-readable summary

    // Request context
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    source: text("source").notNull().default("web"), // "web" | "api" | "worker" | "system"

    // Timestamps — indexed for time-range queries and truncation
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_actor_id_idx").on(table.actorId),
    index("audit_logs_space_id_idx").on(table.spaceId),
    index("audit_logs_entity_type_entity_id_idx").on(
      table.entityType,
      table.entityId
    ),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_category_idx").on(table.category),
  ]
)
