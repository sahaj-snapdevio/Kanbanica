import { lt } from "drizzle-orm";
import type { Job } from "pg-boss";
import { emailEvents } from "@/db/schema";
import { db } from "@/lib/db";

export async function handleEmailEventsPrune(
  _jobs: Job<Record<string, never>>[]
) {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await db.delete(emailEvents).where(lt(emailEvents.receivedAt, cutoff));
}
