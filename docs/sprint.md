# Sprint

## Overview

A Sprint is an optional agile execution layer that sits inside a List. It represents a time-boxed iteration — a fixed period during which a selected set of tasks must be completed.

Sprints are optional. Teams that do not follow agile methodology can ignore them entirely and work directly with Lists and Tasks.

**Real-world analogy:** A Sprint = a 2-week work cycle with a defined goal. e.g. `Sprint 1 — Auth & Onboarding`, `Sprint 12 — Payment Integration`

**Hierarchy position:**
```
Workspace
  └── Space
        └── List
                    └── Sprint (optional)   ← you are here
                          └── Task (assigned to sprint)
```

> Tasks belong to a List. A Sprint is a time-boxed container that pulls tasks from that List into a focused iteration. Tasks are not moved — they are assigned to the sprint while staying in the List.

---

## User Stories

- As a Member with Full Access, I want to create a Sprint with a goal, start date, and end date so the team knows what we are committing to this iteration.
- As a Member, I want to add tasks from the backlog into the Sprint so we have a clear scope.
- As a Member, I want to assign story points to tasks so we can estimate sprint capacity.
- As a Member, I want to see sprint progress (how many tasks are done vs total) so I know if we are on track.
- As a Member, I want to close a Sprint and decide what happens to incomplete tasks — move to backlog or carry over to next sprint.
- As a Member, I want to view past sprints to review what was completed and what was carried over.
- As a Member, I want only one Sprint to be active at a time per List so there is no confusion about what the team is working on now.

---

## Features

### 1. Create Sprint

- **Who can create:** Members with **Full Access** on the Space, Admin, Owner
- Required fields:
  - Sprint Name (required, e.g. `Sprint 1`, `Q3 Week 2`)
  - Start Date (required)
  - Duration in weeks (required — user picks: 1 week / 2 weeks / 3 weeks / 4 weeks)
  - End Date is **auto-calculated** from Start Date + Duration (shown as read-only preview, not manually entered)
- Optional fields:
  - Sprint Goal (short description of what the sprint aims to achieve)
- Sprint settings:
  - **Auto-create next sprint** (toggle — default: off)
    - When enabled: as soon as the current sprint's end date is reached, a new sprint is automatically created with the same duration, starting the day after the current sprint ends
    - Name is auto-incremented (e.g. `Sprint 1` → `Sprint 2`)
    - New sprint starts in **Planned** status — it is NOT auto-started
  - **Auto-close current sprint when next sprint is created** (toggle — only visible when Auto-create is enabled, default: off)
    - When enabled: at the time the new sprint is auto-created, the current sprint is automatically closed
    - When disabled: current sprint remains Active even after the new sprint is created — user must close it manually
  - **Incomplete task strategy** (dropdown — only visible when Auto-close is enabled, default: `move_to_backlog`)
    - `Move to Backlog` — incomplete tasks are unassigned from the sprint and return to the List backlog
    - `Move to Next Sprint` — incomplete tasks are automatically assigned to the newly created sprint. If no planned sprint exists at close time, falls back to Move to Backlog
    - `Leave as-is` — incomplete tasks remain in the closed sprint for reference only (visible in Sprint History)
    - This setting removes the guesswork from automated closes — teams configure their preferred strategy once upfront
- On creation:
  - Sprint status is set to **Planned**
  - No tasks are added yet — tasks are added separately
- A List can have multiple sprints but **only one Active sprint at a time**

---

### 2. Sprint Statuses

| Status | Description |
|--------|-------------|
| Planned | Sprint is created but not started yet |
| Active | Sprint is currently running — start date has passed or was manually started |
| Closed | Sprint has been closed — all tasks settled |

---

### 3. Start Sprint

- **Who can start:** Members with **Full Access**, Admin, Owner
- Changes Sprint status from **Planned** → **Active**
- Can only start if no other Sprint in the same List is already Active
- On start:
  - Sprint start date is locked (cannot be changed after start)
  - Notification sent to all members who have tasks in the Sprint

---

### 4. Add Tasks to Sprint

- Tasks are added to a Sprint from the List's backlog (tasks not yet in any sprint)
- **Who can add:** Members with **Edit** or **Full Access**, Admin, Owner
- A task can only be in **one Sprint at a time**
- Tasks remain in their original List — sprint assignment is an overlay, not a move
- Tasks can be added to a Sprint in any status (Planned or Active)
- Tasks can be removed from a Sprint and returned to the backlog at any time before the Sprint is closed

---

### 5. Story Points

- Story points are a numeric effort estimate per task, used for sprint capacity planning
- Set on the task when adding it to a sprint (or editable from the task detail)
- Field: integer, nullable (no points = not estimated)
- Sprint capacity summary shows:
  - Total story points in the sprint
  - Completed story points (tasks in `closed` status)
  - Remaining story points

---

### 6. Sprint Progress

Visible on the Sprint panel and Sprint detail page.

**Metrics shown:**
- Tasks completed / total tasks (e.g. `8/20`)
- % complete (e.g. `40%`)
- Story points completed / total story points
- Tasks by status (breakdown of how many tasks are in each status)
- Days remaining until sprint end date
- Overdue tasks (past due date and not closed)

**Progress bar:** Visual indicator of `closed tasks / total tasks`.

---

### 7. Close Sprint

- **Who can close:** Members with **Full Access**, Admin, Owner
- Triggered manually — sprints do not auto-close when the end date passes

**Close Sprint modal — step 1: Mark tasks done (optional)**

Before deciding what to do with incomplete tasks, the modal shows a summary:

```
Close Sprint 1 — Auth & Onboarding

  ✅ 14 tasks completed
  ⏳  6 tasks still incomplete

  [ Mark all incomplete tasks as Done ]   ← one-click shortcut

  or handle them individually below ↓
```

- **`Mark all incomplete tasks as Done`** button — sets all incomplete tasks to the List's `closed`-type status in one action before proceeding
- This is the "wrap up the sprint cleanly" shortcut — when the team is done but forgot to close a few tasks
- After clicking, the modal re-evaluates: if all tasks are now closed, the sprint can close immediately with no further decisions needed
- The action is recorded in the Activity Log for each affected task: `"[User] marked task as Done via sprint close"`

**Close Sprint modal — step 2: Handle remaining incomplete tasks**

If any incomplete tasks remain (user skipped step 1 or only some were closed), user must decide what happens to each:

| Option | Description |
|--------|-------------|
| Move to Backlog | Task is removed from the sprint, stays in the List with no sprint assignment |
| Move to Next Sprint | Task is assigned to a selected existing Planned sprint |
| Leave as-is | Task stays in the closed sprint for reference (no further action) |

- User can apply one option to **all remaining incomplete tasks at once** (bulk apply) or handle them individually row by row
- If no Planned sprint exists for "Move to Next Sprint", the option is disabled with a tooltip: `"No planned sprint available — create one first"`

**After closing:**
- Sprint status changes to **Closed**
- No more tasks can be added to the closed sprint
- Sprint data is preserved in Sprint History
- A new Sprint can now be started

---

### 8. Sprint History

- All Closed sprints are listed under Sprint History for the List
- Each closed sprint shows:
  - Sprint name, goal, start date, end date
  - Total tasks, completed tasks, completion rate
  - Total story points, completed story points
  - List of all tasks that were in the sprint (with their final status)
- Sprint History is read-only — closed sprints cannot be reopened or edited

---

### 9. Backlog

- The Backlog is the list of all tasks in the List that are **not assigned to any Sprint**
- Always visible alongside the Sprint view
- Tasks move from Backlog → Sprint (when added) and Sprint → Backlog (when removed or carried over on close)
- Backlog tasks can be created, edited, and managed like any other task

---

## Sprint Board View

When a Sprint is Active, the List's Board View shows only tasks in the active Sprint grouped by status — giving the team a focused Kanban of current sprint work only.

Backlog tasks are hidden from the Board View during an active sprint (accessible via a toggle: `Show Backlog`).

---

## Data Model

```
Sprint
├── id                      (uuid, primary key)
├── list_id                 (foreign key → List)
├── name                    (string, required)
├── goal                    (text, nullable)
├── status                  (enum: planned | active | closed)
├── start_date              (date, required)
├── duration_weeks          (integer, required — 1 | 2 | 3 | 4)
├── end_date                (date, required — calculated: start_date + duration_weeks * 7)
├── auto_create_next        (boolean, default: false)
├── auto_close_on_next      (boolean, default: false — only relevant when auto_create_next = true)
├── auto_incomplete_strategy (enum: move_to_backlog | move_to_next_sprint | leave_as_is, default: move_to_backlog — only relevant when auto_close_on_next = true)
├── started_at              (timestamp, nullable — when sprint was manually started)
├── closed_at               (timestamp, nullable — when sprint was closed)
├── created_by              (foreign key → User)
├── created_at              (timestamp)
└── updated_at              (timestamp)

TaskSprint
├── id                  (uuid, primary key)
├── task_id             (foreign key → Task)
├── sprint_id           (foreign key → Sprint)
├── story_points        (integer, nullable)
└── added_at            (timestamp)
```

> Story points live on `TaskSprint`, not on `Task` directly — the same task may have different story point estimates across different sprints if it is carried over.

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/lists/:listId/sprints` | Create a Sprint | Full Access / Admin+ |
| GET | `/api/lists/:listId/sprints` | Get all Sprints for a List | Space member |
| GET | `/api/sprints/:id` | Get Sprint details and progress | Space member |
| PATCH | `/api/sprints/:id` | Update Sprint (name, goal, end date) | Full Access / Admin+ |
| DELETE | `/api/sprints/:id` | Delete a Planned sprint | Full Access / Admin+ |
| POST | `/api/sprints/:id/start` | Start Sprint | Full Access / Admin+ |
| POST | `/api/sprints/:id/close` | Close Sprint | Full Access / Admin+ |
| POST | `/api/sprints/:id/tasks` | Add task to Sprint | Edit / Full Access / Admin+ |
| DELETE | `/api/sprints/:id/tasks/:taskId` | Remove task from Sprint | Edit / Full Access / Admin+ |
| PATCH | `/api/sprints/:id/tasks/:taskId` | Update story points | Edit / Full Access / Admin+ |
| GET | `/api/lists/:listId/backlog` | Get all backlog tasks (not in any sprint) | Space member |

---

## UI Screens

| Screen | Description | Access |
|--------|-------------|--------|
| Sprint panel (inside List) | Shows Active sprint progress, backlog, planned sprints | All Space members |
| Create Sprint modal | Name, goal, start date, duration (weeks), auto-create toggle, auto-close toggle | Full Access / Admin+ |
| Close Sprint modal | Handle incomplete tasks before closing | Full Access / Admin+ |
| Sprint History page | List of all closed sprints with stats | All Space members |
| Sprint Board View | Kanban of active sprint tasks only | All Space members |

---

## Data Lifecycle

### Archive
- Sprints do not have an Archive state — they use a status-based lifecycle instead:
  `Planned → Active → Closed`
- **Closed** is the terminal state for a Sprint — it functions like a permanent archive.
- Closed Sprint data (name, goal, dates, task list, story points, completion stats) is preserved in Sprint History indefinitely.
- No new tasks can be added to a Closed Sprint.

### Soft Delete
- **Planned Sprints** can be hard-deleted — no soft delete, no recovery.
- **Active and Closed Sprints cannot be deleted** — they are protected once started.
- Closing a Sprint is irreversible — it cannot be reopened.
- `TaskSprint` records for tasks in the sprint are preserved when the sprint is closed (for history).

### Recovery Period
- **Deleted Sprint (Planned only):** No recovery. Hard delete — Sprint record and all `TaskSprint` records for that Sprint are removed. Tasks themselves are unaffected (they return to backlog).
- **Closed Sprint:** Cannot be deleted — always preserved in history. No recovery needed.

### Permanent Deletion Rules
- Only **Planned** Sprints can be deleted (Full Access / Admin+).
- On deletion of a Planned Sprint:
  - The `Sprint` record is permanently deleted.
  - All `TaskSprint` records linking tasks to this sprint are deleted.
  - Tasks that were assigned to this sprint are **not deleted** — they return to the backlog (their `sprint_id` reference is removed).
  - Story points set on `TaskSprint` are lost.
- If the parent List is deleted, all Sprints (Planned, Active, and Closed) are deleted in cascade.
- If the parent Space or Workspace is deleted, all Sprints follow.

---

## Business Rules

1. Sprint is optional — a List can be used with or without sprints.
2. Only one Sprint can be **Active** per List at any time.
3. A Sprint cannot be started if another Sprint in the same List is already Active.
4. A task can only belong to one Sprint at a time within the same List.
5. Tasks are never physically moved out of their List — sprint assignment is a separate relationship.
6. Story points are stored per TaskSprint, not on the Task — so carry-over tasks can be re-estimated in the new sprint.
7. Closing a Sprint shows a two-step modal: (1) optional "Mark all as Done" shortcut, (2) handle any remaining incomplete tasks — move to backlog, move to next sprint, or leave as-is. If all tasks are closed after step 1, step 2 is skipped automatically.
8. A Closed Sprint cannot be reopened.
9. Only Planned sprints can be deleted — Active and Closed sprints cannot be deleted.
10. Sprint end date does not auto-close the sprint unless **Auto-close on next sprint** is enabled.
11. When **Auto-create next sprint** is enabled, a new Planned sprint is created automatically when the end date is reached — it is never auto-started.
12. When **Auto-close on next sprint** is enabled, incomplete tasks are handled according to `auto_incomplete_strategy` — no manual decision prompt since the action is automated. Default strategy is `move_to_backlog`.
13. If `auto_incomplete_strategy = move_to_next_sprint` but no planned sprint exists at close time, the system falls back to `move_to_backlog` and logs a warning in the activity feed: `"Sprint auto-closed — no planned sprint found, incomplete tasks moved to backlog instead."`
14. **Auto-close on next sprint** can only be enabled when **Auto-create next sprint** is also enabled — it has no meaning otherwise.
15. Sprint History is read-only — no edits after closing.
16. Sprints are scoped to a List — they cannot span multiple Lists.

---

## Out of Scope (MVP)

- Burndown chart (visual chart of remaining work over time)
- Velocity tracking (average story points completed per sprint)
- Sprint templates
- Sprint retrospective notes
- Auto-scheduling tasks into sprints
- Cross-List sprints

---

## Implementation Notes

### Auto-Close Job Spec

```typescript
// src/lib/worker/job-types.ts
JOB_NAMES.SPRINT_AUTO_CLOSE = "sprint.auto-close"

interface SprintAutoClosePayload {
  // Empty -- the handler queries all eligible sprints itself
  // Do not pass sprintId -- a cron job handles all eligible sprints in one run
}

QUEUE_OPTIONS[JOB_NAMES.SPRINT_AUTO_CLOSE] = {
  retryLimit: 2,
}
```

**Cron schedule** (register in `scripts/worker.ts`):
```typescript
await boss.schedule(JOB_NAMES.SPRINT_AUTO_CLOSE, '*/15 * * * *', {})
// Runs every 15 minutes
```

**Handler** (`src/lib/worker/handlers/sprint-auto-close.ts`):
1. Query all sprints eligible for auto-close:
   ```sql
   SELECT s.* FROM Sprint s
   WHERE s.status = 'ACTIVE'
     AND s.end_date < CURRENT_DATE
     AND s.auto_close_on_next = true
   ```
2. For each eligible sprint, run the close transaction (see below)
3. If `auto_create_next = true`, create the next sprint (status: PLANNED, start_date = closed sprint end_date + 1 day, same duration)
4. Write `ActivityLog` entry per affected sprint

**Idempotency guard:** At the start of the handler, re-fetch each sprint inside the transaction and check `status = 'ACTIVE'` before acting. If another process already closed it, skip silently.

### Close Sprint Transaction Spec

All three incomplete-task strategies must be handled inside a single `db.$transaction()`:

```typescript
// src/lib/sprints/close-sprint.ts

async function closeSprint(
  sprintId: string,
  strategy: 'move_to_backlog' | 'move_to_next_sprint' | 'leave_as_is',
  targetSprintId?: string,  // required when strategy = 'move_to_next_sprint'
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    // 1. Lock and re-fetch sprint -- idempotency guard
    const sprint = await tx.sprint.findUniqueOrThrow({ where: { id: sprintId } })
    if (sprint.status !== 'ACTIVE') throw new Error('Sprint is not active')

    // 2. Find incomplete tasks (status type != 'CLOSED')
    const incompleteTasks = await tx.taskSprint.findMany({
      where: {
        sprintId,
        task: { status: { type: { not: 'CLOSED' } } }
      },
      include: { task: true }
    })

    // 3. Apply strategy
    if (strategy === 'move_to_backlog') {
      await tx.taskSprint.deleteMany({
        where: { sprintId, taskId: { in: incompleteTasks.map(t => t.taskId) } }
      })
    } else if (strategy === 'move_to_next_sprint') {
      if (!targetSprintId) throw new Error('targetSprintId required for move_to_next_sprint')
      // Verify target sprint exists and is PLANNED
      const target = await tx.sprint.findUniqueOrThrow({ where: { id: targetSprintId } })
      if (target.status !== 'PLANNED') throw new Error('Target sprint must be PLANNED')
      // Move: delete from current, insert into target
      await tx.taskSprint.deleteMany({
        where: { sprintId, taskId: { in: incompleteTasks.map(t => t.taskId) } }
      })
      await tx.taskSprint.createMany({
        data: incompleteTasks.map(t => ({
          taskId: t.taskId,
          sprintId: targetSprintId,
          // story_points preserved from original TaskSprint
          storyPoints: t.storyPoints,
        }))
      })
    }
    // 'leave_as_is' -- no TaskSprint changes, tasks stay linked to closed sprint for history

    // 4. Close the sprint
    await tx.sprint.update({
      where: { id: sprintId },
      data: { status: 'CLOSED', closedAt: new Date() }
    })

    // 5. Write ActivityLog entries
    // One entry per sprint close action + one per task affected
  })
}
```

**Fallback for `move_to_next_sprint` when no PLANNED sprint exists:**
```typescript
// If no targetSprintId and strategy = move_to_next_sprint, fall back to move_to_backlog
// Log a warning to ActivityLog: "Sprint auto-closed — no planned sprint found, incomplete tasks moved to backlog"
```

### Sprint Progress Query

Compute progress on the fly -- do not cache. Called when rendering the Sprint panel:

```typescript
// src/lib/sprints/get-sprint-progress.ts

async function getSprintProgress(sprintId: string) {
  const tasks = await db.taskSprint.findMany({
    where: { sprintId },
    include: {
      task: {
        include: { status: true }
      }
    }
  })

  const total = tasks.length
  const closed = tasks.filter(t => t.task.status.type === 'CLOSED').length
  const totalPoints = tasks.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0)
  const closedPoints = tasks
    .filter(t => t.task.status.type === 'CLOSED')
    .reduce((sum, t) => sum + (t.storyPoints ?? 0), 0)

  return {
    total,
    closed,
    completionPercent: total === 0 ? 0 : Math.round((closed / total) * 100),
    totalPoints,
    closedPoints,
  }
}
```

Add `@@index([sprintId])` on `TaskSprint` to make this query fast as sprint task counts grow.

### One Active Sprint Enforcement

Before starting a sprint, check inside a transaction:
```typescript
const existing = await tx.sprint.findFirst({
  where: { listId, status: 'ACTIVE' }
})
if (existing) throw new ConflictError('A sprint is already active in this list')
```

This check must be inside the transaction that also sets `status = 'ACTIVE'` to prevent a race condition where two sprints are started simultaneously.

### `startSprint` -- Transaction Spec

```typescript
export async function startSprint(sprintId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const sprint = await tx.sprint.findUniqueOrThrow({ where: { id: sprintId } })
    if (sprint.status !== 'PLANNED') throw new Error('Only a PLANNED sprint can be started')

    // One-active enforcement inside the transaction (not a pre-check)
    const activeExists = await tx.sprint.findFirst({
      where: { listId: sprint.listId, status: 'ACTIVE' }
    })
    if (activeExists) throw new ConflictError('A sprint is already active in this list')

    await tx.sprint.update({
      where: { id: sprintId },
      data: { status: 'ACTIVE', startedAt: new Date() }
    })
  })

  // Fire-and-forget: notify all members with tasks in this sprint
  void notifySprintStarted(sprintId, actorId)
}
```

### `deleteSprint` -- Guard Inside Transaction

Active and Closed sprints cannot be deleted. The status check must be inside the transaction:

```typescript
export async function deleteSprint(sprintId: string) {
  return db.$transaction(async (tx) => {
    const sprint = await tx.sprint.findUniqueOrThrow({ where: { id: sprintId } })
    if (sprint.status !== 'PLANNED') {
      throw new ForbiddenError('Only PLANNED sprints can be deleted')
    }

    // Remove TaskSprint records first (tasks themselves are unaffected)
    await tx.taskSprint.deleteMany({ where: { sprintId } })
    await tx.sprint.delete({ where: { id: sprintId } })
  })
}
```

### `addTaskToSprint` -- Uniqueness Enforcement

A task can only be in one non-closed sprint at a time. This cannot be enforced with a DB unique index alone because a task may have historical `TaskSprint` records from closed sprints. Enforce at the application layer:

```typescript
export async function addTaskToSprint(
  taskId: string,
  sprintId: string,
  storyPoints?: number
) {
  return db.$transaction(async (tx) => {
    // Check for existing assignment in any PLANNED or ACTIVE sprint
    const existing = await tx.taskSprint.findFirst({
      where: {
        taskId,
        sprint: { status: { in: ['PLANNED', 'ACTIVE'] } }
      }
    })
    if (existing) throw new ConflictError('Task is already assigned to an active or planned sprint')

    await tx.taskSprint.create({
      data: { taskId, sprintId, storyPoints: storyPoints ?? null }
    })
  })
}
```

Return `409 Conflict` with `{ error: "Task is already in an active sprint. Remove it first." }`.

### Backlog Query -- Tasks Not in Any Active Sprint

"Backlog" = tasks in the List that have no `TaskSprint` record linking them to a PLANNED or ACTIVE sprint.

```typescript
export async function getBacklog(listId: string) {
  // Tasks where no TaskSprint exists for a non-closed sprint
  return db.task.findMany({
    where: {
      listId,
      isArchived: false,
      parentTaskId: null,  // top-level tasks only; subtasks are not sprint-assignable
      NOT: {
        taskSprints: {
          some: {
            sprint: { status: { in: ['PLANNED', 'ACTIVE'] } }
          }
        }
      }
    },
    orderBy: { orderIndex: 'asc' }
  })
}
```

### `mark-all-done` -- Step 1 of Close Sprint Modal

Marks all incomplete tasks in the sprint as the List's first `closed`-type status. Must be atomic.

```typescript
export async function markAllSprintTasksDone(sprintId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const sprint = await tx.sprint.findUniqueOrThrow({
      where: { id: sprintId },
      include: { list: { include: { statuses: { where: { type: 'CLOSED' }, orderBy: { orderIndex: 'asc' }, take: 1 } } } }
    })

    const closedStatus = sprint.list.statuses[0]
    if (!closedStatus) throw new Error('List has no closed status')

    // Find all incomplete tasks (status type != CLOSED)
    const incomplete = await tx.taskSprint.findMany({
      where: { sprintId, task: { status: { type: { not: 'CLOSED' } } } },
      select: { taskId: true }
    })

    if (incomplete.length === 0) return { affected: 0 }

    await tx.task.updateMany({
      where: { id: { in: incomplete.map(t => t.taskId) } },
      data: { statusId: closedStatus.id }
    })

    // ActivityLog entry per task -- fire-and-forget outside transaction
    return { affected: incomplete.length }
  })
}
```

ActivityLog message per task: `"[User] marked task as Done via sprint close"` — written fire-and-forget after the transaction completes.

### Auto-Create Next Sprint -- Name Increment

When `auto_create_next = true` and the sprint closes, a new PLANNED sprint is created. The name is derived by incrementing the trailing number in the current sprint name:

```typescript
function incrementSprintName(name: string): string {
  // "Sprint 1" -> "Sprint 2", "Sprint 12" -> "Sprint 13"
  // "Q3 Week 2" -> "Q3 Week 3"
  // "My Sprint" -> "My Sprint 2" (no trailing number: append 2)
  const match = name.match(/^(.*?)(\d+)$/)
  if (match) return `${match[1]}${parseInt(match[2], 10) + 1}`
  return `${name} 2`
}
```

New sprint: `status = PLANNED`, `startDate = closedSprint.endDate + 1 day`, `durationWeeks = closedSprint.durationWeeks`, `autoCreateNext = closedSprint.autoCreateNext`, `autoCloseOnNext = closedSprint.autoCloseOnNext`, `autoIncompleteStrategy = closedSprint.autoIncompleteStrategy`.

### Folder Mapping

```
src/
  app/api/
    lists/[listId]/
      sprints/route.ts          <- POST (create sprint), GET (list sprints)
      backlog/route.ts          <- GET (tasks not in any active sprint)
    sprints/[id]/
      route.ts                  <- GET, PATCH, DELETE
      start/route.ts            <- POST
      close/route.ts            <- POST (body: { strategy, targetSprintId? })
      mark-all-done/route.ts    <- POST (step 1 of close modal)
      tasks/route.ts            <- POST (add task)
      tasks/[taskId]/route.ts   <- DELETE (remove task), PATCH (story points)
  server/
    sprint.ts                   <- createSprint, startSprint, deleteSprint, addTaskToSprint, markAllSprintTasksDone, closeSprint, getBacklog
    sprint-progress.ts          <- getSprintProgress
  lib/worker/handlers/
    sprint-auto-close.ts
```
