import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushSubscription } from "@/db/schema";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { endpoint, p256dh, auth: authKey, userAgent } = body;

  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .where(eq(pushSubscription.endpoint, endpoint))
    .limit(1);

  if (existing) {
    await db
      .update(pushSubscription)
      .set({ p256dh, auth: authKey, userAgent: userAgent ?? null })
      .where(eq(pushSubscription.id, existing.id));
    return NextResponse.json({ id: existing.id });
  }

  const id = createId();
  await db.insert(pushSubscription).values({
    id,
    userId: session.user.id,
    endpoint,
    p256dh,
    auth: authKey,
    userAgent: userAgent ?? null,
    createdAt: new Date(),
  });

  return NextResponse.json({ id }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  await db
    .delete(pushSubscription)
    .where(
      and(
        eq(pushSubscription.endpoint, endpoint),
        eq(pushSubscription.userId, session.user.id),
      ),
    );

  return NextResponse.json({ ok: true });
}
