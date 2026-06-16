import { pgTable, text, timestamp, boolean, json, index, unique } from "drizzle-orm/pg-core";

export const userSearchHistory = pgTable(
  "user_search_history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_search_history_idx").on(t.userId, t.workspaceId)],
);

export const savedFilter = pgTable(
  "saved_filter",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    listId: text("list_id").notNull(),
    name: text("name").notNull(),
    filters: json("filters").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_filter_user_list_idx").on(t.userId, t.listId)],
);

export const userOnboardingProgress = pgTable(
  "user_onboarding_progress",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    stepWorkspace: boolean("step_workspace").notNull().default(true),
    stepSpace: boolean("step_space").notNull().default(true),
    stepFirstTask: boolean("step_first_task").notNull().default(false),
    stepInvite: boolean("step_invite").notNull().default(false),
    stepDueDate: boolean("step_due_date").notNull().default(false),
    stepBoardView: boolean("step_board_view").notNull().default(false),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("user_onboarding_unique").on(t.userId, t.workspaceId)],
);
