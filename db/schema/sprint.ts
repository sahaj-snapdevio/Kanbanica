import { pgEnum, pgTable, text, timestamp, integer, boolean, index, unique } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";
import { list } from "./list";
import { task } from "./task";

export const sprintStatusEnum = pgEnum("sprint_status", ["PLANNED", "ACTIVE", "CLOSED"]);
export const incompleteStrategyEnum = pgEnum("incomplete_strategy", ["move_to_backlog", "move_to_next_sprint", "leave_as_is"]);

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
    durationWeeks: integer("duration_weeks").notNull().default(2),
    autoCreateNext: boolean("auto_create_next").notNull().default(false),
    autoCloseOnNext: boolean("auto_close_on_next").notNull().default(false),
    autoIncompleteStrategy: incompleteStrategyEnum("auto_incomplete_strategy").notNull().default("move_to_backlog"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
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
