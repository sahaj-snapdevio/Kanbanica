"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, eq, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { user, workspace, workspaceMember } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { workspaceInviteTemplate } from "@/lib/email/templates/workspace-invite";
import { env } from "@/lib/env";
import { getWorkspaceMembership } from "@/lib/permissions";
import { createNotifications } from "@/lib/notifications/create-notification";
import { refreshWorkspace } from "@/lib/realtime/refresh";

type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

/** "ADMIN" → "Admin" for user-facing notification titles. */
function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return null;
  }
  return session;
}

async function requireAdmin(userId: string, workspaceId: string) {
  const m = await getWorkspaceMembership(userId, workspaceId);
  if (!m || (m.role !== "OWNER" && m.role !== "ADMIN")) {
    return null;
  }
  return m;
}

async function requireOwner(userId: string, workspaceId: string) {
  const m = await getWorkspaceMembership(userId, workspaceId);
  if (!m || m.role !== "OWNER") {
    return null;
  }
  return m;
}

// ── Workspace general ──────────────────────────────────────────────────────

export async function updateWorkspace(data: {
  workspaceId: string;
  name: string;
  slug: string;
  logoEmoji: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }

  const admin = await requireAdmin(session.user.id, data.workspaceId);
  if (!admin) {
    return { error: "Only admins can update the workspace" };
  }

  const name = data.name.trim();
  const slug = data.slug.trim().toLowerCase();
  if (!name) {
    return { error: "Name is required" };
  }
  if (!slug) {
    return { error: "Slug is required" };
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { error: "Invalid slug format" };
  }

  // Check slug uniqueness
  const existing = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.slug, slug), ne(workspace.id, data.workspaceId)));
  if (existing.length > 0) {
    return { error: "That slug is already taken" };
  }

  await db
    .update(workspace)
    .set({ name, slug, logoEmoji: data.logoEmoji, updatedAt: new Date() })
    .where(eq(workspace.id, data.workspaceId));

  void refreshWorkspace(data.workspaceId);
  return { ok: true };
}

// ── Invite link ────────────────────────────────────────────────────────────

export async function regenerateInviteLink(
  workspaceId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }
  const owner = await requireOwner(session.user.id, workspaceId);
  if (!owner) {
    return { error: "Only the owner can manage the invite link" };
  }

  await db
    .update(workspace)
    .set({ inviteLinkToken: createId(), updatedAt: new Date() })
    .where(eq(workspace.id, workspaceId));

  return { ok: true };
}

export async function disableInviteLink(
  workspaceId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }
  const owner = await requireOwner(session.user.id, workspaceId);
  if (!owner) {
    return { error: "Only the owner can manage the invite link" };
  }

  await db
    .update(workspace)
    .set({ inviteLinkToken: null, updatedAt: new Date() })
    .where(eq(workspace.id, workspaceId));

  return { ok: true };
}

// ── Members ────────────────────────────────────────────────────────────────

export async function inviteMember(data: {
  workspaceId: string;
  email: string;
  role: "ADMIN" | "MEMBER" | "GUEST";
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }
  const actor = await requireAdmin(session.user.id, data.workspaceId);
  if (!actor) {
    return { error: "Only admins can invite members" };
  }

  const email = data.email.trim().toLowerCase();
  if (!email) {
    return { error: "Email is required" };
  }

  // Don't duplicate active or pending invite
  const existing = await db
    .select({ id: workspaceMember.id })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, data.workspaceId),
        eq(workspaceMember.email, email)
      )
    );
  if (existing.length > 0) {
    return { error: "This email is already a member or has a pending invite" };
  }

  const inviteToken = createId();

  await db.insert(workspaceMember).values({
    id: createId(),
    workspaceId: data.workspaceId,
    email,
    role: data.role,
    status: "INVITED",
    invitedBy: session.user.id,
    inviteToken,
    inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const ws = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, data.workspaceId))
    .then((r) => r[0]);

  const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${inviteToken}`;
  const inviterName = session.user.name ?? session.user.email ?? "Someone";
  const workspaceName = ws?.name ?? "a workspace";

  console.log(`[invite] ${email} → ${inviteUrl}`);

  const { html, text } = await workspaceInviteTemplate({ inviterName, workspaceName, inviteUrl });
  await enqueueEmail({
    to: email,
    subject: `${inviterName} invited you to ${workspaceName}`,
    html,
    text,
  });

  // In-app notification for invitees who already have an account (others get the email only).
  const [invitedUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (invitedUser) {
    createNotifications({
      workspaceId: data.workspaceId,
      actorId: session.user.id,
      recipientIds: [invitedUser.id],
      triggerType: "workspace_invited",
      entityType: "WORKSPACE",
      // entityId carries the invite TOKEN (not the workspaceId) so clicking the
      // notification opens the accept/decline page — the invitee isn't a member yet.
      entityId: inviteToken,
      title: `${inviterName} invited you to ${workspaceName}`,
    });
  }

  return { ok: true };
}

export async function resendInvite(data: {
  workspaceId: string;
  memberId: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }
  const actor = await requireAdmin(session.user.id, data.workspaceId);
  if (!actor) {
    return { error: "Only admins can resend invites" };
  }

  const newToken = createId();

  const [member] = await db
    .update(workspaceMember)
    .set({
      inviteToken: newToken,
      inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspaceMember.id, data.memberId),
        eq(workspaceMember.workspaceId, data.workspaceId)
      )
    )
    .returning({ email: workspaceMember.email });

  if (member?.email) {
    const ws = await db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, data.workspaceId))
      .then((r) => r[0]);

    const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${newToken}`;
    const inviterName = session.user.name ?? session.user.email ?? "Someone";
    const workspaceName = ws?.name ?? "a workspace";

    // Re-deliver the in-app invite (if the invitee has an account) pointing at the
    // NEW token — the old workspace_invited notification is now stale after rotation.
    const [invitedUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, member.email))
      .limit(1);
    if (invitedUser) {
      createNotifications({
        workspaceId: data.workspaceId,
        actorId: session.user.id,
        recipientIds: [invitedUser.id],
        triggerType: "workspace_invited",
        entityType: "WORKSPACE",
        entityId: newToken,
        title: `${inviterName} invited you to ${workspaceName}`,
      });
    }

    // Email is best-effort (no SMTP in dev) — never let it fail the resend.
    try {
      console.log(`[invite] ${member.email} → ${inviteUrl}`);
      const { html, text } = await workspaceInviteTemplate({ inviterName, workspaceName, inviteUrl });
      await enqueueEmail({
        to: member.email,
        subject: `${inviterName} invited you to ${workspaceName}`,
        html,
        text,
      });
    } catch (err) {
      console.error("[invite] resend email failed", err);
    }
  }

  return { ok: true };
}

export async function acceptInvite(token: string): Promise<
  { workspaceId: string } | { error: string }
> {
  const session = await requireSession();
  if (!session) return { error: "Unauthorized" };

  const [invite] = await db
    .select()
    .from(workspaceMember)
    .where(eq(workspaceMember.inviteToken, token));

  if (!invite) return { error: "Invalid or expired invitation" };
  if (invite.status !== "INVITED") return { error: "This invitation has already been used" };
  if (invite.inviteExpiresAt && invite.inviteExpiresAt < new Date())
    return { error: "This invitation has expired" };

  // Check email matches if invite was for a specific address
  if (invite.email && invite.email !== session.user.email?.toLowerCase())
    return { error: "This invitation was sent to a different email address" };

  await db
    .update(workspaceMember)
    .set({
      userId: session.user.id,
      status: "ACTIVE",
      inviteToken: null,
      inviteExpiresAt: null,
      joinedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workspaceMember.id, invite.id));

  // Notify the inviter that their invitation was accepted.
  if (invite.invitedBy) {
    const accepterName = session.user.name ?? session.user.email ?? "Someone";
    const [wsRow] = await db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, invite.workspaceId))
      .limit(1);
    createNotifications({
      workspaceId: invite.workspaceId,
      actorId: session.user.id,
      recipientIds: [invite.invitedBy],
      triggerType: "invite_accepted",
      entityType: "WORKSPACE",
      entityId: invite.workspaceId,
      title: `${accepterName} accepted your invitation to ${wsRow?.name ?? "your workspace"}`,
    });
  }

  return { workspaceId: invite.workspaceId };
}

export async function declineInvite(token: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) return { error: "Unauthorized" };

  const [invite] = await db
    .select()
    .from(workspaceMember)
    .where(eq(workspaceMember.inviteToken, token));

  if (!invite) return { error: "Invalid or expired invitation" };
  if (invite.status !== "INVITED") return { error: "This invitation has already been used" };
  if (invite.email && invite.email !== session.user.email?.toLowerCase())
    return { error: "This invitation was sent to a different email address" };

  await db.delete(workspaceMember).where(eq(workspaceMember.id, invite.id));

  return { ok: true };
}

export async function cancelInvite(data: {
  workspaceId: string;
  memberId: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }
  const actor = await requireAdmin(session.user.id, data.workspaceId);
  if (!actor) {
    return { error: "Only admins can cancel invites" };
  }

  await db
    .delete(workspaceMember)
    .where(
      and(
        eq(workspaceMember.id, data.memberId),
        eq(workspaceMember.workspaceId, data.workspaceId),
        eq(workspaceMember.status, "INVITED")
      )
    );

  return { ok: true };
}

export async function changeMemberRole(data: {
  workspaceId: string;
  memberId: string;
  role: "ADMIN" | "MEMBER" | "GUEST";
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }
  const actor = await requireAdmin(session.user.id, data.workspaceId);
  if (!actor) {
    return { error: "Only admins can change roles" };
  }

  const target = await db
    .select({ role: workspaceMember.role, userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.id, data.memberId),
        eq(workspaceMember.workspaceId, data.workspaceId)
      )
    );

  if (!target.length) {
    return { error: "Member not found" };
  }
  if (target[0].role === "OWNER") {
    return { error: "Cannot change owner's role" };
  }
  if (actor.role === "ADMIN" && target[0].role === "ADMIN") {
    return { error: "Admins cannot change other admins" };
  }
  if (actor.role === "ADMIN" && data.role === "ADMIN") {
    return { error: "Admins cannot grant Admin role" };
  }

  await db
    .update(workspaceMember)
    .set({ role: data.role, updatedAt: new Date() })
    .where(eq(workspaceMember.id, data.memberId));

  if (target[0].userId) {
    createNotifications({
      workspaceId: data.workspaceId,
      actorId: session.user.id,
      recipientIds: [target[0].userId],
      triggerType: "role_changed",
      entityType: "WORKSPACE",
      entityId: data.workspaceId,
      title: `Your workspace role was changed to ${roleLabel(data.role)}`,
    });
  }

  return { ok: true };
}

export async function removeMember(data: {
  workspaceId: string;
  memberId: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }
  const actor = await requireAdmin(session.user.id, data.workspaceId);
  if (!actor) {
    return { error: "Only admins can remove members" };
  }

  const target = await db
    .select({ role: workspaceMember.role, userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.id, data.memberId),
        eq(workspaceMember.workspaceId, data.workspaceId)
      )
    );

  if (!target.length) {
    return { error: "Member not found" };
  }
  if (target[0].role === "OWNER") {
    return { error: "Cannot remove the owner" };
  }
  if (target[0].userId === session.user.id) {
    return { error: "Cannot remove yourself" };
  }

  await db.delete(workspaceMember).where(eq(workspaceMember.id, data.memberId));

  // Notify the removed member so they understand why they lost access.
  if (target[0].userId) {
    const actorName = session.user.name ?? session.user.email ?? "Someone";
    const [wsRow] = await db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, data.workspaceId))
      .limit(1);
    createNotifications({
      workspaceId: data.workspaceId,
      actorId: session.user.id,
      recipientIds: [target[0].userId],
      triggerType: "workspace_removed",
      entityType: "WORKSPACE",
      entityId: data.workspaceId,
      title: `${actorName} removed you from ${wsRow?.name ?? "the workspace"}`,
    });
  }

  return { ok: true };
}

export async function transferOwnership(data: {
  workspaceId: string;
  targetMemberId: string;
  confirmName: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }
  const owner = await requireOwner(session.user.id, data.workspaceId);
  if (!owner) {
    return { error: "Only the owner can transfer ownership" };
  }

  const [ws] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, data.workspaceId));
  if (!ws) {
    return { error: "Workspace not found" };
  }
  if (data.confirmName.trim() !== ws.name.trim()) {
    return { error: "Workspace name does not match" };
  }

  const [ownerMember] = await db
    .select({ id: workspaceMember.id })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, data.workspaceId),
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.status, "ACTIVE")
      )
    );

  await db.transaction(async (tx) => {
    await tx
      .update(workspaceMember)
      .set({ role: "OWNER", updatedAt: new Date() })
      .where(eq(workspaceMember.id, data.targetMemberId));
    if (ownerMember) {
      await tx
        .update(workspaceMember)
        .set({ role: "ADMIN", updatedAt: new Date() })
        .where(eq(workspaceMember.id, ownerMember.id));
    }
  });

  return { ok: true };
}

export async function deleteWorkspace(data: {
  workspaceId: string;
  confirmName: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }
  const owner = await requireOwner(session.user.id, data.workspaceId);
  if (!owner) {
    return { error: "Only the owner can delete the workspace" };
  }

  const [ws] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, data.workspaceId));
  if (!ws) {
    return { error: "Workspace not found" };
  }
  if (data.confirmName.trim() !== ws.name.trim()) {
    return { error: "Workspace name does not match" };
  }

  await db
    .update(workspace)
    .set({ status: "DELETING", updatedAt: new Date() })
    .where(eq(workspace.id, data.workspaceId));

  return { ok: true };
}

export async function updateWorkspaceTheme(data: {
  workspaceId: string;
  theme: string;
  appearanceMode: "light" | "dark" | "auto";
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!session) {
    return { error: "Unauthorized" };
  }

  const admin = await requireAdmin(session.user.id, data.workspaceId);
  if (!admin) {
    return { error: "Only admins can update workspace theme settings" };
  }

  await db
    .update(workspace)
    .set({
      theme: data.theme,
      appearanceMode: data.appearanceMode,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, data.workspaceId));

  return { ok: true };
}
