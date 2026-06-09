import { desc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";

/**
 * GET /api/orbit/users/[userId]/email-events
 *
 * Return the most recent transactional-email delivery events tied to this
 * user's email address. Backed by the `email_events` table populated by
 * the EmailIt webhook handler. Limited to the last 200 events so the page
 * stays light.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin(request);
    const { userId } = await params;

    const [target] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (!target) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const events = await db
      .select({
        id: schema.emailEvents.id,
        emailitEventId: schema.emailEvents.emailitEventId,
        eventType: schema.emailEvents.eventType,
        recipient: schema.emailEvents.recipient,
        emailitEmailId: schema.emailEvents.emailitEmailId,
        occurredAt: schema.emailEvents.occurredAt,
        receivedAt: schema.emailEvents.receivedAt,
        payload: schema.emailEvents.payload,
      })
      .from(schema.emailEvents)
      .where(eq(schema.emailEvents.recipient, target.email))
      .orderBy(desc(schema.emailEvents.receivedAt))
      .limit(200);

    return Response.json({
      email: target.email,
      events: events.map((e) => {
        const subject =
          (e.payload as { subject?: string } | null)?.subject ?? null;
        return {
          id: e.id,
          emailitEventId: e.emailitEventId,
          eventType: e.eventType,
          recipient: e.recipient,
          subject,
          emailitEmailId: e.emailitEmailId,
          occurredAt: e.occurredAt?.toISOString() ?? null,
          receivedAt: e.receivedAt.toISOString(),
        };
      }),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET orbit user email-events error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
