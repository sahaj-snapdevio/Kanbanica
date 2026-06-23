# Pinned Tasks

## Overview

There are two distinct pin models in Kanbanica:

| | Personal Pin | List Pin |
|--|-------------|----------|
| **Who sees it** | Only the user who pinned it | Everyone in the List |
| **Purpose** | Personal bookmark — "I want to track this" | Team highlight — "Everyone should notice this" |
| **Scope** | Workspace-wide (across all projects) | Per List |
| **Who can pin** | Any member with task access | Full Access / Admin+ |
| **Limit** | 50 per user per workspace | 5 per List |
| **Appears in** | Sidebar "Pinned" section | Top of List view (sticky section) |

---

## Part 1 — Personal Pin

### Overview

Any member can pin any task they have access to. Pinned tasks appear in a dedicated **"Pinned"** section in the left sidebar, accessible regardless of which Project or List the user is currently viewing.

**Real-world analogy:** Like browser bookmarks — personal, fast access, invisible to others.

---

### User Stories

- As a Member, I want to pin tasks I'm actively tracking so I can jump to them from anywhere without navigating the sidebar.
- As a Member, I want to unpin a task when I no longer need quick access to it.
- As a Member, I want my pinned tasks to stay pinned after I close and reopen the app.
- As a Member, I want to see the project and list context of each pinned task so I know where it lives.

---

### Features

#### Pin / Unpin
- **Who can pin:** Any member with access to the task
- Pin icon appears:
  - On task card (on hover, top-right corner)
  - In task detail header (always visible)
- Toggling the pin icon pins or unpins the task
- Pinning is instant — no confirmation needed
- If the user has reached the 50-pin limit, show a toast: `"Pin limit reached (50). Unpin a task first."`

#### Pinned Section in Sidebar
- Appears at the top of the sidebar, above the Projects list
- Collapsed by default if no tasks are pinned; expanded once the user has at least one pin
- Shows up to 50 pinned tasks
- Each item shows:
  - Task title (truncated if long)
  - Status dot (color-coded)
  - Project name + List name (secondary line)
- Clicking any item opens the task detail
- Drag-to-reorder within the Pinned section (personal order preference, not global)
- If the underlying task is deleted or the user loses access to it, the pin is automatically removed

#### Cross-workspace
- Pins are workspace-scoped — switching workspaces shows only that workspace's pinned tasks
- Pins do not transfer between workspaces

---

### Data Model

```
PinnedTask
├── id            (uuid, primary key)
├── user_id       (FK → User, onDelete: cascade)
├── task_id       (FK → Task, onDelete: cascade)
├── workspace_id  (FK → Workspace, onDelete: cascade)
├── order_index   (integer — personal sort order within the Pinned section)
└── pinned_at     (timestamp)

Unique index on (user_id, task_id)
Index on (user_id, workspace_id) — for fetching all pins in a workspace
```

> `onDelete: cascade` on task_id means the pin is automatically removed if the task is deleted or hard-removed.

---

### API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/tasks/:taskId/pin` | Pin a task | Task-accessible member |
| DELETE | `/api/tasks/:taskId/pin` | Unpin a task | Task-accessible member |
| GET | `/api/workspaces/:workspaceId/pinned-tasks` | Get all pinned tasks for the current user | Any workspace member |
| PATCH | `/api/workspaces/:workspaceId/pinned-tasks/reorder` | Reorder pinned tasks | Any workspace member |

**Response shape for GET pinned-tasks:**
```typescript
{
  pinnedTasks: Array<{
    id: string           // PinnedTask.id
    taskId: string
    taskTitle: string
    taskStatus: { name: string; color: string; type: string }
    listId: string
    listName: string
    spaceId: string
    spaceName: string    // Project name
    orderIndex: number
    pinnedAt: string
  }>
}
```

---

### UI Screens

| Screen | Description |
|--------|-------------|
| Sidebar — Pinned section | List of all pinned tasks for the user, reorderable |
| Task card — pin icon | Hover to reveal pin/unpin toggle |
| Task detail — pin icon | Always visible in header, toggles pin state |

---

### Business Rules

1. A user can pin at most **50 tasks** per workspace.
2. A task can be pinned by multiple users independently — pins are per-user.
3. If a task is archived, the pin is preserved — the task still appears in the Pinned section with an archived badge.
4. If a task is deleted, the pin record is removed via cascade — no orphaned pins.
5. If a user loses access to a task's Project (e.g. removed from a Private Project), the pin is hidden from the sidebar but the record is preserved. It reappears if access is restored.
6. Pin order is personal — reordering one user's pins does not affect any other user.
7. Pins are not exported or shared.

---

## Part 2 — List Pin (Sticky Task)

### Overview

Members with Full Access can pin up to **5 tasks** to the top of a List. Pinned tasks appear in a **"Pinned"** sticky section above all other tasks in the List view, visible to everyone who can see the List.

**Real-world analogy:** Like a pinned post at the top of a forum thread — a shared signal to the whole team.

---

### User Stories

- As a Member with Full Access, I want to pin a blocker task to the top of the List so the whole team sees it immediately.
- As a Member with Full Access, I want to unpin a task when it is no longer a priority highlight.
- As a Member, I want to see which tasks are pinned when I open a List so I can quickly spot the most important work.
- As a Member with Full Access, I want to reorder pinned tasks within the sticky section.

---

### Features

#### Pin / Unpin to List
- **Who can pin:** Members with **Full Access** on the Space, Admin, Owner
- Right-click context menu on task card → **"Pin to top"**
- Also accessible from the task card `...` (more options) menu
- Also accessible from task detail header `...` menu
- If the List already has 5 pinned tasks, show error: `"List pin limit reached (5). Unpin a task to add another."`
- Unpinning returns the task to its normal position in the list (sorted by the user's current sort preference)

#### Sticky Section in List View
- Displayed at the very top of the List view, above the normal task rows
- Section header: **"📌 Pinned"** (subtle, collapsible)
- Section can be collapsed/expanded by any member (personal preference, not global)
- Each pinned task row looks the same as normal task rows, with a pin badge on the left
- Pinned tasks respect all normal task fields (status, assignee, due date, priority) — they are not frozen
- Pinned tasks are **excluded from the normal task list** below — they do not appear twice
- Up to 5 tasks can be pinned per List
- Pinned tasks within the section can be **drag-to-reordered** by Full Access members (global — affects all members)

#### Board View
- Pinned tasks do NOT move to a special column in Board View
- They appear in their normal status column with a small **pin icon badge** on the card
- No sticky section in Board View — the pin is just a visual indicator

#### Sprint View
- If a pinned task is also assigned to the active Sprint, it shows in both places:
  - Pin badge on the Sprint task card
  - Visible in the Sprint Backlog with a pin badge

---

### Data Model

Add three columns to the existing `task` table:

```ts
// Added to db/schema/task.ts

isPinnedToList: boolean("is_pinned_to_list").notNull().default(false),
pinnedToListBy: text("pinned_to_list_by"),  // user_id of who pinned it, nullable
pinnedToListAt: timestamp("pinned_to_list_at", { withTimezone: true }),  // nullable
pinnedToListOrder: integer("pinned_to_list_order"),  // display order within the sticky section, nullable
```

> Columns live on the `task` table because a task belongs to exactly one List — no join table needed.

**Index to add:**

```ts
index("task_pinned_to_list_idx").on(t.listId, t.isPinnedToList)
// Fast lookup: all pinned tasks in a list
```

---

### API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/tasks/:taskId/pin-to-list` | Pin task to top of its List | Full Access / Admin+ |
| DELETE | `/api/tasks/:taskId/pin-to-list` | Unpin task from List | Full Access / Admin+ |
| PATCH | `/api/lists/:listId/pinned-tasks/reorder` | Reorder pinned tasks in the sticky section | Full Access / Admin+ |

---

### UI Screens

| Screen | Description |
|--------|-------------|
| List view — Pinned sticky section | Fixed at top, up to 5 tasks, collapsible, reorderable by Full Access members |
| Board view — Pin badge | Small pin icon on pinned task cards — no position change |
| Task card `...` menu | "Pin to top" / "Unpin" option |
| Task detail `...` menu | "Pin to top" / "Unpin" option |

---

### Business Rules

1. A List can have at most **5 pinned tasks** at a time.
2. **Only Full Access members, Admin, and Owner** can pin or unpin tasks at the List level.
3. Any member who can see the List can see the pinned section — it is a shared, global view.
4. Pinned task order within the sticky section is global — reordering affects all members.
5. Archiving a task removes its List pin automatically.
6. Moving a task to a different List removes its List pin — the pin is scoped to the originating List.
7. A task can be both personally pinned (by any user) AND List-pinned simultaneously — these are independent.
8. List pins are preserved when a List is archived — they reappear when unarchived.
9. Deleting a List hard-deletes all tasks including their pin state (no special handling needed).
10. List pin order (`pinnedToListOrder`) uses the same gap strategy as other `orderIndex` fields (gap 1000, rebalance on collision).

---

## Implementation Notes

### Personal Pin — `pinTask` Transaction

```typescript
export async function pinTask(taskId: string, userId: string, workspaceId: string) {
  return db.transaction(async (tx) => {
    // Enforce limit
    const [{ count }] = await tx
      .select({ count: count() })
      .from(pinnedTask)
      .where(and(eq(pinnedTask.userId, userId), eq(pinnedTask.workspaceId, workspaceId)))
    if (count >= 50) throw new Error('PIN_LIMIT_REACHED')

    // Get next order index
    const [{ maxOrder }] = await tx
      .select({ maxOrder: max(pinnedTask.orderIndex) })
      .from(pinnedTask)
      .where(and(eq(pinnedTask.userId, userId), eq(pinnedTask.workspaceId, workspaceId)))

    await tx.insert(pinnedTask).values({
      id: crypto.randomUUID(),
      userId,
      taskId,
      workspaceId,
      orderIndex: (maxOrder ?? 0) + 1000,
      pinnedAt: new Date(),
    })
  })
}
```

Return `409 Conflict` if pin already exists (unique index violation). Return `422` with `{ error: "Pin limit reached (50). Unpin a task first." }` on limit.

### List Pin — `pinTaskToList` Transaction

```typescript
export async function pinTaskToList(taskId: string, actorId: string) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(task).where(eq(task.id, taskId))
    if (!t) throw new NotFoundError('Task not found')

    // Enforce 5-pin limit per list
    const [{ count: pinCount }] = await tx
      .select({ count: count() })
      .from(task)
      .where(and(eq(task.listId, t.listId), eq(task.isPinnedToList, true)))
    if (pinCount >= 5) throw new Error('LIST_PIN_LIMIT_REACHED')

    // Assign order at the end of the pinned section
    const [{ maxOrder }] = await tx
      .select({ maxOrder: max(task.pinnedToListOrder) })
      .from(task)
      .where(and(eq(task.listId, t.listId), eq(task.isPinnedToList, true)))

    await tx.update(task)
      .set({
        isPinnedToList: true,
        pinnedToListBy: actorId,
        pinnedToListAt: new Date(),
        pinnedToListOrder: (maxOrder ?? 0) + 1000,
        updatedAt: new Date(),
      })
      .where(eq(task.id, taskId))
  })
}
```

Return `422` with `{ error: "List pin limit reached (5). Unpin a task to add another." }` on limit.

### List View Query — Pinned Tasks First

When fetching tasks for List view, always return pinned tasks first in a separate group:

```typescript
// Pinned tasks (sticky section)
const pinnedTasks = await db.select().from(task)
  .where(and(eq(task.listId, listId), eq(task.isPinnedToList, true), eq(task.isArchived, false)))
  .orderBy(task.pinnedToListOrder)

// Normal tasks (respects user's sort preference)
const normalTasks = await db.select().from(task)
  .where(and(eq(task.listId, listId), eq(task.isPinnedToList, false), eq(task.isArchived, false)))
  .orderBy(/* user sort preference */)
```

### Folder Mapping

```
src/
  app/api/
    tasks/[taskId]/
      pin/route.ts              <- POST (personal pin), DELETE (personal unpin)
      pin-to-list/route.ts      <- POST (list pin), DELETE (list unpin)
    workspaces/[workspaceId]/
      pinned-tasks/
        route.ts                <- GET (list personal pins)
        reorder/route.ts        <- PATCH (reorder personal pins)
    lists/[listId]/
      pinned-tasks/
        reorder/route.ts        <- PATCH (reorder list pins)
  server/
    pinned-task.ts              <- pinTask, unpinTask, getPinnedTasks, reorderPinnedTasks
    list-pin.ts                 <- pinTaskToList, unpinTaskFromList, reorderListPins
```

---

## Out of Scope (MVP)

- Pinning Lists, Projects, or Sprints (only Tasks are pinnable)
- Shared personal pin collections (team pin boards)
- Pin expiry (auto-unpin after N days)
- Pin notifications ("X pinned a task to this list")
- Pinning within Sprint view (use List pin instead)
