# List

## Overview

A List is the primary container for Tasks. It represents a collection of work — a backlog, a project board, a bug tracker, or any grouping of tasks that belong together.

Every task must live inside a List. A List lives directly inside a Space.

**Real-world analogy:** A List = a project board or task queue. e.g. `Backlog`, `Sprint 12`, `Bug Reports`, `Feature Requests`, `Design Review`

**Hierarchy position:**
```
Workspace
  └── Space
        └── List       ← you are here
              └── Task
```

---

## User Stories

- As a Member with Full Access, I want to create a List inside my Space so I can group related tasks together.
- As a Member, I want to customize task statuses per List so each List reflects its own workflow.
- As a Member, I want to view tasks in List view or Board view depending on how I prefer to work.
- As a Member with Full Access, I want to move a List to a different Space without losing any tasks.
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
  - Parent Space (auto-set to current Space)
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
- Duplicated List is placed in the same Space as the original
- Useful for repeating project structures (e.g. monthly sprint template)

---

### 6. Move List

- **Who can move:** Members with **Full Access** on the Space, Admin, Owner
- A List can be moved to:
  - A different Space within the same Workspace
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
├── folder_id           (foreign key → Folder, nullable — post-MVP; null in MVP)
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
| PATCH | `/api/lists/:id/move` | Move List to another Space | Full Access / Admin+ |
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
| Sidebar — List items | Lists shown directly under Space in left sidebar | All Space members |
| List View | Tasks displayed as rows inside the List | All Space members |
| Board View | Tasks as Kanban cards grouped by status | All Space members |
| Calendar View | Tasks on calendar by due date | All Space members |
| Create List modal | Triggered from sidebar `+` next to Space | Full Access / Admin+ |
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
- If the parent Space is archived or deleted, the List follows the same fate.

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
2. A List belongs to exactly one Space. Folder grouping is a post-MVP feature.
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

## Implementation Notes

### Required Drizzle Indexes

These indexes are already defined in `db/schema/list.ts` via the table's third argument:

```ts
// list table indexes
index("list_space_id_idx").on(t.spaceId)
index("list_space_archived_idx").on(t.spaceId, t.isArchived)  // sidebar query filters by both

// listStatus table indexes
index("list_status_list_id_idx").on(t.listId)  // status lookup is always by listId
```

### `order_index` -- Gap Strategy and Rebalancing

Lists are ordered in the sidebar per Space. `order_index` uses an integer gap strategy:

- **Initial gap:** 1000 between adjacent items (first item = 1000, second = 2000, etc.)
- **Insert between:** midpoint of the two neighbours -- `Math.floor((prev + next) / 2)`
- **Append to end:** `max(order_index) + 1000`
- **Rebalance trigger:** when a new midpoint equals an existing `order_index` (gap = 0), rewrite all `order_index` values for that Space in a single transaction with gap 1000

```typescript
// lib/order-index.ts
import { db } from '@/lib/db'
import { list } from '@/db/schema'
import { eq, and, desc, max } from 'drizzle-orm'

export async function getNextOrderIndex(spaceId: string): Promise<number> {
  const [row] = await db
    .select({ maxIndex: max(list.orderIndex) })
    .from(list)
    .where(and(eq(list.spaceId, spaceId), eq(list.isArchived, false)))
  return (row?.maxIndex ?? 0) + 1000
}

export async function rebalanceListOrder(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  spaceId: string
) {
  const lists = await tx
    .select({ id: list.id })
    .from(list)
    .where(eq(list.spaceId, spaceId))
    .orderBy(list.orderIndex)

  await Promise.all(
    lists.map((l, i) =>
      tx.update(list).set({ orderIndex: (i + 1) * 1000 }).where(eq(list.id, l.id))
    )
  )
}
```

Same gap strategy applies to `ListStatus.orderIndex` within a List.

### `createList` -- Transaction with Default Statuses

Create the List and its default statuses atomically. If status creation fails, the List must not exist.

```typescript
// server/list.ts
import { db } from '@/lib/db'
import { list, listStatus } from '@/db/schema'

const DEFAULT_STATUSES = [
  { name: 'Todo',        color: '#9CA3AF', type: 'OPEN'   as const, orderIndex: 1000 },
  { name: 'In Progress', color: '#3B82F6', type: 'ACTIVE' as const, orderIndex: 2000 },
  { name: 'Review',      color: '#8B5CF6', type: 'ACTIVE' as const, orderIndex: 3000 },
  { name: 'Done',        color: '#22C55E', type: 'CLOSED' as const, orderIndex: 4000 },
]

export async function createList(spaceId: string, data: CreateListInput, userId: string) {
  const orderIndex = await getNextOrderIndex(spaceId)

  return db.transaction(async (tx) => {
    const listId = crypto.randomUUID()
    await tx.insert(list).values({ id: listId, spaceId, orderIndex, createdBy: userId, ...data })

    await tx.insert(listStatus).values(
      DEFAULT_STATUSES.map(s => ({ id: crypto.randomUUID(), listId, ...s }))
    )

    return listId
  })
}
```

### `deleteList` -- R2 Before DB Cascade

CLAUDE.md rule: never delete the DB record before the R2 file. For list deletion, collect all attachment keys first, delete from R2 in batches, then delete the DB record (FK cascade removes everything else).

```typescript
import { db } from '@/lib/db'
import { list, task, taskAttachment } from '@/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { deleteFromR2 } from '@/lib/storage'

export async function deleteList(listId: string) {
  // 1. Collect all R2 attachment keys for this list
  const tasks = await db.select({ id: task.id }).from(task).where(eq(task.listId, listId))
  const taskIds = tasks.map(t => t.id)

  const attachments = taskIds.length > 0
    ? await db.select({ fileUrl: taskAttachment.fileUrl })
        .from(taskAttachment)
        .where(inArray(taskAttachment.taskId, taskIds))
    : []

  // 2. Delete from R2 in batches of 50
  for (let i = 0; i < attachments.length; i += 50) {
    const batch = attachments.slice(i, i + 50)
    await Promise.all(batch.map(a => deleteFromR2(a.fileUrl)))
  }

  // 3. Now delete the DB record -- FK cascade removes everything else
  await db.delete(list).where(eq(list.id, listId))
}
```

If R2 deletion fails, abort and return 503 -- do not proceed to DB delete. Orphaned R2 files are unrecoverable.

### `duplicateList` -- Transaction Spec

Duplicate copies structure only by default. Tasks are optional (user opts in).

```typescript
import { db } from '@/lib/db'
import { list, listStatus, task } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export async function duplicateList(
  sourceListId: string,
  userId: string,
  includeTasks: boolean
) {
  const [source] = await db.select().from(list).where(eq(list.id, sourceListId))
  if (!source) throw new Error('NOT_FOUND')

  const statuses = await db.select().from(listStatus).where(eq(listStatus.listId, sourceListId))
  const sourceTasks = includeTasks
    ? await db.select().from(task).where(and(eq(task.listId, sourceListId), eq(task.isArchived, false)))
    : []

  const orderIndex = await getNextOrderIndex(source.spaceId)

  return db.transaction(async (tx) => {
    // 1. Create new List
    const newListId = crypto.randomUUID()
    await tx.insert(list).values({
      id: newListId,
      spaceId: source.spaceId,
      name: `Copy of ${source.name}`,
      color: source.color,
      description: source.description,
      orderIndex,
      createdBy: userId,
    })

    // 2. Copy statuses -- preserve orderIndex and type; generate new IDs
    const statusIdMap = new Map<string, string>()
    for (const s of statuses) {
      const newStatusId = crypto.randomUUID()
      await tx.insert(listStatus).values({
        id: newStatusId,
        listId: newListId,
        name: s.name,
        color: s.color,
        type: s.type,
        orderIndex: s.orderIndex,
      })
      statusIdMap.set(s.id, newStatusId)
    }

    // 3. Copy tasks (structure only -- no assignees, due dates, comments, attachments)
    for (const t of sourceTasks) {
      const mappedStatusId = statusIdMap.get(t.statusId) ?? statuses[0]?.id
      await tx.insert(task).values({
        id: crypto.randomUUID(),
        listId: newListId,
        workspaceId: t.workspaceId,
        seqNumber: t.seqNumber,  // NOTE: in real impl, increment workspace taskSeq
        statusId: mappedStatusId!,
        title: t.title,
        priority: t.priority,
        orderIndex: t.orderIndex,
        reporterId: userId,
        // assignees, dueDate, description NOT copied
      })
    }

    return newListId
  })
}
```

> **`taskSeq` note:** duplicated tasks get new IDs and new `taskSeq` numbers from the workspace counter -- they are not copies of the original task numbers.

### `moveList` -- Permission Check and Space Switch

Moving a List to a different Space requires the user to have Full Access on BOTH the source and destination Space.

```typescript
import { db } from '@/lib/db'
import { list, space } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function moveList(listId: string, targetSpaceId: string, userId: string) {
  // Permission check on destination must happen before the update
  const [[sourceList], [targetSpace]] = await Promise.all([
    db.select().from(list).where(eq(list.id, listId)),
    db.select().from(space).where(eq(space.id, targetSpaceId)),
  ])

  // Verify user has Full Access on destination space (same workspace)
  if (sourceList.spaceId === targetSpaceId) return  // no-op

  const orderIndex = await getNextOrderIndex(targetSpaceId)

  await db.update(list).set({ spaceId: targetSpaceId, orderIndex }).where(eq(list.id, listId))
  // Statuses, tasks, and all nested data remain unchanged -- only spaceId moves
}
```

After the move, the List inherits the destination Space's permission model -- members of the source Space who are not members of the destination Space will lose access.

### Status Deletion Guard -- Must Be Inside a Transaction

The "tasks must be reassigned before delete" check is vulnerable to a race condition if done as a pre-check. Do it atomically:

```typescript
import { db } from '@/lib/db'
import { listStatus, task } from '@/db/schema'
import { eq, and, ne, count } from 'drizzle-orm'

export async function deleteListStatus(listId: string, statusId: string) {
  return db.transaction(async (tx) => {
    // Check inside transaction to prevent TOCTOU race
    const [{ taskCount }] = await tx
      .select({ taskCount: count() })
      .from(task)
      .where(and(eq(task.statusId, statusId), eq(task.isArchived, false)))

    if (taskCount > 0) throw new Error(`TASKS_EXIST:${taskCount}`)

    // Ensure at least one closed status will remain
    const [status] = await tx.select().from(listStatus).where(eq(listStatus.id, statusId))
    if (status.type === 'CLOSED') {
      const [{ remaining }] = await tx
        .select({ remaining: count() })
        .from(listStatus)
        .where(and(
          eq(listStatus.listId, listId),
          eq(listStatus.type, 'CLOSED'),
          ne(listStatus.id, statusId)
        ))
      if (remaining === 0) throw new Error('LAST_CLOSED_STATUS')
    }

    await tx.delete(listStatus).where(eq(listStatus.id, statusId))
  })
}
```

Return `422` with `{ error: "Reassign or delete the X tasks using this status before removing it." }` when `TASKS_EXIST`, and `{ error: "A list must have at least one closed status." }` when `LAST_CLOSED_STATUS`.

### Board View Column Order

Board View columns are the List's statuses in `ListStatus.orderIndex` order -- there is no separate board column order. Reordering statuses (via `PATCH /api/lists/:id/statuses/reorder`) also reorders Board columns.

### `reorderStatuses` -- Bulk Update

Reorder accepts an ordered array of status IDs and reassigns `orderIndex` with gap 1000:

```typescript
import { db } from '@/lib/db'
import { listStatus } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export async function reorderStatuses(listId: string, orderedIds: string[]) {
  return db.transaction(async (tx) => {
    await Promise.all(
      orderedIds.map((id, i) =>
        tx.update(listStatus)
          .set({ orderIndex: (i + 1) * 1000 })
          .where(and(eq(listStatus.id, id), eq(listStatus.listId, listId)))
      )
    )
  })
}
```

### Folder Mapping

```
src/
  server/
    list.ts               <- createList, deleteList, duplicateList, moveList
    list-status.ts        <- createStatus, updateStatus, deleteListStatus, reorderStatuses
  lib/
    order-index.ts        <- getNextOrderIndex, rebalanceListOrder (shared with tasks)
  app/api/
    spaces/[spaceId]/
      lists/route.ts      <- GET (list), POST (create)
    lists/[id]/
      route.ts            <- GET, PATCH, DELETE
      archive/route.ts    <- PATCH
      unarchive/route.ts  <- PATCH
      duplicate/route.ts  <- POST
      move/route.ts       <- PATCH
      reorder/route.ts    <- PATCH
      statuses/
        route.ts          <- GET, POST
        reorder/route.ts  <- PATCH
        [statusId]/
          route.ts        <- PATCH, DELETE
```

---

## Out of Scope (MVP)

- List templates (pre-built Lists with predefined statuses and tasks)
- List-level permission override (separate from Space permission)
- Table / Spreadsheet view
- Gantt / Timeline view
- List-level analytics and reporting
- Public List sharing (external link to a List without login)
- Importing tasks from CSV or external tools
