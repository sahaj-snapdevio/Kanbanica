"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  channel,
  channelMember,
  channelMessage,
  channelMessageAttachment,
  user,
  workspaceMember,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createNotifications } from "@/lib/notifications/create-notification";
import { getWorkspaceMembership } from "@/lib/permissions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return null;
  }
  return session.user;
}

async function requireWorkspaceMember(userId: string, workspaceId: string) {
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    return null;
  }
  return membership;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChannelSummary {
  createdAt: Date;
  id: string;
  name: string;
}

export interface ChannelMemberInfo {
  email: string;
  image: string | null;
  joinedAt: Date;
  name: string;
  role: string;
  userId: string;
}

export interface ChannelMessageInfo {
  attachments: {
    id: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    mimeType: string;
  }[];
  content: string;
  createdAt: Date;
  id: string;
  isDeleted: boolean;
  senderEmail: string;
  senderId: string;
  senderImage: string | null;
  senderName: string | null;
}

// ─── getChannels ──────────────────────────────────────────────────────────────

export async function getChannels(
  workspaceId: string
): Promise<{ channels: ChannelSummary[] } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const channels = await db
    .select({
      id: channel.id,
      name: channel.name,
      createdAt: channel.createdAt,
    })
    .from(channel)
    .where(eq(channel.workspaceId, workspaceId))
    .orderBy(asc(channel.createdAt));

  return { channels };
}

// ─── getChannelDetails ────────────────────────────────────────────────────────

export async function getChannelDetails(
  workspaceId: string,
  channelId: string
): Promise<{ channel: ChannelSummary } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const [ch] = await db
    .select({
      id: channel.id,
      name: channel.name,
      createdAt: channel.createdAt,
    })
    .from(channel)
    .where(and(eq(channel.id, channelId), eq(channel.workspaceId, workspaceId)))
    .limit(1);

  if (!ch) {
    return { error: "Channel not found" };
  }

  return { channel: ch };
}

// ─── createChannel ────────────────────────────────────────────────────────────

export async function createChannel(
  workspaceId: string,
  name: string
): Promise<{ channelId: string } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const trimmed = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_ ]/g, "");
  if (!trimmed || trimmed.length < 1) {
    return { error: "Channel name is required" };
  }
  if (trimmed.length > 50) {
    return { error: "Channel name too long" };
  }

  // Check uniqueness
  const [existing] = await db
    .select({ id: channel.id })
    .from(channel)
    .where(and(eq(channel.workspaceId, workspaceId), eq(channel.name, trimmed)))
    .limit(1);

  if (existing) {
    return { error: `Channel "${trimmed}" already exists` };
  }

  const channelId = createId();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(channel).values({
      id: channelId,
      workspaceId,
      name: trimmed,
      createdBy: sessionUser.id,
      createdAt: now,
      updatedAt: now,
    });

    // Auto-add creator as ADMIN
    await tx.insert(channelMember).values({
      channelId,
      userId: sessionUser.id,
      role: "ADMIN",
      joinedAt: now,
    });
  });

  revalidatePath(`/${workspaceId}`);
  return { channelId };
}

// ─── deleteChannel ────────────────────────────────────────────────────────────

export async function deleteChannel(
  workspaceId: string,
  channelId: string
): Promise<{ ok: true } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  // Only workspace admins/owners or channel admins can delete
  const isWsAdmin = membership.role === "OWNER" || membership.role === "ADMIN";

  if (!isWsAdmin) {
    const [chMember] = await db
      .select({ role: channelMember.role })
      .from(channelMember)
      .where(
        and(
          eq(channelMember.channelId, channelId),
          eq(channelMember.userId, sessionUser.id)
        )
      )
      .limit(1);

    if (!chMember || chMember.role !== "ADMIN") {
      return { error: "Only channel admins can delete channels" };
    }
  }

  await db
    .delete(channel)
    .where(
      and(eq(channel.id, channelId), eq(channel.workspaceId, workspaceId))
    );

  revalidatePath(`/${workspaceId}`);
  return { ok: true };
}

// ─── getChannelMembers ────────────────────────────────────────────────────────

export async function getChannelMembers(
  workspaceId: string,
  channelId: string
): Promise<{ members: ChannelMemberInfo[] } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const rows = await db
    .select({
      userId: channelMember.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      role: channelMember.role,
      joinedAt: channelMember.joinedAt,
    })
    .from(channelMember)
    .innerJoin(user, eq(channelMember.userId, user.id))
    .where(eq(channelMember.channelId, channelId))
    .orderBy(asc(channelMember.joinedAt));

  return {
    members: rows.map((r) => ({
      userId: r.userId,
      name: r.name?.trim() || r.email,
      email: r.email,
      image: r.image ?? null,
      role: r.role,
      joinedAt: r.joinedAt,
    })),
  };
}

// ─── addChannelMember ─────────────────────────────────────────────────────────

export async function addChannelMember(
  workspaceId: string,
  channelId: string,
  userId: string,
  role: "ADMIN" | "MEMBER" = "MEMBER"
): Promise<{ ok: true } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  // Verify target is a workspace member
  const targetMembership = await requireWorkspaceMember(userId, workspaceId);
  if (!targetMembership) {
    return { error: "User is not a workspace member" };
  }

  // Check channel exists and belongs to workspace
  const [ch] = await db
    .select({ id: channel.id })
    .from(channel)
    .where(and(eq(channel.id, channelId), eq(channel.workspaceId, workspaceId)))
    .limit(1);

  if (!ch) {
    return { error: "Channel not found" };
  }

  try {
    await db.insert(channelMember).values({
      channelId,
      userId,
      role,
      joinedAt: new Date(),
    });
  } catch {
    // Already a member — update role instead
    await db
      .update(channelMember)
      .set({ role })
      .where(
        and(
          eq(channelMember.channelId, channelId),
          eq(channelMember.userId, userId)
        )
      );
  }

  return { ok: true };
}

// ─── removeChannelMember ──────────────────────────────────────────────────────

export async function removeChannelMember(
  workspaceId: string,
  channelId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  await db
    .delete(channelMember)
    .where(
      and(
        eq(channelMember.channelId, channelId),
        eq(channelMember.userId, userId)
      )
    );

  return { ok: true };
}

// ─── getChannelMessages ───────────────────────────────────────────────────────

export async function getChannelMessages(
  workspaceId: string,
  channelId: string,
  cursor?: string // ISO date string for pagination
): Promise<
  { messages: ChannelMessageInfo[]; hasMore: boolean } | { error: string }
> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const PAGE_SIZE = 50;

  const conditions = [eq(channelMessage.channelId, channelId)];
  if (cursor) {
    conditions.push(lt(channelMessage.createdAt, new Date(cursor)));
  }

  const rows = await db
    .select({
      id: channelMessage.id,
      senderId: channelMessage.senderId,
      senderName: user.name,
      senderEmail: user.email,
      senderImage: user.image,
      content: channelMessage.content,
      isDeleted: channelMessage.isDeleted,
      createdAt: channelMessage.createdAt,
    })
    .from(channelMessage)
    .leftJoin(user, eq(channelMessage.senderId, user.id))
    .where(and(...conditions))
    .orderBy(desc(channelMessage.createdAt))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Fetch attachments for all messages
  const messageIds = pageRows.map((r) => r.id);
  const attachmentMap = new Map<string, ChannelMessageInfo["attachments"]>();

  if (messageIds.length > 0) {
    const { inArray } = await import("drizzle-orm");
    const attachments = await db
      .select({
        id: channelMessageAttachment.id,
        messageId: channelMessageAttachment.messageId,
        fileName: channelMessageAttachment.fileName,
        fileUrl: channelMessageAttachment.fileUrl,
        fileSize: channelMessageAttachment.fileSize,
        mimeType: channelMessageAttachment.mimeType,
      })
      .from(channelMessageAttachment)
      .where(inArray(channelMessageAttachment.messageId, messageIds))
      .orderBy(asc(channelMessageAttachment.createdAt));

    for (const a of attachments) {
      if (!attachmentMap.has(a.messageId)) {
        attachmentMap.set(a.messageId, []);
      }
      attachmentMap.get(a.messageId)!.push({
        id: a.id,
        fileName: a.fileName,
        fileUrl: `/api/files/${a.fileUrl}`,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
      });
    }
  }

  // Return in chronological order (oldest first)
  const messages: ChannelMessageInfo[] = pageRows.reverse().map((r) => ({
    id: r.id,
    senderId: r.senderId,
    senderName: r.senderName ?? null,
    senderEmail: r.senderEmail ?? "",
    senderImage: r.senderImage ?? null,
    content: r.content,
    isDeleted: r.isDeleted,
    createdAt: r.createdAt,
    attachments: attachmentMap.get(r.id) ?? [],
  }));

  return { messages, hasMore };
}

// ─── sendChannelMessage ───────────────────────────────────────────────────────

export async function sendChannelMessage(
  workspaceId: string,
  channelId: string,
  content: string,
  attachmentIds?: string[],
  mentionedUserIds?: string[]
): Promise<{ messageId: string } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const trimmed = content.trim();
  if (!trimmed && (!attachmentIds || attachmentIds.length === 0)) {
    return { error: "Message cannot be empty" };
  }

  const messageId = createId();
  const now = new Date();

  await db.insert(channelMessage).values({
    id: messageId,
    channelId,
    senderId: sessionUser.id,
    content: trimmed,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  });

  // Link pre-uploaded attachments to this message
  if (attachmentIds && attachmentIds.length > 0) {
    const { inArray } = await import("drizzle-orm");
    await db
      .update(channelMessageAttachment)
      .set({ messageId })
      .where(inArray(channelMessageAttachment.id, attachmentIds));
  }

  // Send mention notifications
  if (mentionedUserIds && mentionedUserIds.length > 0) {
    const [ch] = await db
      .select({ name: channel.name })
      .from(channel)
      .where(eq(channel.id, channelId))
      .limit(1);

    const actorName = sessionUser.name ?? sessionUser.email ?? "Someone";

    void createNotifications({
      workspaceId,
      actorId: sessionUser.id,
      recipientIds: mentionedUserIds,
      triggerType: "mention_comment",
      entityType: "COMMENT",
      entityId: messageId,
      title: `${actorName} mentioned you in #${ch?.name ?? "channel"}`,
      body: trimmed.slice(0, 160),
    });
  }

  return { messageId };
}

// ─── deleteChannelMessage ─────────────────────────────────────────────────────

export async function deleteChannelMessage(
  workspaceId: string,
  channelId: string,
  messageId: string
): Promise<{ ok: true } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const [msg] = await db
    .select({ senderId: channelMessage.senderId })
    .from(channelMessage)
    .where(
      and(
        eq(channelMessage.id, messageId),
        eq(channelMessage.channelId, channelId)
      )
    )
    .limit(1);

  if (!msg) {
    return { error: "Message not found" };
  }

  const isWsAdmin = membership.role === "OWNER" || membership.role === "ADMIN";
  if (msg.senderId !== sessionUser.id && !isWsAdmin) {
    return { error: "You can only delete your own messages" };
  }

  await db
    .update(channelMessage)
    .set({ isDeleted: true, content: "", updatedAt: new Date() })
    .where(eq(channelMessage.id, messageId));

  return { ok: true };
}

// ─── getWorkspaceMembers (for mention autocomplete) ───────────────────────────

export interface MentionableMember {
  email: string;
  id: string;
  image: string | null;
  name: string;
}

export async function getChannelMentionableMembers(
  workspaceId: string
): Promise<{ members: MentionableMember[] } | { error: string }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { error: "Unauthorized" };
  }

  const membership = await requireWorkspaceMember(sessionUser.id, workspaceId);
  if (!membership) {
    return { error: "Unauthorized" };
  }

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(workspaceMember.userId, user.id))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, "ACTIVE")
      )
    );

  return {
    members: rows.map((r) => ({
      id: r.id,
      name: r.name?.trim() || r.email,
      email: r.email,
      image: r.image ?? null,
    })),
  };
}
