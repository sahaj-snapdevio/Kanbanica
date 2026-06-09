import { lt } from "drizzle-orm";
import { emailEvents } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * email.events-prune-cron — daily sweep that drops `email_events` rows
 * older than 90 days.
 *
 * Each row stores the full EmailIt webhook payload as JSONB; open/click
 * events can be chatty, so without retention the table grows unbounded.
 * 90 days keeps a useful deliverability/bounce history while bounding
 * storage. EmailIt itself remains the system of record for older events.
 */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function handleEmailEventsPruneCron(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const deleted = await db
    .delete(emailEvents)
    .where(lt(emailEvents.receivedAt, cutoff))
    .returning({ id: emailEvents.id });
  if (deleted.length > 0) {
    console.log(
      `[email.events-prune-cron] pruned ${deleted.length} email_events row(s) older than 90d`
    );
  }
}
