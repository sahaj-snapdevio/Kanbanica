# UI Redesign Guide

## Purpose

This document drives the visual upgrade of Kanbanica from a generic AI-generated look to a polished, modern product UI. It supersedes `design-system.md` where they conflict — treat this file as the active implementation reference.

**Inspiration bar:** Linear (density + motion), ClickUp (color use), Vercel Dashboard (typography + depth), Raycast (sidebar personality).

---

## What's Wrong With the Current UI

These are the specific patterns to eliminate:

| Problem | Symptom |
|---------|---------|
| Flat white everywhere | Every surface is `bg-white` — no depth, no visual layers |
| Default shadcn components | Buttons, inputs, and cards look identical to a freshly installed shadcn project |
| Weak sidebar | Plain `bg-gray-50` sidebar with no visual weight or hierarchy |
| No motion | Elements pop in abruptly — no transitions, no enter/exit animation |
| Poor typography | System font with no character, uniform weight across all text |
| Status pills feel generic | Colored text on white background — no punch |
| Cards have no depth | Board cards feel like `<div>` with a border |
| No dark mode | The app only works in light mode |
| Passive empty states | Bland gray text with no illustration or personality |
| Hover states are invisible | Hard to tell what's interactive |

---

## New Design Direction

**Aesthetic:** Clean, dense, dark-mode-first. Surfaces have depth through layering, not heavy shadows. Color is used intentionally — never decoratively.

**Key principles:**
1. **Surfaces have layers** — sidebar sits above content which sits above page background. Each layer has a distinct background.
2. **Dark mode is first-class** — not an afterthought. Implement both modes from the start.
3. **Typography does the heavy lifting** — Inter font, tight tracking, meaningful weight contrast.
4. **Motion is subtle and purposeful** — transitions only where they aid spatial understanding.
5. **Color is earned** — only status, priority, and project colors use hue. Everything else is neutral.
6. **Density is default** — this is a productivity tool, not a marketing site.

---

## Design Tokens (Replace `design-system.md` Tokens)

### Typography

Replace system font with **Inter** (Google Fonts or self-hosted via `next/font`).

```css
/* app/layout.tsx */
import { Inter } from 'next/font/google'
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
```

```css
/* globals.css */
body {
  font-family: var(--font-inter), -apple-system, sans-serif;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";  /* Inter optical tweaks */
  -webkit-font-smoothing: antialiased;
}
```

| Scale | Class | Size | Weight | Line Height | Usage |
|-------|-------|------|--------|-------------|-------|
| Display | `text-xl font-semibold tracking-tight` | 20px | 600 | 1.3 | Page titles |
| Heading | `text-sm font-semibold` | 14px | 600 | 1.4 | Section headings |
| Body | `text-sm font-normal` | 14px | 400 | 1.5 | Default everywhere |
| Small | `text-xs font-normal` | 12px | 400 | 1.4 | Metadata, timestamps |
| Label | `text-xs font-medium tracking-wide uppercase` | 12px | 500 | 1 | Section group labels |
| Mono | `font-mono text-xs` | 12px | 400 | 1.5 | Task IDs, code |

### Color Tokens — Light + Dark

Define all tokens in `globals.css`. Tailwind `dark:` variants switch via `class="dark"` on `<html>`.

```css
:root {
  /* Backgrounds — 3-layer surface system */
  --bg-app:       #F4F5F7;   /* outermost page bg */
  --bg-surface:   #FFFFFF;   /* cards, panels, content areas */
  --bg-elevated:  #FFFFFF;   /* modals, dropdowns, popovers */
  --bg-sidebar:   #1A1D23;   /* sidebar — always dark */
  --bg-sidebar-item-hover: rgba(255,255,255,0.06);
  --bg-sidebar-item-active: rgba(255,255,255,0.10);

  /* Borders */
  --border:       #E4E7EC;
  --border-strong:#C8CDD8;

  /* Text */
  --text-primary:   #0F1117;
  --text-secondary: #5E6573;
  --text-muted:     #9AA0AD;
  --text-inverse:   #FFFFFF;
  --text-sidebar:   #C9CDD6;
  --text-sidebar-active: #FFFFFF;

  /* Brand */
  --brand:         #5B6BF8;
  --brand-hover:   #4554E8;
  --brand-muted:   #EEF0FE;

  /* Semantic */
  --success:       #16A34A;
  --success-muted: #DCFCE7;
  --warning:       #D97706;
  --warning-muted: #FEF3C7;
  --danger:        #DC2626;
  --danger-muted:  #FEE2E2;
  --info:          #2563EB;
  --info-muted:    #DBEAFE;
}

.dark {
  --bg-app:       #0D0F12;
  --bg-surface:   #161A20;
  --bg-elevated:  #1E2229;
  --bg-sidebar:   #0D0F12;
  --bg-sidebar-item-hover: rgba(255,255,255,0.05);
  --bg-sidebar-item-active: rgba(255,255,255,0.09);

  --border:       #272B33;
  --border-strong:#363C47;

  --text-primary:   #F0F2F5;
  --text-secondary: #8B919E;
  --text-muted:     #545B68;
  --text-sidebar:   #8B919E;
  --text-sidebar-active: #F0F2F5;

  --brand:         #6475FA;
  --brand-hover:   #7585FB;
  --brand-muted:   #1E2140;

  --success-muted: #14532D;
  --warning-muted: #451A03;
  --danger-muted:  #450A0A;
  --info-muted:    #1E3A5F;
}
```

Map these into `tailwind.config.ts`:

```ts
theme: {
  extend: {
    colors: {
      app: 'var(--bg-app)',
      surface: 'var(--bg-surface)',
      elevated: 'var(--bg-elevated)',
      border: 'var(--border)',
      'border-strong': 'var(--border-strong)',
    }
  }
}
```

### Shadows

Remove heavy shadows. Use layered border + subtle elevation only.

```css
--shadow-sm:  0 1px 2px 0 rgba(0,0,0,0.05);
--shadow-md:  0 2px 8px 0 rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04);
--shadow-lg:  0 8px 24px 0 rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06);
--shadow-xl:  0 20px 40px 0 rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.08);
```

In dark mode, shadows are less visible — compensate with stronger border:
```css
.dark {
  --shadow-md:  0 2px 8px 0 rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04);
  --shadow-lg:  0 8px 24px 0 rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
}
```

---

## Motion System

All transitions use a consistent easing curve. Never use CSS `transition: all`.

```css
/* globals.css */
:root {
  --ease-default: cubic-bezier(0.16, 1, 0.3, 1);  /* snappy spring */
  --ease-out:     cubic-bezier(0.0, 0, 0.2, 1);
  --duration-fast:   120ms;
  --duration-normal: 200ms;
  --duration-slow:   300ms;
}
```

| Use case | Duration | Easing |
|----------|----------|--------|
| Button hover/active | 80ms | ease-out |
| Sidebar collapse/expand | 220ms | ease-default |
| Modal enter | 180ms | ease-default |
| Modal exit | 120ms | ease-out |
| Dropdown/popover open | 140ms | ease-default |
| Toast enter | 300ms | ease-default |
| Skeleton pulse | 1.5s | ease-in-out (loop) |

**Framer Motion** is preferred for enter/exit animations on modals, sidebars, and sliding panels. For simple hover/focus states, Tailwind `transition-*` utilities are fine.

```bash
npm install framer-motion
```

---

## Component-by-Component Changes

### Sidebar

The sidebar is always dark (`--bg-sidebar: #1A1D23`), regardless of light/dark mode. This creates a permanent visual separation between navigation and content.

```
┌─────────────────────────────────────────────────┐
│ [Logo]  Kanbanica          [Workspace selector ▾]│  ← workspace header row
├─────────────────────────────────────────────────┤
│  ◎  My Tasks                                     │  ← nav item
│  🔔  Inbox                                       │
│  📌  Pinned          (count badge if > 0)        │
├─────────────────────────────────────────────────┤
│  PROJECTS                                 [+]    │  ← section label + add button
│  ● Backend API                            ▾      │  ← project row (expanded)
│     ≡  List                                      │    ← list child
│     ⚡ Sprint 1  (active badge)                   │    ← sprint child
│  ● Mobile App                             ▶      │  ← project row (collapsed)
├─────────────────────────────────────────────────┤
│  [Avatar]  Devang Patel                          │  ← user row at bottom
└─────────────────────────────────────────────────┘
```

**Sidebar item styles:**
```tsx
// Normal
className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] text-[var(--text-sidebar)]
           hover:bg-[var(--bg-sidebar-item-hover)] hover:text-[var(--text-sidebar-active)]
           transition-colors duration-100 cursor-pointer select-none"

// Active
className="... bg-[var(--bg-sidebar-item-active)] text-[var(--text-sidebar-active)] font-medium"
```

**Section labels:**
```tsx
className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-widest uppercase text-[var(--text-muted)]"
```

**Project row with color dot:**
```tsx
<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
<span className="flex-1 truncate">{project.name}</span>
<ChevronRight className="w-3.5 h-3.5 opacity-50 transition-transform duration-150 group-data-[open=true]:rotate-90" />
```

**Sprint active badge (inside sidebar):**
```tsx
<span className="ml-auto px-1.5 py-0.5 text-[10px] font-medium rounded-full
                 bg-emerald-500/15 text-emerald-500">
  Active
</span>
```

**Sidebar collapse:** Animate width with Framer Motion `animate={{ width: collapsed ? 56 : 240 }}`. Do not use CSS `transition-all` on width — it causes layout thrash.

---

### Top Bar (per-view header)

Replace a plain `<h1>` with a structured header row:

```
┌─────────────────────────────────────────────────────────────────────┐
│  [≡ List icon]  Backend API  /  Sprint 1          [Filter] [Sort] […]│
└─────────────────────────────────────────────────────────────────────┘
```

- Height: `h-12` (48px)
- Border bottom: `border-b border-[var(--border)]`
- Background: `bg-[var(--bg-surface)]`
- Breadcrumb: `text-[var(--text-secondary)] text-sm` with `/` dividers, last item `text-[var(--text-primary)] font-medium`
- Right side: icon-only toolbar buttons (Filter, Sort, Group, View toggle) — `w-7 h-7` ghost buttons with tooltips

---

### Buttons

Upgrade all button variants. Remove the default shadcn ring focus style — replace with a cleaner outline.

```tsx
// Primary
"bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white
 h-8 px-3.5 text-sm font-medium rounded-md
 transition-colors duration-100
 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"

// Secondary (outline)
"border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]
 hover:bg-[var(--bg-app)] hover:border-[var(--border-strong)]
 h-8 px-3.5 text-sm font-medium rounded-md transition-colors duration-100"

// Ghost
"text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-app)]
 h-7 px-2 text-sm rounded-md transition-colors duration-100"

// Danger
"bg-[var(--danger)] hover:bg-red-700 text-white
 h-8 px-3.5 text-sm font-medium rounded-md transition-colors duration-100"
```

Height standard: `h-8` (32px) everywhere except auth pages which use `h-10`.

---

### Inputs & Form Fields

```tsx
// Base input
"h-8 px-3 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)]
 border border-[var(--border)] rounded-md
 placeholder:text-[var(--text-muted)]
 focus:outline-none focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]
 transition-colors duration-100"
```

Labels: `text-xs font-medium text-[var(--text-secondary)] mb-1.5` — always above the input, never placeholder-only.

---

### Task Row (List View)

The task row is the most-seen element. It needs to feel premium and interactive.

```
┌───────────────────────────────────────────────────────────────────────┐
│ ○  [●Todo]  Fix auth token expiry bug      @John  Jun 15  ⚡ Medium   │  ← normal row
├───────────────────────────────────────────────────────────────────────┤
│ ○  [●In Progress]  API rate limiting       @Sarah  Today   🔴 Urgent  │  ← hovered (bg tint)
└───────────────────────────────────────────────────────────────────────┘
```

**Row anatomy:**
- Height: `h-9` (36px), `h-8` in compact mode
- Left: checkbox (shows on hover only) → status dot → task title
- Right: assignee avatar → due date → priority badge
- Hover: `bg-[var(--bg-app)]` background tint + reveal action icons (pin, more)
- Border: only `border-b border-[var(--border)]` — no left/right borders
- Active (selected): left accent bar `border-l-2 border-[var(--brand)] bg-[var(--brand-muted)]`

**Status pill on task row** — small, inline:
```tsx
<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{ backgroundColor: `${status.color}1A`, color: status.color }}>
  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
  {status.name}
</span>
```

**Priority badge:**
```tsx
// Urgent — the only priority with strong visual weight
<span className="text-[11px] font-medium text-red-500 bg-red-50 dark:bg-red-500/10
                 px-1.5 py-0.5 rounded">
  Urgent
</span>
// Others use icon only (colored icon, no bg pill) to reduce visual noise
```

---

### Task Card (Board View)

```
┌─────────────────────────────────┐
│  🔴 [Urgent]                     │  ← priority badge (only if not None)
│                                  │
│  Fix auth token expiry bug       │  ← title, text-sm font-medium
│                                  │
│  [●In Progress]    📎2   Jun 15  │  ← status + metadata row
│                    [JD]          │  ← assignee avatar
└─────────────────────────────────┘
```

```tsx
"bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-3
 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-sm)]
 transition-all duration-100 cursor-pointer
 group"
```

Cards should have `rounded-lg` (8px), not `rounded-md` — it looks less generic.

---

### Modals & Dialogs

Use Framer Motion for enter/exit:

```tsx
// Dialog overlay
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.15 }}
  className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
/>

// Dialog panel
<motion.div
  initial={{ opacity: 0, scale: 0.96, y: 8 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.96, y: 8 }}
  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
  className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl shadow-[var(--shadow-lg)]
             max-w-md w-full p-6"
/>
```

**Dialog header pattern:**
```tsx
<div className="flex items-start justify-between mb-5">
  <div>
    <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Create Sprint</h2>
    <p className="text-sm text-[var(--text-secondary)] mt-0.5">Set up a new iteration for Backend API</p>
  </div>
  <button className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
    <X className="w-4 h-4" />
  </button>
</div>
```

---

### Task Detail Panel (Sheet)

Slides in from the right as a `<Sheet>` — not a full page.

- Width: `600px` (fixed, not responsive in MVP)
- Border left: `border-l border-[var(--border)]`
- Background: `bg-[var(--bg-surface)]`
- Header: task title as an editable `contentEditable` `<h1>` — click to edit inline
- Slide animation: `x: 600 → 0` with `ease-default`

---

### Dropdowns & Popovers

```tsx
"bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)]
 p-1 min-w-[180px]"

// Dropdown item
"flex items-center gap-2 px-2.5 py-1.5 text-sm text-[var(--text-primary)] rounded-md
 hover:bg-[var(--bg-app)] transition-colors duration-75 cursor-pointer"

// Dropdown item — destructive
"... text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-500/10"
```

Dropdown open animation:
```tsx
initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.12, ease: 'easeOut' }}
```

---

### Badges & Pills

```tsx
// Status pill — full (in task detail, sprint view)
const pill = "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
style={{ backgroundColor: `${color}20`, color }}

// Status dot — minimal (in task row, sidebar)
const dot = "w-2 h-2 rounded-full flex-shrink-0"
style={{ backgroundColor: color }}

// Count badge (notifications, sprint task count)
"min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold
 bg-[var(--brand)] text-white flex items-center justify-center"
```

---

### Loading States

Replace all spinners with **skeleton screens** that match the real layout.

```tsx
// Skeleton base
"animate-pulse bg-[var(--border)] rounded"

// Task row skeleton
<div className="flex items-center gap-3 h-9 px-4">
  <div className="w-4 h-4 rounded-full animate-pulse bg-[var(--border)]" />
  <div className="w-24 h-3 rounded animate-pulse bg-[var(--border)]" />
  <div className="flex-1 h-3 rounded animate-pulse bg-[var(--border)]" />
  <div className="w-16 h-3 rounded animate-pulse bg-[var(--border)]" />
</div>
```

Never show a full-page spinner for content that can be skeletonized.

---

### Empty States

Each empty state needs a centered layout with: icon → heading → subtext → primary action.

```tsx
<div className="flex flex-col items-center justify-center py-20 text-center">
  {/* Icon — use a subtle colored icon, not a gray blob */}
  <div className="w-12 h-12 rounded-2xl bg-[var(--brand-muted)] flex items-center justify-center mb-4">
    <ListTodo className="w-6 h-6 text-[var(--brand)]" />
  </div>
  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">No tasks yet</h3>
  <p className="text-sm text-[var(--text-secondary)] max-w-[260px] mb-5">
    Add your first task to start tracking work in this list.
  </p>
  <Button variant="primary" size="sm">Add task</Button>
</div>
```

---

### Tooltips

Use Radix `<Tooltip>` (via shadcn) with a consistent dark style:

```tsx
"bg-[#1A1D23] text-white text-xs px-2 py-1 rounded-md shadow-[var(--shadow-md)]
 border border-white/10"
```

Always show keyboard shortcut inside tooltip when one exists:
```
Pin task    ⌘P
```

---

## Layout Changes

### Page Structure

```
┌───────────────────────────────────────────────────────────────────────┐
│ Sidebar (240px, always dark)   │ Main area (flex-1)                   │
│                                │ ┌───────────────────────────────────┐│
│                                │ │ Top bar (h-12, sticky)            ││
│                                │ ├───────────────────────────────────┤│
│                                │ │                                   ││
│                                │ │  Content                          ││
│                                │ │                                   ││
│                                │ └───────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────┘
```

- `<html>` gets `class="dark"` by default — dark mode is the default mode
- `<body>` background: `bg-[var(--bg-app)]`
- Main content area background: `bg-[var(--bg-surface)]`
- Sidebar has its own `bg-[var(--bg-sidebar)]` — never inherits from body

### Content Max Width

List views and board views use full width — no `max-w-*` container. Only settings pages and modals are constrained.

---

## Dark Mode Implementation

Dark mode is the **default**. Light mode is the toggle option.

```tsx
// app/layout.tsx
// Default to dark — read user preference from a cookie or localStorage
<html lang="en" className={userTheme ?? 'dark'}>
```

Store preference in `localStorage` key `ui-theme` with values `'light' | 'dark' | 'system'`. A `ThemeProvider` component handles this on the client.

All color tokens already have dark variants in the `:root` / `.dark` CSS above — no component-level `dark:` changes needed if you use the CSS variables correctly.

---

## Specific Screen Upgrades

### Sidebar — Sprint Active State

When a sprint is active, show a subtle green pulsing dot next to the sprint name:

```tsx
<span className="relative flex h-2 w-2">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
</span>
```

### Task Row — Pinned State (List Pin)

Pinned task rows get a left accent border and a slightly elevated background:

```tsx
// Pinned section header
<div className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider
                text-[var(--text-muted)] border-b border-[var(--border)]">
  <Pin className="w-3 h-3" />
  Pinned
</div>

// Pinned task row
"border-l-2 border-[var(--brand)] bg-[var(--brand-muted)]/30"
```

### Sprint Progress Bar

Replace a flat progress bar with a segmented one that shows task status distribution:

```tsx
// Instead of a single filled bar, show colored segments per status
<div className="flex h-1.5 rounded-full overflow-hidden gap-px bg-[var(--border)]">
  {statuses.map(s => (
    <div key={s.id} style={{ width: `${s.percent}%`, backgroundColor: s.color }}
         className="transition-all duration-500" />
  ))}
</div>
```

### Kanban Board Column

```tsx
// Column header
<div className="flex items-center justify-between px-3 py-2 mb-2">
  <div className="flex items-center gap-2">
    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: status.color }} />
    <span className="text-sm font-medium text-[var(--text-primary)]">{status.name}</span>
    <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-app)] px-1.5 py-0.5 rounded-full">
      {count}
    </span>
  </div>
  <button className="opacity-0 group-hover:opacity-100 ...">
    <Plus className="w-4 h-4" />
  </button>
</div>

// Column body
<div className="flex flex-col gap-2 min-h-[40px]">
  {/* task cards */}
</div>
```

---

## Implementation Order

Work through these in order — each step builds on the previous.

1. **Tokens first** — set up all CSS variables in `globals.css` + Inter font. Nothing else works correctly until tokens are in.
2. **Sidebar** — highest-impact single change. Dark sidebar immediately makes the app feel like a real product.
3. **Buttons + Inputs** — global components touched on every screen.
4. **Task row** — the most-seen component in the app.
5. **Task card (board)** — second most-seen.
6. **Modals** — add Framer Motion enter/exit to all Dialog/Sheet components.
7. **Dropdowns + Tooltips** — polish the interaction layer.
8. **Empty states** — replace every bland empty state.
9. **Skeleton loaders** — remove all spinners.
10. **Dark mode toggle** — wire up the theme toggle in user settings.

---

## Things to Avoid

- Never use `shadow-xl` on anything except the command palette
- Never use `bg-gray-50` — use `bg-[var(--bg-app)]` instead
- Never use `rounded-sm` on interactive elements — minimum `rounded-md`
- Never use `font-bold` in the UI — `font-semibold` (600) is the maximum weight
- Never animate `width`, `height`, or `transform` with CSS `transition-all` — always target the specific property
- Never show a full-page loading spinner — use skeletons
- Never use emoji as functional icons — use Lucide icons only
- Never hardcode hex colors in components — always use CSS variables
- Never create a new color that isn't in the token set

---

## Checklist: Before Marking a Screen as Done

- [ ] Uses CSS variable tokens — no hardcoded hex values
- [ ] Works correctly in both light and dark mode
- [ ] All interactive elements have visible hover + focus states
- [ ] Empty state is styled (not a bare text fallback)
- [ ] Loading state uses skeleton, not spinner
- [ ] No `text-gray-*` classes — uses CSS variable text tokens (`--text-primary`, `--text-secondary`, `--text-muted`)
- [ ] Modals/drawers have enter/exit animation
- [ ] Tooltips on all icon-only buttons
