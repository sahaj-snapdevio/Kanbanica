import { asc, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { supportTicket, supportTicketMessage, user } from "@/db/schema";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const [ticket, messages] = await Promise.all([
    db
      .select({
        id: supportTicket.id,
        ticketNumber: supportTicket.ticketNumber,
        subject: supportTicket.subject,
        status: supportTicket.status,
        category: supportTicket.category,
        assignedTo: supportTicket.assignedTo,
        closedAt: supportTicket.closedAt,
        closedReason: supportTicket.closedReason,
        createdAt: supportTicket.createdAt,
        updatedAt: supportTicket.updatedAt,
        userId: supportTicket.userId,
        userName: user.name,
        userEmail: user.email,
      })
      .from(supportTicket)
      .leftJoin(user, eq(supportTicket.userId, user.id))
      .where(eq(supportTicket.id, id))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: supportTicketMessage.id,
        ticketId: supportTicketMessage.ticketId,
        authorId: supportTicketMessage.authorId,
        isAdmin: supportTicketMessage.isAdmin,
        isInternalNote: supportTicketMessage.isInternalNote,
        body: supportTicketMessage.body,
        createdAt: supportTicketMessage.createdAt,
        authorName: user.name,
        authorEmail: user.email,
      })
      .from(supportTicketMessage)
      .leftJoin(user, eq(supportTicketMessage.authorId, user.id))
      .where(eq(supportTicketMessage.ticketId, id))
      .orderBy(asc(supportTicketMessage.createdAt)),
  ]);

  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ticket, messages });
}
