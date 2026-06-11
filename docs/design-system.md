# Design System

## Overview

This is the single source of truth for all visual design decisions in Teamority. Every UI component, color, spacing, and typography choice must reference this doc. Do not invent values on the fly.

---

## Color Palette

### Brand Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-brand` | `#6366F1` | Primary CTAs, active states, links, focus rings |
| `--color-brand-hover` | `#4F46E5` | Hover state on brand elements |
| `--color-brand-light` | `#EEF2FF` | Backgrounds for selected/active items |

### Neutrals (used for text, backgrounds, borders)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#FFFFFF` | Main page background |
| `--color-bg-subtle` | `#F9FAFB` | Sidebar, panels, secondary backgrounds |
| `--color-bg-muted` | `#F3F4F6` | Hover states, chips, code blocks |
| `--color-border` | `#E5E7EB` | Dividers, input borders, card borders |
| `--color-border-strong` | `#D1D5DB` | Focused input borders |
| `--color-text` | `#111827` | Primary text |
| `--color-text-secondary` | `#6B7280` | Subtext, labels, timestamps |
| `--color-text-muted` | `#9CA3AF` | Placeholder text, disabled text |
| `--color-text-inverse` | `#FFFFFF` | Text on dark/brand backgrounds |

### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | `#10B981` | Completed states, success toasts |
| `--color-success-light` | `#D1FAE5` | Success background |
| `--color-warning` | `#F59E0B` | Warning states, overdue indicators |
| `--color-warning-light` | `#FEF3C7` | Warning background |
| `--color-danger` | `#EF4444` | Errors, delete actions, danger zone |
| `--color-danger-light` | `#FEE2E2` | Error background |
| `--color-info` | `#3B82F6` | Info states, neutral notifications |
| `--color-info-light` | `#DBEAFE` | Info background |

### Dark Mode

Dark mode uses the same tokens — values swap. Tailwind `dark:` variants handle this. Not in MVP scope but tokens are named to support it cleanly later.

---

## Priority Colors

These are fixed across the entire app — never change per List.

| Priority | Color | Hex |
|----------|-------|-----|
| None | Gray | `#9CA3AF` |
| Low | Blue | `#3B82F6` |
| Medium | Yellow | `#F59E0B` |
| High | Orange | `#F97316` |
| Urgent | Red | `#EF4444` |

---

## Space / List Colors (User Picks)

These are the colors users can pick when creating a Space or List. Keep this palette small and distinct.

| Name | Hex |
|------|-----|
| Indigo | `#6366F1` |
| Blue | `#3B82F6` |
| Cyan | `#06B6D4` |
| Teal | `#14B8A6` |
| Green | `#22C55E` |
| Lime | `#84CC16` |
| Yellow | `#EAB308` |
| Orange | `#F97316` |
| Red | `#EF4444` |
| Pink | `#EC4899` |
| Purple | `#A855F7` |
| Gray | `#6B7280` |

---

## Typography

| Scale | Class | Size | Weight | Usage |
|-------|-------|------|--------|-------|
| Display | `text-2xl font-bold` | 24px | 700 | Page titles, modal headings |
| Heading | `text-lg font-semibold` | 18px | 600 | Section headings, card titles |
| Subheading | `text-base font-medium` | 16px | 500 | Group labels, sidebar section names |
| Body | `text-sm` | 14px | 400 | Default text everywhere |
| Small | `text-xs` | 12px | 400 | Timestamps, badges, metadata |
| Small Bold | `text-xs font-medium` | 12px | 500 | Labels, chips, status pills |

**Font:** System font stack (Tailwind default) — `font-sans`. No custom font in MVP.

---

## Spacing Scale

Tailwind's default spacing scale. Stick to these values — no arbitrary pixel values.

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight gaps between inline elements |
| `space-2` | 8px | Icon-to-label gaps, small padding |
| `space-3` | 12px | Internal padding for compact components |
| `space-4` | 16px | Default padding (cards, inputs, list items) |
| `space-6` | 24px | Section spacing |
| `space-8` | 32px | Large section gaps |

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `rounded` | 6px | Buttons, inputs, badges |
| `rounded-md` | 8px | Cards, dropdowns, modals |
| `rounded-lg` | 12px | Larger panels, popovers |
| `rounded-full` | 9999px | Avatars, toggle pills |

---

## Shadows

| Token | Usage |
|-------|-------|
| `shadow-sm` | Cards, list items on hover |
| `shadow-md` | Dropdowns, popovers |
| `shadow-lg` | Modals |
| `shadow-xl` | Command palette (Ctrl+K overlay) |

---

## Components

### Buttons

| Variant | Style | Usage |
|---------|-------|-------|
| Primary | `bg-brand text-white hover:bg-brand-hover` | Main CTAs (Save, Create, Submit) |
| Secondary | `bg-white border border-border text-text hover:bg-bg-muted` | Secondary actions (Cancel, Edit) |
| Danger | `bg-danger text-white hover:bg-red-600` | Destructive actions (Delete) |
| Ghost | `text-text hover:bg-bg-muted` | Toolbar icons, inline actions |
| Link | `text-brand underline-offset-2 hover:underline` | Text links |

Button heights:
- Default: `h-9` (36px)
- Small: `h-7` (28px)
- Large: `h-11` (44px) — used for primary CTAs on auth pages

---

### Inputs

- Height: `h-9` (36px)
- Border: `border border-border rounded`
- Focus: `focus:ring-2 focus:ring-brand focus:border-brand-strong`
- Placeholder: `text-text-muted`
- Error state: `border-danger focus:ring-danger`

---

### Status Pills

Statuses use the color defined on the ListStatus record.

| Type | Style |
|------|-------|
| Open | `bg-[color]/15 text-[color]` (light background, colored text) |
| Active | `bg-[color]/15 text-[color]` |
| Closed | `bg-bg-muted text-text-secondary` (always gray when closed) |

---

### Sidebar

The sidebar is collapsible. Users can toggle it open or closed. State persists in `localStorage`.

| State | Width | Behavior |
|-------|-------|----------|
| Open | `240px` | Full sidebar — shows icons + labels |
| Closed | `56px` | Icon-only rail — labels hidden, icons remain |

- Transition: `transition-all duration-200 ease-in-out` on width change
- Toggle button: a `ChevronLeft` / `ChevronRight` icon pinned at the bottom of the sidebar
- Collapsed state shows only icons — hovering an icon shows a tooltip with the label
- Background: `bg-bg-subtle`
- Active item: `bg-brand-light text-brand font-medium`
- Hover item: `bg-bg-muted`
- Text: `text-sm text-text`
- Section labels (open): `text-xs font-medium text-text-muted uppercase tracking-wide`
- Section labels (closed): hidden
- Not resizable by drag in MVP — toggle only

#### Sidebar Bottom Bar

Two fixed items are pinned at the very bottom of the sidebar, above the collapse toggle, separated from the main nav by a `border-t border-border`:

| Item | Icon | Behaviour | Visible to |
|------|------|-----------|------------|
| **Workspace Settings** | `Settings` (Lucide) | Navigates to `/[workspaceId]/settings/general` | Owner and Admin only — hidden for Member/Guest |
| **User profile row** | User avatar (`w-6 h-6`) + name (truncated, open state only) | Opens a popover anchored to the row | All roles |

**User profile popover** (opens upward, `min-w-[200px]`):

```
[Avatar]  Full Name
          email@example.com
──────────────────────────
Profile & Account      →  /settings/account
Sessions               →  /settings/sessions
Notifications          →  /settings/notifications
──────────────────────────
Sign out
```

- Popover uses `<Popover>` (shadcn) anchored to the bottom of the sidebar
- "Sign out" triggers Better Auth `signOut()` then redirects to `/sign-in`
- In collapsed (icon-only) mode: only the avatar is shown; tooltip on hover reads the user's full name

---

### Avatars

- Sizes: `w-6 h-6` (small, inline), `w-8 h-8` (default), `w-10 h-10` (large, profile)
- Shape: `rounded-full`
- Fallback: Initials on a colored background (color derived from user ID — deterministic)
- See `docs/avatar-system.md` for full fallback logic

---

### Task Cards (Board View)

- Background: `bg-white`
- Border: `border border-border`
- Border radius: `rounded-md`
- Shadow on hover: `shadow-sm`
- Padding: `p-3`

---

### Modals

- Max width: `max-w-lg` (default), `max-w-2xl` (large — task detail)
- Background: `bg-white`
- Overlay: `bg-black/40`
- Border radius: `rounded-lg`
- Shadow: `shadow-lg`

#### Sheet vs Dialog vs AlertDialog -- When to Use Which

| Component | Use for | Example |
|-----------|---------|---------|
| `<Dialog>` | Focused input forms; content that fits in a centred modal | Create List, Create Sprint, Invite Member |
| `<Sheet>` | Contextual detail panels that slide in from the side; complex content the user may want open alongside the main view | Task detail panel, Space settings |
| `<AlertDialog>` | Destructive confirmations only -- actions that cannot be undone | Delete List, Delete Task, Archive All |

**Rules:**
- Never use `<Dialog>` for destructive confirmations -- always `<AlertDialog>`. It has a built-in accessible cancel/confirm pattern and correct focus management.
- Never use `<Sheet>` for simple forms -- use `<Dialog>`. Sheets imply persistent side context, not a quick input.
- `<AlertDialog>` must always have two explicit buttons: a clearly labelled destructive action (`"Delete List"`, not `"OK"`) and a cancel button. Never a single-button confirm.

---

## Icons

Use **Lucide React** (`lucide-react`) for all icons — it ships with shadcn/ui.

- Default size: `w-4 h-4` (16px)
- Sidebar icons: `w-4 h-4`
- Toolbar icons: `w-4 h-4`
- Empty state icons: `w-10 h-10 text-text-muted`

Do not use multiple icon libraries.

---

## Toasts / Notifications

Use shadcn/ui `Sonner` toast component.

| Type | Color |
|------|-------|
| Success | Green (`--color-success`) |
| Error | Red (`--color-danger`) |
| Info | Default (neutral) |

Position: Bottom-right. Duration: 4 seconds.

---

## Z-Index Scale

| Layer | Value | Usage |
|-------|-------|-------|
| Base | 0 | Default content |
| Dropdown | 10 | Dropdowns, popovers |
| Sidebar | 20 | Left sidebar (sticky) |
| Sticky header | 30 | Top nav bar |
| Modal overlay | 40 | Modal backdrop |
| Modal | 50 | Modal content |
| Command palette | 60 | Ctrl+K overlay |
| Toast | 70 | Toast notifications |

---

## Responsive Breakpoints

MVP is **desktop-first**. Mobile is post-MVP. Do not spend time on mobile layouts.

Minimum supported viewport: **1024px** (laptop).

---

## `<LocalDate />` Component (Critical -- Build First)

All timestamps in the UI must be rendered through `<LocalDate />`. Do NOT use `new Date().toLocaleDateString()`, `date-fns` format calls, or any date formatting directly in JSX.

**Why:** Next.js App Router server-renders components on the server (UTC timezone). The client has a different local timezone. Any date formatted on the server and hydrated on the client will produce a React hydration mismatch error (`Hydration failed because the server rendered HTML didn't match the client`). This error appears on every screen that shows a timestamp.

```typescript
// src/components/ui/local-date.tsx
'use client'

import { format, formatDistanceToNow, isThisYear } from 'date-fns'

interface LocalDateProps {
  date: string | Date
  // 'relative' -> "2 hours ago" with exact date on hover
  // 'date'     -> "Jun 15" or "Jun 15, 2024" (includes year if not current year)
  // 'datetime' -> "Jun 15, 2:30 PM"
  format?: 'relative' | 'date' | 'datetime'
  className?: string
}

export function LocalDate({ date, format: fmt = 'relative', className }: LocalDateProps) {
  const d = typeof date === 'string' ? new Date(date) : date
  const exact = format(d, 'MMM d, yyyy h:mm a')

  let display: string
  if (fmt === 'relative') {
    display = formatDistanceToNow(d, { addSuffix: true })
  } else if (fmt === 'date') {
    display = isThisYear(d) ? format(d, 'MMM d') : format(d, 'MMM d, yyyy')
  } else {
    display = format(d, 'MMM d, h:mm a')
  }

  return (
    <time dateTime={d.toISOString()} title={exact} className={className}>
      {display}
    </time>
  )
}
```

Usage:

```tsx
// Always use LocalDate for any date/time display
<LocalDate date={task.createdAt} />                    // "2 hours ago"
<LocalDate date={task.dueDate} format="date" />        // "Jun 15"
<LocalDate date={comment.createdAt} format="datetime" /> // "Jun 15, 2:30 PM"
```

**`'use client'` is non-negotiable** -- this component accesses the browser's local timezone. Removing it causes the hydration error the component exists to prevent.

Build this before building any component that displays a timestamp (task detail panel, activity log, comments, notifications). That is Phase 4 at the latest.

---

## Tailwind Config Notes

Define these as CSS custom properties in `globals.css` and reference via Tailwind's `theme.extend`. Use the `--color-*` tokens above as the source. Example:

```css
:root {
  --color-brand: #6366F1;
  --color-brand-hover: #4F46E5;
  --color-brand-light: #EEF2FF;
  /* ... etc */
}
```
