import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { notification } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  await db
    .update(notification)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(notification.id, id),
        eq(notification.recipientId, session.user.id)
      )
    );

  return NextResponse.json({ ok: true });
}
