import { and, eq, lt } from "drizzle-orm";
import type { Job } from "pg-boss";
import { supportTicket, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { supportTicketClosedTemplate } from "@/lib/email/templates/support-ticket-closed";

const INACTIVITY_DAYS = 14;

export async function handleSupportTicketAutoClose(
  jobs: Job<{ dryRun?: boolean }>[]
) {
  const dryRun = jobs[0]?.data?.dryRun ?? false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - INACTIVITY_DAYS);

  const staleTickets = await db
    .select({
      id: supportTicket.id,
      ticketNumber: supportTicket.ticketNumber,
      subject: supportTicket.subject,
      userId: supportTicket.userId,
      userEmail: user.email,
    })
    .from(supportTicket)
    .innerJoin(user, eq(supportTicket.userId, user.id))
    .where(
      and(eq(supportTicket.status, "OPEN"), lt(supportTicket.updatedAt, cutoff))
    );

  if (staleTickets.length === 0) {
    console.log("[support.ticket-auto-close] no stale tickets to close");
    return;
  }

  console.log(
    `[support.ticket-auto-close] closing ${staleTickets.length} ticket(s)${dryRun ? " (dry run)" : ""}`
  );

  if (dryRun) {
    return;
  }

  const now = new Date();

  for (const ticket of staleTickets) {
    try {
      await db
        .update(supportTicket)
        .set({
          status: "CLOSED",
          closedAt: now,
          closedReason: "auto_inactivity",
          updatedAt: now,
        })
        .where(eq(supportTicket.id, ticket.id));

      void audit({
        action: "ticket.auto_closed",
        actorId: null,
        entityType: "support_ticket",
        entityId: ticket.id,
        description: `Ticket ${ticket.ticketNumber} auto-closed due to ${INACTIVITY_DAYS} days inactivity`,
        metadata: { reason: "auto_inactivity" },
      });

      void supportTicketClosedTemplate({
        userEmail: ticket.userEmail,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
      })
        .then(({ html, text }) =>
          enqueueEmail({
            to: ticket.userEmail,
            subject: `Your ticket ${ticket.ticketNumber} has been closed`,
            html,
            text,
          })
        )
        .catch(() => {});

      console.log(`[support.ticket-auto-close] closed ${ticket.ticketNumber}`);
    } catch (err) {
      console.error(
        `[support.ticket-auto-close] failed for ticket ${ticket.id}`,
        err
      );
    }
  }
}
