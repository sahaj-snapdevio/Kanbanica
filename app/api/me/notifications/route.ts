import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, lt, count } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notification, user } from "@/db/schema";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const { searchParams } = req.nextUrl;
  const filter = searchParams.get("filter") ?? "all";
  const cursor = searchParams.get("cursor");

  const conditions = [eq(notification.recipientId, userId)];

  if (filter === "unread") {
    conditions.push(eq(notification.isRead, false));
  } else if (filter === "mentions") {
    conditions.push(
      inArray(notification.triggerType, ["mention_comment", "mention_description"]),
    );
  }

  if (cursor) {
    conditions.push(lt(notification.createdAt, new Date(cursor)));
  }

  const [notifications, unreadCountResult] = await Promise.all([
    db
      .select({
        id: notification.id,
        workspaceId: notification.workspaceId,
        actorId: notification.actorId,
        triggerType: notification.triggerType,
        entityType: notification.entityType,
        entityId: notification.entityId,
        title: notification.title,
        body: notification.body,
        isRead: notification.isRead,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        actorName: user.name,
        actorImage: user.image,
      })
      .from(notification)
      .leftJoin(user, eq(user.id, notification.actorId))
      .where(and(...conditions))
      .orderBy(desc(notification.createdAt))
      .limit(20),
    db
      .select({ count: count() })
      .from(notification)
      .where(and(eq(notification.recipientId, userId), eq(notification.isRead, false))),
  ]);

  const unreadCount = unreadCountResult[0]?.count ?? 0;

  return NextResponse.json({ notifications, unreadCount });
}
