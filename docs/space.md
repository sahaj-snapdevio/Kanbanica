# Space

## Overview

A Space is the second level in the Teamority hierarchy, sitting directly inside a Workspace. Spaces represent teams, departments, or major areas of work. Everything inside a Space — Lists, Tasks — inherits its permission model.

**Real-world analogy:** A Space = a team or department. e.g. `Engineering`, `Marketing`, `Design`, `HR`

**Hierarchy position:**
```
Workspace
  └── Space      ← you are here
        └── List
              └── Task
```

---

## User Stories

- As an Admin, I want to create a Space for each team so work stays organized and separated.
- As an Admin, I want to make a Space private so only invited members can see it.
- As an Admin, I want to invite specific members to a Space and control what they can do.
- As a Member with Full Access, I want to create Lists inside my Space.
- As a Member with Edit access, I want to create and update tasks without being able to delete structure.
- As a Member with View access, I want to read task progress and comment without making changes.
- As any member, I want to archive a Space instead of deleting it so history is preserved.

---

## Features

### 1. Create Space

- **Who can create:** Owner, Admin
- Required fields:
  - Space Name (required)
  - Color (pick from palette — used in sidebar and UI accents)
  - Icon / Emoji (optional)
  - Visibility: **Public** or **Private** (default: Public)
- On creation:
  - Creator is automatically given **Full Access** to the Space
  - A default List named **"List"** is automatically created inside the Space so the user can start adding tasks immediately without any extra steps
  - User can rename the default List at any time
  - If Public: all workspace Members can see the Space (with default **View** access unless overridden)
  - If Private: only explicitly invited members can see it

---

### 2. Edit Space

- **Who can edit:** Members with **Full Access** on that Space, Admin, Owner
- Editable fields:
  - Name
  - Color
  - Icon / Emoji
  - Visibility (Public ↔ Private)
- Changing visibility from Private → Public makes the Space visible to all workspace Members with default **View** access
- Changing from Public → Private removes access for members not explicitly listed

---

### 3. Archive Space

- **Who can archive:** Owner, Admin, Member with Full Access
- Archived Spaces are hidden from the main sidebar
- All data (Lists, Tasks, Comments) is preserved and searchable
- No new tasks can be created inside an archived Space
- Can be unarchived at any time by Owner or Admin
- Members lose active access but data remains intact

---

### 4. Delete Space

- **Who can delete:** Owner, Admin only
- Permanently deletes the Space and all its contents:
  - Lists, Tasks, Subtasks, Comments, Attachments
- Requires confirmation (type Space name to confirm)
- Cannot be undone
- Recommended to Archive instead of Delete in most cases

---

### 5. Space Visibility — Public vs Private

| | Public Space | Private Space |
|--|-------------|---------------|
| Who can see it | All workspace members | Only invited members |
| Default access for new workspace members | View | No access |
| Shown in sidebar for non-members | Yes (read-only) | No (invisible) |
| Owner / Admin visibility | Always | Always |

---

### 6. Space Members & Permissions

Each Space has its own member list with a permission level per user.

**Permission Levels:**

| Permission | Create Task | Edit Task | Delete Task | Create List | Delete List | Manage Space Members | Comment |
|------------|-------------|-----------|-------------|-------------------|-------------------|---------------------|---------|
| Full Access | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Edit | Yes | Yes | No | No | No | No | Yes |
| View | No | No | No | No | No | No | Yes |

**Managing Space Members:**
- Members with **Full Access** can invite users to the Space and set their permission level
- Admin and Owner can always manage Space members regardless of their Space permission
- A user's Space permission overrides their Workspace role within that Space
  - Exception: Owner and Admin always have implicit Full Access everywhere

**Adding members to a Space:**
- Search for existing workspace members by name or email
- Select permission level (Full Access / Edit / View)
- Member immediately gains access — no email required (they are already in the workspace)
- Guests must be workspace members first before being added to a Space

---

### 7. Space Notifications Settings

Each member can configure notification preferences per Space:

- **All activity** — notify on every task update, comment, status change
- **Only @mentions** — notify only when directly mentioned
- **None** — mute this Space entirely

Settings are per-user, per-Space. Does not affect other members.

---

### 8. Space Sidebar & Navigation

- All Spaces a user has access to appear in the left sidebar under the Workspace
- Spaces are grouped: Public Spaces first, then Private Spaces (marked with a lock icon)
- User can reorder Spaces in their sidebar (personal preference, not global)
- Collapsed/expanded state of each Space persists per user

---

## Space Member States

| State | Description |
|-------|-------------|
| Active | Member has access to this Space with an assigned permission level |
| Removed | Member was removed from the Space; can no longer access it |

---

## Data Model

```
Space
├── id                  (uuid, primary key)
├── workspace_id        (foreign key → Workspace)
├── name                (string, required)
├── color               (string — hex color code)
├── icon                (string — emoji or icon identifier, nullable)
├── is_private          (boolean, default: false)
├── is_archived         (boolean, default: false)
├── archived_at         (timestamp, nullable)
├── created_by          (user_id, foreign key)
├── created_at          (timestamp)
└── updated_at          (timestamp)

SpaceMember
├── id                  (uuid, primary key)
├── space_id            (foreign key → Space)
├── user_id             (foreign key → User)
├── permission          (enum: full_access | edit | view)
├── added_by            (user_id, foreign key)
└── created_at          (timestamp)
```

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/workspaces/:workspaceId/spaces` | Create a Space | Admin+ |
| GET | `/api/workspaces/:workspaceId/spaces` | List all accessible Spaces | Member+ |
| GET | `/api/workspaces/:workspaceId/spaces/:id` | Get Space details | Space member |
| PATCH | `/api/workspaces/:workspaceId/spaces/:id` | Update Space (name, color, icon, visibility) | Full Access / Admin+ |
| DELETE | `/api/workspaces/:workspaceId/spaces/:id` | Delete Space permanently | Admin+ |
| PATCH | `/api/workspaces/:workspaceId/spaces/:id/archive` | Archive Space | Full Access / Admin+ |
| PATCH | `/api/workspaces/:workspaceId/spaces/:id/unarchive` | Unarchive Space | Admin+ |
| GET | `/api/workspaces/:workspaceId/spaces/:id/members` | List Space members | Space member |
| POST | `/api/workspaces/:workspaceId/spaces/:id/members` | Add member to Space | Full Access / Admin+ |
| PATCH | `/api/workspaces/:workspaceId/spaces/:id/members/:userId` | Change member permission | Full Access / Admin+ |
| DELETE | `/api/workspaces/:workspaceId/spaces/:id/members/:userId` | Remove member from Space | Full Access / Admin+ |

---

## UI Screens

| Screen | Route | Access |
|--------|-------|--------|
| Space sidebar list | Sidebar (global) | All workspace members |
| Space home (lists inside) | `/space/:spaceId` | Space member |
| Space Settings — General | `/space/:spaceId/settings/general` | Full Access / Admin+ |
| Space Settings — Members | `/space/:spaceId/settings/members` | Full Access / Admin+ |
| Space Settings — Notifications | `/space/:spaceId/settings/notifications` | Any Space member (own settings) |
| Create Space modal | Global (sidebar button) | Admin+ |

---

## Data Lifecycle

### Archive
- Archived Spaces are hidden from the sidebar for all members.
- All Lists, Tasks, Comments, and Attachments inside are preserved — fully searchable.
- No new Lists or Tasks can be created inside an archived Space.
- Archived Spaces can be unarchived at any time — **no time limit**.
- Members retain their SpaceMember records and permissions during archival.
- If a Workspace is deleted, archived Spaces are permanently deleted along with it.

### Soft Delete
- Space deletion is a **hard delete** — no soft delete or recovery period.
- Archive is the recommended alternative to deletion when you want to preserve history.

### Recovery Period
- **Archived Space:** Recoverable at any time — no expiry.
- **Deleted Space:** No recovery. Deletion is permanent and immediate.

### Permanent Deletion Rules
- Only **Admin and Owner** can permanently delete a Space.
- Requires confirmation (button click — no name-typing required, unlike Workspace).
- On deletion, the following are permanently removed in cascade:
  - All Lists inside the Space
  - All Tasks and Subtasks inside those Lists
  - All Checklists, ChecklistItems, TaskAttachments (DB + S3/R2 files)
  - All Comments (including soft-deleted tombstones)
  - All ActivityLog entries for tasks in this Space
  - All SpaceMember records
  - All Notifications referencing tasks in this Space
  - All SavedFilters and UserListViewPreferences scoped to Lists in this Space
  - All Sprints and TaskSprint records in Lists in this Space
- The Space record itself is deleted — no tombstone.

---

## Business Rules

1. A Space always belongs to exactly one Workspace.
2. Owner and Admin always have implicit Full Access on all Spaces, including Private ones.
3. A Private Space is completely invisible (not even its name) to users who are not members of it.
4. When a Space is made Public, workspace Members get View access by default unless explicitly given a higher permission.
5. When a Space is made Private, all non-explicitly-listed members immediately lose access.
6. Archiving a Space does not delete data — it only locks new work and hides it from the sidebar.
7. A deleted Space cannot be recovered.
8. A user can only be added to a Space if they are already a member of the parent Workspace.
9. Removing a member from a Space does not remove them from the Workspace.
10. Space permission always takes precedence over Workspace role within that Space (except Owner and Admin who always have Full Access).

---

## Out of Scope (MVP)

- Space-level templates (pre-built Spaces with Lists and tasks)
- Space duplication / copy
- Space-level analytics and reporting
- Public Spaces visible outside the workspace (external sharing)
- Space-level custom fields
