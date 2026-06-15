"use server";

import { randomUUID } from "crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/worker/boss";
import { JOB_NAMES } from "@/lib/worker/job-types";
import { workspaceInviteEmail } from "@/lib/email/templates/workspace-invite";
import type { WorkspaceMember, WorkspaceRole } from "@prisma/client";

const INVITE_VALIDITY_DAYS = 7;

type ActionResult = { ok: true } | { error: string };

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user;
}

/** Active membership with at least the given role rank, or null. */
async function requireRole(
  userId: string,
  workspaceId: string,
  roles: WorkspaceRole[],
): Promise<WorkspaceMember | null> {
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId, status: "ACTIVE", workspace: { status: "ACTIVE" } },
  });
  if (!member || !roles.includes(member.role)) return null;
  return member;
}

function membersPath(workspaceId: string) {
  return `/${workspaceId}/settings/members`;
}

// ── General settings ─────────────────────────────────────────────────────────

const updateWorkspaceSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  logoEmoji: z.string().trim().max(8).nullable().optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug can contain lowercase letters, numbers and dashes")
    .min(2)
    .max(48)
    .optional(),
});

export async function updateWorkspace(
  input: z.infer<typeof updateWorkspaceSchema>,
): Promise<ActionResult> {
  const user = await getSessionUser();
  const parsed = updateWorkspaceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { workspaceId, ...data } = parsed.data;

  if (!(await requireRole(user.id, workspaceId, ["OWNER", "ADMIN"]))) {
    return { error: "You don't have permission to edit this workspace" };
  }

  if (data.slug) {
    const taken = await db.workspace.findFirst({
      where: { slug: data.slug, id: { not: workspaceId } },
      select: { id: true },
    });
    if (taken) return { error: "This slug is already taken" };
  }

  await db.workspace.update({ where: { id: workspaceId }, data });
  revalidatePath(`/${workspaceId}/settings/general`);
  return { ok: true };
}

// ── Members & invites ────────────────────────────────────────────────────────

const inviteSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role: z.enum(["ADMIN", "MEMBER", "GUEST"]).default("MEMBER"),
});

export async function inviteMember(input: z.infer<typeof inviteSchema>): Promise<ActionResult> {
  const user = await getSessionUser();
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { workspaceId, email, role } = parsed.data;

  const actor = await requireRole(user.id, workspaceId, ["OWNER", "ADMIN"]);
  if (!actor) return { error: "You don't have permission to invite members" };
  // Admin can grant Member/Guest only; promoting to Admin is an Owner action
  if (actor.role === "ADMIN" && role === "ADMIN") {
    return { error: "Only the Owner can invite Admins" };
  }

  const existingUser = await db.user.findUnique({ where: { email }, select: { id: true } });
  const existing = await db.workspaceMember.findFirst({
    where: {
      workspaceId,
      OR: [{ email }, ...(existingUser ? [{ userId: existingUser.id }] : [])],
    },
  });
  if (existing?.status === "ACTIVE") return { error: "This person is already a member" };
  if (existing?.status === "INVITED") return { error: "This email already has a pending invite" };

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true },
  });

  const inviteToken = randomUUID();
  await db.workspaceMember.create({
    data: {
      workspaceId,
      email,
      role,
      status: "INVITED",
      invitedBy: user.id,
      inviteToken,
      inviteExpiresAt: new Date(Date.now() + INVITE_VALIDITY_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  const { subject, html, text } = workspaceInviteEmail({
    workspaceName: workspace.name,
    inviterName: user.name ?? user.email,
    url: `${env.NEXT_PUBLIC_APP_URL}/invite/${inviteToken}`,
  });
  await enqueue(JOB_NAMES.SEND_EMAIL, { to: email, subject, html, text });

  // Getting Started checklist: "Invite a teammate"
  await db.userOnboardingProgress.updateMany({
    where: { userId: user.id, workspaceId, stepInvite: false },
    data: { stepInvite: true },
  });

  revalidatePath(membersPath(workspaceId));
  return { ok: true };
}

export async function cancelInvite(input: {
  workspaceId: string;
  memberId: string;
}): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!(await requireRole(user.id, input.workspaceId, ["OWNER", "ADMIN"]))) {
    return { error: "You don't have permission to manage invites" };
  }
  await db.workspaceMember.deleteMany({
    where: { id: input.memberId, workspaceId: input.workspaceId, status: "INVITED" },
  });
  revalidatePath(membersPath(input.workspaceId));
  return { ok: true };
}

export async function resendInvite(input: {
  workspaceId: string;
  memberId: string;
}): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!(await requireRole(user.id, input.workspaceId, ["OWNER", "ADMIN"]))) {
    return { error: "You don't have permission to manage invites" };
  }

  const invite = await db.workspaceMember.findFirst({
    where: { id: input.memberId, workspaceId: input.workspaceId, status: "INVITED" },
    include: { workspace: { select: { name: true } } },
  });
  if (!invite?.email) return { error: "Invite not found" };

  // Never reuse tokens — fresh uuid on every re-invite (docs/workspace.md)
  const inviteToken = randomUUID();
  await db.workspaceMember.update({
    where: { id: invite.id },
    data: {
      inviteToken,
      inviteExpiresAt: new Date(Date.now() + INVITE_VALIDITY_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  const { subject, html, text } = workspaceInviteEmail({
    workspaceName: invite.workspace.name,
    inviterName: user.name ?? user.email,
    url: `${env.NEXT_PUBLIC_APP_URL}/invite/${inviteToken}`,
  });
  await enqueue(JOB_NAMES.SEND_EMAIL, { to: invite.email, subject, html, text });

  revalidatePath(membersPath(input.workspaceId));
  return { ok: true };
}

const changeRoleSchema = z.object({
  workspaceId: z.string().uuid(),
  memberId: z.string().uuid(),
  role: z.enum(["ADMIN", "MEMBER", "GUEST"]),
});

export async function changeMemberRole(
  input: z.infer<typeof changeRoleSchema>,
): Promise<ActionResult> {
  const user = await getSessionUser();
  const parsed = changeRoleSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { workspaceId, memberId, role } = parsed.data;

  const actor = await requireRole(user.id, workspaceId, ["OWNER", "ADMIN"]);
  if (!actor) return { error: "You don't have permission to manage members" };

  const target = await db.workspaceMember.findFirst({
    where: { id: memberId, workspaceId, status: "ACTIVE" },
  });
  if (!target) return { error: "Member not found" };
  if (target.role === "OWNER") return { error: "Ownership can only be transferred, not changed" };
  if (target.userId === user.id) return { error: "You can't change your own role" };
  // Admin can manage Member and Guest roles only (docs/workspace.md §7)
  if (actor.role === "ADMIN" && (target.role === "ADMIN" || role === "ADMIN")) {
    return { error: "Only the Owner can manage Admin roles" };
  }

  await db.workspaceMember.update({ where: { id: target.id }, data: { role } });
  revalidatePath(membersPath(workspaceId));
  return { ok: true };
}

export async function removeMember(input: {
  workspaceId: string;
  memberId: string;
}): Promise<ActionResult> {
  const user = await getSessionUser();
  const actor = await requireRole(user.id, input.workspaceId, ["OWNER", "ADMIN"]);
  if (!actor) return { error: "You don't have permission to manage members" };

  const target = await db.workspaceMember.findFirst({
    where: { id: input.memberId, workspaceId: input.workspaceId, status: "ACTIVE" },
  });
  if (!target) return { error: "Member not found" };
  if (target.role === "OWNER") return { error: "The Owner can't be removed — transfer ownership first" };
  if (target.userId === user.id) return { error: "You can't remove yourself" };
  if (actor.role === "ADMIN" && target.role === "ADMIN") {
    return { error: "Only the Owner can remove Admins" };
  }

  await db.$transaction(async (tx) => {
    // Removing a member also removes them from all Spaces in this workspace.
    // TaskAssignee records are deliberately preserved (docs/workspace.md §6).
    if (target.userId) {
      await tx.spaceMember.deleteMany({
        where: { userId: target.userId, space: { workspaceId: input.workspaceId } },
      });
    }
    await tx.workspaceMember.delete({ where: { id: target.id } });
  });

  revalidatePath(membersPath(input.workspaceId));
  return { ok: true };
}

const transferSchema = z.object({
  workspaceId: z.string().uuid(),
  targetMemberId: z.string().uuid(),
  confirmName: z.string(),
});

export async function transferOwnership(
  input: z.infer<typeof transferSchema>,
): Promise<ActionResult> {
  const user = await getSessionUser();
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { workspaceId, targetMemberId, confirmName } = parsed.data;

  const owner = await requireRole(user.id, workspaceId, ["OWNER"]);
  if (!owner) return { error: "Only the Owner can transfer ownership" };

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true },
  });
  if (confirmName.trim() !== workspace.name) {
    return { error: "Workspace name doesn't match" };
  }

  const target = await db.workspaceMember.findFirst({
    where: {
      id: targetMemberId,
      workspaceId,
      status: "ACTIVE",
      role: { in: ["ADMIN", "MEMBER"] },
    },
  });
  if (!target) return { error: "Select an active Admin or Member to transfer to" };

  await db.$transaction([
    db.workspaceMember.update({ where: { id: target.id }, data: { role: "OWNER" } }),
    db.workspaceMember.update({ where: { id: owner.id }, data: { role: "ADMIN" } }),
  ]);

  revalidatePath(membersPath(workspaceId));
  return { ok: true };
}

// ── Invite accept / decline (email invites) ──────────────────────────────────

export async function acceptInvite(token: string): Promise<{ workspaceId: string } | { error: string }> {
  const user = await getSessionUser();

  const invite = await db.workspaceMember.findFirst({
    where: { inviteToken: token, status: "INVITED" },
  });
  if (!invite) return { error: "This invite is no longer valid" };
  if (invite.inviteExpiresAt && invite.inviteExpiresAt < new Date()) {
    return { error: "This invite has expired — ask an admin to re-send it" };
  }
  if (invite.email?.toLowerCase() !== user.email.toLowerCase()) {
    return { error: `This invite was sent to ${invite.email}. Sign in with that email to accept it.` };
  }

  const alreadyMember = await db.workspaceMember.findFirst({
    where: { workspaceId: invite.workspaceId, userId: user.id, status: "ACTIVE" },
  });
  if (alreadyMember) {
    await db.workspaceMember.delete({ where: { id: invite.id } });
    return { workspaceId: invite.workspaceId };
  }

  await db.workspaceMember.update({
    where: { id: invite.id },
    data: {
      userId: user.id,
      email: null,
      inviteToken: null,
      inviteExpiresAt: null,
      status: "ACTIVE",
      joinedAt: new Date(),
    },
  });
  return { workspaceId: invite.workspaceId };
}

export async function declineInvite(token: string): Promise<ActionResult> {
  const user = await getSessionUser();
  await db.workspaceMember.deleteMany({
    where: { inviteToken: token, status: "INVITED", email: user.email.toLowerCase() },
  });
  return { ok: true };
}

// ── Invite link ──────────────────────────────────────────────────────────────

export async function regenerateInviteLink(workspaceId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!(await requireRole(user.id, workspaceId, ["OWNER"]))) {
    return { error: "Only the Owner can manage the invite link" };
  }
  await db.workspace.update({
    where: { id: workspaceId },
    data: { inviteLinkToken: randomUUID() },
  });
  revalidatePath(`/${workspaceId}/settings/security`);
  return { ok: true };
}

export async function disableInviteLink(workspaceId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!(await requireRole(user.id, workspaceId, ["OWNER"]))) {
    return { error: "Only the Owner can manage the invite link" };
  }
  await db.workspace.update({ where: { id: workspaceId }, data: { inviteLinkToken: null } });
  revalidatePath(`/${workspaceId}/settings/security`);
  return { ok: true };
}

export async function joinViaInviteLink(
  token: string,
): Promise<{ workspaceId: string } | { error: string }> {
  const user = await getSessionUser();

  const workspace = await db.workspace.findFirst({
    where: { inviteLinkToken: token, status: "ACTIVE" },
    select: { id: true },
  });
  if (!workspace) return { error: "This invite link is no longer active" };

  const existing = await db.workspaceMember.findFirst({
    where: { workspaceId: workspace.id, userId: user.id, status: "ACTIVE" },
  });
  if (existing) return { workspaceId: workspace.id };

  // Absorb a pending email invite for the same person, if any
  await db.workspaceMember.deleteMany({
    where: { workspaceId: workspace.id, email: user.email.toLowerCase(), status: "INVITED" },
  });
  await db.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "MEMBER", // invite links always grant Member (docs/workspace.md rule 7)
      status: "ACTIVE",
      joinedAt: new Date(),
    },
  });
  return { workspaceId: workspace.id };
}

// ── Delete workspace (async — docs/workspace.md Data Lifecycle) ──────────────

export async function deleteWorkspace(input: {
  workspaceId: string;
  confirmName: string;
}): Promise<ActionResult> {
  const user = await getSessionUser();
  const owner = await requireRole(user.id, input.workspaceId, ["OWNER"]);
  if (!owner) return { error: "Only the Owner can delete this workspace" };

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: { name: true },
  });
  if (input.confirmName.trim() !== workspace.name) {
    return { error: "Workspace name doesn't match" };
  }

  // Mark deleting + enqueue in one transaction so the job payload is
  // consistent with DB state; the background job does the actual cascade.
  await db.$transaction(async (tx) => {
    await tx.workspace.update({
      where: { id: input.workspaceId },
      data: { status: "DELETING" },
    });
    await enqueue(
      JOB_NAMES.WORKSPACE_DELETE,
      {
        workspaceId: input.workspaceId,
        requestedBy: user.id,
        requestedAt: new Date().toISOString(),
      },
      { singletonKey: input.workspaceId },
    );
  });

  return { ok: true };
}
