import { pgTable, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { task } from "./task";
import { workspace } from "./workspace";

export const pinnedTask = pgTable(
  "pinned_task",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull().default(0),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pinned_task_user_task_idx").on(t.userId, t.taskId),
    index("pinned_task_user_workspace_idx").on(t.userId, t.workspaceId),
  ],
);
