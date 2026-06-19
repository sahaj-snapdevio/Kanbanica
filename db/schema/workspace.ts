import { pgEnum, pgTable, text, timestamp, integer, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const workspaceStatusEnum = pgEnum("workspace_status", ["ACTIVE", "DELETING"]);
export const workspaceRoleEnum = pgEnum("workspace_role", ["OWNER", "ADMIN", "MEMBER", "GUEST"]);
export const memberStatusEnum = pgEnum("member_status", ["ACTIVE", "INVITED"]);

export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  logoEmoji: text("logo_emoji"),
  inviteLinkToken: text("invite_link_token").unique(),
  taskSeq: integer("task_seq").notNull().default(0),
  status: workspaceStatusEnum("status").notNull().default("ACTIVE"),
  theme: text("theme").notNull().default("forest"),
  appearanceMode: text("appearance_mode").notNull().default("auto"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMember = pgTable(
  "workspace_member",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    email: text("email"),
    role: workspaceRoleEnum("role").notNull(),
    status: memberStatusEnum("status").notNull(),
    invitedBy: text("invited_by"),
    inviteToken: text("invite_token").unique(),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workspace_member_workspace_id_idx").on(t.workspaceId), index("workspace_member_user_id_idx").on(t.userId)],
);
