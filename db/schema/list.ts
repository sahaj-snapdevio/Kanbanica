import { pgEnum, pgTable, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { space } from "./space";

export const statusTypeEnum = pgEnum("status_type", ["OPEN", "ACTIVE", "CLOSED"]);

export const list = pgTable(
  "list",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    folderId: text("folder_id"),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    orderIndex: integer("order_index").notNull().default(0),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("list_space_id_idx").on(t.spaceId)],
);

export const listStatus = pgTable(
  "list_status",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => list.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    type: statusTypeEnum("type").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("list_status_list_id_idx").on(t.listId)],
);
