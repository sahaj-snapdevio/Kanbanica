# Sprint

## Overview

A Sprint is an optional agile execution layer that sits inside a List. It represents a time-boxed iteration — a fixed period during which a selected set of tasks must be completed.

Sprints are optional. Teams that do not follow agile methodology can ignore them entirely and work directly with Lists and Tasks.

**Real-world analogy:** A Sprint = a 2-week work cycle with a defined goal. e.g. `Sprint 1 — Auth & Onboarding`, `Sprint 12 — Payment Integration`

**Hierarchy position:**
```
Workspace
  └── Space
        └── Folder (optional)
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
    - Incomplete tasks are automatically moved to the **Backlog** (no manual decision prompt — since this is automated)
    - When disabled: current sprint remains Active even after the new sprint is created — user must close it manually
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
- Before closing, user must decide what to do with **incomplete tasks** (tasks not in a `closed` status):

  | Option | Description |
  |--------|-------------|
  | Move to Backlog | Task is removed from the sprint, stays in the List with no sprint assignment |
  | Move to Next Sprint | Task is assigned to a selected existing Planned sprint |
  | Leave as-is | Task stays in the closed sprint for reference (no further action) |

- User can handle tasks individually or apply one option to all incomplete tasks at once
- After closing:
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
7. Closing a Sprint requires an explicit decision for each incomplete task (move to backlog, move to next sprint, or leave).
8. A Closed Sprint cannot be reopened.
9. Only Planned sprints can be deleted — Active and Closed sprints cannot be deleted.
10. Sprint end date does not auto-close the sprint unless **Auto-close on next sprint** is enabled.
11. When **Auto-create next sprint** is enabled, a new Planned sprint is created automatically when the end date is reached — it is never auto-started.
12. When **Auto-close on next sprint** is enabled, incomplete tasks are moved to the Backlog automatically — no manual decision prompt since the action is automated.
13. **Auto-close on next sprint** can only be enabled when **Auto-create next sprint** is also enabled — it has no meaning otherwise.
14. Sprint History is read-only — no edits after closing.
15. Sprints are scoped to a List — they cannot span multiple Lists.

---

## Out of Scope (MVP)

- Burndown chart (visual chart of remaining work over time)
- Velocity tracking (average story points completed per sprint)
- Sprint templates
- Sprint retrospective notes
- Auto-scheduling tasks into sprints
- Cross-List sprints
