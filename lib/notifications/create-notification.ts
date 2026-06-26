import { createId } from "@paralleldrive/cuid2";
import { addDays } from "date-fns";
import { db } from "@/lib/db";
import { notification, mutedEntity, userNotificationPreference } from "@/db/schema";
import { and, eq, inArray, or, isNull } from "drizzle-orm";
import type { NotificationTriggerType } from "./types";
import { sendPushToUser } from "./push";
import { pushToUser } from "@/lib/sse-clients";

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
  // Push-specific overrides — separate from in-app title/body
  pushTitle?: string;
  pushBody?: string;
  pushUrl?: string;
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
    pushTitle,
    pushBody,
    pushUrl,
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

  // Fetch per-trigger preferences for all eligible recipients
  const prefs = await db
    .select({
      userId: userNotificationPreference.userId,
      inAppEnabled: userNotificationPreference.inAppEnabled,
      pushEnabled: userNotificationPreference.pushEnabled,
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

  // Build pref maps — default is enabled if no row exists
  const prefMap = new Map(prefs.map((p) => [p.userId, p]));

  const notifRecipients = finalRecipients.filter((id) => {
    const pref = prefMap.get(id);
    return pref ? pref.inAppEnabled : true; // default on
  });

  const pushRecipients = finalRecipients.filter((id) => {
    const pref = prefMap.get(id);
    return pref ? pref.pushEnabled : true; // default on
  });

  const now = new Date();
  const expiresAt = addDays(now, 90);

  if (notifRecipients.length > 0) {
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
    // Push SSE event to all connected browsers for each recipient
    for (const recipientId of notifRecipients) {
      pushToUser(recipientId, { type: "new_notification" });
    }
  }

  // Send push notifications — fire-and-forget per recipient
  if (pushRecipients.length > 0) {
    await Promise.allSettled(
      pushRecipients.map((userId) =>
        sendPushToUser(userId, {
          title: pushTitle ?? title,
          body: pushBody ?? body ?? "",
          url: pushUrl ?? `/${workspaceId}/task/${entityId}`,
        }),
      ),
    );
  }
}
