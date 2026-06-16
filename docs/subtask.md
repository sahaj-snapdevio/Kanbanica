# Subtask

## Overview

A Subtask is a child Task nested directly under a parent Task. It breaks large tasks into smaller, trackable pieces of work. Subtasks have the same core fields as Tasks but always belong to a parent — they cannot exist independently.

**Real-world analogy:** If a Task is `Design Login Screen`, its Subtasks might be `Create wireframe`, `Design mobile layout`, `Get design approval`.

**Hierarchy position:**
```
Workspace
  └── Space
        └── List
                    └── Task
                          └── Subtask    ← you are here
```

---

## Subtask vs Checklist

Both Subtasks and Checklists break work into smaller pieces. Knowing which to use matters:

| | Subtask | Checklist Item |
|--|---------|----------------|
| Has own status | Yes | No (just checked / unchecked) |
| Has assignee | Yes | Yes (optional) |
| Has due date | Yes | Yes (optional) |
| Has description | Yes | No |
| Has comments | Yes | No |
| Has activity log | Yes | No |
| Visible in My Tasks view | Yes | No |
| Contributes to progress bar | Yes | Yes |
| Use when | Work needs tracking and ownership | Simple step-by-step checklist |

**Rule of thumb:** If a sub-item needs its own assignee, status, or due date — make it a Subtask. If it is just a step to tick off — use a Checklist item.

---

## User Stories

- As a Member with Edit or Full Access, I want to create subtasks inside a task to break large work into smaller pieces.
- As a Member, I want to assign subtasks to different teammates so each piece has a clear owner.
- As a Member, I want to set individual due dates on subtasks so I can track progress step by step.
- As a Member, I want to see a progress bar on the parent task showing how many subtasks are done.
- As a Member, I want my assigned subtasks to appear in My Tasks view so I don't miss work.
- As a Member, I want to convert a checklist item into a subtask when the work grows in scope.
- As a Member, I want to collapse the subtask list on a task to reduce visual noise when I don't need it.

---

## Features

### 1. Create Subtask

- **Who can create:** Members with **Edit** or **Full Access** on the Space, Admin, Owner
- Created from inside the parent Task detail panel — Subtasks section
- Quick create: type title → press Enter → subtask is added instantly
- Full fields available after creation (same as Task)
- A Task can have unlimited subtasks
- Subtasks are **one level deep only** — a Subtask cannot have its own Subtasks

---

### 2. Subtask Fields

Subtasks share the same fields as Tasks:

| Field | Supported |
|-------|-----------|
| Title | Yes (required) |
| Description | Yes |
| Status | Yes — uses the same statuses as the parent List |
| Priority | Yes |
| Assignees | Yes |
| Due Date | Yes |
| Tags | Yes |
| Watchers | Yes |
| Attachments | Yes |
| Comments | Yes |
| Checklists | No — subtasks do not have nested checklists in MVP |
| Dependencies | No — subtask-level dependencies out of scope for MVP |
| Subtasks | No — no nesting beyond one level |

---

### 3. Subtask Status

- Subtasks use the **same statuses defined on the parent List**
- Default status on creation: first `open` status in the List (e.g. "Todo")
- Changing a subtask's status to `closed` type counts it as complete for the progress rollup
- Closing all subtasks does **not** auto-close the parent Task — the parent must be closed manually

---

### 4. Progress Rollup

- The parent Task shows a progress bar based on subtask completion
- Formula: `closed subtasks / total subtasks * 100`
- Progress is shown:
  - As a fraction on the Task card in List and Board views (e.g. `2/5`)
  - As a progress bar inside the Task detail panel
- Progress updates in real-time as subtask statuses change

---

### 5. Subtask in My Tasks View

- Subtasks assigned to a user appear in their **My Tasks** view alongside regular tasks
- Each subtask shows its parent task name as context (e.g. `Design Login Screen › Create wireframe`)
- Clicking a subtask in My Tasks opens the subtask detail, not the parent

---

### 6. Convert Checklist Item to Subtask

- Any checklist item can be converted into a Subtask
- On convert:
  - A new Subtask is created with the checklist item's title
  - The checklist item is removed from the checklist
  - All other subtask fields start empty (assignee, due date, etc.)
- Action available from the checklist item's context menu (`...` → Convert to Subtask)

---

### 7. Reorder Subtasks

- Subtasks can be reordered via drag-and-drop inside the Task detail panel
- Order is global — all users see the same order

---

### 8. Collapse / Expand Subtask List

- The subtask section in the Task detail panel can be collapsed or expanded
- State is per user — collapsing for yourself does not affect others
- The parent Task card in List / Board views always shows the subtask count fraction regardless of collapse state

---

### 9. Open Subtask as Full Page

- Subtasks can be opened in their own full detail panel (same as a regular Task)
- URL: `/[workspaceId]/task/[subtaskId]`
- Breadcrumb in the panel shows: `List › Parent Task › Subtask Title`

---

## Data Model

Subtasks use the same `Task` table as regular tasks. The `parent_task_id` field determines whether a task is a top-level task or a subtask.

```
Task
├── id                  (uuid, primary key)
├── list_id             (foreign key → List — inherited from parent)
├── parent_task_id      (foreign key → Task, nullable)
│                         null  = top-level Task
│                         set   = Subtask of that Task
├── title               (string, required)
├── description         (text, nullable)
├── status_id           (foreign key → ListStatus)
├── priority            (enum: none | low | medium | high | urgent)
├── reporter_id         (foreign key → User)
├── due_date_start      (date, nullable)
├── due_date_end        (date, nullable)
├── order_index         (integer — position among siblings)
├── is_archived         (boolean, default: false)
├── created_at          (timestamp)
└── updated_at          (timestamp)
```

> No separate Subtask table — subtasks are Tasks with a non-null `parent_task_id`. This keeps queries and logic uniform.

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/tasks/:taskId/subtasks` | Create a Subtask | Edit / Full Access / Admin+ |
| GET | `/api/tasks/:taskId/subtasks` | Get all Subtasks of a Task | Space member |
| GET | `/api/tasks/:id` | Get Subtask detail (same as Task) | Space member |
| PATCH | `/api/tasks/:id` | Update Subtask fields (same as Task) | Edit / Full Access / Admin+ |
| DELETE | `/api/tasks/:id` | Delete Subtask | Full Access / Admin+ |
| PATCH | `/api/tasks/:taskId/subtasks/reorder` | Reorder subtasks | Full Access / Admin+ |
| POST | `/api/tasks/:taskId/subtasks/convert-checklist-item` | Convert checklist item to subtask | Edit / Full Access / Admin+ |

---

## UI Screens

| Screen | Description | Access |
|--------|-------------|--------|
| Subtask section in Task detail | List of subtasks with progress bar, collapse/expand | All Space members |
| Quick create subtask | Inline input at bottom of subtask list | Edit / Full Access / Admin+ |
| Subtask full detail panel | Full page view of a subtask | All Space members |
| My Tasks view | Assigned subtasks appear alongside tasks | Assignee |
| Convert checklist item modal | Confirm conversion from checklist item to subtask | Edit / Full Access / Admin+ |

---

## Data Lifecycle

### Archive
- Subtasks can be archived individually — same behavior as Tasks.
- Archiving a parent Task does **not** automatically archive its Subtasks.
- However, archived parent Tasks are inaccessible in the UI, so Subtasks are effectively hidden even if not individually archived.
- Archiving a Subtask hides it from the Subtask list in the parent Task detail panel.
- Archived Subtasks are **not** counted in the progress rollup (closed / total) — only active subtasks count.
- Can be unarchived at any time — no time limit.

### Soft Delete
- Subtask deletion is a **hard delete** — same as Task, no soft delete or tombstone.
- When a parent Task is deleted, all its Subtasks are hard-deleted in cascade — no recovery.

### Recovery Period
- **Archived Subtask:** Recoverable at any time — no expiry.
- **Deleted Subtask:** No recovery. Data is permanently gone immediately.
- **Deleted via parent Task deletion:** No recovery for any subtask deleted through parent cascade.

### Permanent Deletion Rules
- **Full Access, Admin, and Owner** can delete a Subtask directly.
- Deleting a parent Task permanently deletes all its Subtasks in cascade (regardless of individual Subtask archive state).
- On Subtask deletion, the following are permanently removed:
  - All Comments on the Subtask (soft-deleted tombstones also hard-deleted)
  - All TaskAttachments (DB records + S3/R2 files)
  - All ActivityLog entries
  - All TaskAssignee, TaskWatcher records
  - All Notifications referencing this Subtask
- The Subtask's `Task` record is hard-deleted — no tombstone.

---

## Business Rules

1. A Subtask always belongs to exactly one parent Task.
2. Subtasks are one level deep only — a Subtask cannot have its own Subtasks.
3. A Subtask inherits the `list_id` of its parent Task — it lives in the same List.
4. Subtasks use the statuses of their parent List, not a separate status set.
5. Closing all Subtasks does not automatically close the parent Task.
6. Deleting a parent Task permanently deletes all its Subtasks and their data.
7. Archiving a parent Task does NOT automatically archive its Subtasks — subtasks must be archived individually. However, since they are only accessible through the parent, they are effectively hidden.
8. A Subtask assigned to a user appears in that user's My Tasks view, even if the parent Task is not assigned to them.
9. Subtasks cannot be moved to a different parent Task in MVP — delete and recreate if needed.
10. The progress bar on the parent Task counts only **direct** subtasks (one level), not nested subtasks (which don't exist in MVP anyway).
11. Reordering subtasks is global — all users see the same order.

---

## Out of Scope (MVP)

- Nested subtasks (subtasks of subtasks -- more than one level deep)
- Moving a subtask to a different parent task
- Subtask-level dependencies
- Subtask-level checklists
- Bulk create subtasks
- Converting a subtask into a top-level task

---

## Implementation Notes

### Required Schema Index

These indexes are already defined in `db/schema/task.ts`:

```ts
index("task_parent_task_id_idx").on(t.parentTaskId)        // required for progress rollup and subtask list queries
index("task_list_parent_idx").on(t.listId, t.parentTaskId) // for filtering subtasks within a list
```

Without `task_parent_task_id_idx`, the progress rollup query runs a full table scan for every task card rendered in List View -- an N+1 problem at scale.

### Progress Rollup Query

Compute on the fly. Do NOT cache per task -- the count is small and the index makes it fast. Called when rendering a task card or task detail panel:

```typescript
// src/lib/tasks/get-subtask-progress.ts

async function getSubtaskProgress(parentTaskId: string) {
  // Single query: count total and closed subtasks
  const result = await db.execute<{ total: string; closed: string }>(sql`
    SELECT
      COUNT(*)                                      AS total,
      COUNT(*) FILTER (
        WHERE ls.type = 'CLOSED' AND t.is_archived = false
      )                                             AS closed
    FROM task t
    JOIN list_status ls ON ls.id = t.status_id
    WHERE t.parent_task_id = ${parentTaskId}
      AND t.is_archived = false
  `)

  const total = Number(result[0].total)
  const closed = Number(result[0].closed)

  return {
    total,
    closed,
    percent: total === 0 ? 0 : Math.round((closed / total) * 100),
    label: `${closed}/${total}`,   // shown on task card, e.g. "2/5"
  }
}
```

**Why exclude archived subtasks:** Business rule 11 (see above) states archived subtasks do not count in the progress rollup. The `is_archived = false` filter enforces this.

**Avoid N+1 in List View:** When loading a full list of tasks, do NOT call `getSubtaskProgress` per task. Instead, batch-fetch progress for all parent task IDs in one query:

```typescript
// src/lib/tasks/get-subtask-progress-batch.ts

async function getSubtaskProgressBatch(
  parentTaskIds: string[]
): Promise<Record<string, { total: number; closed: number; percent: number }>> {
  if (parentTaskIds.length === 0) return {}

  const rows = await db.execute<{ parent_task_id: string; total: string; closed: string }>(sql`
    SELECT
      t.parent_task_id,
      COUNT(*)                                             AS total,
      COUNT(*) FILTER (WHERE ls.type = 'CLOSED')          AS closed
    FROM task t
    JOIN list_status ls ON ls.id = t.status_id
    WHERE t.parent_task_id = ANY(${sql.raw(`ARRAY[${parentTaskIds.map(id => `'${id}'`).join(',')}]`)}::text[])
      AND t.is_archived = false
    GROUP BY t.parent_task_id
  `)

  return Object.fromEntries(
    rows.map(r => [
      r.parent_task_id,
      {
        total: Number(r.total),
        closed: Number(r.closed),
        percent: Number(r.total) === 0 ? 0 : Math.round(Number(r.closed) / Number(r.total) * 100),
      }
    ])
  )
}
```

Call this once per list-load and attach progress to each task object before returning the response.

### Create Subtask

Creating a subtask follows the same code path as creating a regular task, with two additional steps:
1. Set `parentTaskId` on the new `Task` record
2. Inherit `listId` from the parent task (do not accept `listId` from the client for subtasks -- always copy from parent)

```typescript
// src/lib/tasks/create-subtask.ts

async function createSubtask(parentTaskId: string, data: CreateSubtaskInput, actorId: string) {
  const [parent] = await db.select().from(task).where(eq(task.id, parentTaskId))
  if (!parent) throw new NotFoundError('Task not found')

  // Guard: cannot nest subtasks
  if (parent.parentTaskId !== null) {
    throw new BadRequestError('Subtasks cannot be nested more than one level deep')
  }

  return db.transaction(async (tx) => {
    // Increment workspace taskSeq atomically
    const [{ taskSeq }] = await tx.execute<{ taskSeq: number }>(sql`
      UPDATE workspace SET task_seq = task_seq + 1
      WHERE id = ${parent.workspaceId}
      RETURNING task_seq AS "taskSeq"
    `)

    const subtaskId = crypto.randomUUID()
    await tx.insert(task).values({
      id: subtaskId,
      ...data,
      listId: parent.listId,      // always inherited
      workspaceId: parent.workspaceId,
      parentTaskId,
      seqNumber: taskSeq,
      reporterId: actorId,
    })

    // Write ActivityLog on parent task
    await tx.insert(activityLog).values({
      id: crypto.randomUUID(),
      taskId: parentTaskId,
      userId: actorId,
      eventType: 'subtask_created',
      meta: { subtask_id: subtaskId, subtask_title: data.title },
    })

    return subtaskId
  })
}
```

### Checklist Item -> Subtask Conversion

```typescript
// src/lib/tasks/convert-checklist-item.ts

async function convertChecklistItemToSubtask(
  checklistItemId: string,
  actorId: string
) {
  // Fetch item + checklist + parent task
  const [item] = await db
    .select({
      itemTitle: checklistItem.title,
      taskId: checklist.taskId,
      listId: task.listId,
    })
    .from(checklistItem)
    .innerJoin(checklist, eq(checklistItem.checklistId, checklist.id))
    .innerJoin(task, eq(checklist.taskId, task.id))
    .where(eq(checklistItem.id, checklistItemId))

  if (!item) throw new NotFoundError('Checklist item not found')

  const [defaultStatus] = await db
    .select()
    .from(listStatus)
    .where(and(eq(listStatus.listId, item.listId), eq(listStatus.type, 'OPEN')))
    .orderBy(listStatus.orderIndex)
    .limit(1)

  // Create subtask
  const subtaskId = await createSubtask(
    item.taskId,
    { title: item.itemTitle, statusId: defaultStatus.id },
    actorId
  )

  // Delete the checklist item
  await db.delete(checklistItem).where(eq(checklistItem.id, checklistItemId))

  return subtaskId
}
```
