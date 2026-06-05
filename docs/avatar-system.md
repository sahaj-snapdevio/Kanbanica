# Avatar & Profile Display System

## Overview

Every user and workspace in Teamority is represented visually with an avatar. Avatars appear across the entire product — task assignee chips, comments, activity log, notifications, member lists, and more. A consistent, well-defined avatar system prevents blank circles and broken images throughout the UI.

---

## 1. User Avatar

### States (in priority order)

| Priority | State | What is shown |
|----------|-------|---------------|
| 1st | Uploaded photo | The user's uploaded image, cropped to a circle |
| 2nd | Initials fallback | Generated from the user's name with a deterministic background color |

The initials fallback is **always** available — it requires no upload and no external service.

### Initials fallback rules

**What initials to show:**
- Take the user's `full_name`
- Split on spaces → take the first character of the first word and the first character of the last word, uppercased
- Examples:
  - `"John Doe"` → `JD`
  - `"Alice"` → `A` (single word — one initial only)
  - `"Mary Jane Watson"` → `MW` (first + last word only, middle ignored)
  - `"john doe"` → `JD` (always uppercased regardless of input)
- Maximum 2 characters shown

**Background color — deterministic hash:**
- Color is derived from the user's `id` (UUID) — not the name, so it never changes even if the user renames
- Hash function: sum the char codes of the UUID string → `hash % PALETTE.length` → pick color
- This means the same user always gets the same color, on every device, for every viewer
- Color is never chosen randomly at render time

**Color palette (10 colors — accessible contrast on white text):**

| Index | Color name | Hex |
|-------|-----------|-----|
| 0 | Indigo | `#4F46E5` |
| 1 | Rose | `#E11D48` |
| 2 | Amber | `#D97706` |
| 3 | Emerald | `#059669` |
| 4 | Sky | `#0284C7` |
| 5 | Violet | `#7C3AED` |
| 6 | Pink | `#DB2777` |
| 7 | Teal | `#0D9488` |
| 8 | Orange | `#EA580C` |
| 9 | Slate | `#475569` |

**Text color:** Always white (`#FFFFFF`) — all palette colors are dark enough to guarantee WCAG AA contrast ratio (≥4.5:1) against white text.

**Implementation (utility function):**

```ts
const PALETTE = [
  '#4F46E5', '#E11D48', '#D97706', '#059669',
  '#0284C7', '#7C3AED', '#DB2777', '#0D9488',
  '#EA580C', '#475569',
]

function getAvatarColor(userId: string): string {
  const hash = userId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return PALETTE[hash % PALETTE.length]
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
```

---

## 2. Avatar Sizes

Avatars appear at different sizes depending on context. All sizes use the same circular crop.

| Size | Pixels | Used in |
|------|--------|---------|
| `xs` | 20×20 | Activity log inline, notification list |
| `sm` | 24×24 | Task card assignee chips, comment header, checklist item assignee |
| `md` | 32×32 | Task detail panel sidebar, member list rows, mention dropdown |
| `lg` | 40×40 | Profile settings page, workspace member table |
| `xl` | 64×64 | Account settings page header |

**Font size for initials scales with avatar size:**

| Size | Font size | Font weight |
|------|-----------|-------------|
| `xs` | 8px | 600 |
| `sm` | 10px | 600 |
| `md` | 13px | 600 |
| `lg` | 16px | 600 |
| `xl` | 24px | 700 |

---

## 3. Avatar Stack (multiple assignees)

When a task has multiple assignees, avatars are stacked horizontally with overlap.

### Rules

- Show up to **3 avatars** stacked, then a `+N` overflow chip for the rest
- Overlap: each avatar overlaps the previous by 6px
- Border: 2px white border around each avatar to separate them visually from each other and the background
- Stack order: left-to-right in the order assignees were added
- The `+N` chip uses the same size as the other avatars, with a neutral grey background (`#E5E7EB`) and dark text

### Examples

```
2 assignees:    [JD][AW]
3 assignees:    [JD][AW][MK]
5 assignees:    [JD][AW][MK]+2
```

### Where avatar stacks appear

- Task cards in List View (assignee column)
- Task cards in Board View (bottom of card)
- Task detail panel header area
- My Tasks rows

---

## 4. Tooltip on Avatar Hover

Hovering any avatar (in any context) shows a tooltip after a 300ms delay:

```
┌─────────────┐
│ John Doe    │
│ john@acme.. │
└─────────────┘
```

- Shows: full name (bold) + email address below
- Tooltip appears above the avatar (flips below if insufficient space)
- For the `+N` overflow chip: tooltip lists all overflow assignees by name, one per line

---

## 5. Greyed-Out Avatar (removed member)

When an assigned user has lost workspace access (removed from workspace, or invite never accepted and was cancelled):

- Avatar is rendered at **40% opacity** (`opacity: 0.4`)
- A tooltip on hover says: `"This user no longer has access to this workspace"`
- Initials fallback is still used if they had no photo — color is preserved from their original hash
- The greyed-out avatar is shown in all contexts: task cards, task detail panel, activity log

---

## 6. Workspace Avatar / Logo

Workspaces also have an avatar — shown in the sidebar workspace switcher and workspace settings.

### States (in priority order)

| Priority | State | What is shown |
|----------|-------|---------------|
| 1st | Uploaded logo | The workspace's uploaded image, cropped to a rounded square (8px radius) |
| 2nd | Emoji picker | If the owner chose an emoji instead of an image (stored as a text character) |
| 3rd | Initials fallback | First 2 characters of the workspace name, uppercase, with a color derived from the workspace `id` |

**Shape difference:** Workspace avatars use a **rounded square** (8px border-radius), not a circle. This visually distinguishes workspace avatars from user avatars throughout the product.

**Initials fallback for workspace:**
- Take workspace `name` → first character of each word → up to 2 characters
- `"Acme Corp"` → `AC`
- `"My Team"` → `MT`
- `"Teamority"` → `T`
- Color derived from workspace `id` using the same `getAvatarColor()` function

---

## 7. "Deleted User" avatar

When a user deletes their account, their tasks and comments are attributed to `"Deleted User"`. These show:

- A neutral grey circle with a person icon (no initials — identity is gone)
- Hex: `#9CA3AF` background, white icon
- Tooltip: `"This user has deleted their account"`
- No email shown in tooltip

---

## 8. System / Automated event avatar

Activity log entries and notifications triggered by the system (not by a specific user — e.g. auto-close sprint, due date reminder fired) show:

- A Teamority logo mark icon in a light brand-colored circle
- No initials, no tooltip name
- Label reads: `"Teamority"` in the actor name position

---

## 9. Upload Rules (user photo)

| Rule | Value |
|------|-------|
| Accepted formats | JPEG, PNG, WebP, GIF (static only — no animated GIFs) |
| Max file size | 2 MB |
| Min dimensions | 100×100 px |
| Storage | S3-compatible storage — same bucket as task attachments, under `/avatars/` prefix |
| Processing | Resized server-side to max 256×256 px before storing — no oversized originals kept |
| Old avatar | Previous avatar file is deleted from S3 storage when a new one is uploaded |

---

## Data Model

No new tables needed — avatar data lives on existing models:

```
User
├── ...
├── name      (string — used for initials generation)
├── image     (string, nullable — S3 URL if uploaded, null = use initials fallback)
└── ...

Workspace
├── ...
├── logo_url  (string, nullable — S3 URL or null = use initials fallback)
├── logo_emoji (string, nullable — single emoji character, used if set instead of logo_url)
└── ...
```

> **Priority:** `logo_url` takes precedence over `logo_emoji`. If both are null, initials fallback is used.

---

## Where Avatars Appear — Full Reference

| Location | Avatar type | Size | Stack? |
|----------|------------|------|--------|
| Sidebar — workspace switcher | Workspace avatar | `sm` (24px) | No |
| Sidebar — current user (bottom) | User avatar | `sm` (24px) | No |
| Task card — assignee column (List View) | User avatar | `sm` (24px) | Yes (max 3 + overflow) |
| Task card — bottom (Board View) | User avatar | `sm` (24px) | Yes (max 3 + overflow) |
| Task detail panel — assignees | User avatar | `md` (32px) | Yes (max 5 + overflow) |
| Task detail panel — reporter | User avatar | `md` (32px) | No |
| Activity log — each entry | User avatar | `xs` (20px) | No |
| Comment — author | User avatar | `md` (32px) | No |
| Notification item — actor | User avatar | `xs` (20px) | No |
| Member list (workspace settings) | User avatar | `lg` (40px) | No |
| Assignee picker (dropdown) | User avatar | `sm` (24px) | No |
| Mention dropdown (`@`) | User avatar | `sm` (24px) | No |
| Account settings page | User avatar | `xl` (64px) | No |
| Admin panel — user list | User avatar | `sm` (24px) | No |
| Feature request — submitted by | User avatar | `sm` (24px) | No |
| Calendar View — task card | User avatar | `xs` (20px) | No |
| Checklist item — assignee | User avatar | `xs` (20px) | No |

---

## Business Rules

1. The initials fallback is always available — it requires no external service and never fails.
2. Avatar background color is derived from `user.id`, not the name — color is stable even if the user changes their name.
3. The same color palette and hash function must be used on both client and server to ensure consistent rendering.
4. Workspace avatars use a rounded square shape; user avatars use a full circle — this distinction is consistent everywhere.
5. Uploaded avatars are resized server-side to max 256×256 px before storage — raw originals are never kept.
6. Old avatar files are deleted from S3 storage when replaced — no orphaned files accumulate.
8. Greyed-out avatars (removed members) preserve the original color and initials — they are just rendered at 40% opacity.
9. `+N` overflow chips use a neutral grey, not a palette color — they are not avatars, they are counters.
10. Animated GIFs are not accepted for avatar upload — static images only.

---

## Out of Scope (MVP)

- Avatar frames or decorations
- Team / group avatars (beyond workspace avatar)
- Avatar crop/zoom editor on upload (upload as-is, server resizes)
- Gravatar fallback (initials fallback is used instead — no external dependency)
- Custom emoji avatar for users (workspace only in MVP)
