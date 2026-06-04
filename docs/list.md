# List

## Overview

A List is the primary container for Tasks. It represents a collection of work — a backlog, a project board, a bug tracker, or any grouping of tasks that belong together.

Every task must live inside a List. A List lives inside a Space, optionally inside a Folder.

**Real-world analogy:** A List = a project board or task queue. e.g. `Backlog`, `Sprint 12`, `Bug Reports`, `Feature Requests`, `Design Review`

**Hierarchy position:**
```
Workspace
  └── Space
        └── Folder (optional)
              └── List       ← you are here
                    └── Task
```

---

## User Stories

- As a Member with Full Access, I want to create a List inside my Space so I can group related tasks together.
- As a Member, I want to customize task statuses per List so each List reflects its own workflow.
- As a Member, I want to view tasks in List view or Board view depending on how I prefer to work.
- As a Member with Full Access, I want to move a List to a different Folder or Space without losing any tasks.
- As a Member with Full Access, I want to duplicate a List as a starting point for a similar project.
- As an Admin, I want to archive a List when a project is completed so it stays accessible but out of the way.
- As a Member, I want to filter and sort tasks inside a List to focus on what matters right now.

---

## Features

### 1. Create List

- **Who can create:** Members with **Full Access** on the Space, Admin, Owner
- Required fields:
  - List Name (required)
  - Color (optional — pick from palette)
- Optional fields:
  - Description (short text about what this List is for)
  - Parent: choose a Folder or leave at Space root
- On creation:
  - Default statuses are automatically added (see [Default Statuses](#default-statuses))
  - User lands inside the new List, ready to add tasks

> **Special case — Space creation:** When a new Space is created, a default List named **"List"** is auto-created so the user can start adding tasks immediately. The user can rename it anytime.

---

### 2. Edit List

- **Who can edit:** Members with **Full Access** on the Space, Admin, Owner
- Editable fields:
  - Name
  - Color
  - Description
- Changes reflect immediately for all members

---

### 3. Archive List

- **Who can archive:** Members with **Full Access** on the Space, Admin, Owner
- Archived Lists are hidden from the active sidebar
- All Tasks inside are preserved and searchable
- No new Tasks can be created in an archived List
- Can be unarchived at any time
- Useful for completed sprints or finished projects

---

### 4. Delete List

- **Who can delete:** Admin, Owner only
- Permanently deletes the List and all Tasks, Subtasks, Comments, and Attachments inside
- Requires confirmation (type List name to confirm)
- Cannot be undone
- Recommended to Archive instead of Delete in most cases

---

### 5. Duplicate List

- **Who can duplicate:** Members with **Full Access** on the Space, Admin, Owner
- Creates a copy of the List with:
  - Same name (prefixed with "Copy of")
  - Same statuses and their configuration
  - Same color and description
  - Tasks optionally included (user chooses: duplicate structure only, or include tasks too)
- Duplicated List is placed in the same Folder / Space as the original
- Useful for repeating project structures (e.g. monthly sprint template)

---

### 6. Move List

- **Who can move:** Members with **Full Access** on the Space, Admin, Owner
- A List can be moved to:
  - A different Folder within the same Space
  - The root of the same Space (no Folder)
  - A different Space entirely (within the same Workspace)
- Moving a List does not affect its Tasks, Statuses, or any task data
- If moved to a different Space, the List inherits the destination Space's permission model

---

### 7. Custom Task Statuses

Each List has its own set of task statuses. This allows different Lists to reflect different workflows.

**Default Statuses (applied to every new List):**

| Status | Type | Color |
|--------|------|-------|
| Todo | open | Grey |
| In Progress | active | Blue |
| Review | active | Purple |
| Done | closed | Green |

**Status customization (Full Access / Admin+):**
- Add a new status (name + color)
- Rename an existing status
- Change status color
- Reorder statuses (drag-and-drop)
- Delete a status
  - If tasks exist with that status, user must reassign them to another status before deletion

**Status types:**
| Type | Meaning |
|------|---------|
| `open` | Task has not been started |
| `active` | Task is being worked on |
| `closed` | Task is complete or cancelled |

> Status type drives progress calculations and sprint burndown — closed = done.

---

### 8. List Views

Users can switch how tasks are displayed inside a List.

| View | Description |
|------|-------------|
| **List View** | Default — tasks displayed as rows, all fields visible inline |
| **Board View** | Kanban — tasks grouped into columns by status, drag-and-drop between columns |
| **Calendar View** | Tasks placed on a calendar by due date |

- View preference is **per user per List** — switching your view does not affect other members
- All views show the same tasks and respect the same filters

---

### 9. Filters & Sort

**Filters (applied per List, per user):**
- Status
- Priority
- Assignee
- Due Date (overdue, due today, due this week, custom range)
- Tags
- Created by

**Sort:**
- Due Date (ascending / descending)
- Priority
- Status
- Assignee
- Created Date
- Last Updated

- Filter and sort state is **per user** — does not affect other members
- Users can save a filter combination as a named **Saved Filter** for quick access

---

## Default Statuses

Applied automatically when a new List is created:

```
Todo  →  In Progress  →  Review  →  Done
```

These can be customized after creation. They are not shared across Lists — each List manages its own statuses independently.

---

## Data Model

```
List
├── id                  (uuid, primary key)
├── space_id            (foreign key → Space)
├── folder_id           (foreign key → Folder, nullable — null means Space root)
├── name                (string, required)
├── description         (text, nullable)
├── color               (string — hex color code, nullable)
├── order_index         (integer — for sidebar ordering within Folder or Space)
├── is_archived         (boolean, default: false)
├── archived_at         (timestamp, nullable)
├── created_by          (user_id, foreign key)
├── created_at          (timestamp)
└── updated_at          (timestamp)

ListStatus
├── id                  (uuid, primary key)
├── list_id             (foreign key → List)
├── name                (string, required)
├── color               (string — hex color code)
├── type                (enum: open | active | closed)
├── order_index         (integer — display order)
└── created_at          (timestamp)
```

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/spaces/:spaceId/lists` | Create a List | Full Access / Admin+ |
| GET | `/api/spaces/:spaceId/lists` | Get all Lists in a Space | Space member |
| GET | `/api/lists/:id` | Get List details | Space member |
| PATCH | `/api/lists/:id` | Update List (name, color, description) | Full Access / Admin+ |
| DELETE | `/api/lists/:id` | Delete List permanently | Admin+ |
| PATCH | `/api/lists/:id/archive` | Archive List | Full Access / Admin+ |
| PATCH | `/api/lists/:id/unarchive` | Unarchive List | Full Access / Admin+ |
| POST | `/api/lists/:id/duplicate` | Duplicate List | Full Access / Admin+ |
| PATCH | `/api/lists/:id/move` | Move List to another Folder or Space | Full Access / Admin+ |
| PATCH | `/api/lists/:id/reorder` | Update sidebar order | Full Access / Admin+ |
| GET | `/api/lists/:id/statuses` | Get all statuses for a List | Space member |
| POST | `/api/lists/:id/statuses` | Add a new status | Full Access / Admin+ |
| PATCH | `/api/lists/:id/statuses/:statusId` | Update status (name, color, type) | Full Access / Admin+ |
| DELETE | `/api/lists/:id/statuses/:statusId` | Delete a status | Full Access / Admin+ |
| PATCH | `/api/lists/:id/statuses/reorder` | Reorder statuses | Full Access / Admin+ |

---

## UI Screens

| Screen | Description | Access |
|--------|-------------|--------|
| Sidebar — List items | Lists shown under Folder or Space root in left sidebar | All Space members |
| List View | Tasks displayed as rows inside the List | All Space members |
| Board View | Tasks as Kanban cards grouped by status | All Space members |
| Calendar View | Tasks on calendar by due date | All Space members |
| Create List modal | Triggered from sidebar `+` next to Folder or Space | Full Access / Admin+ |
| Edit List modal | Accessible from List header `...` menu | Full Access / Admin+ |
| Status settings panel | Manage statuses for a List | Full Access / Admin+ |
| Archive / Delete confirmation | Confirmation dialog before destructive actions | Full Access / Admin+ |

---

## Data Lifecycle

### Archive
- Archived Lists are hidden from the sidebar for all Space members.
- All Tasks and Subtasks inside are preserved — fully searchable.
- No new Tasks can be created in an archived List.
- Can be unarchived at any time — **no time limit**.
- Archiving a List does **not** archive its Tasks individually — Tasks remain in their current state inside the archived List.
- When unarchived, the List and all its Tasks become immediately accessible again with their existing statuses.
- If the parent Space or Folder is archived or deleted, the List follows the same fate.

### Soft Delete
- List deletion is a **hard delete** — no soft delete or recovery period.
- Archive is the strongly recommended alternative for any List with valuable task history.

### Recovery Period
- **Archived List:** Recoverable at any time — no expiry.
- **Deleted List:** No recovery. All data is permanently gone immediately.

### Permanent Deletion Rules
- Only **Admin and Owner** can permanently delete a List.
- Requires confirmation (type List name).
- On deletion, the following are permanently removed in cascade:
  - All Tasks and Subtasks in the List
  - All Checklists and ChecklistItems
  - All TaskAttachments (DB records + files deleted from S3/R2)
  - All Comments on all tasks (including soft-deleted tombstones)
  - All ActivityLog entries for tasks in this List
  - All ListStatus records for this List
  - All SavedFilters and UserListViewPreferences scoped to this List
  - All Sprints and TaskSprint records in this List
  - All Notifications referencing tasks in this List
- The List record itself is deleted — no tombstone.

---

## Business Rules

1. Every Task must belong to exactly one List.
2. A List belongs to a Space and optionally to a Folder within that Space — never to both a Folder and another Folder.
3. Each List manages its own statuses independently — status changes in one List do not affect other Lists.
4. Every List must have at least one status of type `closed` — required for task completion tracking.
5. A status with assigned tasks cannot be deleted until all its tasks are moved to another status.
6. Archiving a List locks it — no new tasks can be created but existing data remains intact.
7. Deleting a List is permanent and removes all tasks inside it — archive is preferred.
8. Moving a List to a different Space means it inherits the destination Space's permissions.
9. When duplicating, task data (assignees, due dates, comments) is NOT copied — only structure and statuses are copied unless the user explicitly opts in to copy tasks.
10. List order in the sidebar is global — reordering affects all Space members.
11. Filter and sort preferences are per user — they do not affect what others see.
12. The auto-created default List (named "List") on Space creation follows all the same rules and can be renamed or deleted like any other List.

---

## Out of Scope (MVP)

- List templates (pre-built Lists with predefined statuses and tasks)
- List-level permission override (separate from Space permission)
- Table / Spreadsheet view
- Gantt / Timeline view
- List-level analytics and reporting
- Public List sharing (external link to a List without login)
- Importing tasks from CSV or external tools
