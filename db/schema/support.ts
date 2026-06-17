import { pgEnum, pgTable, text, timestamp, boolean, integer, json, index } from "drizzle-orm/pg-core";

export const supportTicketStatusEnum = pgEnum("support_ticket_status", ["OPEN", "IN_PROGRESS", "CLOSED"]);
export const supportTicketCategoryEnum = pgEnum("support_ticket_category", [
  "GENERAL",
  "TASKS",
  "BILLING",
  "TECHNICAL",
  "OTHER",
]);

export const supportTicket = pgTable(
  "support_ticket",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    ticketNumber: text("ticket_number").notNull().unique(),
    subject: text("subject").notNull(),
    status: supportTicketStatusEnum("status").notNull().default("OPEN"),
    category: supportTicketCategoryEnum("category").notNull().default("GENERAL"),
    assignedTo: text("assigned_to"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_ticket_user_status_idx").on(t.userId, t.status),
    index("support_ticket_status_updated_idx").on(t.status, t.updatedAt),
  ],
);

export const supportTicketMessage = pgTable(
  "support_ticket_message",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTicket.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    isInternalNote: boolean("is_internal_note").notNull().default(false),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_ticket_message_ticket_id_idx").on(t.ticketId)],
);

export const helpArticle = pgTable(
  "help_article",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    category: text("category").notNull(),
    body: json("body").notNull(),
    isPublished: boolean("is_published").notNull().default(false),
    authorId: text("author_id").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("help_article_category_idx").on(t.category, t.isPublished)],
);
