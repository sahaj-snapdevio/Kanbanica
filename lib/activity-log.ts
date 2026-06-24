import { createId } from "@paralleldrive/cuid2";
import { activityLog } from "@/db/schema";
import { db } from "@/lib/db";

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
  | "comment_added"
  | "comment_edited"
  | "comment_deleted"
  | "comment_resolved"
  | "comment_unresolved"
  | "subtask_created"
  | "subtask_deleted"
  | "subtask_completed"
  | "sprint_assigned"
  | "sprint_unassigned"
  | "story_points_set"
  | "checklist_item_added"
  | "checklist_item_deleted"
  | "checklist_renamed";

export type ActivityMeta = Record<string, unknown>;

export async function writeActivityLog(
  taskId: string,
  userId: string,
  eventType: ActivityEventType,
  meta: ActivityMeta = {}
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
