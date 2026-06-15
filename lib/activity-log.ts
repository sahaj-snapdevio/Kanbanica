import { db } from "@/lib/db";

interface ActivityLogEntry {
  taskId: string;
  userId: string;
  eventType: string;
  meta?: Record<string, unknown>;
}

/**
 * Fire-and-forget activity log write. Never throws — a failed log entry
 * must not fail the user action that triggered it.
 */
export function writeActivityLog(entry: ActivityLogEntry): void {
  db.activityLog
    .create({
      data: {
        taskId: entry.taskId,
        userId: entry.userId,
        eventType: entry.eventType,
        meta: (entry.meta ?? {}) as object,
      },
    })
    .catch((err) => {
      console.error("[activity-log] write failed:", err);
    });
}
