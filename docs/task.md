# Task

## Overview

A Task is the core unit of work in Teamority. Everything actionable lives inside a Task. A Task always belongs to a List, inherits the Space's permission model, and can have Subtasks nested inside it.

**Real-world analogy:** A Task = a work item, ticket, or to-do. e.g. `Design login screen`, `Fix payment bug`, `Write Q3 report`, `Review pull request`

**Hierarchy position:**
```
Workspace
  └── Space
        └── Folder (optional)
              └── List
                    └── Task       ← you are here
                          └── Subtask
```

---

## User Stories

- As a Member with Edit or Full Access, I want to create a task quickly by just typing a title so I can capture work without friction.
- As a Member, I want to fill in task details (assignee, due date, priority, description) after creation so I don't slow down during capture.
- As a Member, I want to assign a task to one or more teammates so ownership is clear.
- As a Member, I want to set a due date and priority so the team knows what is urgent.
- As a Member, I want to add a checklist inside a task to track smaller steps without creating subtasks.
- As a Member, I want to link a task as "blocked by" another task so dependencies are visible.
- As a Member, I want to watch a task so I get notified of updates even if it is not assigned to me.
- As a Member, I want to see the full activity timeline on a task so I know exactly what changed and when.
- As an Admin, I want to move a task to a different List when priorities change.
- As a Member, I want to duplicate a task to quickly create similar work items.

---

## Task Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Title | Short text | Yes | The name of the task |
| Description | Rich text | No | Detailed context — supports bold, italic, headings, bullet lists, numbered lists, code blocks, inline code, links |
| Status | Enum (per List) | Yes | Defaults to first status in the List (usually "Todo") |
| Priority | Enum | No | None / Low / Medium / High / Urgent |
| Assignees | User[] | No | One or more workspace members |
| Reporter | User | Auto | Set to the user who created the task — cannot be changed |
| Due Date | Date or Date Range | No | Single deadline or start + end range |
| Tags | String[] | No | Custom multi-select labels scoped to the Workspace |
| Watchers | User[] | No | Users who follow the task and receive notifications |
| Attachments | File[] | No | Images, PDFs, documents — uploaded directly |
| Checklists | Checklist[] | No | Named checklists with checkable items inside the task |
| Dependencies | Task[] | No | Blocked by / Blocking relationships to other tasks |
| Subtasks | Task[] | No | Child tasks nested under this task |
| Time Estimate | Number (hours) | No | Estimated effort |
| Time Logged | Number (hours) | No | Manually logged time entries |

---

## Priority Levels

| Priority | Color | Meaning |
|----------|-------|---------|
| None | Grey | No priority set |
| Low | Blue | Nice to have, not urgent |
| Medium | Yellow | Normal priority |
| High | Orange | Important, do soon |
| Urgent | Red | Drop everything, do now |

---

## Features

### 1. Create Task

- **Who can create:** Members with **Edit** or **Full Access** on the Space, Admin, Owner
- **Quick create:** Click `+ Add Task` inside a List → type title → press Enter → task is created instantly
- **Full create:** Open task detail panel to fill all fields before saving
- On creation:
  - Status defaults to the first `open` status in the List (e.g. "Todo")
  - Reporter is set to the current user automatically
  - Task appears at the bottom of the List (or top, based on user sort preference)

---

### 2. Task Detail Panel

Clicking a task opens a side panel (or full-page modal) showing all fields.

**Panel sections:**
- Header: Title (editable inline), Status pill, Priority badge
- Left/Main column: Description (rich text editor), Subtasks, Checklists, Attachments, Comments
- Right/Sidebar column: Assignees, Reporter, Due Date, Tags, Watchers, Time Estimate, Time Logged, Dependencies
- Bottom: Activity Timeline

---

### 3. Edit Task

- **Who can edit:** Members with **Edit** or **Full Access**, Admin, Owner
- All fields are editable inline inside the Task detail panel
- Every field change is recorded in the Activity Timeline with timestamp and who made the change
- Editing is real-time — multiple users can view the same task simultaneously

---

### 4. Change Status

- Click the status pill on the task → select from the List's statuses
- Status change triggers a notification to Assignees and Watchers
- When status type changes to `closed` → task is marked as complete
- Completing a task does not archive or hide it — it stays in the List

---

### 5. Assign Task

- A task can have **multiple assignees**
- Search for workspace members by name or email in the assignee field
- Any member who has access to the Space can be assigned (regardless of their Space permission level — even View users can be assigned to tasks)
- Assigning a user sends them a notification
- Removing an assignee sends them a notification

---

### 6. Set Due Date

- **Single date:** a deadline
- **Date range:** start date + end date (useful for planning work blocks)
- Due date appears on the task card in List and Board views
- Overdue tasks (past due date, not closed) are highlighted in red
- Due date triggers a reminder notification (default: 1 day before due date)

---

### 7. Priority

- Set or change priority from the task detail panel or inline in List view
- Priority is visible as a colored badge on task cards
- Can be used as a filter and sort criteria in List / Board views

---

### 8. Tags

- Workspace-scoped tags (shared across all Spaces in the Workspace)
- A task can have multiple tags
- Tags can be created inline when editing a task (type a new tag name → create)
- Tags are used for filtering across Lists

---

### 9. Checklists

- A task can have **multiple named checklists**
- Each checklist has a name and a list of checkable items
- Checklist progress is shown as a fraction (e.g. `3/5`) on the task card
- Checklist items can be:
  - Added, renamed, checked/unchecked, reordered, deleted
  - Assigned to a user (optional)
  - Given a due date (optional)
- Completing all items in all checklists does **not** auto-close the task — status must be changed manually

---

### 10. Dependencies

- A task can be linked to other tasks as:
  - **Blocked by** — this task cannot start until the linked task is done
  - **Blocking** — this task is blocking the linked task
- Dependencies are visible in the Task detail panel
- Circular dependencies are not allowed (A blocks B blocks A)
- Cross-List dependencies within the same Workspace are allowed
- No automatic enforcement in MVP — dependencies are informational only (no hard block on status change)

---

### 11. Watchers

- Any workspace member can watch a task
- Watchers receive notifications for:
  - Status changes
  - New comments
  - Due date changes
  - Assignee changes
- Task creator and all assignees are automatically added as Watchers
- Watchers can remove themselves at any time

---

### 12. Attachments

- Upload files directly to a task (images, PDFs, documents, zip files)
- Supported: drag-and-drop or file picker
- Images are previewed inline in the task detail panel
- Non-image files show as a file card with name, size, and download link
- File size limit: **10MB per file** (MVP)
- Files are stored in S3 / Cloudflare R2

---

### 13. Activity Timeline

Every change to a task is recorded and displayed chronologically at the bottom of the task detail panel.

**Tracked events:**
- Task created
- Title changed (old → new)
- Status changed (old → new)
- Priority changed (old → new)
- Assignee added / removed
- Due date set / changed / removed
- Description updated
- Comment added / edited / deleted
- Checklist item checked / unchecked
- Attachment uploaded / deleted
- Dependency added / removed
- Task moved to another List
- Watcher added / removed

Each entry shows: **who** did it, **what** changed, and **when** (timestamp).

---

### 14. Duplicate Task

- **Who can duplicate:** Members with **Edit** or **Full Access**, Admin, Owner
- Creates a copy of the task with:
  - Same title (prefixed with "Copy of")
  - Same description, priority, tags, checklists, status
  - **Not copied:** assignees, due date, comments, attachments, time logged, activity timeline
- Duplicated task is placed in the same List as the original
- User can edit all fields after duplication

---

### 15. Move Task

- **Who can move:** Members with **Full Access**, Admin, Owner
- A task can be moved to:
  - A different position within the same List
  - A different List within the same Space
  - A different List in a different Space (within the same Workspace)
- Moving preserves all task data (description, assignees, comments, attachments, activity)
- If moved to a different List, the task's status is mapped to the closest matching status in the destination List by name. If no match, it defaults to the first `open` status.
- Moving is recorded in the Activity Timeline

---

### 16. Copy Task Link

- Every task has a unique URL
- `Copy Link` option available from task detail header and task card context menu (`...`)
- Link format: `/workspace/:workspaceSlug/task/:taskId`
- Pasting the link in a comment or description creates a clickable task reference

---

### 17. Archive Task

- **Who can archive:** Members with **Full Access**, Admin, Owner
- Archived tasks are hidden from the List view by default
- Can be viewed via a filter: `Show Archived`
- No new comments or changes can be made to an archived task
- Can be unarchived at any time

---

### 18. Delete Task

- **Who can delete:** Members with **Full Access**, Admin, Owner
- Permanently deletes the task and all its data (subtasks, comments, attachments, checklist items)
- Requires single confirmation click
- Cannot be undone
- Recommended to Archive instead of Delete for audit trail purposes

---

### 19. Recurring Tasks

- A task can be set to recur on a schedule
- Recurrence options:
  - Daily
  - Weekly (pick day of week)
  - Monthly (pick day of month)
  - Custom interval
- When a recurring task is closed, a new copy is automatically created with:
  - Same title, description, assignees, priority, tags
  - New due date calculated from the recurrence schedule
  - Status reset to first `open` status
  - Empty checklist items (unchecked)
- Original closed task is kept in history

---

## Data Model

```
Task
├── id                  (uuid, primary key)
├── list_id             (foreign key → List)
├── parent_task_id      (foreign key → Task, nullable — null means top-level task)
├── title               (string, required)
├── description         (text / rich text JSON, nullable)
├── status_id           (foreign key → ListStatus)
├── priority            (enum: none | low | medium | high | urgent, default: none)
├── reporter_id         (foreign key → User)
├── due_date_start      (date, nullable)
├── due_date_end        (date, nullable)
├── time_estimate       (integer — minutes, nullable)
├── order_index         (integer — position in List)
├── is_archived         (boolean, default: false)
├── archived_at         (timestamp, nullable)
├── recurrence_rule     (string — rrule format, nullable)
├── created_at          (timestamp)
└── updated_at          (timestamp)

TaskAssignee
├── task_id             (foreign key → Task)
└── user_id             (foreign key → User)

TaskWatcher
├── task_id             (foreign key → Task)
└── user_id             (foreign key → User)

TaskTag
├── task_id             (foreign key → Task)
└── tag_id              (foreign key → Tag)

Tag
├── id                  (uuid, primary key)
├── workspace_id        (foreign key → Workspace)
├── name                (string)
└── color               (string — hex color code)

TaskDependency
├── id                  (uuid, primary key)
├── task_id             (foreign key → Task — the task that is blocked)
└── depends_on_task_id  (foreign key → Task — the task that must be done first)

Checklist
├── id                  (uuid, primary key)
├── task_id             (foreign key → Task)
├── name                (string)
└── order_index         (integer)

ChecklistItem
├── id                  (uuid, primary key)
├── checklist_id        (foreign key → Checklist)
├── title               (string)
├── is_checked          (boolean, default: false)
├── assignee_id         (foreign key → User, nullable)
├── due_date            (date, nullable)
└── order_index         (integer)

TaskAttachment
├── id                  (uuid, primary key)
├── task_id             (foreign key → Task)
├── uploaded_by         (foreign key → User)
├── file_name           (string)
├── file_url            (string — S3 / R2 URL)
├── file_size           (integer — bytes)
├── mime_type           (string)
└── created_at          (timestamp)

TaskTimeLog
├── id                  (uuid, primary key)
├── task_id             (foreign key → Task)
├── user_id             (foreign key → User)
├── duration            (integer — minutes)
├── logged_at           (date)
└── created_at          (timestamp)

ActivityLog
├── id                  (uuid, primary key)
├── task_id             (foreign key → Task)
├── user_id             (foreign key → User)
├── event_type          (string — e.g. status_changed, assignee_added, comment_added)
├── meta                (json — { from, to, value } depending on event type)
└── created_at          (timestamp)
```

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/lists/:listId/tasks` | Create a Task | Edit / Full Access / Admin+ |
| GET | `/api/lists/:listId/tasks` | Get all Tasks in a List | Space member |
| GET | `/api/tasks/:id` | Get Task details | Space member |
| PATCH | `/api/tasks/:id` | Update Task fields | Edit / Full Access / Admin+ |
| DELETE | `/api/tasks/:id` | Delete Task permanently | Full Access / Admin+ |
| PATCH | `/api/tasks/:id/archive` | Archive Task | Full Access / Admin+ |
| PATCH | `/api/tasks/:id/unarchive` | Unarchive Task | Full Access / Admin+ |
| POST | `/api/tasks/:id/duplicate` | Duplicate Task | Edit / Full Access / Admin+ |
| PATCH | `/api/tasks/:id/move` | Move Task to another List | Full Access / Admin+ |
| GET | `/api/tasks/:id/activity` | Get Activity Timeline | Space member |
| POST | `/api/tasks/:id/assignees` | Add assignee | Edit / Full Access / Admin+ |
| DELETE | `/api/tasks/:id/assignees/:userId` | Remove assignee | Edit / Full Access / Admin+ |
| POST | `/api/tasks/:id/watchers` | Add watcher | Any Space member (self) |
| DELETE | `/api/tasks/:id/watchers/:userId` | Remove watcher | Any Space member (self) |
| POST | `/api/tasks/:id/attachments` | Upload attachment | Edit / Full Access / Admin+ |
| DELETE | `/api/tasks/:id/attachments/:attachmentId` | Delete attachment | Full Access / Admin+ |
| POST | `/api/tasks/:id/checklists` | Add checklist | Edit / Full Access / Admin+ |
| PATCH | `/api/tasks/:id/checklists/:checklistId` | Update checklist | Edit / Full Access / Admin+ |
| DELETE | `/api/tasks/:id/checklists/:checklistId` | Delete checklist | Full Access / Admin+ |
| POST | `/api/tasks/:id/dependencies` | Add dependency | Edit / Full Access / Admin+ |
| DELETE | `/api/tasks/:id/dependencies/:depId` | Remove dependency | Edit / Full Access / Admin+ |
| POST | `/api/tasks/:id/time-logs` | Log time | Edit / Full Access / Admin+ |

---

## UI Screens

| Screen | Description | Access |
|--------|-------------|--------|
| List View | Tasks as rows in a List | All Space members |
| Board View | Tasks as cards grouped by status | All Space members |
| Task Detail Panel | Side panel or full page with all task fields | All Space members |
| Task context menu (`...`) | Quick actions: duplicate, move, archive, delete, copy link | Based on permission |
| Create Task (quick) | Inline row in List View — type title + Enter | Edit / Full Access / Admin+ |
| Create Task (full) | Open full detail panel before saving | Edit / Full Access / Admin+ |

---

## Data Lifecycle

### Archive
- Archived Tasks are hidden from List View and Board View by default.
- Viewable via the filter toggle: `Show Archived`.
- No new comments or field changes can be made on an archived Task.
- Subtasks are **not** auto-archived — they remain in their current state but are only accessible via the archived parent.
- Can be unarchived at any time — **no time limit**.
- When unarchived, the Task and all its Subtasks become immediately editable again.
- If the parent List is archived or deleted, the Task follows.

### Soft Delete
- Task deletion is a **hard delete** — no soft delete, no tombstone for the Task itself.
- Exception: **Comments** on a task use soft delete when the comment has replies (see [collaboration.md](./collaboration.md)).
- Archive is the recommended alternative to keep task history accessible.

### Recovery Period
- **Archived Task:** Recoverable at any time — no expiry.
- **Deleted Task:** No recovery. Data is permanently gone immediately.
- **Recurring Task:** When a recurring task is closed, the original is kept in history — only a new copy is created. The original is never deleted automatically.

### Permanent Deletion Rules
- **Full Access, Admin, and Owner** can permanently delete a Task.
- Requires a single confirmation click.
- On deletion, the following are permanently removed in cascade:
  - All Subtasks (and their own comments, attachments, checklists)
  - All Checklists and ChecklistItems
  - All TaskAttachments (DB records + files deleted from S3/R2)
  - All Comments — soft-deleted tombstones are also hard-deleted at this point
  - All ActivityLog entries
  - All TaskAssignee, TaskWatcher, TaskTag, TaskDependency records
  - All TaskSprint records (task is removed from any sprint records)
  - All Notifications referencing this Task
- The Task record itself is deleted — no tombstone.

---

## Business Rules

1. Every Task must belong to exactly one List at all times.
2. A Task's status must be one of the statuses defined in its current List.
3. When a Task is moved to a different List, its status is remapped to the closest match by name; if no match, it falls back to the first `open` status.
4. Reporter is set at creation and cannot be changed.
5. Any workspace member with Space access (even View) can be assigned to a task — assignment does not grant edit permission.
6. A View-only member who is assigned a task can still only view it, not edit it.
7. Task creator and all assignees are automatically added as Watchers on creation.
8. Circular dependencies (A blocked by B, B blocked by A) are not allowed.
9. Dependencies are informational only in MVP — they do not hard-block status changes.
10. Deleting a Task permanently deletes all its Subtasks, Comments, Attachments, Checklists, and ActivityLog entries.
11. Archiving a Task does not archive its Subtasks — they must be archived individually or will appear as orphaned subtasks.
12. When a recurring Task is closed, the new recurrence copy is created immediately with reset status and unchecked checklists.
13. File attachments are stored externally (S3/R2) — deleting an attachment removes the DB record and the file from storage.
14. Tags are Workspace-scoped — the same tag can appear across multiple Spaces and Lists.

---

## Out of Scope (MVP)

- Custom Fields (Text, Number, Dropdown, Date, Checkbox, URL) — post-MVP
- Task Templates
- Email-to-task (create task by sending an email)
- AI-generated task descriptions
- Task approval workflow
- Time tracking with a live timer (only manual time log in MVP)
- Subtask progress auto-closing parent task
