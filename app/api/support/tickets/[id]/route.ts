import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { supportTicket, supportTicketMessage } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { closeTicketByUser } from "@/lib/support/tickets";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [ticket, messages] = await Promise.all([
    db
      .select()
      .from(supportTicket)
      .where(
        and(eq(supportTicket.id, id), eq(supportTicket.userId, session.user.id))
      )
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: supportTicketMessage.id,
        authorId: supportTicketMessage.authorId,
        isAdmin: supportTicketMessage.isAdmin,
        body: supportTicketMessage.body,
        createdAt: supportTicketMessage.createdAt,
      })
      .from(supportTicketMessage)
      .where(
        and(
          eq(supportTicketMessage.ticketId, id),
          eq(supportTicketMessage.isInternalNote, false)
        )
      )
      .orderBy(asc(supportTicketMessage.createdAt)),
  ]);

  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ticket, messages });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = body as { action?: string };
  if (action !== "close") {
    return NextResponse.json(
      { error: "Invalid action. Use action: 'close'" },
      { status: 400 }
    );
  }

  const result = await closeTicketByUser({
    ticketId: id,
    userId: session.user.id,
    userEmail: session.user.email,
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({ ok: true });
}
