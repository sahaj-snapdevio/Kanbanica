"use server";

import { headers } from "next/headers";
import { and, eq, inArray, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { comment, commentReaction, user } from "@/db/schema";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";
import { writeActivityLog } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";

// ─── Types ────────────────────────────────────────────────────────────────────

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

  // Build tree: top-level comments first, then nest replies
  const byId = new Map<string, CommentWithReplies>();
  for (const row of rows) {
    byId.set(row.id, {
      ...row,
      authorName: row.authorName ?? null,
      authorEmail: row.authorEmail ?? null,
      authorImage: row.authorImage ?? null,
      body: row.body,
      reactions: buildReactions(row.id),
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

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(session.user.id, workspaceId),
    canAccessSpace(session.user.id, workspaceId, spaceId),
  ]);
  if (!membership || !accessible) return { error: "Unauthorized" };

  const [existing] = await db
    .select({ authorId: comment.authorId })
    .from(comment)
    .where(eq(comment.id, commentId))
    .limit(1);

  if (!existing) return { error: "Comment not found" };

  const isAdmin = membership.role === "OWNER" || membership.role === "ADMIN";
  if (existing.authorId !== session.user.id && !isAdmin) {
    return { error: "You don't have permission to delete this comment" };
  }

  // Check if has replies
  const [replyRow] = await db
    .select({ id: comment.id })
    .from(comment)
    .where(and(eq(comment.parentCommentId, commentId), eq(comment.isDeleted, false)))
    .limit(1);

  if (replyRow) {
    // Soft delete — keep tombstone
    await db
      .update(comment)
      .set({ body: null, isDeleted: true, updatedAt: new Date() })
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

  const [existing] = await db
    .select({ id: commentReaction.id })
    .from(commentReaction)
    .where(
      and(
        eq(commentReaction.commentId, commentId),
        eq(commentReaction.userId, session.user.id),
        eq(commentReaction.emoji, emoji),
      ),
    )
    .limit(1);

  if (existing) {
    await db.delete(commentReaction).where(eq(commentReaction.id, existing.id));
  } else {
    await db.insert(commentReaction).values({
      id: createId(),
      commentId,
      userId: session.user.id,
      emoji,
      createdAt: new Date(),
    });
  }

  return { ok: true };
}
