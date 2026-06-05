# Empty States & Onboarding Checklist

## Overview

Every screen a user can land on with no data must show a clear, helpful empty state — not a blank page. Empty states serve two purposes: explain what belongs here, and tell the user exactly what to do next.

**Design principles:**
- One illustration or icon (simple, not distracting)
- One headline — what this area is for
- One line of supporting text — why it's empty or what the user gains by filling it
- One primary CTA button — the single next action
- Optional secondary link — a less-commitment alternative (e.g. "Learn more")

Empty states are **not** error states. They are welcoming, not alarming.

---

## 1. Post-Onboarding Getting Started Checklist

When a brand-new user completes onboarding (Workspace created → Space created → lands in their first List), they see a **Getting Started checklist** panel pinned inside the empty List view.

This is the most important empty state in the product — it directly combats first-session churn.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  👋 Welcome to Teamority, [First Name]!                  │
│                                                          │
│  Here's how to get started:                              │
│                                                          │
│  ✅  Create your workspace           (done)              │
│  ✅  Create your first Space         (done)              │
│  ◻   Create your first task          [Create task →]     │
│  ◻   Invite a teammate               [Invite →]          │
│  ◻   Set a due date on a task        [Learn how →]       │
│  ◻   Try the Board view              [Switch view →]     │
│                                                          │
│  Progress: ▓▓░░░░░░  2 of 6 complete                    │
│                                                          │
│                              [Dismiss checklist]         │
└──────────────────────────────────────────────────────────┘
```

### Checklist items

| Step | Completion trigger | CTA |
|------|--------------------|-----|
| Create your workspace | Auto-completed — already done | — |
| Create your first Space | Auto-completed — already done | — |
| Create your first task | User creates any task in any List | Opens quick-create inline |
| Invite a teammate | User sends at least one workspace invite | Opens invite modal |
| Set a due date on a task | User sets a due date on any task | Links to Help article |
| Try the Board view | User switches to Board view on any List | Switches view directly |

### Behavior

- Checklist is shown **pinned above the task list** inside the first List, only for the workspace creator
- Each item auto-checks as the user completes it — no manual ticking
- Progress bar fills as items are completed
- Once all 6 items are done: checklist collapses with a congratulations message: `"You're all set! 🎉 You've covered the basics."` then fades out after 3 seconds
- `[Dismiss checklist]` link hides it permanently (stored in `UserOnboardingProgress.dismissed_at`)
- Checklist is only shown to the user who created the workspace — teammates who join later do not see it
- Checklist persists across sessions until dismissed or completed

### Data model addition

```
UserOnboardingProgress
├── id                   (uuid, primary key)
├── user_id              (foreign key → User)
├── workspace_id         (foreign key → Workspace)
├── step_workspace       (boolean, default: true — auto-complete)
├── step_space           (boolean, default: true — auto-complete)
├── step_first_task      (boolean, default: false)
├── step_invite          (boolean, default: false)
├── step_due_date        (boolean, default: false)
├── step_board_view      (boolean, default: false)
├── dismissed_at         (timestamp, nullable)
└── created_at           (timestamp)
```

---

## 2. Empty List (no tasks)

When a List has no tasks (freshly created, or all tasks have been deleted/moved).

### For the workspace creator (first List)

The Getting Started checklist (above) is shown instead of a plain empty state — it is more actionable.

### For all other empty Lists

```
┌────────────────────────────────────┐
│                                    │
│         📋                         │
│                                    │
│    This list has no tasks yet      │
│    Add your first task to          │
│    start tracking work             │
│                                    │
│      [ + Add your first task ]     │
│                                    │
└────────────────────────────────────┘
```

| Element | Content |
|---------|---------|
| Icon | Clipboard / checklist illustration |
| Headline | `"This list has no tasks yet"` |
| Subtext | `"Add your first task to start tracking work"` |
| Primary CTA | `"+ Add your first task"` — activates inline quick-create |

---

## 3. Empty Board View (no tasks in sprint / no tasks at all)

**Case A — List has tasks but none match current filters:**

```
│         🔍                         │
│   No tasks match your filters      │
│   Try adjusting or clearing        │
│   the active filters               │
│                                    │
│      [ Clear filters ]             │
```

**Case B — List has no tasks at all:**

```
│         📋                         │
│   No tasks in this board yet       │
│   Tasks you add will appear here   │
│   as cards in their status column  │
│                                    │
│      [ + Add a task ]              │
```

**Case C — Sprint is active but no tasks have been added to it:**

```
│         🏃                         │
│   No tasks in this sprint yet      │
│   Add tasks from the backlog to    │
│   define your sprint scope         │
│                                    │
│      [ Add tasks from backlog ]    │
```

---

## 4. Empty Calendar View (no tasks with due dates)

```
│         📅                         │
│   No tasks scheduled this month    │
│   Tasks with a due date will       │
│   appear on the calendar           │
│                                    │
│      [ + Add a task with due date ]│
│      [ See unscheduled tasks →  ]  │
```

The Unscheduled sidebar is still shown on the right even when the calendar grid is empty — it may contain tasks without due dates.

---

## 5. Empty Backlog (no tasks outside a sprint)

Shown in the Sprint panel when all List tasks are assigned to sprints.

```
│         ✅                         │
│   Backlog is empty                 │
│   All tasks are in a sprint,       │
│   or there are no tasks yet        │
│                                    │
│      [ + Create a task ]           │
```

---

## 6. Empty Sprint Panel (no sprints created yet)

Shown in the Sprint panel when no sprints have been created for this List.

```
│         🏁                         │
│   No sprints yet                   │
│   Sprints let you time-box work    │
│   into focused iterations          │
│                                    │
│      [ Create your first sprint ]  │
│      [ Learn about sprints →    ]  │
```

- CTA opens the Create Sprint modal directly
- Secondary link goes to the Help Center article on Sprints

---

## 7. My Tasks — No Assigned Tasks

Shown when the logged-in user has no tasks assigned to them across the workspace.

```
│         👤                         │
│   You have no tasks yet            │
│   Tasks assigned to you across     │
│   all Spaces will appear here      │
│                                    │
│      [ Browse your Lists →     ]   │
```

- CTA links to the last viewed List (or the workspace root if none)
- No "create task" CTA here — My Tasks is a read view, not where tasks are created

---

## 8. Empty Space (no Lists)

When a Space is created but has no Lists inside it (edge case — normally a default List is auto-created, but the user may have deleted it).

```
│         📁                         │
│   This Space has no Lists yet      │
│   Lists are where tasks live —     │
│   create one to get started        │
│                                    │
│      [ + Create a List ]           │
```

---

## 9. Empty Folder (no Lists)

When a Folder has been created but no Lists have been added to it.

```
│         📂                         │
│   This folder is empty             │
│   Add a List to start organizing   │
│   tasks inside this folder         │
│                                    │
│      [ + Add a List ]              │
```

---

## 10. Notifications — No Notifications

When the user's notification inbox is empty.

```
│         🔔                         │
│   You're all caught up!            │
│   Notifications from task updates, │
│   mentions, and comments           │
│   will appear here                 │
│                                    │
```

No CTA needed — this is a positive state. Headline should feel like a success, not a problem.

---

## 11. Search — No Results

When global search (Ctrl+K) returns no matches for the query.

```
│         🔍                         │
│   No results for "[query]"         │
│   Try a different keyword,         │
│   or search by task ID e.g. #42    │
│                                    │
│   Recent searches:                 │
│   › Design login screen            │
│   › Sprint 3                       │
```

- Shows recent search history below (last 5 searches)
- No CTA — search result page, not a creation surface

---

## 12. Activity Log — No Activity on a New Task

When a task was just created and has no activity yet beyond the creation event.

```
│   Task created by [You]  just now  │
│                                    │
│   Activity will appear here as     │
│   changes are made to this task    │
```

Minimal — the creation event itself satisfies "not blank". No CTA needed.

---

## 13. Comments — No Comments Yet

When a task has no comments.

```
│         💬                         │
│   No comments yet                  │
│   Be the first to leave a comment  │
│   Use @ to mention a teammate      │
│                                    │
│   [ Write a comment... ]  ← opens  │
│                               the  │
│                             editor │
```

- The comment composer is always visible below this — so the empty state blends into the composer naturally

---

## 14. Support Tickets — No Tickets

When the user has no support tickets submitted.

```
│         🎫                         │
│   No support tickets yet           │
│   Having an issue or a question?   │
│   We're here to help               │
│                                    │
│      [ Open a support ticket ]     │
│      [ Browse Help Center →    ]   │
```

---

## 15. Feature Requests — No Requests (filtered view)

When the user filters the Feature Requests board and nothing matches.

```
│         💡                         │
│   No feature requests found        │
│   for this filter                  │
│                                    │
│      [ Clear filters ]             │
│      [ Submit a new request ]      │
```

---

## 16. Workspace Members — Only the Owner

When a workspace has only one member (the creator). Shown in `Settings → Members`.

```
│   Just you here so far             │
│   Invite your teammates to         │
│   collaborate in Teamority         │
│                                    │
│      [ + Invite teammates ]        │
│      [ Copy invite link ]          │
```

- Two CTAs: email invite (primary) and copy link (secondary, lower commitment)

---

## Implementation Notes

### What NOT to do

- **No blank white space** — every empty area must have at least a headline
- **No generic "Nothing here" messages** — always explain what belongs here
- **No multiple CTAs competing** — one primary action per empty state
- **Do not show empty state while loading** — show a skeleton loader first, then the empty state only after the request confirms zero results

### Skeleton loaders vs empty states

| State | Show |
|-------|------|
| Data is loading | Skeleton loader (grey placeholder rows/cards) |
| Request completed, zero results | Empty state with message + CTA |
| Request failed | Error state with retry button (separate from empty state) |

### Permissions affect CTAs

If the logged-in user does not have permission to create (e.g. View-only member on a Space):
- Do not show "Create" CTAs in empty states
- Show only the explanation headline + subtext
- Example: View-only user seeing an empty List sees `"This list has no tasks yet"` with no create button

---

## Business Rules

1. Empty states are shown only after the data request completes with zero results — never while loading.
2. Skeleton loaders are shown during every data fetch — empty states replace the skeleton on completion.
3. The Getting Started checklist is shown only to the workspace creator in their first List — not to teammates who join later.
4. Getting Started checklist progress is tracked in `UserOnboardingProgress` — server-side, persists across devices.
5. Dismissing the checklist sets `dismissed_at` and hides it permanently for that user in that workspace.
6. CTAs in empty states respect the user's permission level — View-only users do not see "Create" buttons.
7. Filter-induced empty states always show a `[Clear filters]` CTA in addition to (or instead of) a create CTA.
8. The comment composer is always rendered below the comments empty state — the two elements together form the full empty comment section.

---

## Out of Scope (MVP)

- Interactive product tour / tooltips overlay (post-MVP)
- Video walkthrough embedded in onboarding (post-MVP)
- Customisable empty state illustrations per team
- "Import from ClickUp / Asana" CTA in empty states (post-MVP — once import feature exists)
