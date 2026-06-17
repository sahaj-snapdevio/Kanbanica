import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { supportTicket, supportTicketMessage } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { body: messageBody, isInternalNote = false } = body;

  if (!messageBody?.trim()) return NextResponse.json({ error: "Body is required" }, { status: 400 });

  const ticket = await db.select({ id: supportTicket.id, status: supportTicket.status }).from(supportTicket).where(eq(supportTicket.id, id)).limit(1).then((r) => r[0] ?? null);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [msg] = await db
    .insert(supportTicketMessage)
    .values({
      id: createId(),
      ticketId: id,
      authorId: session.user.id,
      isAdmin: true,
      isInternalNote,
      body: messageBody,
    })
    .returning();

  if (!isInternalNote && ticket.status === "OPEN") {
    await db.update(supportTicket).set({ status: "IN_PROGRESS", updatedAt: new Date() }).where(eq(supportTicket.id, id));
  }

  return NextResponse.json({ message: msg });
}
