import { createId } from "@paralleldrive/cuid2";
import { db } from "@/lib/db";
import { activityLog } from "@/db/schema";

export type ActivityEventType =
  | "task_created"
  | "title_changed"
  | "status_changed"
  | "priority_changed"
  | "description_updated"
  | "assignee_added"
  | "assignee_removed"
  | "watcher_added"
  | "watcher_removed"
  | "due_date_set"
  | "due_date_changed"
  | "due_date_removed"
  | "tag_added"
  | "tag_removed"
  | "checklist_created"
  | "checklist_deleted"
  | "checklist_item_checked"
  | "checklist_item_unchecked"
  | "dependency_added"
  | "dependency_removed"
  | "attachment_uploaded"
  | "attachment_deleted"
  | "task_moved"
  | "task_archived"
  | "task_unarchived"
  | "time_logged"
  | "comment_added";

export type ActivityMeta = Record<string, unknown>;

export async function writeActivityLog(
  taskId: string,
  userId: string,
  eventType: ActivityEventType,
  meta: ActivityMeta = {},
): Promise<void> {
  try {
    await db.insert(activityLog).values({
      id: createId(),
      taskId,
      userId,
      eventType,
      meta,
    });
  } catch {
    // Activity logging is fire-and-forget — never block the main action
  }
}
