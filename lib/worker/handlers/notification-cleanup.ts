import { lt } from "drizzle-orm";
import type { Job } from "pg-boss";
import { notification } from "@/db/schema";
import { db } from "@/lib/db";

export async function handleNotificationCleanup(
  _jobs: Job<Record<string, never>>[]
) {
  const result = await db
    .delete(notification)
    .where(lt(notification.expiresAt, new Date()));
  console.log("[notification-cleanup] expired notifications deleted", result);
}
