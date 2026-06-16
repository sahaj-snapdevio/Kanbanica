# Calendar View

## Goal

Provide a date-grid visualization of tasks within a List, allowing users to see task due dates spatially and drag tasks to reschedule them.

**This feature is post-MVP and must not be implemented in Phases 0-18.**

---

## Existing Scope (Post-MVP Only)

This entire document is a planning artifact for a future phase. Calendar View will be introduced after the core task management system (Phases 1-18) is stable and adopted.

**DO NOT build any part of this feature until the Development Plan explicitly lists it in a numbered phase.**

---

## User Flow

1. User opens a List -> clicks "Calendar" in the view switcher (alongside List/Board)
2. Calendar renders in monthly view by default; weekly toggle available
3. Each task with a `dueDateEnd` appears as a chip on its due date
4. Tasks without a due date appear in an "Unscheduled" sidebar on the right
5. User drags a task chip to a new date -> `dueDateEnd` is updated via `PATCH /api/tasks/:id`
6. User drags a task from the Unscheduled sidebar to the grid -> sets `dueDateEnd`
7. Clicking a task chip opens the Task detail panel (same as List/Board view)
8. Calendar respects all existing task filters (assignee, priority, status)

---

## Technical Design

### SSR Safety (Critical)

dnd-kit accesses the browser's `window` object on import and will crash Next.js App Router's server-side render. The entire Calendar component and all dnd-kit imports MUST use dynamic import:

```typescript
// src/app/(app)/[workspaceId]/[spaceId]/list/[listId]/calendar/page.tsx
import dynamic from 'next/dynamic'

const CalendarView = dynamic(
  () => import('@/components/calendar/calendar-view'),
  { ssr: false }
)
```

This same pattern is required for Board View. Both views must never be imported directly in a server component.

### Date Handling

- All dates stored in UTC (Drizzle `timestamp({ withTimezone: true })` -> PostgreSQL `TIMESTAMP WITH TIME ZONE`)
- Calendar grid renders in the user's local timezone using `Intl.DateTimeFormat`
- Use `date-fns` for grid generation (month/week date arithmetic)
- Drag-to-reschedule sends the target date in ISO format; client must convert local date -> UTC before sending
- Never store timezone in the task -- always UTC, always convert on display

### Timezone Edge Cases

- A task due "June 10" for a user in UTC-5 is stored as `2026-06-10T05:00:00Z`
- On render, convert stored UTC back to local date for grid placement
- If the user changes their system timezone, task dates shift visually (expected behavior)

### Library Choice

- Build a lightweight custom grid with `date-fns` -- avoid `react-big-calendar` for monthly/weekly-only views (carries significant bundle weight)
- Use dnd-kit (`@dnd-kit/core`, `@dnd-kit/sortable`) for drag-and-drop

---

## Folder Mapping

```
src/
  app/(app)/[workspaceId]/[spaceId]/list/[listId]/
    calendar/
      page.tsx                 <- dynamic import wrapper only (ssr: false)
  components/
    calendar/
      calendar-view.tsx        <- main component (loaded client-side only)
      calendar-grid.tsx        <- month/week grid
      calendar-task-chip.tsx   <- task pill on date cell
      unscheduled-sidebar.tsx
      use-calendar-dnd.ts      <- dnd-kit drag logic
```

---

## API

No new API endpoints. Calendar View reuses existing task endpoints:

- `GET /api/lists/:id/tasks` -- with `view=calendar` query param to include tasks without `dueDateEnd` in unscheduled list
- `PATCH /api/tasks/:id` -- to update `dueDateEnd` on drag

---

## Database

No new tables. Calendar View reads and writes `Task.dueDateEnd` (and optionally `Task.dueDateStart` for date-range tasks).

`UserListViewPreference.view` will include `calendar` as a valid value when this feature is built. Until then the column only accepts `list` and `board`.

---

## Events

No new activity log events. Dragging to reschedule triggers the existing `task.due_date_changed` event in `ActivityLog`.

---

## Background Jobs

None.

---

## Dependencies

- `Task.dueDateEnd` (nullable) -- already in schema
- `UserListViewPreference` table -- must be implemented first (Phase 12)
- dnd-kit (`@dnd-kit/core`, `@dnd-kit/sortable`) -- add to `package.json` when this phase begins
- `date-fns` -- already in `package.json`

---

## Edge Cases

| Scenario | Handling |
|----------|---------|
| Task with `dueDateStart` and `dueDateEnd` on different days | Render as multi-day span chip across cells |
| Task with only `dueDateStart` | Show on start date; no end indicator |
| Task with no due date at all | Place in unscheduled sidebar |
| Month with 5+ weeks | Grid must accommodate 6-row months |
| Dragging to past date | Allow -- no validation on date direction |
| 100+ tasks on one date | Show first 3 chips + overflow count; click overflow to expand |

---

## Acceptance Criteria

*(Preliminary -- to be finalised when the phase is scheduled.)*

- [ ] Calendar renders all tasks with `dueDateEnd` on the correct date cell
- [ ] Dragging a task chip to a new cell updates `dueDateEnd` with optimistic update
- [ ] Dragging from unscheduled sidebar sets `dueDateEnd`
- [ ] Calendar respects active list filters
- [ ] Weekly/monthly toggle persists to `UserListViewPreference`
- [ ] No SSR crash from dnd-kit (all calendar components wrapped in `dynamic({ ssr: false })`)

---

## Implementation Notes

- Do not begin until `UserListViewPreference` is in the schema and Board View is working
- The `dynamic({ ssr: false })` wrapper is non-negotiable; add a code comment to prevent future removal
- When building, add `calendar` to the `UserListViewPreference.view` enum at the same time as the component
