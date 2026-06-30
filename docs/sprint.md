# Sprint

## Overview

A Sprint is an optional agile execution layer that sits directly inside a Project (alongside Lists). It represents a time-boxed iteration — a fixed period during which a selected set of tasks must be completed.

Sprints are optional. Teams that do not follow agile methodology can ignore them entirely and work directly with Lists and Tasks.

**Real-world analogy:** A Sprint = a 2-week work cycle with a defined goal. e.g. `Sprint 1 — Auth & Onboarding`, `Sprint 12 — Payment Integration`

**Hierarchy position:**
```
Workspace
  └── Project
        ├── List (default + user-created)
        │     └── Task
        └── Sprint (optional)   ← you are here
              └── Task (assigned from any List in this Project)
```

> Tasks belong to a List. A Sprint is a time-boxed container that pulls tasks from **any List within the same Project** into a focused iteration. Tasks are not moved — they are assigned to the sprint while staying in their List.

---

## User Stories

- As a Member with Full Access, I want to create a Sprint with a goal, start date, and end date so the team knows what we are committing to this iteration.
- As a Member, I want to add tasks from any List in the Project into the Sprint so we have a clear scope.
- As a Member, I want to assign story points to tasks so we can estimate sprint capacity.
- As a Member, I want to see sprint progress (how many tasks are done vs total) so I know if we are on track.
- As a Member, I want to close a Sprint and decide what happens to incomplete tasks — move to backlog or carry over to next sprint.
- As a Member, I want to view past sprints to review what was completed and what was carried over.
- As a Member, I want only one Sprint to be active at a time per Project so there is no confusion about what the team is working on now.

---

## Features

### 1. Create Sprint

- **Who can create:** Members with **Full Access** on the Space, Admin, Owner
- Required fields:
  - Sprint Name (required, e.g. `Sprint 1`, `Q3 Week 2`) — pre-filled from smart defaults (see [Sprint Settings](#sprint-settings))
  - Start Date (required) — pre-filled to the next occurrence of the project's configured `sprint_start_day`
  - End Date (required) — pre-filled to Start Date + `sprint_default_duration_weeks`; user can adjust freely
  - Both dates are shown as side-by-side date pickers. The Start Date calendar constrains selectable days to the configured `sprint_start_day` (e.g. only Mondays if start day = Monday), preventing misaligned sprint starts. End Date is unconstrained.
- Optional fields:
  - Sprint Goal (short description of what the sprint aims to achieve)
- On creation:
  - Sprint status is set to **Planned**
  - No tasks are added yet — tasks are added separately
- A Project can have multiple sprints but **only one Active sprint at a time**

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
- Can only start if no other Sprint in the same Project is already Active
- On start:
  - Sprint start date is locked (cannot be changed after start)
  - Notification sent to all members who have tasks in the Sprint

---

### 4. Add Tasks to Sprint

- Tasks are added to a Sprint from the Project backlog — tasks in any List within the Project that are not yet in any sprint
- **Who can add:** Members with **Edit** or **Full Access**, Admin, Owner
- A task can only be in **one Sprint at a time**
- Tasks remain in their original List — sprint assignment is an overlay, not a move
- Tasks can be added to a Sprint in any status (Planned or Active)
- Tasks can be removed from a Sprint and returned to the backlog at any time before the Sprint is closed

---

### 4a. Bulk Move Tasks (List & Sprint Views)

Both the **List view** and **Sprint view** expose a floating bulk action bar when one or more tasks are selected via checkboxes. The bulk action bar includes a **Move** option for sprint-related operations.

Both views expose a single **Move** button in the floating bulk action bar. Clicking it opens a popover with two sections: **Sprint** and **List**.

#### Move → Sprint

| Context | Behaviour |
|---------|-----------|
| List view | Shows all PLANNED and ACTIVE sprints for the current Project. Selecting one adds the tasks to that sprint (removes from any current sprint first). |
| Sprint view | Shows all OTHER PLANNED/ACTIVE sprints in the Project (current sprint excluded). Selecting one moves the tasks out of the current sprint into the target. |

#### Move → List

Available in both views. Shows all non-archived lists in the workspace, grouped by Space, excluding the current list.

When moved to another list:
- Status is remapped by name match (e.g. "In Progress" → "In Progress"). If no match, falls back to the first `OPEN`-type status in the target list.
- Any active sprint assignment is cleared — the task returns to the backlog of the target list (sprint scoping is per-list).
- All other task data (description, assignees, comments, attachments, tags, activity) is preserved.
- Activity log records a `task_moved` event with `fromListId` / `toListId`.

#### Backlog (Sprint view only)

A separate **Backlog** button (distinct from Move) removes selected tasks from the current sprint and returns them to the current list's backlog without changing their list or status.

#### Rules

- Only PLANNED and ACTIVE sprints appear as move targets — CLOSED sprints are excluded.
- The current sprint is excluded from the sprint list in the Sprint view.
- The current list is excluded from the list picker.
- Move to List requires **Edit** access (same as `moveTask`). Sprint move requires **Full Access**.
- After any bulk move the view refreshes automatically.

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
- Triggered manually, **or** automatically by the background worker when the space has **Auto-mark sprint as done** enabled and the sprint's end date has passed (see [Sprint Settings](#sprint-settings) and [Auto-Close Job Spec](#auto-close-job-spec))
- Both paths run the same shared logic — `closeSprintAndRollover()` in `lib/sprint/rollover.ts`

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
| Move to Next Sprint | Task is assigned to a selected existing Planned sprint — or, when the space has **Auto-create next sprint** enabled, to a newly auto-created next sprint |
| Leave as-is | Task stays in the closed sprint for reference (no further action) |

- User can apply one option to **all remaining incomplete tasks at once** (bulk apply) or handle them individually row by row
- "Move to Next Sprint" behaviour depends on the space's **Auto-create next sprint** setting:
  - **Enabled:** no existing Planned sprint is required — the modal shows _"A new sprint will be created automatically"_ and `closeSprintAndRollover()` creates it (or reuses an existing PLANNED sprint) and carries the tasks over
  - **Disabled:** an existing Planned sprint must be selected; if none exists the option is disabled with a tooltip: `"No planned sprint available — create one first"`

**After closing:**
- Sprint status changes to **Closed**
- No more tasks can be added to the closed sprint
- Sprint data is preserved in Sprint History
- A new Sprint can now be started

---

### 8. Sprint History

Closed sprints are accessible from two places:

**1. Past Sprints section in the Sprint Panel**
- A "Past Sprints" collapsible row appears at the bottom of the Sprint Panel (below the Backlog count) whenever any CLOSED sprints exist
- Shows all closed sprints as a list with a green checkmark icon, sprint name, and date range
- Clicking any closed sprint navigates to `/{workspaceId}/{spaceId}/sprint/{sprintId}`

**2. Closed Sprint View (accessed via sprint URL)**
- When navigating to a sprint that has status = CLOSED, the page renders `ClosedSprintView` instead of the active sprint view
- `ClosedSprintView` is read-only and shows:
  - **Header card:** Sprint name, goal, start date → end date, "Closed" badge
  - **Stats bar:** Completion % with progress bar, tasks done / total, story points done / total (if any tasks have story points)
  - **Task table:** All tasks grouped by status, each row showing title, status pill, assignee avatars, priority, story points, due date
  - Clicking any task row navigates to the task detail page
- Sprint History is read-only — closed sprints cannot be reopened or edited

---

### 9. Backlog

- The Backlog is the list of all tasks across **all Lists in the Project** that are **not assigned to any Sprint** (PLANNED or ACTIVE)
- Visible via a **"Show Backlog"** toggle button below the Sprint List View
- Tasks move from Backlog → Sprint (when added via "Add to Sprint") and Sprint → Backlog (when removed or carried over on close)
- Backlog tasks are grouped by their originating List for clarity; each list group is collapsible
- Each task row shows: status dot, title, seq number (on hover), priority badge, assignee avatars
- **"Add to Sprint"** button appears on hover per task — opens a popover listing PLANNED and ACTIVE sprints to choose from
- Backlog refreshes automatically when a task is added to a sprint or when the sprint view refreshes

**UI Spec:**
- Toggle button: `Show Backlog / Hide Backlog` (with TrayIcon) — placed below SprintListView
- Backlog section header: "Backlog" with total task count badge
- Per List group header: collapsible (caret icon + list name + task count)
- Per task row: `[status dot] [title] [#seq on hover] [priority] [assignees] [Add to Sprint button on hover]`
- Empty state: "All tasks are in a sprint" with descriptive subtext
- Clicking a task row navigates to task detail page

**Data source:** `getBacklogTasks(workspaceId, spaceId)` — queries all lists in the space, excludes tasks in PLANNED/ACTIVE sprints, returns grouped by list with status, priority, and assignee data.

---

## Sprint Board View

The Sprint has its own Board View showing all tasks assigned to the active Sprint grouped by status — giving the team a focused Kanban of current sprint work only. Tasks may come from different Lists within the Project.

The Project Backlog is accessible via a toggle: `Show Backlog` — it displays all unassigned tasks from all Lists in the Project.

**Creating tasks from the sprint view:** `getActiveSprintView()` returns a `defaultListId` so that tasks quick-created inside the sprint land in a real List instead of "No Status". It resolves to the first List among the sprint's existing tasks, falling back to the space's first non-archived List.

---

## Data Model

```
Sprint
├── id                      (uuid, primary key)
├── space_id                (foreign key → Space/Project)
├── name                    (string, required)
├── goal                    (text, nullable)
├── status                  (enum: planned | active | closed)
├── start_date              (date, required)
├── duration_weeks          (integer, required — 1 | 2 | 3 | 4)
├── end_date                (date, required — calculated: start_date + duration_weeks * 7)
├── auto_create_next        (boolean, default: false — LEGACY/display only, see note below)
├── auto_close_on_next      (boolean, default: false — LEGACY/display only)
├── auto_incomplete_strategy (enum: move_to_backlog | move_to_next_sprint | leave_as_is, default: move_to_backlog — LEGACY/display only)
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

> **Auto-close source of truth:** the `auto_create_next` / `auto_close_on_next` / `auto_incomplete_strategy` columns on `Sprint` are legacy/display fields. Auto-close behaviour is now driven by **space-level** settings — `space.sprint_auto_mark_done`, `space.sprint_auto_create_next`, `space.sprint_auto_move_incomplete` (see [Sprint Settings](#sprint-settings)). Both the manual close action and the background worker read these space settings.

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/spaces/:spaceId/sprints` | Create a Sprint | Full Access / Admin+ |
| GET | `/api/spaces/:spaceId/sprints` | Get all Sprints for a Project | Project member |
| GET | `/api/sprints/:id` | Get Sprint details and progress | Project member |
| PATCH | `/api/sprints/:id` | Update Sprint (name, goal, end date) | Full Access / Admin+ |
| DELETE | `/api/sprints/:id` | Delete a Planned sprint | Full Access / Admin+ |
| POST | `/api/sprints/:id/start` | Start Sprint | Full Access / Admin+ |
| POST | `/api/sprints/:id/close` | Close Sprint | Full Access / Admin+ |
| POST | `/api/sprints/:id/tasks` | Add task to Sprint | Edit / Full Access / Admin+ |
| DELETE | `/api/sprints/:id/tasks/:taskId` | Remove task from Sprint | Edit / Full Access / Admin+ |
| PATCH | `/api/sprints/:id/tasks/:taskId` | Update story points | Edit / Full Access / Admin+ |
| GET | `/api/spaces/:spaceId/backlog` | Get all backlog tasks in the Project (not in any sprint) | Project member |

---

## UI Screens

| Screen | Description | Access |
|--------|-------------|--------|
| Sprint view (inside Project, sibling to Lists) | Shows Active sprint progress, project backlog, planned sprints | All Project members |
| Create Sprint modal | Name, goal, start date, duration (weeks), auto-create toggle, auto-close toggle | Full Access / Admin+ |
| Close Sprint modal | Handle incomplete tasks before closing | Full Access / Admin+ |
| Sprint History page | List of all closed sprints with stats | All Project members |
| Sprint Board View | Kanban of active sprint tasks only (from any List in the Project) | All Project members |

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

1. Sprint is optional — a Project can be used with or without sprints.
2. Only one Sprint can be **Active** per Project at any time.
3. A Sprint cannot be started if another Sprint in the same Project is already Active.
4. A task can only belong to one Sprint at a time.
5. Tasks are never physically moved out of their List — sprint assignment is a separate relationship overlay.
6. A Sprint can contain tasks from multiple Lists within the same Project.
7. Story points are stored per TaskSprint, not on the Task — so carry-over tasks can be re-estimated in the new sprint.
8. Closing a Sprint shows a two-step modal: (1) optional "Mark all as Done" shortcut, (2) handle any remaining incomplete tasks — move to backlog, move to next sprint, or leave as-is. If all tasks are closed after step 1, step 2 is skipped automatically.
9. A Closed Sprint cannot be reopened.
10. Only Planned sprints can be deleted — Active and Closed sprints cannot be deleted.
11. Sprint end date does not auto-close the sprint unless the space-level **Auto-mark sprint as done** (`sprint_auto_mark_done`) setting is enabled. The background worker then closes ACTIVE sprints whose end date has passed.
12. When the space-level **Auto-create next sprint** (`sprint_auto_create_next`) setting is enabled, closing a sprint creates a new PLANNED sprint (or reuses an existing one) — it is never auto-started. This applies to **both** the worker and the manual "Move to Next Sprint" choice.
13. When the space-level **Auto-move incomplete tasks** (`sprint_auto_move_incomplete`) setting is enabled, the worker carries incomplete tasks into the next sprint (`move_to_next_sprint`); otherwise they return to the backlog (`move_to_backlog`).
14. If incomplete tasks should move to the next sprint but none can be resolved/created, they are returned to the backlog (the `taskSprint` link is simply removed).
15. The three space-level sprint settings are **independent** — any can be toggled on its own (there is no longer an "auto-close requires auto-create" coupling).
16. `closeSprintAndRollover()` is **idempotent** — it no-ops on a sprint that is not currently ACTIVE, so the worker can safely retry and the manual + automated paths cannot double-close.
17. Sprint History is read-only — no edits after closing.
18. Sprints are scoped to a Project — they cannot span multiple Projects.

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

**Handler** (`lib/worker/handlers/sprint-auto-close.ts`):
1. Query all sprints eligible for auto-close, joining the **space** so the space-level settings drive everything:
   ```sql
   SELECT s.id, s.name, s.space_id, s.created_by,
          sp.sprint_auto_create_next, sp.sprint_auto_move_incomplete
   FROM Sprint s
   INNER JOIN Space sp ON s.space_id = sp.id
   WHERE s.status = 'ACTIVE'
     AND sp.sprint_auto_mark_done = true
     AND s.end_date < CURRENT_DATE
   ```
2. For each eligible sprint, call the shared `closeSprintAndRollover()` (see below), passing:
   - `autoCreateNext = space.sprint_auto_create_next`
   - `incompleteStrategy = space.sprint_auto_move_incomplete ? "move_to_next_sprint" : "move_to_backlog"`
3. Errors are caught per-sprint and logged — one bad sprint does not abort the run.

**Idempotency guard:** `closeSprintAndRollover()` re-fetches the sprint and returns a no-op when its status is not `ACTIVE`, so retries / overlapping runs cannot double-close.

### Close Sprint — Shared Rollover Module

Both the manual `closeSprint` server action (`app/actions/sprint.ts`) and the auto-close worker delegate to a single shared function so the two paths can never diverge:

```typescript
// lib/sprint/rollover.ts  (plain module — NO "use server", so the standalone
// worker process can import it safely)

export type IncompleteStrategy =
  | "move_to_backlog"
  | "move_to_next_sprint"
  | "leave_as_is";

export async function closeSprintAndRollover(params: {
  spaceId: string;
  sprintId: string;
  actorId: string;
  incompleteStrategy: IncompleteStrategy;
  /** Explicit target sprint for `move_to_next_sprint` (manual flow). */
  targetSprintId?: string;
  /** Whether to create the next sprint when none is targeted/planned. */
  autoCreateNext: boolean;
}): Promise<{ nextSprintId: string | null }>;
```

**Steps:**
1. **Load + idempotency guard** — re-fetch the sprint; if its status is not `ACTIVE`, return `{ nextSprintId: null }` (no-op). This is what makes worker retries and the manual/auto paths safe.
2. **Collect incomplete tasks** — tasks linked via `taskSprint` whose `listStatus.type !== "CLOSED"` (archived tasks excluded).
3. **Resolve the next/target sprint:**
   - An explicit `targetSprintId` (manual flow) wins, if it's a valid `PLANNED` sprint in the space.
   - Else, when `autoCreateNext` is true: reuse the first existing `PLANNED` sprint, or create a new one (`incrementSprintName(current.name)`, `startDate = endDate + 1 day`, same `durationWeeks`).
4. **Roll incomplete tasks over** — remove their `taskSprint` link from the closing sprint; if `move_to_next_sprint` and a next sprint was resolved, insert links into it (`onConflictDoNothing`). `move_to_backlog` is just the removal; `leave_as_is` skips this step.
5. **Close the sprint** — set `status = "CLOSED"`, `closedAt = now`.

Helpers `addDays()` and `incrementSprintName()` also live in this module (previously duplicated in the action and the worker).

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
  where: { spaceId, status: 'ACTIVE' }  // scoped to Project, not List
})
if (existing) throw new ConflictError('A sprint is already active in this project')
```

This check must be inside the transaction that also sets `status = 'ACTIVE'` to prevent a race condition where two sprints are started simultaneously.

### `startSprint` -- Transaction Spec

```typescript
export async function startSprint(sprintId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const sprint = await tx.sprint.findUniqueOrThrow({ where: { id: sprintId } })
    if (sprint.status !== 'PLANNED') throw new Error('Only a PLANNED sprint can be started')

    // One-active enforcement inside the transaction (not a pre-check)
    // Scoped to Project (spaceId), not a single List
    const activeExists = await tx.sprint.findFirst({
      where: { spaceId: sprint.spaceId, status: 'ACTIVE' }
    })
    if (activeExists) throw new ConflictError('A sprint is already active in this project')

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

"Backlog" = tasks in **any List in the Project** that have no `TaskSprint` record linking them to a PLANNED or ACTIVE sprint.

```typescript
export async function getBacklog(spaceId: string) {
  // Find all list IDs in this project first
  const lists = await db.list.findMany({
    where: { spaceId, isArchived: false },
    select: { id: true }
  })
  const listIds = lists.map(l => l.id)

  // Tasks across all lists in the project with no active/planned sprint assignment
  return db.task.findMany({
    where: {
      listId: { in: listIds },
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
    include: { list: { select: { id: true, name: true } } },  // include list for grouping in UI
    orderBy: [{ listId: 'asc' }, { orderIndex: 'asc' }]
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

---

## Sprint Settings

Sprint Settings are stored per-Project (space) and control cadence, naming, and automation behavior across all sprints in a project.

### First-Time Setup Flow

When a user clicks "Create Sprint" for the first time in a project (i.e. `space.sprint_start_day IS NULL`), they are shown a **Sprint Setup modal** first. After saving, the Create Sprint modal opens with smart defaults pre-filled.

On subsequent sprint creations, the Setup modal is skipped — the Create Sprint modal opens directly with smart defaults.

### Settings Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sprint_start_day` | `int` (0–6) or NULL | NULL | Day of week sprints start (0=Sun, 1=Mon, …). NULL = settings not yet configured (triggers first-time setup). |
| `sprint_default_duration_weeks` | `int` | 2 | Default duration in weeks when creating a new sprint |
| `sprint_name_format` | `text` | `"Sprint {n}"` | Name template; `{n}` = auto-incremented number, `{project}` = project name |
| `sprint_date_format` | `text` | `"MM/DD"` | Date display format used throughout sprint views (e.g. "MM/DD", "DD/MM", "MMM D") |
| `sprint_auto_mark_done` | `bool` | false | Auto-close sprint when its end date passes |
| `sprint_auto_create_next` | `bool` | false | Auto-create next sprint when one is completed |
| `sprint_auto_move_incomplete` | `bool` | false | Auto-move incomplete tasks to next sprint (requires `sprint_auto_create_next`) |
| `sprint_auto_archive_after_n` | `int` or NULL | NULL | Archive old sprints so only the last N are visible in the sidebar |

### Smart Defaults in Create Sprint Modal

When creating a sprint (after settings are configured):

1. **Sprint number**: Infer from the trailing number in the last sprint's name (e.g. "Sprint 3" → next is 4). Falls back to 1 if no prior sprints.
2. **Sprint name**: Apply `sprint_name_format` with inferred number and project name.
3. **Start date**: Last sprint's `end_date + 1 day`, then snap forward to the next occurrence of `sprint_start_day`. If no prior sprint, snap today → next `sprint_start_day`.
4. **Duration**: Use `sprint_default_duration_weeks`.

### Sprint Settings Page

Available from:
- First-time "Create Sprint" click when `sprint_start_day` is NULL — shows setup modal, then opens Create Sprint modal with defaults pre-filled
- Project settings sidebar: **Settings → Sprints** (`/[workspaceId]/[spaceId]/settings/sprints`)

Sections:
- **General**: Sprint starts on (day picker), Default duration (1–4 weeks), Date format (MM/DD, DD/MM, MMM D)
- **Naming**: Name format selector with live preview (e.g. "Sprint 1, Sprint 2, …")
- **Automations**: All four automation toggles with sub-options (move incomplete only shows when auto-create-next is on; archive N input only shows when archive toggle is on)

The settings form fills the full content area of the settings layout (`max-w-3xl mx-auto`). The Save button is right-aligned at the bottom of the form.

### Folder Mapping

```
src/
  app/api/
    spaces/[spaceId]/
      sprints/route.ts          <- POST (create sprint), GET (list sprints for project)
      backlog/route.ts          <- GET (tasks across all lists in project not in any sprint)
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
  lib/sprint/
    rollover.ts                 <- closeSprintAndRollover() + addDays/incrementSprintName (shared module, no "use server")
  lib/worker/handlers/
    sprint-auto-close.ts        <- reads space-level settings, calls closeSprintAndRollover()
```

> Note: in the current codebase server actions live under `app/actions/sprint.ts` (not `server/`); `closeSprint` there delegates to `lib/sprint/rollover.ts`.
