import { pgEnum, pgTable, text, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";
import { list } from "./list";
import { task } from "./task";

export const sprintStatusEnum = pgEnum("sprint_status", ["PLANNED", "ACTIVE", "CLOSED"]);

export const sprint = pgTable(
  "sprint",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => list.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    status: sprintStatusEnum("status").notNull().default("PLANNED"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sprint_list_id_idx").on(t.listId)],
);

export const taskSprint = pgTable("task_sprint", {
  taskId: text("task_id")
    .notNull()
    .references(() => task.id, { onDelete: "cascade" }),
  sprintId: text("sprint_id")
    .notNull()
    .references(() => sprint.id, { onDelete: "cascade" }),
  points: integer("points"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("task_sprint_pk").on(t.taskId, t.sprintId)]);
