import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { supportTicket } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { adminId } = body;

  if (!adminId) return NextResponse.json({ error: "adminId is required" }, { status: 400 });

  const ticket = await db.select({ id: supportTicket.id }).from(supportTicket).where(eq(supportTicket.id, id)).limit(1).then((r) => r[0] ?? null);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.update(supportTicket).set({ assignedTo: adminId, updatedAt: new Date() }).where(eq(supportTicket.id, id));

  return NextResponse.json({ ok: true });
}
