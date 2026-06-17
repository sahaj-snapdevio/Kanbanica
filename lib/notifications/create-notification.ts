import { createId } from "@paralleldrive/cuid2";
import { addDays } from "date-fns";
import { db } from "@/lib/db";
import { notification, mutedEntity, userNotificationPreference } from "@/db/schema";
import { and, eq, inArray, or, isNull } from "drizzle-orm";
import type { NotificationTriggerType } from "./types";

export interface CreateNotificationParams {
  workspaceId: string;
  actorId: string | null;
  recipientIds: string[];
  triggerType: NotificationTriggerType;
  entityType: "TASK" | "COMMENT" | "SPACE" | "WORKSPACE" | "SPRINT";
  entityId: string;
  title: string;
  body?: string;
  muteCheckEntityIds?: string[];
}

// Fire-and-forget — never await this in a mutation handler
export function createNotifications(params: CreateNotificationParams): void {
  void _create(params).catch((err) => {
    console.error("[notifications] create failed", err);
  });
}

async function _create(params: CreateNotificationParams) {
  const {
    workspaceId,
    actorId,
    recipientIds,
    triggerType,
    entityType,
    entityId,
    title,
    body,
    muteCheckEntityIds,
  } = params;

  // Remove actor from recipients (no self-notifications), deduplicate
  const eligibleIds = [...new Set(recipientIds.filter((id) => id !== actorId))];
  if (eligibleIds.length === 0) return;

  // Check muted entities — exclude users who muted this task/space
  const entitiesToCheck = muteCheckEntityIds ?? [entityId];
  const mutedRows = await db
    .select({ userId: mutedEntity.userId })
    .from(mutedEntity)
    .where(
      and(
        inArray(mutedEntity.userId, eligibleIds),
        inArray(mutedEntity.entityId, entitiesToCheck),
      ),
    );
  const mutedUserIds = new Set(mutedRows.map((r) => r.userId));
  const finalRecipients = eligibleIds.filter((id) => !mutedUserIds.has(id));
  if (finalRecipients.length === 0) return;

  // Check in-app preferences — only skip if user explicitly disabled in-app for this trigger
  const prefs = await db
    .select({
      userId: userNotificationPreference.userId,
      inAppEnabled: userNotificationPreference.inAppEnabled,
    })
    .from(userNotificationPreference)
    .where(
      and(
        inArray(userNotificationPreference.userId, finalRecipients),
        eq(userNotificationPreference.triggerType, triggerType),
        or(
          isNull(userNotificationPreference.workspaceId),
          eq(userNotificationPreference.workspaceId, workspaceId),
        ),
      ),
    );

  // Build a set of users who have explicitly disabled in-app for this trigger
  const disabledInApp = new Set(
    prefs.filter((p) => !p.inAppEnabled).map((p) => p.userId),
  );
  const notifRecipients = finalRecipients.filter((id) => !disabledInApp.has(id));
  if (notifRecipients.length === 0) return;

  const now = new Date();
  const expiresAt = addDays(now, 90);

  await db.insert(notification).values(
    notifRecipients.map((recipientId) => ({
      id: createId(),
      workspaceId,
      recipientId,
      actorId,
      triggerType,
      entityType,
      entityId,
      title,
      body: body ?? null,
      isRead: false,
      createdAt: now,
      expiresAt,
    })),
  );
}
