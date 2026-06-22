# Revision Plan

Changes to already-implemented code. Work through each change in the order listed — later changes depend on earlier ones.

For new features being built from scratch, continue following `docs/development-plan.md`. This file only covers **retroactive changes**.

---

## Status Key

| Symbol | Meaning |
|--------|---------|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Done |

---

## Change 1 — Sprint Architecture: List Level → Project Level

**Why:** Sprint was originally designed inside a List. Decision revised to sit at the Project (Space) level so a sprint can pull tasks from multiple Lists within the same project.

**Spec:** `docs/sprint.md`

**Current state:** `sprint` table has `list_id` FK → `list`. Sprint routes (when built) would sit under `/api/lists/:listId/sprints`.

**Target state:** `sprint` table has `space_id` FK → `space`. Routes sit under `/api/spaces/:spaceId/sprints`.

---

### Step 1.1 — DB Schema: Replace `list_id` with `space_id`

**File:** `db/schema/sprint.ts`

Changes:
- Remove `listId` column and its FK reference to `list`
- Remove `workspaceId` column (redundant — reachable via `space.workspaceId`)
- Add `spaceId` column with FK → `space`
- Rename index from `sprint_list_id_idx` → `sprint_space_id_idx`
- Remove import of `list` and `workspace`; add import of `space`

```ts
// BEFORE
import { workspace } from "./workspace";
import { list } from "./list";

listId: text("list_id").notNull().references(() => list.id, { onDelete: "cascade" }),
workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),

// AFTER
import { space } from "./space";

spaceId: text("space_id").notNull().references(() => space.id, { onDelete: "cascade" }),
```

Index to update:
```ts
// BEFORE
(t) => [index("sprint_list_id_idx").on(t.listId)]

// AFTER
(t) => [index("sprint_space_id_idx").on(t.spaceId)]
```

**Status:** `[ ]`

---

### Step 1.2 — DB Migration

After updating the schema file, generate and apply the migration:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

> If the `sprint` table has existing data, the migration will fail because `list_id` is NOT NULL and `space_id` doesn't exist yet. In dev, dropping and recreating the table is fine. In prod, write a manual migration that reads `list.space_id` to backfill `space_id` before dropping `list_id`.

**Status:** `[ ]`

---

### Step 1.3 — Update `db/schema/index.ts`

Make sure `sprint` and `taskSprint` are still exported after the schema change. No structural change needed — just verify exports still work after the file edit.

**Status:** `[ ]`

---

### Step 1.4 — Sprint API Routes (if already built)

If any sprint API routes exist under `app/api/lists/[listId]/sprints/`, move them:

```
FROM: app/api/lists/[listId]/sprints/route.ts
TO:   app/api/spaces/[spaceId]/sprints/route.ts

FROM: app/api/lists/[listId]/backlog/route.ts
TO:   app/api/spaces/[spaceId]/backlog/route.ts
```

Inside each route handler, replace all `listId` references with `spaceId`.

If routes do not exist yet, create them at the new location — do not create them at the old `lists/[listId]/` path.

**Status:** `[ ]`

---

### Step 1.5 — Server Actions (`server/sprint.ts`)

Find any server actions that reference `listId` on sprint and update:

| Function | Change |
|----------|--------|
| `createSprint` | Accept `spaceId` instead of `listId` |
| `startSprint` | One-active check: `where { spaceId, status: 'ACTIVE' }` instead of `listId` |
| `getBacklog` | Query tasks across all lists in the space, not just one list |

`getBacklog` new logic:
```ts
// 1. Get all list IDs for this space
const lists = await db.select({ id: list.id }).from(list)
  .where(and(eq(list.spaceId, spaceId), eq(list.isArchived, false)))

// 2. Find tasks in those lists with no active/planned sprint
const backlog = await db.select().from(task)
  .where(and(
    inArray(task.listId, lists.map(l => l.id)),
    eq(task.isArchived, false),
    isNull(task.parentTaskId),
    notExists(/* taskSprint join for PLANNED/ACTIVE sprint */)
  ))
```

**Status:** `[ ]`

---

### Step 1.6 — Sidebar: Move Sprints Under Project, Not Under List

In the sidebar component, sprints should render as direct children of the Project row — not nested inside a List row.

**File:** Whichever component renders the sidebar tree (likely `components/common/sidebar.tsx` or similar).

Current tree (wrong):
```
● Backend API
    ≡  List
        ⚡ Sprint 1
```

Target tree (correct):
```
● Backend API
    ≡  List
    ⚡ Sprint 1   ← sibling to List, not child of List
```

**Status:** `[ ]`

---

### Step 1.7 — Sprint Page Route

Sprint has its own page route as a sibling to list:

```
FROM (if exists): /[workspaceId]/[spaceId]/list/[listId]/sprint/[sprintId]
TO:               /[workspaceId]/[spaceId]/sprint/[sprintId]
```

Create the route at `app/(app)/[workspaceId]/[spaceId]/sprint/[sprintId]/page.tsx` if it does not exist.

**Status:** `[ ]`

---

## Change 2 — Space → Project (UI Rename Only)

**Why:** "Space" as a term is ambiguous. Users think in terms of projects. The entity is renamed "Project" in all user-facing text.

**Spec:** `docs/space.md`

**Scope:** UI labels only. The database table stays `space`. The URL param stays `[spaceId]`. TypeScript types stay `space`/`Space`. Only strings the user reads in the interface change.

> Do NOT rename DB columns, TypeScript types, function names, or URL params. Only change display strings.

---

### Step 2.1 — Sidebar Labels

Find every place the word "Space" appears as a visible UI string and replace with "Project":

| Location | Before | After |
|----------|--------|-------|
| Sidebar section header | `SPACES` | `PROJECTS` |
| Sidebar `+` button tooltip | `New Space` | `New Project` |
| Sidebar item context menu | `Space settings` | `Project settings` |
| Empty state | `No spaces yet` | `No projects yet` |

**Status:** `[ ]`

---

### Step 2.2 — Create / Edit Modal

| Field | Before | After |
|-------|--------|-------|
| Modal title | `Create Space` | `Create Project` |
| Input label | `Space name` | `Project name` |
| Input placeholder | `e.g. Engineering` | `e.g. Backend API` |
| Description | `Spaces represent teams...` | `Projects represent an area of work...` |

**Status:** `[ ]`

---

### Step 2.3 — Settings Pages

| Location | Before | After |
|----------|--------|-------|
| Page title | `Space Settings` | `Project Settings` |
| Members tab heading | `Space Members` | `Project Members` |
| Visibility section | `Space Visibility` | `Project Visibility` |
| Archive confirmation | `Archive this Space?` | `Archive this Project?` |
| Delete confirmation | `Delete Space` | `Delete Project` |
| Breadcrumb | `[Space name] / Settings` | `[Project name] / Settings` |

**Status:** `[ ]`

---

### Step 2.4 — Toast Messages & Error Strings

Search the codebase for all strings containing `"space"` (case-insensitive) that are user-visible toast/error/success messages. Update each one.

```bash
# Find all occurrences to review
grep -r "space" app/ components/ --include="*.tsx" --include="*.ts" -i -l
```

Go through each file and update only the strings that are shown to the user. Leave code identifiers untouched.

**Status:** `[ ]`

---

### Step 2.5 — Page `<title>` Tags and Metadata

Update any Next.js `export const metadata` blocks or `<title>` tags that reference "Space":

```ts
// BEFORE
export const metadata = { title: 'Space Settings — Kanbanica' }

// AFTER
export const metadata = { title: 'Project Settings — Kanbanica' }
```

**Status:** `[ ]`

---

## Change 3 — Pin Task (New Feature)

**Why:** New feature — not a change to existing code, but depends on the task schema already being stable. Implement after Changes 1 and 2 are complete.

**Spec:** `docs/pinned-tasks.md`

Two independent sub-features:
- **Personal Pin** — user bookmarks a task (private to that user)
- **List Pin** — pins a task to the top of its List for all members

---

### Step 3.1 — DB Schema: Add List Pin Columns to Task

**File:** `db/schema/task.ts`

Add four columns to the `task` table:

```ts
isPinnedToList: boolean("is_pinned_to_list").notNull().default(false),
pinnedToListBy: text("pinned_to_list_by"),
pinnedToListAt: timestamp("pinned_to_list_at", { withTimezone: true }),
pinnedToListOrder: integer("pinned_to_list_order"),
```

Add one index to the table's index array:
```ts
index("task_pinned_to_list_idx").on(t.listId, t.isPinnedToList),
```

**Status:** `[ ]`

---

### Step 3.2 — DB Schema: New `pinned_task` Table

**New file:** `db/schema/pinned-task.ts`

```ts
import { pgTable, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { task } from "./task";
import { workspace } from "./workspace";

export const pinnedTask = pgTable("pinned_task", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pinned_task_user_task_idx").on(t.userId, t.taskId),
  index("pinned_task_user_workspace_idx").on(t.userId, t.workspaceId),
]);
```

Export from `db/schema/index.ts`.

**Status:** `[ ]`

---

### Step 3.3 — DB Migration

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

This migration adds 4 columns to `task` and creates the `pinned_task` table. Non-destructive — safe to run on existing data.

**Status:** `[ ]`

---

### Step 3.4 — Server Actions: Personal Pin

**New file:** `server/pinned-task.ts`

Functions to implement:
- `pinTask(taskId, userId, workspaceId)` — enforce 50-pin limit, insert record
- `unpinTask(taskId, userId)` — delete record
- `getPinnedTasks(userId, workspaceId)` — fetch all with task + list + space joined
- `reorderPinnedTasks(userId, workspaceId, orderedIds)` — bulk update orderIndex

**Status:** `[ ]`

---

### Step 3.5 — Server Actions: List Pin

**New file:** `server/list-pin.ts`

Functions to implement:
- `pinTaskToList(taskId, actorId)` — enforce 5-pin limit per list, set columns
- `unpinTaskFromList(taskId, actorId)` — clear pin columns
- `reorderListPins(listId, orderedIds)` — bulk update `pinnedToListOrder`

**Status:** `[ ]`

---

### Step 3.6 — API Routes: Personal Pin

**New files:**

```
app/api/tasks/[taskId]/pin/route.ts
  POST   → pinTask
  DELETE → unpinTask

app/api/workspaces/[workspaceId]/pinned-tasks/route.ts
  GET    → getPinnedTasks

app/api/workspaces/[workspaceId]/pinned-tasks/reorder/route.ts
  PATCH  → reorderPinnedTasks
```

**Status:** `[ ]`

---

### Step 3.7 — API Routes: List Pin

**New files:**

```
app/api/tasks/[taskId]/pin-to-list/route.ts
  POST   → pinTaskToList
  DELETE → unpinTaskFromList

app/api/lists/[listId]/pinned-tasks/reorder/route.ts
  PATCH  → reorderListPins
```

**Status:** `[ ]`

---

### Step 3.8 — UI: Pinned Section in Sidebar

**File:** Sidebar component

Add a "Pinned" section between the global nav and the Projects section:

```
🔔 Inbox
📌 Pinned   ← new section (hidden if 0 pins, collapsed/expanded by user)
─────────────
PROJECTS
```

Each pinned item shows: task title + project name + list name + status dot.

Fetch pinned tasks via SWR from `GET /api/workspaces/:workspaceId/pinned-tasks`.

**Status:** `[ ]`

---

### Step 3.9 — UI: Pin Icon on Task Card and Task Detail

**Files:** Task row component, task card component, task detail panel

- Task row: show `Pin` icon (Lucide) on hover, right side. Filled when pinned, outline when not.
- Task detail header: always-visible `Pin` icon button.
- On click: call `POST /api/tasks/:taskId/pin` or `DELETE /api/tasks/:taskId/pin`.
- Optimistic update: toggle pin state immediately, revert on error.

**Status:** `[ ]`

---

### Step 3.10 — UI: Pinned Sticky Section in List View

**File:** List view component

Add a "Pinned" collapsible section at the very top of the list, above normal task rows:

```
📌 Pinned                         ← section header (collapse toggle)
─────────────────────────────────
[pinned task row]
[pinned task row]
─────────────────────────────────
[normal task rows...]
```

- Only visible if `isPinnedToList = true` tasks exist for this list
- Pin/unpin via context menu (`...` on task row) — only shown to Full Access / Admin+
- Section header collapses/expands via localStorage key `list-pin-collapsed-{listId}`

**Status:** `[ ]`

---

### Step 3.11 — UI: Pin Badge on Board Cards

**File:** Board view task card component

If `task.isPinnedToList === true`, show a small `Pin` icon (Lucide, `w-3 h-3`) in the top-right corner of the card. No position change — just the badge.

**Status:** `[ ]`

---

## Change 4 — UI Redesign

**Why:** Current UI looks AI-generated — default shadcn components, flat white backgrounds, no personality.

**Spec:** `docs/ui-redesign.md`

Work through these in order — each step builds on the previous. Do not skip ahead.

---

### Step 4.1 — Design Tokens + Font

**Files:** `app/globals.css`, `app/layout.tsx`, `tailwind.config.ts`

1. Add Inter font via `next/font/google` in `layout.tsx`
2. Replace all CSS custom properties in `globals.css` with the token system from `ui-redesign.md` (light + dark values)
3. Extend `tailwind.config.ts` to expose the new color tokens as Tailwind classes
4. Set `<html className="dark">` as default — dark mode is the default

After this step, the app will look broken until step 4.2 replaces the old color classes.

**Status:** `[ ]`

---

### Step 4.2 — Sidebar Redesign

**Files:** Sidebar component(s)

1. Set sidebar background to `bg-[var(--bg-sidebar)]` (always dark, regardless of page theme)
2. Update all sidebar item classes to use `--text-sidebar` / `--text-sidebar-active` tokens
3. Add colored dot to project rows (`project.color`)
4. Add active sprint pulse animation (green ping dot)
5. Add "Pinned" section slot (can be empty div for now — Step 3.8 fills it)
6. Animate collapse/expand with Framer Motion

This is the highest-impact single change. The app will immediately look like a real product once this is done.

**Status:** `[ ]`

---

### Step 4.3 — Buttons + Inputs (Global Components)

**Files:** `components/ui/button.tsx`, `components/ui/input.tsx`, any custom form components

Replace all button and input variants with the specs from `ui-redesign.md`:
- Button heights → `h-8` standard (not `h-9`)
- Primary button → `bg-[var(--brand)]`
- Secondary button → `border border-[var(--border)]`
- Ghost button → `text-[var(--text-secondary)] hover:bg-[var(--bg-app)]`
- Input → `h-8`, `border-[var(--border)]`, focus ring using `--brand`

**Status:** `[ ]`

---

### Step 4.4 — Task Row (List View)

**File:** List view task row component

1. Height: `h-9` per row
2. Checkbox: hidden by default, shows on row hover
3. Status pill: `color + 1A` hex background (e.g. `#3B82F61A`), colored text
4. Hover state: `bg-[var(--bg-app)]` tint
5. Right-side actions (pin, more) appear on hover only
6. Left accent bar on selected row: `border-l-2 border-[var(--brand)]`

**Status:** `[ ]`

---

### Step 4.5 — Task Card (Board View)

**File:** Board view card component

1. `rounded-lg` (not `rounded-md`)
2. Hover: `hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-sm)]`
3. Priority badge: only shown if not `NONE`; Urgent gets colored pill, others get icon only
4. Assignee avatar bottom-right
5. Pin badge top-right corner if `isPinnedToList`

**Status:** `[ ]`

---

### Step 4.6 — Modals + Dialogs

**Files:** All Dialog and Sheet components

Install Framer Motion if not already installed:
```bash
npm install framer-motion
```

Add enter/exit animations per `ui-redesign.md` motion spec:
- Overlay: opacity 0 → 1
- Panel: `opacity: 0, scale: 0.96, y: 8` → `opacity: 1, scale: 1, y: 0`
- Duration: 180ms enter, 120ms exit

Update all dialog header patterns to match the two-line heading structure in `ui-redesign.md`.

**Status:** `[ ]`

---

### Step 4.7 — Dropdowns + Tooltips

**Files:** All Popover / DropdownMenu / Tooltip components

1. Dropdown panel: `bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)]`
2. Dropdown item: `text-[var(--text-primary)] hover:bg-[var(--bg-app)]`
3. Destructive dropdown item: `text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-500/10`
4. Tooltip style: `bg-[#1A1D23] text-white text-xs rounded-md border border-white/10`
5. Add keyboard shortcut to tooltip content where applicable

**Status:** `[ ]`

---

### Step 4.8 — Empty States

**Files:** All empty state components / inline empty state JSX

Replace every plain-text empty state with the structured layout from `ui-redesign.md`:
- Colored icon in a rounded square container
- Bold heading
- Subdued description text
- Primary action button

Screens that need this: Lists with no tasks, Projects with no lists, Sprint backlog empty, Pinned section empty, Notifications empty, My Tasks empty.

**Status:** `[ ]`

---

### Step 4.9 — Skeleton Loaders

**Files:** All `loading.tsx` files and inline loading states

Replace every `<Spinner />` or `<Loader />` with a skeleton that matches the real layout of that screen.

Priority order:
1. List view skeleton (most-visited)
2. Board view skeleton
3. Task detail skeleton (already exists at `task-detail-skeleton.tsx` — update to match new design)
4. Sidebar skeleton (shown on initial load)
5. Sprint view skeleton

**Status:** `[ ]`

---

### Step 4.10 — Dark Mode Toggle

**File:** User settings → Appearance (or profile popover)

Add a theme toggle with three options: Light / Dark / System.

Store preference in `localStorage` key `ui-theme`. A `ThemeProvider` client component reads this on mount and sets `<html class="dark">` or removes it.

```tsx
// components/common/theme-provider.tsx
'use client'
import { useEffect } from 'react'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const theme = localStorage.getItem('ui-theme') ?? 'dark'
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [])
  return <>{children}</>
}
```

**Status:** `[ ]`

---

## Dependency Order

```
Change 1 (Sprint architecture)
  └── Step 1.1 Schema
  └── Step 1.2 Migration
  └── Steps 1.3–1.7 (can be done in any order after migration)

Change 2 (Project rename)
  └── No dependencies — can be done in parallel with Change 1

Change 3 (Pin task)
  └── Requires Change 1 to be complete (task schema must be stable)
  └── Steps 3.1–3.3 (DB) must come before 3.4–3.11 (code + UI)

Change 4 (UI redesign)
  └── Step 4.1 (tokens) must come first
  └── Steps 4.2–4.10 can be done in any order after 4.1
  └── Step 4.2 (sidebar) should come before 4.8 (empty states in sidebar)
  └── Can run in parallel with Changes 1–3
```

---

## Pre-Merge Checklist (per change)

Before marking a change done:

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All changed API routes tested manually (create, read, update, delete)
- [ ] No hardcoded hex colors or `bg-gray-*` classes in new UI code
- [ ] Both light and dark mode checked visually
- [ ] No `console.log` left in committed code
- [ ] Migration has been applied locally and `drizzle-kit studio` shows correct schema
