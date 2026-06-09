# Search & Filters

## Overview

Search and Filters help users find and focus on the right tasks quickly. There are two distinct systems:

- **Global Search** — find anything across the entire workspace instantly (tasks, lists, spaces, members)
- **List Filters & Sort** — narrow down and organize tasks within a specific List or View

Both are independent but complementary. Global Search is for discovery; Filters are for focused work.

---

## 1. Global Search

A fast, workspace-wide search accessible from anywhere in the app.

### Access

- Keyboard shortcut: `Ctrl + K` (Windows) / `Cmd + K` (Mac) — opens the search command palette
- Click the search icon in the top navigation bar
- Available on every page in the app
- For the full list of keyboard shortcuts across the app, see [keyboard-shortcuts.md](./keyboard-shortcuts.md)

### What can be searched

| Type | Searchable fields |
|------|------------------|
| Tasks | Title |
| Subtasks | Title |
| Lists | Name |
| Spaces | Name |
| Members | Name, email |
| Tags | Name |

### Search behavior

- Search begins after typing **2 or more characters**
- Results appear instantly as the user types (debounced — 300ms delay to avoid excess requests)
- Results are grouped by type: Tasks, Lists, Spaces, Members
- Maximum **10 results per group** shown in the dropdown — pressing Enter or clicking "View all results" opens the full results page
- Search respects permissions — only shows results from Spaces the user has access to
- Private Spaces the user is not a member of are completely excluded from results

### Search result item (Task)

Each task result shows:
- Task title (with matching term highlighted)
- Space name → List name (breadcrumb context)
- Status pill
- Assignee avatar(s)
- Due date (red if overdue)

Clicking a result opens the Task detail panel directly.

### Search result item (List / Space / Member)

- **List:** Name + Space it belongs to → click to navigate to that List
- **Space:** Name + member count → click to navigate to that Space
- **Member:** Avatar + name + email → click to open their profile

### Full results page

- Triggered by pressing Enter or "View all results"
- Shows all matching results with filters on the left:
  - Filter by type (Tasks / Lists / Spaces / Members)
  - Filter by Space
  - Filter by Assignee
  - Filter by Status
  - Filter by Date range (created or updated)
- Results sortable by: Relevance (default) / Created Date / Last Updated

### Recent & Suggested

When the search palette opens with no input:
- **Recent:** Last 5 items the user visited (tasks, lists, spaces)
- **Suggested:** Frequently visited items by the user

---

## 2. List Filters

Filters narrow down which tasks are visible within a List or View. They are applied per user and do not affect what others see.

### Access

- Filter icon / `Filters` button in the List toolbar (top of List View, Board View, Calendar View)
- Active filters are shown as removable chips in the toolbar
- Multiple filters can be active at the same time (AND logic — all conditions must match)

### Available Filters

| Filter | Options |
|--------|---------|
| **Status** | Select one or more statuses from the List's status set |
| **Priority** | None / Low / Medium / High / Urgent (multi-select) |
| **Assignee** | Select one or more workspace members; option: `Unassigned` |
| **Due Date** | Overdue / Due Today / Due This Week / Due This Month / Custom Date Range / No Due Date |
| **Tags** | Select one or more tags |
| **Created By** | Select one or more members |
| **Created Date** | Custom date range |
| **Last Updated** | Custom date range |

### Filter logic

- Multiple values within the same filter = **OR** (e.g. Priority: High OR Urgent)
- Multiple different filters active = **AND** (e.g. Assignee: Jane AND Priority: High)
- Example: `Assignee: Jane OR John` AND `Priority: Urgent OR High` AND `Due Date: This Week`

### Filter chips

Active filters show as chips in the toolbar:
```
[Assignee: Jane ×]  [Priority: High, Urgent ×]  [Due Date: This Week ×]  [Clear All]
```
- Click `×` on a chip to remove that filter
- Click `Clear All` to remove all active filters

### Saved Filters

- Users can save a combination of active filters as a named Saved Filter
- Save button appears in the filter panel when at least one filter is active
- Saved Filters are **per user per List** — not shared with other members
- Saved Filters appear as a dropdown in the filter toolbar for quick reapplication
- Maximum **10 saved filters per List per user**
- Saved Filters can be renamed or deleted

---

## 3. Sort

Sorting controls the order tasks appear within a List View or within columns in Board View.

### Sort options

| Sort by | Direction |
|---------|-----------|
| Manual (default) | Drag-and-drop order — user-defined |
| Due Date | Ascending (earliest first) / Descending |
| Priority | Highest first / Lowest first |
| Status | By status order defined in List settings |
| Assignee | Alphabetical A–Z / Z–A |
| Created Date | Newest first / Oldest first |
| Last Updated | Most recently updated first / Oldest |

### Sort behavior

- Only one sort can be active at a time
- Sort is **per user** — does not affect other members
- When a sort is active, manual drag-and-drop reordering is disabled (sort order takes precedence)
- Sort preference is saved per user per List and persists across sessions

---

## 4. Filters + Sort in My Tasks View

My Tasks has its own filter and sort options since it is workspace-wide (not List-specific).

### My Tasks Filters

| Filter | Options |
|--------|---------|
| **Space** | Select one or more Spaces |
| **List** | Select one or more Lists |
| **Priority** | None / Low / Medium / High / Urgent |
| **Status** | Select statuses across all Lists |
| **Due Date** | Overdue / Today / This Week / Custom Range |
| **Show Completed** | Toggle — hide or show closed tasks (default: hidden) |

### My Tasks Sort

| Sort by | Direction |
|---------|-----------|
| Due Date (default) | Soonest first |
| Priority | Highest first |
| Status | By type (open → active → closed) |
| List | Alphabetical |
| Space | Alphabetical |
| Created Date | Newest first |

---

## Data Model

```
SavedFilter
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── list_id             (foreign key → List)
├── name                (string, required)
├── filters             (json — serialized filter state)
│                         e.g. { assignees: [...], priorities: [...], due_date: "this_week" }
├── created_at          (timestamp)
└── updated_at          (timestamp)

UserSearchHistory
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── workspace_id        (foreign key → Workspace)
├── entity_type         (enum: task | list | space | member)
├── entity_id           (uuid — id of the visited item)
└── visited_at          (timestamp)
```

---

## API Endpoints

### Global Search

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/workspaces/:workspaceId/search?q=:query` | Global search across workspace | Workspace member |
| GET | `/api/workspaces/:workspaceId/search/recent` | Get recent + suggested items for the user | Workspace member |

### List Filters & Sort

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/lists/:listId/tasks?status=&priority=&assignee=&due=&sort=&dir=` | Get tasks with filters and sort applied | Space member |
| GET | `/api/lists/:listId/saved-filters` | Get saved filters for a List | Space member |
| POST | `/api/lists/:listId/saved-filters` | Save a new filter | Space member |
| PATCH | `/api/saved-filters/:id` | Rename a saved filter | Filter owner |
| DELETE | `/api/saved-filters/:id` | Delete a saved filter | Filter owner |

### My Tasks

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/me/tasks?space=&priority=&status=&due=&show_completed=&sort=&dir=` | Get My Tasks with filters and sort | Authenticated user |

---

## UI Screens

| Screen | Description | Access |
|--------|-------------|--------|
| Global Search palette | `Ctrl+K` / `Cmd+K` overlay — instant results as you type | All workspace members |
| Full search results page | `/search?q=:query` — paginated results with sidebar filters | All workspace members |
| List filter toolbar | Filter chips + filter panel in List / Board / Calendar views | All Space members |
| Saved filters dropdown | Quick-apply saved filter combinations in List toolbar | All Space members |
| My Tasks filter panel | Filter sidebar in My Tasks view | All workspace members |

---

## Business Rules

1. Global Search only returns results from Spaces the user has access to — private Spaces the user is not a member of are fully excluded.
2. Search results for tasks inside archived Lists or Spaces are excluded by default — can be included via a toggle `Include Archived`.
3. Filters are per user — applying or clearing a filter does not affect what other members see.
4. Multiple values within the same filter use OR logic; multiple different filters use AND logic.
5. When a sort other than Manual is active, drag-and-drop task reordering is disabled for that user.
6. Saved Filters are per user per List — they are not shared or visible to other team members.
7. Saved Filter limit is 10 per user per List to prevent clutter.
8. Global Search respects the same permission model as the rest of the app — no information is exposed through search that the user would not otherwise have access to.
9. Search history (recent items) is per user and per workspace — switching workspace shows that workspace's recent history.
10. Filters and sort preferences persist across sessions — they are restored when the user returns to the same List.

---

## Implementation Notes

### FTS Scope -- Title Only at MVP (Critical)

Task `description` is stored as `jsonb` (Tiptap JSON). PostgreSQL `@@to_tsquery` and `tsvector` do not work on `jsonb` columns without a generated column extracting the text first. **Do NOT attempt to search description at MVP** -- it will either error or silently return no matches.

Global search queries **`title` and `name` fields only**. The Out of Scope section documents the post-MVP path (generated `tsvector` column + GIN index).

### Global Search Query

```typescript
// src/server/search.ts

export async function globalSearch(
  query: string,
  workspaceId: string,
  userId: string
) {
  if (query.length < 2) return { tasks: [], lists: [], spaces: [], members: [] }

  // Scope all results to spaces the user can access
  const accessibleSpaceIds = await getAccessibleSpaceIds(userId, workspaceId)

  const [tasks, lists, spaces, members] = await Promise.all([
    db.task.findMany({
      where: {
        isArchived: false,
        parentTaskId: null,
        list: {
          isArchived: false,
          space: { id: { in: accessibleSpaceIds } }
        },
        title: { contains: query, mode: 'insensitive' }
      },
      include: {
        status: true,
        list: { include: { space: true } },
        assignees: { include: { user: true } }
      },
      take: 10,
      orderBy: { updatedAt: 'desc' }
    }),

    db.list.findMany({
      where: {
        isArchived: false,
        spaceId: { in: accessibleSpaceIds },
        name: { contains: query, mode: 'insensitive' }
      },
      include: { space: true },
      take: 10
    }),

    db.space.findMany({
      where: {
        workspaceId,
        id: { in: accessibleSpaceIds },
        name: { contains: query, mode: 'insensitive' }
      },
      take: 10
    }),

    db.workspaceMember.findMany({
      where: {
        workspaceId,
        user: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } }
          ]
        }
      },
      include: { user: true },
      take: 10
    })
  ])

  return { tasks, lists, spaces, members }
}
```

`contains` with `mode: 'insensitive'` maps to `ILIKE '%query%'` in PostgreSQL. This is sufficient for MVP. Post-MVP: replace with `search` mode + a GIN index for performance at scale.

### Search History -- Upsert and Trim

Track recent visits in `UserSearchHistory`. Upsert on `(userId, workspaceId, entityType, entityId)` to avoid duplicate rows, then trim to the last 20 entries per user per workspace:

```typescript
// src/server/search.ts

export async function recordSearchVisit(
  userId: string,
  workspaceId: string,
  entityType: 'task' | 'list' | 'space' | 'member',
  entityId: string
) {
  await db.userSearchHistory.upsert({
    where: { userId_workspaceId_entityType_entityId: { userId, workspaceId, entityType, entityId } },
    create: { userId, workspaceId, entityType, entityId, visitedAt: new Date() },
    update: { visitedAt: new Date() }
  })

  // Keep only the 20 most recent entries per user per workspace
  const oldest = await db.userSearchHistory.findMany({
    where: { userId, workspaceId },
    orderBy: { visitedAt: 'desc' },
    skip: 20,
    select: { id: true }
  })
  if (oldest.length > 0) {
    await db.userSearchHistory.deleteMany({
      where: { id: { in: oldest.map(r => r.id) } }
    })
  }
}
```

Add a unique index to `UserSearchHistory` for the upsert to work:

```prisma
model UserSearchHistory {
  // ...
  @@unique([userId, workspaceId, entityType, entityId])
  @@index([userId, workspaceId, visitedAt])  // for ORDER BY visitedAt DESC
}
```

### Filter-to-Prisma Query Builder

`GET /api/lists/:listId/tasks` accepts filter params and must translate them into a Prisma `where` clause. Build it incrementally:

```typescript
// src/server/task-filters.ts

interface FilterParams {
  status?: string[]       // status IDs
  priority?: string[]     // 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'NONE'
  assignee?: string[]     // user IDs; 'unassigned' is a special sentinel
  due?: string            // 'overdue' | 'today' | 'this_week' | 'this_month' | 'no_due_date'
  dueDateFrom?: string    // ISO date string (custom range)
  dueDateTo?: string
  tags?: string[]         // tag IDs
  createdBy?: string[]
  createdFrom?: string
  createdTo?: string
  sort?: string
  dir?: 'asc' | 'desc'
}

export function buildTaskWhere(listId: string, params: FilterParams) {
  const where: Prisma.TaskWhereInput = {
    listId,
    isArchived: false,
    parentTaskId: null,
  }

  if (params.status?.length) {
    where.statusId = { in: params.status }
  }

  if (params.priority?.length) {
    where.priority = { in: params.priority as Priority[] }
  }

  if (params.assignee?.length) {
    const hasUnassigned = params.assignee.includes('unassigned')
    const userIds = params.assignee.filter(a => a !== 'unassigned')

    if (hasUnassigned && userIds.length > 0) {
      where.OR = [
        { assignees: { none: {} } },
        { assignees: { some: { userId: { in: userIds } } } }
      ]
    } else if (hasUnassigned) {
      where.assignees = { none: {} }
    } else {
      where.assignees = { some: { userId: { in: userIds } } }
    }
  }

  if (params.due) {
    const now = new Date()
    switch (params.due) {
      case 'overdue':
        where.dueDateEnd = { lt: now }
        where.status = { type: { not: 'CLOSED' } }
        break
      case 'today':
        where.dueDateEnd = { gte: startOfDay(now), lte: endOfDay(now) }
        break
      case 'this_week':
        where.dueDateEnd = { gte: startOfWeek(now), lte: endOfWeek(now) }
        break
      case 'this_month':
        where.dueDateEnd = { gte: startOfMonth(now), lte: endOfMonth(now) }
        break
      case 'no_due_date':
        where.dueDateEnd = null
        break
    }
  }

  if (params.dueDateFrom || params.dueDateTo) {
    where.dueDateEnd = {
      ...(params.dueDateFrom ? { gte: new Date(params.dueDateFrom) } : {}),
      ...(params.dueDateTo   ? { lte: new Date(params.dueDateTo)   } : {}),
    }
  }

  if (params.tags?.length) {
    where.tags = { some: { tagId: { in: params.tags } } }
  }

  if (params.createdBy?.length) {
    where.createdBy = { in: params.createdBy }
  }

  if (params.createdFrom || params.createdTo) {
    where.createdAt = {
      ...(params.createdFrom ? { gte: new Date(params.createdFrom) } : {}),
      ...(params.createdTo   ? { lte: new Date(params.createdTo)   } : {}),
    }
  }

  return where
}

export function buildTaskOrderBy(sort?: string, dir: 'asc' | 'desc' = 'asc') {
  const d = dir
  switch (sort) {
    case 'due_date':    return { dueDateEnd: d }
    case 'priority':    return { priority: d }
    case 'assignee':    return { assignees: { _count: d } }
    case 'created_at':  return { createdAt: d }
    case 'updated_at':  return { updatedAt: d }
    default:            return { orderIndex: 'asc' as const }  // manual sort
  }
}
```

### Saved Filter Limit -- Server-Side Check

The 10-per-user-per-List limit must be enforced server-side (not just frontend):

```typescript
// POST /api/lists/:listId/saved-filters handler

const count = await db.savedFilter.count({ where: { userId, listId } })
if (count >= 10) {
  return NextResponse.json(
    { error: 'Saved filter limit reached (10 per list). Delete one to save a new filter.' },
    { status: 422 }
  )
}
```

### Debounce -- Client Hook

```typescript
// src/hooks/use-debounced-search.ts

export function useDebouncedSearch(delay = 300) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    if (query.length < 2) { setDebouncedQuery(''); return }
    const timer = setTimeout(() => setDebouncedQuery(query), delay)
    return () => clearTimeout(timer)
  }, [query, delay])

  return { query, setQuery, debouncedQuery }
}
```

Use `debouncedQuery` as the SWR key -- SWR will re-fetch only when it changes:

```typescript
const { data } = useSWR(
  debouncedQuery ? `/api/workspaces/${workspaceId}/search?q=${debouncedQuery}` : null
)
```

### Folder Mapping

```
src/
  server/
    search.ts              <- globalSearch, recordSearchVisit
    task-filters.ts        <- buildTaskWhere, buildTaskOrderBy
  hooks/
    use-debounced-search.ts
  app/api/
    workspaces/[workspaceId]/
      search/route.ts      <- GET (?q=)
      search/recent/route.ts <- GET
    lists/[listId]/
      tasks/route.ts       <- GET (uses buildTaskWhere + buildTaskOrderBy)
      saved-filters/route.ts <- GET, POST
    saved-filters/[id]/route.ts <- PATCH (rename), DELETE
    me/
      tasks/route.ts       <- GET (My Tasks with filters)
```

---

## Out of Scope (MVP)

- Search inside task descriptions (title-only in MVP; post-MVP will add description search with a "Search in descriptions" toggle — requires a generated `tsvector` column on the Task table)
- Full-text search inside file attachments (e.g. searching inside a PDF)
- Search inside comment bodies
- Shared/team-level saved filters (visible to all members of a Space)
- Advanced search operators (e.g. `assignee:jane due:this-week status:review`)
- Search across multiple workspaces simultaneously
- Boolean filter logic customization (switching AND/OR between filter groups)
