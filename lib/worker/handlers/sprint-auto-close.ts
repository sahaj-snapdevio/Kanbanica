import { and, eq, lt } from "drizzle-orm";
import type { Job } from "pg-boss";
import { space, sprint } from "@/db/schema";
import { db } from "@/lib/db";
import { closeSprintAndRollover } from "@/lib/sprint/rollover";

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleSprintAutoClose(
  _jobs: Job<Record<string, never>>[]
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ACTIVE sprints past their end date, in spaces that have "Auto-mark sprint as
  // done" enabled. The space-level settings are the single source of truth (the
  // same toggles the Sprints settings page saves).
  const eligibleSprints = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      spaceId: sprint.spaceId,
      createdBy: sprint.createdBy,
      autoCreateNext: space.sprintAutoCreateNext,
      moveIncomplete: space.sprintAutoMoveIncomplete,
    })
    .from(sprint)
    .innerJoin(space, eq(sprint.spaceId, space.id))
    .where(
      and(
        eq(sprint.status, "ACTIVE"),
        eq(space.sprintAutoMarkDone, true),
        lt(sprint.endDate, today)
      )
    );

  if (eligibleSprints.length === 0) {
    return;
  }

  console.log(
    `[sprint.auto-close] processing ${eligibleSprints.length} sprint(s)`
  );

  for (const s of eligibleSprints) {
    try {
      const { nextSprintId } = await closeSprintAndRollover({
        spaceId: s.spaceId,
        sprintId: s.id,
        actorId: s.createdBy,
        autoCreateNext: s.autoCreateNext,
        incompleteStrategy: s.moveIncomplete
          ? "move_to_next_sprint"
          : "move_to_backlog",
      });
      console.log(
        `[sprint.auto-close] closed "${s.name}" (${s.id})` +
          (nextSprintId ? ` → next sprint ${nextSprintId}` : "")
      );
    } catch (err) {
      console.error(`[sprint.auto-close] failed for sprint ${s.id}`, err);
    }
  }
}
