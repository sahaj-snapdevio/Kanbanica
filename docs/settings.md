# Settings

This document is the single source of truth for all settings pages in Kanbanica — personal, workspace, and space. Implementation phases are noted where relevant.

---

## Overview

Settings are accessed from two entry points in the sidebar bottom bar (see [design-system.md](./design-system.md)):

| Entry point | Who sees it | Leads to |
|---|---|---|
| Gear icon (`Settings`) | Owner and Admin only | `/[workspaceId]/settings/general` |
| User avatar / name row | All authenticated users | Profile popover -> links below |

**Profile popover links:**
- Profile & Account -> `/settings/account`
- Sessions -> `/settings/sessions`
- Notifications -> `/settings/notifications`
- Project settings → inline project picker (see below)
- Sign out

**Project settings flow (sidebar profile popover → project picker):**

Clicking "Project settings" in the profile popover replaces the popover content in place with an inline project picker — no new dialog or flyout. The picker shows:
- A "← Back" button (returns to the main popover view)
- A scrollable list of all Projects in the current workspace (`max-h-52 overflow-y-auto`)
- Each row: colored dot + project name (clickable)

Clicking a project navigates to `[workspaceId]/[spaceId]/settings/general` and closes the popover.

This is a two-step inline replace pattern (not a nested flyout) implemented inside `workspace-shell.tsx` using a `showProjectPicker` boolean state and a `Popover` `onOpenChange` that resets the state when the popover closes.

---

## 1. Personal Settings

Personal settings are scoped to the logged-in user and are workspace-independent.

### 1.1 Profile & Account — `/settings/account`

**Access:** All authenticated users

**Fields:**

| Field | Editable | Notes |
|---|---|---|
| Full name | Yes | Plain text, max 100 chars |
| Avatar | Yes | JPEG / PNG / WebP, max 2 MB, min 100Ã—100 px. Stored in R2. |
| Email address | No (read-only in MVP) | Shown for reference only |

**Behaviour:**
- Saving name updates `user.name` immediately (optimistic update).
- Uploading a new avatar replaces the existing R2 file; old file is deleted first.
- Avatar fallback: initials on a deterministic color background — see [avatar-system.md](./avatar-system.md).

**Data written:** `User.name`, `User.image`

---

### 1.2 Sessions — `/settings/sessions`

**Access:** All authenticated users

**What it shows:**
- All active sessions for the current user across devices.
- Each session card displays: device type (Desktop / Mobile), browser name, approximate location (city + country from IP — best-effort), last active timestamp.
- Current session is highlighted with a "This device" badge.

**Actions:**
- Revoke individual session (cannot revoke current session).
- "Sign out all other devices" — revokes every session except current.

**Data read/written:** `Session` table (managed by Better Auth).

---

### 1.3 Notification Preferences — `/settings/notifications`

**Access:** All authenticated users

**Page layout:**

```
Notification Settings
+-- Email Notifications
|     +-- Delivery mode: [Instant] [Daily Digest] [Off]
|     L-- (if Digest) Digest time: [08:00 AM v]  Timezone: [Auto-detect v]
+-- Browser Push
|     L-- Enable push notifications: [toggle]
|         (browser permission prompt fires on first enable)
+-- Notification Events
|     Table: one row per trigger type
|     Columns: Trigger | In-App | Email | Push
|     ------------------------------------------
|     Task assigned to me           [x]  [x]  [x]
|     @mention                      [x]  [x]  [x]
|     New comment on my task        [x]  [x]  [x]
|     Reply to my comment           [x]  [x]  [x]
|     Task status changed           [x]  [x]  --
|     Due date reminder (24h)       [x]  [x]  [x]
|     Task completed                [x]  --  --
|     Sprint started                [x]  --  --
|     Sprint ending soon (24h)      [x]  [x]  --
|     Member added to workspace     [x]  --  --
|     Invite accepted               [x]  [x]  --
|
L-- Muted Spaces & Tasks
      List of muted items (Space name or Task name + Space)
      Each row: [Unmute] action
      Empty state: "No muted spaces or tasks."
```

**Default values (on first save / new user):** all in-app toggles ON, email = Instant, push = Off.

**Per-workspace overrides:** Users can override global defaults for a specific workspace from within that workspace's notification settings link (accessible via Space `...` menu). These overrides are stored with a `workspace_id` on `UserNotificationPreference`.

**Per-Space mute:** Accessible from the Space sidebar `...` -> "Mute Space". Adds a `MutedEntity` row. Appears in the Muted list above.

**Per-task mute:** Accessible from Task detail `...` -> "Mute Task". Removes the user from `TaskWatcher` and adds a `MutedEntity` row.

**Digest rules:**
- Digest email is only sent if there are undelivered notifications since the last digest.
- Digest time is in the user's selected timezone (defaults to browser-detected timezone on first visit).

**Data model:**

| Table | Purpose |
|---|---|
| `UserNotificationPreference` | One row per (user, trigger_type, workspace_id nullable). Stores `in_app`, `email`, `push` booleans. |
| `UserEmailPreference` | One row per user. Stores `delivery_mode` (instant / digest / off), `digest_time` (HH:MM), `timezone` (IANA). |
| `MutedEntity` | One row per muted (user, entity_type, entity_id). `entity_type` = `space` or `task`. |

**Implementation phase:** Phase 15 — Notifications

---

## 2. Workspace Settings

Workspace settings are scoped to a single workspace. Route prefix: `/[workspaceId]/settings/`.

**Access guard:** Redirect non-admin/non-owner to the workspace home with a toast: "You don't have permission to access workspace settings."

### 2.1 General — `/[workspaceId]/settings/general`

**Access:** Admin and Owner

**Fields:**

| Field | Notes |
|---|---|
| Workspace name | Required, max 80 chars |
| Logo | Upload image (same constraints as avatar) or pick emoji |
| URL slug | Vanity alias only — changing never breaks existing UUID-based links |

**Saving:** Each field saves independently (no single Save button needed — autosave on blur is acceptable, or a single Save button per section).

---

### 2.2 Members — `/[workspaceId]/settings/members`

**Access:** Admin and Owner

**Layout:**

```
Members tab
+-- Search bar (filter by name or email)
+-- Role filter dropdown: All | Owner | Admin | Member | Guest
+-- Members table
|     Columns: Avatar + Name | Email | Role | Joined | Actions
|     Role cell: dropdown (Owner can change any; Admin can change Member/Guest only)
|     Actions: [Remove] — disabled on self and on Owner (for non-owners)
|
L-- Pending Invites section (collapsible)
      Columns: Email | Invited by | Sent | Expires | [Cancel invite]
```

**Actions:**
- Invite by email — opens a modal: email input + role selector (Member default). Sends magic-link invite email.
- Change role — inline dropdown in the table.
- Remove member — `<AlertDialog>` confirmation. Removing a member also removes them from all Spaces within this workspace.
- Cancel pending invite — immediate, no confirmation needed.
- Transfer ownership (Owner only) — modal: select member -> type workspace name to confirm -> transfers Owner role, demotes current owner to Admin.

---

### 2.4 Themes — `/[workspaceId]/settings/themes`

**Access:** All workspace members (each user's theme choice is per-workspace)

**What it controls:**

| Setting | Options | Default |
|---|---|---|
| Appearance | Light / Dark / System | System |
| Accent Theme Color | 10 color swatches (see below) | Indigo |

**Accent theme options:**

| Key | Name | Primary color |
|---|---|---|
| `indigo` | Indigo | `oklch(0.513 0.234 278)` |
| `black` | Black | `oklch(0.18 0.018 277)` |
| `purple` | Purple | `oklch(0.58 0.23 295)` |
| `blue` | Blue | `oklch(0.56 0.21 250)` |
| `pink` | Pink | `oklch(0.61 0.22 350)` |
| `violet` | Violet | `oklch(0.53 0.23 280)` |
| `orange` | Orange | `oklch(0.62 0.21 45)` |
| `teal` | Teal | `oklch(0.52 0.16 180)` |
| `bronze` | Bronze | `oklch(0.54 0.11 60)` |
| `mint` | Mint | `oklch(0.54 0.15 160)` |

**Behaviour:**
- Changes apply as an **instant live preview** — DOM updates immediately when the user clicks a swatch or appearance card without waiting for a save.
- Clicking **Save Changes** writes `theme` + `appearance_mode` to the DB (server action `updateWorkspaceTheme`) and also persists to `localStorage` (`kanbanica_theme_{workspaceId}` + `kanbanica_appearance_{workspaceId}`) for flash-free next load.
- Clicking **Cancel** reverts the preview to the last saved values; a toast confirms "Changes discarded."
- On page load: localStorage is checked first; if present it overrides the DB value (avoids a round-trip flash).
- `System` mode listens to `window.matchMedia('(prefers-color-scheme: dark)')` and re-applies on system change without requiring a reload.

**Implementation:**
- Theme is applied via `data-theme="<key>"` attribute on `<html>` + `.dark` class toggle.
- CSS variables for each theme are defined in `app/globals.css` using `[data-theme="X"]` selectors.
- `ThemeProvider` (`components/theme/theme-provider.tsx`) wraps the workspace layout and exposes `useTheme()` context.
- Theme is loaded server-side in `app/(app)/[workspaceId]/layout.tsx` from the DB and passed as `initialTheme` + `initialAppearanceMode` props to `ThemeProvider`.

**Data written:** `workspace.theme`, `workspace.appearanceMode`

---

### 2.3 Security — `/[workspaceId]/settings/security`

**Access:** Owner only

**Invite link:**
- Shows the current invite link (if active) with a Copy button.
- Toggle: Enable / Disable invite link.
- Regenerate link — `<AlertDialog>` warning: "This will immediately invalidate the current link. Anyone with the old link will no longer be able to join." Requires confirmation.

**Danger Zone:**
- Delete Workspace — `<AlertDialog>`. User must type the workspace name exactly to unlock the Delete button. Triggers async deletion job (see [workspace.md](./workspace.md)).

---

## 3. Space Settings

Space settings are accessed via:
- The Space sidebar `...` → "Settings"
- The sidebar profile popover → "Project settings" → select a project
- Route prefix: `/[workspaceId]/[spaceId]/settings/`

Tabs: **General**, **Members**, **Sprints**

### 3.1 General — `/[workspaceId]/[spaceId]/settings/general`

**Access:** Full Access permission or Admin/Owner workspace role

**Fields:**

| Field | Notes |
|---|---|
| Name | Required, max 80 chars |
| Color | Pick from 12-color palette (same palette as List colors) |
| Icon / emoji | Optional emoji picker |
| Visibility | Toggle: Public <-> Private |

**Visibility change rules:**
- Public -> Private: only explicitly added Space members retain access.
- Private -> Public: all workspace members gain View access by default (existing explicit members keep their existing level).

**Archive Space:** Button at the bottom of General settings (separate from Danger Zone). Archived Spaces are hidden from the sidebar but accessible via a "Show archived" toggle. Archiving is reversible.

**Danger Zone:**
- Delete Space — `<AlertDialog>`. Deletes the Space and all Lists and Tasks within it. Irreversible. Requires Admin+ workspace role.

---

### 3.2 Members — `/[workspaceId]/[spaceId]/settings/members`

**Access:** Full Access permission or Admin/Owner workspace role

**Layout:**

```
Members tab
+-- Search existing workspace members by name or email
+-- Members table
|     Columns: Avatar + Name | Email | Permission | Actions
|     Permission cell: dropdown (Full Access / Edit / View)
|     Actions: [Remove from Space]
|
L-- Add Members button -> inline search + permission picker
```

**Notes:**
- Only workspace members can be added as Space members.
- Removing a member from a Private Space immediately revokes their access.
- Owner and Admin always have implicit access to all Spaces regardless of Space membership.

---

## 4. Settings Navigation

### URL structure summary

| Page | Route |
|---|---|
| Profile & Account | `/settings/account` |
| Sessions | `/settings/sessions` |
| Notifications | `/settings/notifications` |
| Workspace General | `/[workspaceId]/settings/general` |
| Workspace Members | `/[workspaceId]/settings/members` |
| Workspace Security | `/[workspaceId]/settings/security` |
| Workspace Themes | `/[workspaceId]/settings/themes` |
| Space General | `/[workspaceId]/[spaceId]/settings/general` |
| Space Members | `/[workspaceId]/[spaceId]/settings/members` |
| Space Sprint Settings | `/[workspaceId]/[spaceId]/settings/sprints` |

### Settings page layout pattern

All settings pages share a two-column layout:

```
+----------------------------+--------------------------------------+
|  Left nav (200px)          |  Content area                        |
|  -----------------         |  ---------------------------------   |
|  > General                 |  [Section heading]                   |
|    Members                 |                                      |
|    Security                |  [Form fields / tables]              |
|                            |                                      |
|                            |  [Danger Zone — if applicable]       |
L----------------------------+--------------------------------------+
```

- On mobile (< 768px): left nav collapses to a top tab bar.
- Active nav item: `text-brand font-medium`.
- Danger Zone is always at the bottom of the relevant page, visually separated by a red border section (`border border-danger rounded-md`).

---

## 5. Implementation Phases

| Settings area | Phase |
|---|---|
| Profile & Account, Sessions | Phase 3 — Authentication |
| Workspace General, Members, Security + sidebar entry points | Phase 5 — Workspace |
| Workspace Themes | Phase 5 — Workspace (added post-phase) |
| Space General, Space Members | Phase 6 — Space |
| Space Sprint Settings | Phase 7/8 — Sprint |
| Notification Preferences | Phase 15 — Notifications |
