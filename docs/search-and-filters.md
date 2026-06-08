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

## Out of Scope (MVP)

- Search inside task descriptions (title-only in MVP; post-MVP will add description search with a "Search in descriptions" toggle — requires a generated `tsvector` column on the Task table)
- Full-text search inside file attachments (e.g. searching inside a PDF)
- Search inside comment bodies
- Shared/team-level saved filters (visible to all members of a Space)
- Advanced search operators (e.g. `assignee:jane due:this-week status:review`)
- Search across multiple workspaces simultaneously
- Boolean filter logic customization (switching AND/OR between filter groups)
