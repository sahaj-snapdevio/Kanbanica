import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { session, user } from "@/db/schema";
import { getAdminSession } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminSession = await getAdminSession();
  if (!adminSession) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = body.reason ?? null;

  const targetUser = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, id))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (!targetUser) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(user)
    .set({ banned: true, banReason: reason, updatedAt: new Date() })
    .where(eq(user.id, id));
  await db.delete(session).where(eq(session.userId, id));

  await audit({
    action: "user_banned",
    actorId: adminSession.user.id,
    actorEmail: adminSession.user.email,
    entityType: "user",
    entityId: id,
    description: `Admin banned user ${targetUser.email}`,
    metadata: { reason },
  });

  return NextResponse.json({ ok: true });
}
