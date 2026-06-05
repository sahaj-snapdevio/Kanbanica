# Views

## Overview

Views are different ways to visualize and interact with tasks. The same underlying tasks can be seen in multiple views — switching view does not change the data, only how it is displayed.

**View preference is per user per List** — switching your view does not affect what other members see.

**MVP Views:**
| View | Scope | Description |
|------|-------|-------------|
| List View | Per List | Default row-by-row task list |
| Board View | Per List | Kanban columns grouped by status |
| Calendar View | Per List | Tasks placed on a calendar by due date |
| My Tasks | Global (workspace-wide) | Personal view of all tasks assigned to the current user |

---

## 1. List View

The default view for every List. Tasks are displayed as rows with key fields visible inline.

### Layout

```
[ ] Task Title          | Assignee | Due Date | Priority | Status
[ ] Another Task        | Assignee | Due Date | Priority | Status
  [ ] Subtask           | Assignee | Due Date |          | Status
+ Add Task
```

### Features

**Columns visible inline (configurable per user):**
- Task Title (always visible, cannot hide)
- Status
- Priority
- Assignee(s)
- Due Date
- Tags
- Story Points (if sprint is active)

**Column customization:**
- Show / hide columns per user preference
- Reorder columns (drag-and-drop) per user preference
- Column preferences are saved per user per List

**Task rows:**
- Click a task row to open the Task detail panel
- Inline edit: click a field directly in the row to edit (status, priority, due date, assignee) without opening the detail panel
- Subtasks shown as indented rows under their parent — collapsible per user
- Completed tasks (closed status) shown with strikethrough — can be hidden via toggle `Hide Closed Tasks`

**Grouping:**
- Default: no grouping (flat list ordered by `order_index`)
- Group by: Status / Priority / Assignee / Due Date / Tags
- When grouped, tasks are split into collapsible sections per group value

**Quick create:**
- `+ Add Task` button at the bottom of the list (or bottom of each group when grouped)
- Type title → Enter → task created instantly in that group's context (e.g. creating in the "High Priority" group sets priority to High)

**Bulk selection:**
- Each task row has a checkbox on the far left — hidden by default, appears on row hover
- Checking any task reveals all other checkboxes and activates the **Bulk Action Bar** at the bottom of the screen
- `Shift+Click` a checkbox — range-selects all tasks between the last selected and the clicked row
- Checkbox in the column header — selects / deselects all currently visible tasks (respects active filters and grouping)
- Selection is cleared when: navigating away, switching views, or clicking `✕ Clear` in the Bulk Action Bar

**Bulk Action Bar** (appears at bottom of screen when ≥1 task is selected):
```
[✓ 5 selected]  [Assign]  [Status]  [Priority]  [Move]  [Archive]  [Delete]  [✕ Clear]
```

| Bulk Action | Behavior | Required Permission |
|-------------|----------|-------------------|
| Assign | Opens user picker — replaces all assignees on every selected task | Edit / Full Access |
| Status | Dropdown of the current List's statuses — applies to all selected tasks | Edit / Full Access |
| Priority | Dropdown (None/Low/Medium/High/Urgent) — applies to all selected tasks | Edit / Full Access |
| Move | List picker (all accessible Lists in the workspace) — moves all selected tasks | Full Access / Admin+ |
| Archive | Archives all selected tasks in one action — removes from view | Full Access / Admin+ |
| Delete | Confirmation modal: `"Delete 5 tasks? This cannot be undone."` — permanently deletes all selected | Full Access / Admin+ |

**Bulk action rules:**
- If selected tasks span different statuses and the user applies a status — all tasks move to the new status regardless of their current status
- Moving tasks to a different List: status is remapped to the closest match by name (same rule as single task move)
- Archived tasks are excluded from the selectable rows by default (unless `Show Archived` filter is active)
- Activity log entry is created per task for each bulk action — not a single grouped entry

**"Close All Tasks" list action:**

Available from the List toolbar (`···` overflow menu → `Close All Tasks`):

```
List toolbar:  [ List ][ Board ][ Calendar ]  [+ Add Task]  [ Filter ]  [ ··· ▾ ]
                                                                          └─ Close All Tasks
                                                                          └─ Archive All Closed Tasks
```

- **Close All Tasks** — sets every open task in the List (or current filtered view) to the List's `closed`-type status in one action
  - A confirmation dialog appears: `"Close all 24 open tasks in this List? This will mark them as [Done]."` with `[Close All]` and `[Cancel]` buttons
  - If filters are active, only the currently visible tasks are affected — the dialog clearly states this: `"Close 8 filtered tasks"`
  - Each affected task gets an Activity Log entry: `"[User] marked task as Done via Close All"`
  - Completed tasks (already closed) are skipped silently
  - Required permission: **Full Access / Admin+**

- **Archive All Closed Tasks** — archives every task in the List that is already in a `closed` status
  - Confirmation dialog: `"Archive all 18 completed tasks? They will be hidden from the List view."`
  - Useful after using "Close All Tasks" to clean up the view
  - Required permission: **Full Access / Admin+**

**Sorting:**
- Manual sort (drag-and-drop to reorder)
- Sort by: Due Date / Priority / Status / Assignee / Created Date / Last Updated
- Sort is per user — does not affect others

**Filters:**
- All filters from the Filter & Sort module apply here
- Active filters shown as chips in the view toolbar

---

## 2. Board View

A Kanban board where tasks are displayed as cards in columns, one column per status.

### Layout

```
┌──────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐
│   Todo   │  │ In Progress │  │  Review  │  │   Done   │
├──────────┤  ├─────────────┤  ├──────────┤  ├──────────┤
│ Task A   │  │ Task C      │  │ Task E   │  │ Task F   │
│ Task B   │  │ Task D      │  │          │  │ Task G   │
│          │  │             │  │          │  │          │
│+ Add     │  │+ Add        │  │+ Add     │  │+ Add     │
└──────────┘  └─────────────┘  └──────────┘  └──────────┘
```

### Features

**Columns:**
- One column per status in the List
- Column order matches the status order defined in List settings
- Column header shows status name + task count in that column
- Columns cannot be added/removed from Board View — manage statuses from List settings

**Task cards show:**
- Task title
- Priority badge (colored)
- Assignee avatar(s)
- Due date (red if overdue)
- Subtask count fraction (e.g. `2/5`) if subtasks exist
- Checklist progress fraction if checklists exist
- Tag chips

**Drag and drop:**
- Drag a task card from one column to another to change its status
- Drag within a column to reorder tasks
- Reorder is global — affects all users

**Quick create:**
- `+ Add` button at the bottom of each column
- Creates a task with the column's status pre-set

**Sprint mode:**
- When a Sprint is Active, Board View shows only tasks in the active sprint
- A toggle `Show Backlog` reveals backlog tasks in a separate swimlane at the bottom

**Filters and sort:**
- Same filter options as List View apply to Board View
- Sort within columns: by Due Date / Priority / Created Date

---

## 3. Calendar View

Tasks are placed on a calendar grid based on their due date. Useful for seeing what is due when across the month or week.

### Layout

```
◀ May 2026                                              June 2026 ▶
┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│ Mon │ Tue │ Wed │ Thu │ Fri │ Sat │ Sun │
├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
│     │     │  3  │  4  │  5  │  6  │  7  │
│     │     │[T1] │[T2] │[T3] │     │     │
├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
│  8  │  9  │ 10  │ 11  │ 12  │ 13  │ 14  │
│     │[T4] │     │[T5] │     │     │     │
└─────┴─────┴─────┴─────┴─────┴─────┴─────┘
```

### Features

**Calendar modes:**
- Monthly view (default) — full month grid
- Weekly view — 7-day horizontal strip with more vertical space per day

**Task placement:**
- Tasks with a single due date appear on that day
- Tasks with a date range (start + end) appear as a spanning bar across the date range
- Tasks with no due date are listed in an `Unscheduled` sidebar panel on the right

**Task card on calendar:**
- Shows: title, priority color dot, assignee avatar
- Click to open Task detail panel

**Drag and drop:**
- Drag a task card to a different day to change its due date
- Dragging a range task adjusts the end date (start date stays fixed)

**Quick create:**
- Click on a day cell → opens quick create with that date pre-filled as due date

**Overdue:**
- Past days with unclosed tasks are highlighted

**Filters:**
- Assignee filter — show only tasks assigned to selected users
- Priority filter — show only selected priorities

---

## 4. My Tasks View

A personal, workspace-wide view showing all tasks and subtasks assigned to the currently logged-in user, across all Spaces and Lists they have access to.

**Scope:** Entire Workspace — not limited to a single List or Space.

### Layout

```
My Tasks
├── Overdue (3)
│     └── Fix login bug         · Engineering › Backlog    · Due 2 days ago
├── Due Today (2)
│     └── Review PR             · Engineering › Sprint 12  · Due today
│     └── Send weekly report    · Marketing › Tasks        · Due today
├── Due This Week (5)
│     └── ...
├── Upcoming (12)
│     └── ...
└── No Due Date (8)
      └── ...
```

### Features

**Grouping (default — by due date proximity):**
- Overdue — past due date, not closed
- Due Today
- Due This Week (excluding today)
- Upcoming (beyond this week)
- No Due Date

**Alternative grouping options (user can switch):**
- By Space
- By List
- By Priority
- By Status

**Each task row shows:**
- Task title
- Space name + List name (context breadcrumb)
- Due date
- Priority badge
- Status pill
- If subtask: parent task name shown in smaller text below

**Actions available inline:**
- Change status
- Change due date
- Open Task detail panel (click title)

**Bulk selection in My Tasks:**
- Same checkbox + Shift+Click selection model as List View
- Bulk actions available: **Assign**, **Status**, **Priority**, **Archive**
- **Move** and **Delete** are not available in My Tasks bulk actions — tasks here span multiple Lists, making bulk move/delete too destructive without clear context
- Status dropdown in My Tasks bulk action shows a merged list of statuses — if selected tasks are from different Lists, only statuses that exist by name across all of them are shown. If none match, the action is disabled with a tooltip: `"Selected tasks have incompatible statuses — apply status from within a single List"`

**Filters:**
- Filter by Space (show tasks from specific spaces only)
- Filter by Priority
- Filter by Status
- Toggle: `Show Completed` (hide closed tasks by default)

**Sorting:**
- Default: by due date (soonest first)
- Sort by: Priority / Status / List / Space / Created Date

**Access:**
- Available to every workspace member from the left sidebar (global nav)
- Always shows only tasks assigned to the current user — cannot view other users' My Tasks

---

## View Switcher

Every List has a view switcher in the toolbar (top of the List page):

```
[ List ] [ Board ] [ Calendar ]
```

- Clicking a view tab switches to that view
- Selected view is remembered per user per List
- My Tasks is accessible from the global left sidebar, not the List toolbar

---

## Data Model

No separate table needed for views — view preference is stored as user settings.

```
UserListViewPreference
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── list_id             (foreign key → List)
├── view_type           (enum: list | board | calendar)
├── column_config       (json — visible columns and order for List View)
├── group_by            (string, nullable — grouping preference)
├── sort_by             (string, nullable)
├── sort_direction      (enum: asc | desc, nullable)
└── updated_at          (timestamp)

UserMyTasksPreference
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── group_by            (enum: due_date | space | list | priority | status, default: due_date)
├── show_completed      (boolean, default: false)
└── updated_at          (timestamp)
```

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/lists/:listId/tasks?view=list` | Get tasks for List View (with sort/filter/group params) | Space member |
| GET | `/api/lists/:listId/tasks?view=board` | Get tasks grouped by status for Board View | Space member |
| GET | `/api/lists/:listId/tasks?view=calendar&month=2026-06` | Get tasks with due dates for Calendar View | Space member |
| GET | `/api/me/tasks` | Get all tasks assigned to current user (My Tasks) | Authenticated user |
| PATCH | `/api/me/list-preferences/:listId` | Save view preference for a List | Authenticated user |
| PATCH | `/api/me/my-tasks-preferences` | Save My Tasks grouping/filter preference | Authenticated user |
| POST | `/api/tasks/bulk` | Apply a bulk action to multiple tasks | Edit / Full Access / Admin+ |
| POST | `/api/lists/:listId/close-all` | Close all open tasks in a List (respects active filters) | Full Access / Admin+ |
| POST | `/api/lists/:listId/archive-closed` | Archive all closed tasks in a List | Full Access / Admin+ |
| POST | `/api/sprints/:id/mark-all-done` | Mark all incomplete sprint tasks as done (used in close sprint modal) | Full Access / Admin+ |

---

## UI Screens

| Screen | Route | Access |
|--------|-------|--------|
| List View | `/space/:spaceId/list/:listId?view=list` | Space member |
| Board View | `/space/:spaceId/list/:listId?view=board` | Space member |
| Calendar View | `/space/:spaceId/list/:listId?view=calendar` | Space member |
| My Tasks | `/my-tasks` | All workspace members |

---

## Business Rules

1. View preference is per user per List — switching view does not affect other members.
2. All views display the same tasks — the data is identical, only the presentation changes.
3. Filters applied in one view carry over when switching to another view on the same List.
4. Drag-and-drop status changes in Board View are global — they change the task's actual status for everyone.
5. Drag-and-drop reordering within a column in Board View is global — order is shared.
6. My Tasks shows tasks across all Spaces the user has access to — if access is revoked from a Space, those tasks disappear from My Tasks immediately.
7. Closed tasks are hidden by default in My Tasks — user can toggle `Show Completed` to see them.
8. Calendar View only places tasks that have a due date — tasks without a due date appear in the Unscheduled panel.
9. Column visibility and order in List View are per user — they are not shared with other members.
10. View switcher is only available at the List level — My Tasks is a global view accessible from the sidebar.
11. Bulk selection is only available in List View and My Tasks — not in Board View or Calendar View.
12. Bulk actions are applied server-side atomically per task — if one task fails a permission check, that task is skipped and the others still apply. The result message shows how many succeeded and how many were skipped.
13. Each task in a bulk action generates its own Activity Log entry — bulk actions do not create a single grouped log.
14. Bulk delete requires an explicit confirmation modal showing the exact count — no undo.
15. "Close All Tasks" and "Archive All Closed Tasks" respect active filters — only visible tasks are affected. The confirmation dialog always states the exact count and whether filters are applied.
16. "Mark all as Done" inside the Close Sprint modal uses the List's `closed`-type status — if the List has multiple closed-type statuses, the first one in the status order is used.

---

## Out of Scope (MVP)

- Gantt / Timeline View
- Table / Spreadsheet View
- Workload View (capacity per member)
- Dashboard View (widgets and charts)
- Saving custom views with a name
- Sharing a saved view with the team
