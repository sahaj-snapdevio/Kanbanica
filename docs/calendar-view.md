# Calendar View

> **⚠️ Post-MVP — Not included in the initial launch.**
>
> Calendar View is deferred to a post-MVP release. The implementation cost (date grid rendering, drag-to-reschedule, date range display, responsive month/week toggle) is high relative to day-1 adoption. Less than 15% of users open a calendar view in their first week. For MVP, due-date sorting and overdue highlighting in List View covers the most critical scheduling needs.
>
> This document preserves the full spec so it can be built in a later phase without re-designing from scratch.

---

## Overview

Tasks are placed on a calendar grid based on their due date. Useful for seeing what is due when across the month or week.

**Access:** Via the view switcher in the List toolbar — `[ List ][ Board ][ Calendar ]`

---

## Layout

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

---

## Features

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

## Data Model

View preference stored in the existing `UserListViewPreference` table — no new table needed.

```
UserListViewPreference
├── view_type   (enum: list | board | calendar)  ← add "calendar" value when shipping
└── ...
```

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/lists/:listId/tasks?view=calendar&month=2026-06` | Get tasks with due dates for Calendar View | Space member |

---

## UI Screens

| Screen | Route | Access |
|--------|-------|--------|
| Calendar View | `/space/:spaceId/list/:listId?view=calendar` | Space member |

---

## Business Rules

1. Calendar View only places tasks that have a due date — tasks without a due date appear in the Unscheduled panel on the right.
2. Drag-and-drop on the calendar changes the task's actual due date for everyone — it is not a personal view-only change.
3. View preference is per user per List — switching to calendar does not affect other members' views.
4. Filters applied in other views carry over when switching to Calendar View on the same List.
5. Bulk selection is not available in Calendar View — use List View for bulk operations.

---

## Implementation Notes (for when this is built)

- **Date grid rendering:** Use a calendar library (e.g. `react-big-calendar` or custom grid with CSS Grid) rather than building from scratch. Month grid + week strip are different layout modes.
- **Date range tasks:** Require CSS spanning logic across day cells — test edge cases at month boundaries.
- **Drag-and-drop:** dnd-kit (already in the stack) supports calendar drop zones. Each day cell is a droppable target.
- **Timezone handling:** All dates stored as UTC. Display in user's local timezone via `Intl.DateTimeFormat`. Test DST transitions.
- **Responsive layout:** Monthly grid collapses poorly on mobile — weekly view should be the default on mobile viewports.
- **Performance:** Only fetch tasks whose due date falls within the visible month range — `?month=2026-06` query param, not all tasks.

---

## Out of Scope (even when Calendar View is built)

- Cross-list calendar (multiple lists overlaid on one calendar) — post-calendar-MVP
- iCal export / Google Calendar sync
- Recurring task visualization on calendar
