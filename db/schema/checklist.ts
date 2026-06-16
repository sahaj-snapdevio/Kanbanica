import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { task } from "./task";

export const checklist = pgTable("checklist", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => task.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const checklistItem = pgTable("checklist_item", {
  id: text("id").primaryKey(),
  checklistId: text("checklist_id")
    .notNull()
    .references(() => checklist.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  isChecked: boolean("is_checked").notNull().default(false),
  checkedBy: text("checked_by"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
