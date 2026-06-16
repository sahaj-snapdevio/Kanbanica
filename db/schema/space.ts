import { pgEnum, pgTable, text, timestamp, integer, boolean, index, unique } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";

export const spacePermissionEnum = pgEnum("space_permission", ["FULL_ACCESS", "EDIT", "VIEW"]);

export const space = pgTable(
  "space",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    isPrivate: boolean("is_private").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("space_workspace_id_idx").on(t.workspaceId)],
);

export const spaceMember = pgTable(
  "space_member",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    permission: spacePermissionEnum("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("space_member_unique").on(t.spaceId, t.userId), index("space_member_user_id_idx").on(t.userId)],
);
