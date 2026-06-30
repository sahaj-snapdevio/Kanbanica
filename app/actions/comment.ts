"use server";

import { headers } from "next/headers";
import { and, eq, inArray, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { comment, commentReaction, task, taskAttachment, taskWatcher, user } from "@/db/schema";
import { canAccessSpace, getSpacePermission, hasPermissionLevel } from "@/lib/permissions";
import { writeActivityLog } from "@/lib/activity-log";
import { createNotifications } from "@/lib/notifications/create-notification";
import { storage } from "@/lib/storage";
import { revalidatePath } from "next/cache";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommentAttachment {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  url: string;
}

export interface CommentWithReplies {
  id: string;
  taskId: string;
  parentCommentId: string | null;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  authorImage: string | null;
  body: unknown;
  isDeleted: boolean;
  isResolved: boolean;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  reactions: { emoji: string; userIds: string[]; count: number }[];
  attachments: CommentAttachment[];
  replies: CommentWithReplies[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireSpaceAccess(userId: string, workspaceId: string, spaceId: string) {
  const accessible = await canAccessSpace(userId, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" } as const;
  return null;
}

function revalidateTask(workspaceId: string, spaceId: string, listId: string) {
  revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
}

// ─── extractMentionIds ────────────────────────────────────────────────────────

function extractMentionIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const ids: string[] = [];
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "mention" && n.attrs && typeof n.attrs === "object") {
      const attrs = n.attrs as Record<string, unknown>;
      if (typeof attrs.id === "string") ids.push(attrs.id);
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }
  walk(body);
  return [...new Set(ids)];
}

// ─── getTaskComments ──────────────────────────────────────────────────────────

export async function getTaskComments(
  workspaceId: string,
  spaceId: string,
  taskId: string,
): Promise<{ comments: CommentWithReplies[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireSpaceAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  // Fetch all comments for this task (flat)
  const rows = await db
    .select({
      id: comment.id,
      taskId: comment.taskId,
      parentCommentId: comment.parentCommentId,
      authorId: comment.authorId,
      authorName: user.name,
      authorEmail: user.email,
      authorImage: user.image,
      body: comment.body,
      isDeleted: comment.isDeleted,
      isResolved: comment.isResolved,
      resolvedBy: comment.resolvedBy,
      resolvedAt: comment.resolvedAt,
      editedAt: comment.editedAt,
      createdAt: comment.createdAt,
    })
    .from(comment)
    .leftJoin(user, eq(comment.authorId, user.id))
    .where(eq(comment.taskId, taskId))
    .orderBy(asc(comment.createdAt));

  const reactionMap = new Map<string, Map<string, string[]>>();
  const allCommentIds = rows.map((r) => r.id);
  const reactionRows =
    allCommentIds.length > 0
      ? await db
          .select({
            commentId: commentReaction.commentId,
            emoji: commentReaction.emoji,
            userId: commentReaction.userId,
          })
          .from(commentReaction)
          .where(inArray(commentReaction.commentId, allCommentIds))
      : [];

  for (const r of reactionRows) {
    if (!reactionMap.has(r.commentId)) reactionMap.set(r.commentId, new Map());
    const emojiMap = reactionMap.get(r.commentId)!;
    if (!emojiMap.has(r.emoji)) emojiMap.set(r.emoji, []);
    emojiMap.get(r.emoji)!.push(r.userId);
  }

  function buildReactions(commentId: string) {
    const emojiMap = reactionMap.get(commentId);
    if (!emojiMap) return [];
    return Array.from(emojiMap.entries()).map(([emoji, userIds]) => ({
      emoji,
      userIds,
      count: userIds.length,
    }));
  }

  // Fetch attachments for all comments
  const attachmentRows =
    allCommentIds.length > 0
      ? await db
          .select({
            id: taskAttachment.id,
            commentId: taskAttachment.commentId,
            fileName: taskAttachment.fileName,
            fileUrl: taskAttachment.fileUrl,
            mimeType: taskAttachment.mimeType,
            fileSize: taskAttachment.fileSize,
          })
          .from(taskAttachment)
          .where(inArray(taskAttachment.commentId, allCommentIds))
          .orderBy(asc(taskAttachment.createdAt))
      : [];

  const attachmentUrls = await Promise.all(attachmentRows.map((a) => storage.url(a.fileUrl)));
  const attachmentMap = new Map<string, CommentAttachment[]>();
  for (let i = 0; i < attachmentRows.length; i++) {
    const a = attachmentRows[i];
    if (!a.commentId) continue;
    if (!attachmentMap.has(a.commentId)) attachmentMap.set(a.commentId, []);
    attachmentMap.get(a.commentId)!.push({
      id: a.id,
      fileName: a.fileName,
      fileUrl: a.fileUrl,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      url: attachmentUrls[i],
    });
  }

  // Build tree: top-level comments first, then nest replies
  const byId = new Map<string, CommentWithReplies>();
  for (const row of rows) {
    byId.set(row.id, {
      ...row,
      authorName: row.authorName ?? "Deleted User",
      authorEmail: row.authorEmail ?? null,
      authorImage: row.authorImage ?? null,
      body: row.body,
      reactions: buildReactions(row.id),
      attachments: attachmentMap.get(row.id) ?? [],
      replies: [],
    });
  }

  const topLevel: CommentWithReplies[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parentCommentId) {
      byId.get(row.parentCommentId)?.replies.push(node);
    } else {
      topLevel.push(node);
    }
  }

  return { comments: topLevel };
}

// Extract plain text from Tiptap JSON for push notification body preview
function tiptapToPlainText(node: unknown, depth = 0): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.text) return n.text;
  if (n.content) return n.content.map((c) => tiptapToPlainText(c, depth + 1)).join("");
  return "";
}

// ─── createComment ────────────────────────────────────────────────────────────

export async function createComment(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  body: unknown,
  parentCommentId?: string,
): Promise<{ commentId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireSpaceAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  // Fetch task title for push notification
  const [taskRow] = await db
    .select({ title: task.title })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  const taskTitle = taskRow?.title ?? "Task";

  const actorName = session.user.name ?? session.user.email ?? "Someone";
  const commentText = tiptapToPlainText(body).trim();
  const pushBody = commentText
    ? `${actorName}: ${commentText.slice(0, 120)}${commentText.length > 120 ? "…" : ""}`
    : actorName;
  const pushUrl = `/${workspaceId}/task/${taskId}`;

  const id = createId();
  const now = new Date();

  await db.insert(comment).values({
    id,
    taskId,
    parentCommentId: parentCommentId ?? null,
    authorId: session.user.id,
    body,
    isDeleted: false,
    isResolved: false,
    createdAt: now,
    updatedAt: now,
  });

  void writeActivityLog(taskId, session.user.id, "comment_added", { comment_id: id });

  // Fire-and-forget notifications
  const watchers = await db
    .select({ userId: taskWatcher.userId })
    .from(taskWatcher)
    .where(eq(taskWatcher.taskId, taskId));

  const watcherIds = watchers.map((w) => w.userId);

  const commentPreview = commentText ? commentText.slice(0, 160) : undefined;

  // Comment added notification to all watchers
  createNotifications({
    workspaceId,
    actorId: session.user.id,
    recipientIds: watcherIds,
    triggerType: "comment_added",
    entityType: "TASK",
    entityId: taskId,
    title: `${actorName} commented on "${taskTitle}"`,
    body: commentPreview,
    muteCheckEntityIds: [taskId],
    pushTitle: taskTitle,
    pushBody,
    pushUrl,
  });

  // Reply notification to parent comment author
  if (parentCommentId) {
    const [parentComment] = await db
      .select({ authorId: comment.authorId })
      .from(comment)
      .where(eq(comment.id, parentCommentId))
      .limit(1);

    if (parentComment) {
      createNotifications({
        workspaceId,
        actorId: session.user.id,
        recipientIds: [parentComment.authorId],
        triggerType: "comment_reply",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorName} replied to your comment on "${taskTitle}"`,
        body: commentPreview,
        muteCheckEntityIds: [taskId],
        pushTitle: taskTitle,
        pushBody,
        pushUrl,
      });
    }
  }

  // Mention notifications
  const mentionedIds = extractMentionIds(body);
  if (mentionedIds.length > 0) {
    createNotifications({
      workspaceId,
      actorId: session.user.id,
      recipientIds: mentionedIds,
      triggerType: "mention_comment",
      entityType: "TASK",
      entityId: taskId,
      title: `${actorName} mentioned you in "${taskTitle}"`,
      body: commentPreview,
      muteCheckEntityIds: [taskId],
      pushTitle: taskTitle,
      pushBody,
      pushUrl,
    });
  }

  revalidateTask(workspaceId, spaceId, listId);

  return { commentId: id };
}

// ─── editComment ──────────────────────────────────────────────────────────────

export async function editComment(
  workspaceId: string,
  spaceId: string,
  listId: string,
  commentId: string,
  body: unknown,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireSpaceAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [existing] = await db
    .select({ authorId: comment.authorId })
    .from(comment)
    .where(eq(comment.id, commentId))
    .limit(1);

  if (!existing) return { error: "Comment not found" };
  if (existing.authorId !== session.user.id) return { error: "You can only edit your own comments" };

  await db
    .update(comment)
    .set({ body, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(comment.id, commentId));

  revalidateTask(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── deleteComment ────────────────────────────────────────────────────────────

export async function deleteComment(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  commentId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permission = await getSpacePermission(session.user.id, workspaceId, spaceId);
  if (permission === null) return { error: "Forbidden" };

  const [existing] = await db
    .select({ authorId: comment.authorId })
    .from(comment)
    .where(eq(comment.id, commentId))
    .limit(1);

  if (!existing) return { error: "Comment not found" };

  // full_access can delete any comment; others can only delete their own
  const canDeleteAny = hasPermissionLevel(permission, "full_access");
  if (existing.authorId !== session.user.id && !canDeleteAny) {
    return { error: "You don't have permission to delete this comment" };
  }

  // Remove any attachments belonging to this comment first. The
  // task_attachment.commentId FK has no ON DELETE rule, so leaving these rows
  // would block the hard delete below. Delete the storage files before the DB
  // rows (orphaned files are unrecoverable — see CLAUDE.md).
  const attachments = await db
    .select({ id: taskAttachment.id, fileUrl: taskAttachment.fileUrl })
    .from(taskAttachment)
    .where(eq(taskAttachment.commentId, commentId));

  if (attachments.length > 0) {
    await Promise.all(
      attachments.map(async (a) => {
        try {
          await storage.delete(a.fileUrl);
        } catch {
          // Best-effort: a missing storage file must not block comment deletion.
        }
      }),
    );
    await db.delete(taskAttachment).where(eq(taskAttachment.commentId, commentId));
  }

  // Check if has replies
  const [replyRow] = await db
    .select({ id: comment.id })
    .from(comment)
    .where(and(eq(comment.parentCommentId, commentId), eq(comment.isDeleted, false)))
    .limit(1);

  if (replyRow) {
    // Soft delete — keep a tombstone row. `body` is NOT NULL, so clear it to an
    // empty doc (the UI shows "[Comment deleted]" based on isDeleted, not body).
    await db
      .update(comment)
      .set({ body: { type: "doc", content: [] }, isDeleted: true, updatedAt: new Date() })
      .where(eq(comment.id, commentId));
  } else {
    // Hard delete
    await db.delete(comment).where(eq(comment.id, commentId));
  }

  void writeActivityLog(taskId, session.user.id, "comment_deleted", { comment_id: commentId });
  revalidateTask(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── resolveComment / unresolveComment ────────────────────────────────────────

export async function resolveComment(
  workspaceId: string,
  spaceId: string,
  listId: string,
  commentId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireSpaceAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  await db
    .update(comment)
    .set({ isResolved: true, resolvedBy: session.user.id, resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq(comment.id, commentId));

  revalidateTask(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function unresolveComment(
  workspaceId: string,
  spaceId: string,
  listId: string,
  commentId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireSpaceAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  await db
    .update(comment)
    .set({ isResolved: false, resolvedBy: null, resolvedAt: null, updatedAt: new Date() })
    .where(eq(comment.id, commentId));

  revalidateTask(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── toggleReaction ───────────────────────────────────────────────────────────

export async function toggleReaction(
  workspaceId: string,
  spaceId: string,
  commentId: string,
  emoji: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireSpaceAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  // Find any existing reaction by this user on this comment (regardless of emoji)
  const [existing] = await db
    .select({ id: commentReaction.id, emoji: commentReaction.emoji })
    .from(commentReaction)
    .where(
      and(
        eq(commentReaction.commentId, commentId),
        eq(commentReaction.userId, session.user.id),
      ),
    )
    .limit(1);

  if (existing) {
    // Always remove the old reaction first
    await db.delete(commentReaction).where(eq(commentReaction.id, existing.id));
    // If it was the same emoji, this is a toggle-off — we're done
    if (existing.emoji === emoji) return { ok: true };
  }

  // Add the new reaction (replaces the old one, or adds fresh)
  await db.insert(commentReaction).values({
    id: createId(),
    commentId,
    userId: session.user.id,
    emoji,
    createdAt: new Date(),
  });

  return { ok: true };
}
