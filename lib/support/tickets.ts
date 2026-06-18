import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { supportTicket, supportTicketMessage, supportTicketSequence, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { enqueueEmail } from "@/lib/email";
import { supportTicketCreatedTemplate } from "@/lib/email/templates/support-ticket-created";
import { supportTicketReplyTemplate } from "@/lib/email/templates/support-ticket-reply";

export const OPEN_TICKET_LIMIT = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextTicketNumber(tx: any): Promise<string> {
  const rows = await tx.execute(sql`
    UPDATE support_ticket_sequence SET value = value + 1 WHERE id = 1 RETURNING value AS "nextNum"
  `) as { nextNum: number }[];
  const nextNum = rows[0].nextNum;
  return `TKT-${String(nextNum).padStart(4, "0")}`;
}

export async function createTicket({
  userId,
  userEmail,
  subject,
  body,
  category,
}: {
  userId: string;
  userEmail: string;
  subject: string;
  body: string;
  category: "GENERAL" | "TASKS" | "BILLING" | "TECHNICAL" | "OTHER";
}) {
  return db.transaction(async (tx) => {
    // Atomic open-ticket limit check
    const [{ openCount }] = await tx
      .select({ openCount: count() })
      .from(supportTicket)
      .where(and(eq(supportTicket.userId, userId), eq(supportTicket.status, "OPEN")));

    if (openCount >= OPEN_TICKET_LIMIT) {
      return { error: `Open ticket limit reached (${OPEN_TICKET_LIMIT}). Please resolve existing tickets first.`, status: 422 } as const;
    }

    const ticketNumber = await nextTicketNumber(tx);
    const ticketId = createId();
    const now = new Date();

    await tx.insert(supportTicket).values({
      id: ticketId,
      userId,
      ticketNumber,
      subject,
      status: "OPEN",
      category,
      createdAt: now,
      updatedAt: now,
    });

    // Insert initial message as the ticket body
    await tx.insert(supportTicketMessage).values({
      id: createId(),
      ticketId,
      authorId: userId,
      isAdmin: false,
      isInternalNote: false,
      body,
      createdAt: now,
    });

    void audit({
      action: "ticket.created",
      actorId: userId,
      actorEmail: userEmail,
      entityType: "support_ticket",
      entityId: ticketId,
      description: `User created support ticket ${ticketNumber}`,
    });

    // Send confirmation email (fire-and-forget)
    void supportTicketCreatedTemplate({ userEmail, ticketNumber, subject }).then(
      ({ html, text }) =>
        enqueueEmail({ to: userEmail, subject: `Your ticket ${ticketNumber} has been received`, html, text }),
    ).catch(() => {});

    return {
      ticket: { id: ticketId, ticketNumber, status: "OPEN" as const, subject, createdAt: now },
    };
  });
}

export async function replyToTicket({
  ticketId,
  userId,
  userEmail,
  body,
}: {
  ticketId: string;
  userId: string;
  userEmail: string;
  body: string;
}) {
  const ticket = await db
    .select({ id: supportTicket.id, status: supportTicket.status, userId: supportTicket.userId, subject: supportTicket.subject, ticketNumber: supportTicket.ticketNumber })
    .from(supportTicket)
    .where(and(eq(supportTicket.id, ticketId), eq(supportTicket.userId, userId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!ticket) return { error: "Not found", status: 404 } as const;

  const now = new Date();
  const wasReopened = ticket.status === "CLOSED";

  await db.insert(supportTicketMessage).values({
    id: createId(),
    ticketId,
    authorId: userId,
    isAdmin: false,
    isInternalNote: false,
    body,
    createdAt: now,
  });

  // Reopen if closed; otherwise keep current status
  await db
    .update(supportTicket)
    .set({ status: "OPEN", updatedAt: now })
    .where(eq(supportTicket.id, ticketId));

  void audit({
    action: wasReopened ? "ticket.reopened" : "ticket.replied",
    actorId: userId,
    actorEmail: userEmail,
    entityType: "support_ticket",
    entityId: ticketId,
    description: wasReopened
      ? `User reopened ticket ${ticket.ticketNumber} by replying`
      : `User replied to ticket ${ticket.ticketNumber}`,
  });

  return { ok: true, wasReopened };
}

export async function closeTicketByUser({
  ticketId,
  userId,
  userEmail,
}: {
  ticketId: string;
  userId: string;
  userEmail: string;
}) {
  const ticket = await db
    .select({ id: supportTicket.id, ticketNumber: supportTicket.ticketNumber })
    .from(supportTicket)
    .where(and(eq(supportTicket.id, ticketId), eq(supportTicket.userId, userId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!ticket) return { error: "Not found", status: 404 } as const;

  const now = new Date();
  await db
    .update(supportTicket)
    .set({ status: "CLOSED", closedAt: now, closedReason: "user_closed", updatedAt: now })
    .where(eq(supportTicket.id, ticketId));

  void audit({
    action: "ticket.closed",
    actorId: userId,
    actorEmail: userEmail,
    entityType: "support_ticket",
    entityId: ticketId,
    description: `User closed ticket ${ticket.ticketNumber}`,
    metadata: { reason: "user_closed" },
  });

  return { ok: true };
}

// Called by admin when replying — sends email to ticket owner
export async function notifyUserOfAdminReply({
  ticketId,
}: {
  ticketId: string;
}) {
  const row = await db
    .select({
      subject: supportTicket.subject,
      ticketNumber: supportTicket.ticketNumber,
      userEmail: user.email,
    })
    .from(supportTicket)
    .innerJoin(user, eq(supportTicket.userId, user.id))
    .where(eq(supportTicket.id, ticketId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) return;

  void supportTicketReplyTemplate({ userEmail: row.userEmail, ticketNumber: row.ticketNumber, subject: row.subject }).then(
    ({ html, text }) =>
      enqueueEmail({ to: row.userEmail, subject: `New reply on your ticket ${row.ticketNumber}`, html, text }),
  ).catch(() => {});
}
