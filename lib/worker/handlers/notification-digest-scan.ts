import type { Job } from "pg-boss";
import { db } from "@/lib/db";
import { userEmailPreference } from "@/db/schema";
import { eq } from "drizzle-orm";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function handleNotificationDigestScan(_jobs: Job<Record<string, never>>[]) {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();

  // Get all users with digest delivery mode
  const digestUsers = await db
    .select()
    .from(userEmailPreference)
    .where(eq(userEmailPreference.deliveryMode, "digest"));

  for (const pref of digestUsers) {
    // Parse digestTime (HH:MM) - treat as UTC since we use simple approach
    const [hours, minutes] = pref.digestTime.split(":").map(Number);
    if (isNaN(hours) || isNaN(minutes)) continue;

    // Check if current time is within 30 min window of digest time
    const digestMinutes = hours * 60 + minutes;
    const currentMinutes = currentHour * 60 + currentMinute;
    const diff = Math.abs(currentMinutes - digestMinutes);
    // Within 30-minute window (1410 = 24*60 - 30 to handle day wrap)
    if (diff > 30 && diff < 1410) continue;

    const windowEnd = now.toISOString();
    const windowStart = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

    await enqueueJob(
      JOB_NAMES.NOTIFICATION_DIGEST_SEND,
      { userId: pref.userId, windowStart, windowEnd },
      { singletonKey: `digest-${pref.userId}-${hours}-${minutes}` },
    );
  }

  console.log("[notification-digest-scan] scanned", digestUsers.length, "digest users");
}
