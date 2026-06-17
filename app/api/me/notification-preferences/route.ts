import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userNotificationPreference } from "@/db/schema";
import { NOTIFICATION_TRIGGERS } from "@/lib/notifications/types";

const ALL_TRIGGERS = Object.values(NOTIFICATION_TRIGGERS);

export async function GET(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await db
    .select()
    .from(userNotificationPreference)
    .where(
      and(
        eq(userNotificationPreference.userId, session.user.id),
        isNull(userNotificationPreference.workspaceId),
      ),
    );

  const prefMap = new Map(existing.map((p) => [p.triggerType, p]));

  const preferences = ALL_TRIGGERS.map((triggerType) => {
    const pref = prefMap.get(triggerType);
    return {
      triggerType,
      inAppEnabled: pref?.inAppEnabled ?? true,
      emailEnabled: pref?.emailEnabled ?? true,
      pushEnabled: pref?.pushEnabled ?? true,
    };
  });

  return NextResponse.json({ preferences });
}

export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const updates = body.preferences as Array<{
    triggerType: string;
    inAppEnabled: boolean;
    emailEnabled: boolean;
    pushEnabled: boolean;
  }>;

  if (!Array.isArray(updates)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const now = new Date();

  for (const update of updates) {
    const existing = await db
      .select({ id: userNotificationPreference.id })
      .from(userNotificationPreference)
      .where(
        and(
          eq(userNotificationPreference.userId, session.user.id),
          eq(userNotificationPreference.triggerType, update.triggerType),
          isNull(userNotificationPreference.workspaceId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(userNotificationPreference)
        .set({
          inAppEnabled: update.inAppEnabled,
          emailEnabled: update.emailEnabled,
          pushEnabled: update.pushEnabled,
          updatedAt: now,
        })
        .where(eq(userNotificationPreference.id, existing[0].id));
    } else {
      await db.insert(userNotificationPreference).values({
        id: createId(),
        userId: session.user.id,
        workspaceId: null,
        triggerType: update.triggerType,
        inAppEnabled: update.inAppEnabled,
        emailEnabled: update.emailEnabled,
        pushEnabled: update.pushEnabled,
        updatedAt: now,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
