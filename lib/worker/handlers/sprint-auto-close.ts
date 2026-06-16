import { and, eq, inArray, lt } from "drizzle-orm";
import type { Job } from "pg-boss";
import { sprint, taskSprint, task, listStatus, list } from "@/db/schema";
import { db } from "@/lib/db";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function incrementSprintName(name: string): string {
  const match = name.match(/^(.*?)(\d+)(\s*)$/);
  if (match) return `${match[1]}${parseInt(match[2], 10) + 1}${match[3]}`;
  return `${name} 2`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleSprintAutoClose(
  _jobs: Job<Record<string, never>>[],
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all ACTIVE sprints whose end date has passed and have auto_close_on_next = true
  const eligibleSprints = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      listId: sprint.listId,
      workspaceId: sprint.workspaceId,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      durationWeeks: sprint.durationWeeks,
      autoCreateNext: sprint.autoCreateNext,
      autoCloseOnNext: sprint.autoCloseOnNext,
      autoIncompleteStrategy: sprint.autoIncompleteStrategy,
      createdBy: sprint.createdBy,
    })
    .from(sprint)
    .where(
      and(
        eq(sprint.status, "ACTIVE"),
        eq(sprint.autoCloseOnNext, true),
        lt(sprint.endDate, today),
      ),
    );

  if (eligibleSprints.length === 0) return;

  console.log(`[sprint.auto-close] processing ${eligibleSprints.length} sprint(s)`);

  for (const s of eligibleSprints) {
    try {
      await processAutoClose(s);
    } catch (err) {
      console.error(`[sprint.auto-close] failed for sprint ${s.id}`, err);
    }
  }
}

async function processAutoClose(s: {
  id: string;
  name: string;
  listId: string;
  workspaceId: string;
  startDate: Date | null;
  endDate: Date | null;
  durationWeeks: number;
  autoCreateNext: boolean;
  autoCloseOnNext: boolean;
  autoIncompleteStrategy: "move_to_backlog" | "move_to_next_sprint" | "leave_as_is";
  createdBy: string;
}) {
  // Idempotency: re-fetch inside the operation to confirm it's still ACTIVE
  const [current] = await db
    .select({ status: sprint.status })
    .from(sprint)
    .where(eq(sprint.id, s.id))
    .limit(1);

  if (!current || current.status !== "ACTIVE") {
    console.log(`[sprint.auto-close] sprint ${s.id} is no longer ACTIVE, skipping`);
    return;
  }

  const now = new Date();

  // ── 1. Get incomplete tasks ────────────────────────────────────────────────
  const sprintTasks = await db
    .select({ taskId: taskSprint.taskId, statusType: listStatus.type })
    .from(taskSprint)
    .innerJoin(task, eq(taskSprint.taskId, task.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(and(eq(taskSprint.sprintId, s.id), eq(task.isArchived, false)));

  const incompleteTaskIds = sprintTasks
    .filter((t) => t.statusType !== "CLOSED")
    .map((t) => t.taskId);

  // ── 2. Find (or create) the next planned sprint if needed ─────────────────
  let nextSprintId: string | null = null;

  if (s.autoCreateNext) {
    // Check for an existing PLANNED sprint for this list
    const [existingPlanned] = await db
      .select({ id: sprint.id })
      .from(sprint)
      .where(and(eq(sprint.listId, s.listId), eq(sprint.status, "PLANNED")))
      .limit(1);

    if (existingPlanned) {
      nextSprintId = existingPlanned.id;
    } else {
      // Auto-create the next sprint
      const newStartDate = s.endDate ? addDays(s.endDate, 1) : now;
      const newEndDate = addDays(newStartDate, s.durationWeeks * 7);
      const newName = incrementSprintName(s.name);
      const { createId } = await import("@paralleldrive/cuid2");
      const newId = createId();

      await db.insert(sprint).values({
        id: newId,
        listId: s.listId,
        workspaceId: s.workspaceId,
        name: newName,
        goal: null,
        status: "PLANNED",
        startDate: newStartDate,
        endDate: newEndDate,
        durationWeeks: s.durationWeeks,
        autoCreateNext: s.autoCreateNext,
        autoCloseOnNext: s.autoCloseOnNext,
        autoIncompleteStrategy: s.autoIncompleteStrategy,
        createdBy: s.createdBy,
        createdAt: now,
        updatedAt: now,
      });

      nextSprintId = newId;
      console.log(`[sprint.auto-close] created next sprint "${newName}" (${newId})`);
    }
  }

  // ── 3. Handle incomplete tasks ────────────────────────────────────────────
  if (incompleteTaskIds.length > 0) {
    const strategy = s.autoIncompleteStrategy;

    if (strategy === "move_to_backlog") {
      await db
        .delete(taskSprint)
        .where(
          and(
            eq(taskSprint.sprintId, s.id),
            inArray(taskSprint.taskId, incompleteTaskIds),
          ),
        );
      console.log(`[sprint.auto-close] moved ${incompleteTaskIds.length} task(s) to backlog`);

    } else if (strategy === "move_to_next_sprint" && nextSprintId) {
      await db
        .delete(taskSprint)
        .where(
          and(
            eq(taskSprint.sprintId, s.id),
            inArray(taskSprint.taskId, incompleteTaskIds),
          ),
        );

      await db.insert(taskSprint).values(
        incompleteTaskIds.map((taskId) => ({
          taskId,
          sprintId: nextSprintId!,
          points: null,
          addedAt: now,
        })),
      );
      console.log(`[sprint.auto-close] moved ${incompleteTaskIds.length} task(s) to next sprint`);

    } else if (strategy === "move_to_next_sprint" && !nextSprintId) {
      // Fall back to backlog — no planned sprint available
      await db
        .delete(taskSprint)
        .where(
          and(
            eq(taskSprint.sprintId, s.id),
            inArray(taskSprint.taskId, incompleteTaskIds),
          ),
        );
      console.warn(
        `[sprint.auto-close] strategy=move_to_next_sprint but no planned sprint found — fell back to backlog for sprint ${s.id}`,
      );
    }
    // leave_as_is: no changes to tasks
  }

  // ── 4. Mark sprint as CLOSED ──────────────────────────────────────────────
  await db
    .update(sprint)
    .set({ status: "CLOSED", updatedAt: now })
    .where(eq(sprint.id, s.id));

  console.log(`[sprint.auto-close] closed sprint "${s.name}" (${s.id})`);
}
