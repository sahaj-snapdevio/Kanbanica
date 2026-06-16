import { pgTable, text, timestamp, boolean, json, integer, index, unique } from "drizzle-orm/pg-core";
import { task } from "./task";

export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    parentCommentId: text("parent_comment_id"),
    authorId: text("author_id").notNull(),
    body: json("body").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comment_task_id_idx").on(t.taskId)],
);

export const commentReaction = pgTable("comment_reaction", {
  id: text("id").primaryKey(),
  commentId: text("comment_id")
    .notNull()
    .references(() => comment.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("comment_reaction_unique").on(t.commentId, t.userId, t.emoji)]);

export const activityLog = pgTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    eventType: text("event_type").notNull(),
    meta: json("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_log_task_id_idx").on(t.taskId)],
);

export const taskAttachment = pgTable(
  "task_attachment",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => comment.id),
    uploadedBy: text("uploaded_by").notNull(),
    fileName: text("file_name").notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_attachment_task_id_idx").on(t.taskId)],
);
