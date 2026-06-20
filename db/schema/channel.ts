import { pgEnum, pgTable, text, timestamp, integer, boolean, index, unique } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";

export const channelMemberRoleEnum = pgEnum("channel_member_role", ["ADMIN", "MEMBER"]);

export const channel = pgTable(
  "channel",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("channel_workspace_name_unique").on(t.workspaceId, t.name),
    index("channel_workspace_id_idx").on(t.workspaceId),
  ],
);

export const channelMember = pgTable(
  "channel_member",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: channelMemberRoleEnum("role").notNull().default("MEMBER"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("channel_member_pk").on(t.channelId, t.userId),
    index("channel_member_channel_id_idx").on(t.channelId),
  ],
);

export const channelMessage = pgTable(
  "channel_message",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    senderId: text("sender_id").notNull(),
    content: text("content").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("channel_message_channel_id_idx").on(t.channelId),
    index("channel_message_created_at_idx").on(t.createdAt),
  ],
);

export const channelMessageAttachment = pgTable(
  "channel_message_attachment",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => channelMessage.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by").notNull(),
    fileName: text("file_name").notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("channel_message_attachment_message_id_idx").on(t.messageId)],
);
