import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notification } from "@/db/schema";

export async function PATCH(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  await db
    .update(notification)
    .set({ isRead: true, readAt: now })
    .where(
      and(
        eq(notification.recipientId, session.user.id),
        eq(notification.isRead, false),
      ),
    );

  return NextResponse.json({ ok: true });
}
