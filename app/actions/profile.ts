"use server";

import { and, count, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  account,
  channelMember,
  commentReaction,
  mutedEntity,
  notification,
  pushSubscription,
  savedFilter,
  session as sessionTable,
  spaceMember,
  taskAssignee,
  taskWatcher,
  timeLog,
  user,
  userEmailPreference,
  userNotificationPreference,
  userOnboardingProgress,
  userSearchHistory,
  workspaceMember,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/authz";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

export interface ActionState {
  error?: string;
  success?: string;
}

export async function updateNameAction(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Name is required." };
  }
  if (name.length > 100) {
    return { error: "Name must be 100 characters or fewer." };
  }

  await db
    .update(user)
    .set({ name, updatedAt: new Date() })
    .where(eq(user.id, session.user.id));

  await audit({
    action: "profile.name_updated",
    actorEmail: session.user.email,
    actorId: session.user.id,
    description: "Updated profile name",
    entityId: session.user.id,
    entityType: "user",
    metadata: { name },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/profile");
  return { success: "Name updated." };
}


export async function revokeSessionAction(formData: FormData): Promise<void> {
  const current = await requireSession();
  const sessionId = String(formData.get("sessionId") ?? "");

  const [row] = await db
    .select({
      id: sessionTable.id,
      token: sessionTable.token,
      userId: sessionTable.userId,
    })
    .from(sessionTable)
    .where(eq(sessionTable.id, sessionId))
    .limit(1);

  if (!row || row.userId !== current.user.id) {
    return;
  }
  if (row.token === current.session.token) {
    return;
  }

  await db.delete(sessionTable).where(eq(sessionTable.id, sessionId));
  await audit({
    action: "profile.session_revoked",
    actorEmail: current.user.email,
    actorId: current.user.id,
    description: "Revoked an active session",
    entityId: sessionId,
    entityType: "session",
  });

  revalidatePath("/dashboard/profile");
}

export async function signOutOtherSessionsAction(): Promise<void> {
  const current = await requireSession();
  const rows = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, current.user.id),
        ne(sessionTable.token, current.session.token)
      )
    );

  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(sessionTable).where(inArray(sessionTable.id, ids));
  }

  await audit({
    action: "profile.other_sessions_revoked",
    actorEmail: current.user.email,
    actorId: current.user.id,
    description: `Signed out ${ids.length} other session(s)`,
    entityId: current.user.id,
    entityType: "user",
    metadata: { revokedCount: ids.length },
  });

  revalidatePath("/dashboard/profile");
}

export async function deleteAccountAction(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const current = await requireSession();
  const confirmEmail = String(formData.get("confirmEmail") ?? "")
    .trim()
    .toLowerCase();

  const [freshUser] = await db
    .select({ email: user.email, id: user.id, image: user.image })
    .from(user)
    .where(eq(user.id, current.user.id))
    .limit(1);

  if (!freshUser) {
    return { error: "Account not found." };
  }

  if (confirmEmail !== freshUser.email.toLowerCase()) {
    return { error: "Type your email address to confirm deletion." };
  }

  // Block deletion if this user is the sole owner of any workspace
  const ownedWorkspaces = await db
    .select({ workspaceId: workspaceMember.workspaceId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.userId, freshUser.id),
        eq(workspaceMember.role, "OWNER"),
        eq(workspaceMember.status, "ACTIVE"),
      )
    );

  if (ownedWorkspaces.length > 0) {
    const ownedIds = ownedWorkspaces.map((r) => r.workspaceId);
    const ownerCounts = await db
      .select({
        workspaceId: workspaceMember.workspaceId,
        ownerCount: count(),
      })
      .from(workspaceMember)
      .where(
        and(
          inArray(workspaceMember.workspaceId, ownedIds),
          eq(workspaceMember.role, "OWNER"),
          eq(workspaceMember.status, "ACTIVE"),
        )
      )
      .groupBy(workspaceMember.workspaceId);

    const hasSoleOwnership = ownerCounts.some((r) => r.ownerCount === 1);
    if (hasSoleOwnership) {
      return {
        error:
          "You are the sole owner of one or more workspaces. Transfer ownership to another member before deleting your account.",
      };
    }
  }

  // Delete avatar from storage before removing DB record
  if (freshUser.image) {
    try {
      await storage.delete(freshUser.image);
    } catch {
      // Non-fatal — proceed with deletion even if storage cleanup fails
    }
  }

  await audit({
    action: "profile.account_deleted",
    actorEmail: freshUser.email,
    actorId: freshUser.id,
    description: "Deleted account",
    entityId: freshUser.id,
    entityType: "user",
  });

  await db.transaction(async (tx) => {
    // Notification & preferences
    await tx.delete(notification).where(eq(notification.recipientId, freshUser.id));
    await tx.delete(userNotificationPreference).where(eq(userNotificationPreference.userId, freshUser.id));
    await tx.delete(userEmailPreference).where(eq(userEmailPreference.userId, freshUser.id));
    await tx.delete(mutedEntity).where(eq(mutedEntity.userId, freshUser.id));
    await tx.delete(pushSubscription).where(eq(pushSubscription.userId, freshUser.id));
    // Search & filters
    await tx.delete(userSearchHistory).where(eq(userSearchHistory.userId, freshUser.id));
    await tx.delete(savedFilter).where(eq(savedFilter.userId, freshUser.id));
    await tx.delete(userOnboardingProgress).where(eq(userOnboardingProgress.userId, freshUser.id));
    // Task participation
    await tx.delete(taskAssignee).where(eq(taskAssignee.userId, freshUser.id));
    await tx.delete(taskWatcher).where(eq(taskWatcher.userId, freshUser.id));
    await tx.delete(timeLog).where(eq(timeLog.userId, freshUser.id));
    await tx.delete(commentReaction).where(eq(commentReaction.userId, freshUser.id));
    // Memberships (comments & activity logs are intentionally left — "Deleted User" fallback handles them)
    await tx.delete(spaceMember).where(eq(spaceMember.userId, freshUser.id));
    await tx.delete(workspaceMember).where(eq(workspaceMember.userId, freshUser.id));
    await tx.delete(channelMember).where(eq(channelMember.userId, freshUser.id));
    // Auth records last
    await tx.delete(sessionTable).where(eq(sessionTable.userId, freshUser.id));
    await tx.delete(account).where(eq(account.userId, freshUser.id));
    await tx.delete(user).where(eq(user.id, freshUser.id));
  });

  redirect("/login");
}
