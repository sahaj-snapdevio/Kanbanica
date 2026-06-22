# Project

> **Naming note:** The entity is called **Project** in the product UI. In the codebase and database it is named `space` / `spaceId` — do not rename the technical identifiers, only the user-facing labels.

## Overview

A Project is the second level in the Kanbanica hierarchy, sitting directly inside a Workspace. Projects represent a distinct area of work — a product, a campaign, a codebase, or any initiative. Everything inside a Project — Lists, Sprints, Tasks — inherits its permission model.

**Real-world analogy:** A Project = a distinct initiative. e.g. `Backend API`, `Mobile App v2`, `Q3 Marketing Campaign`, `Design System`

**Hierarchy position:**
```
Workspace
  └── Project      <- you are here
        ├── List (default + user-created)
        │     └── Task
        └── Sprint (optional, project-level)
              └── Task (assigned from any List in this Project)
```

---

## User Stories

- As an Admin, I want to create a Project for each initiative so work stays organized and separated.
- As an Admin, I want to make a Project private so only invited members can see it.
- As an Admin, I want to invite specific members to a Project and control what they can do.
- As a Member with Full Access, I want to create Lists and Sprints inside my Project.
- As a Member with Edit access, I want to create and update tasks without being able to delete structure.
- As a Member with View access, I want to read task progress and comment without making changes.
- As any member, I want to archive a Project instead of deleting it so history is preserved.

---

## Features

### 1. Create Project

- **Who can create:** Owner, Admin
- Required fields:
  - Project Name (required)
  - Color (pick from palette — used in sidebar and UI accents)
  - Icon / Emoji (optional)
  - Visibility: **Public** or **Private** (default: Public)
- On creation:
  - Creator is automatically given **Full Access** to the Project
  - A default List named **"List"** is automatically created inside the Project so the user can start adding tasks immediately without any extra steps
  - User can rename the default List at any time
  - Sprints are available immediately — user can create the first Sprint at any time (optional)
  - If Public: all workspace Members can see the Project (with default **View** access unless overridden)
  - If Private: only explicitly invited members can see it

---

### 2. Edit Project

- **Who can edit:** Members with **Full Access** on that Project, Admin, Owner
- Editable fields:
  - Name
  - Color
  - Icon / Emoji
  - Visibility (Public <-> Private)
- Changing visibility from Private -> Public makes the Project visible to all workspace Members with default **View** access
- Changing from Public -> Private removes access for members not explicitly listed

---

### 3. Archive Project

- **Who can archive:** Owner, Admin, Member with Full Access
- Archived Projects are hidden from the main sidebar
- All data (Lists, Sprints, Tasks, Comments) is preserved and searchable
- No new tasks or sprints can be created inside an archived Project
- Can be unarchived at any time by Owner or Admin
- Members lose active access but data remains intact

---

### 4. Delete Project

- **Who can delete:** Owner, Admin only
- Permanently deletes the Project and all its contents:
  - Lists, Sprints, Tasks, Subtasks, Comments, Attachments
- Requires confirmation (type Project name to confirm)
- Cannot be undone
- Recommended to Archive instead of Delete in most cases

---

### 5. Project Visibility — Public vs Private

| | Public Project | Private Project |
|--|-------------|---------------|
| Who can see it | All workspace members | Only invited members |
| Default access for new workspace members | View | No access |
| Shown in sidebar for non-members | Yes (read-only) | No (invisible) |
| Owner / Admin visibility | Always | Always |

---

### 6. Project Members & Permissions

Each Project has its own member list with a permission level per user.

**Permission Levels:**

| Permission | Create Task | Edit Task | Delete Task | Create List | Delete List | Create Sprint | Manage Project Members | Comment |
|------------|-------------|-----------|-------------|-------------|-------------|---------------|----------------------|---------|
| Full Access | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Edit | Yes | Yes | No | No | No | No | No | Yes |
| View | No | No | No | No | No | No | No | Yes |

**Managing Project Members:**
- Members with **Full Access** can invite users to the Project and set their permission level
- Admin and Owner can always manage Project members regardless of their Project permission
- A user's Project permission overrides their Workspace role within that Project
  - Exception: Owner and Admin always have implicit Full Access everywhere

**Adding members to a Project:**
- Search for existing workspace members by name or email
- Select permission level (Full Access / Edit / View)
- Member immediately gains access — no email required (they are already in the workspace)
- Guests must be workspace members first before being added to a Project

---

### 7. Project Notifications Settings

Each member can configure notification preferences per Project:

- **All activity** — notify on every task update, comment, status change
- **Only @mentions** — notify only when directly mentioned
- **None** — mute this Project entirely

Settings are per-user, per-Project. Does not affect other members.

---

### 8. Project Sidebar & Navigation

- All Projects a user has access to appear in the left sidebar under the Workspace
- Projects are grouped: Public Projects first, then Private Projects (marked with a lock icon)
- User can reorder Projects in their sidebar (personal preference, not global)
- Collapsed/expanded state of each Project persists per user
- Each Project in the sidebar expands to show its Lists and Sprints

---

## Project Member States

| State | Description |
|-------|-------------|
| Active | Member has access to this Project with an assigned permission level |
| Removed | Member was removed from the Project; can no longer access it |

---

## Data Model

```
Space
+-- id                  (uuid, primary key)
+-- workspace_id        (foreign key -> Workspace)
+-- name                (string, required)
+-- color               (string — hex color code)
+-- icon                (string — emoji or icon identifier, nullable)
+-- is_private          (boolean, default: false)
+-- is_archived         (boolean, default: false)
+-- archived_at         (timestamp, nullable)
+-- created_by          (user_id, foreign key)
+-- created_at          (timestamp)
L-- updated_at          (timestamp)

SpaceMember
+-- id                  (uuid, primary key)
+-- space_id            (foreign key -> Space)
+-- user_id             (foreign key -> User)
+-- permission          (enum: full_access | edit | view)
+-- added_by            (user_id, foreign key)
L-- created_at          (timestamp)
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
| Project sidebar list | Sidebar (global) | All workspace members |
| Project home (lists + sprints) | `/[workspaceId]/[spaceId]` | Project member |
| Project Settings — General | `/[workspaceId]/[spaceId]/settings/general` | Full Access / Admin+ |
| Project Settings — Members | `/[workspaceId]/[spaceId]/settings/members` | Full Access / Admin+ |
| Project Settings — Notifications | `/[workspaceId]/[spaceId]/settings/notifications` | Any Project member (own settings) |
| Create Project modal | Global (sidebar button) | Admin+ |

---

## Data Lifecycle

### Archive
- Archived Projects are hidden from the sidebar for all members.
- All Lists, Sprints, Tasks, Comments, and Attachments inside are preserved — fully searchable.
- No new Lists, Sprints, or Tasks can be created inside an archived Project.
- Archived Projects can be unarchived at any time — **no time limit**.
- Members retain their SpaceMember records and permissions during archival.
- If a Workspace is deleted, archived Projects are permanently deleted along with it.

### Soft Delete
- Project deletion is a **hard delete** — no soft delete or recovery period.
- Archive is the recommended alternative to deletion when you want to preserve history.

### Recovery Period
- **Archived Project:** Recoverable at any time — no expiry.
- **Deleted Project:** No recovery. Deletion is permanent and immediate.

### Permanent Deletion Rules
- Only **Admin and Owner** can permanently delete a Project.
- Requires confirmation (button click — no name-typing required, unlike Workspace).
- On deletion, the following are permanently removed in cascade:
  - All Sprints inside the Project (and all TaskSprint records)
  - All Lists inside the Project
  - All Tasks and Subtasks inside those Lists
  - All Checklists, ChecklistItems, TaskAttachments (DB + S3/R2 files)
  - All Comments (including soft-deleted tombstones)
  - All ActivityLog entries for tasks in this Project
  - All SpaceMember records
  - All Notifications referencing tasks or sprints in this Project
  - All SavedFilters and UserListViewPreferences scoped to Lists in this Project
- The Space record itself is deleted — no tombstone.

---

## Business Rules

1. A Project always belongs to exactly one Workspace.
2. Owner and Admin always have implicit Full Access on all Projects, including Private ones.
3. A Private Project is completely invisible (not even its name) to users who are not members of it.
4. When a Project is made Public, workspace Members get View access by default unless explicitly given a higher permission.
5. When a Project is made Private, all non-explicitly-listed members immediately lose access.
6. Archiving a Project does not delete data — it only locks new work and hides it from the sidebar.
7. A deleted Project cannot be recovered.
8. A user can only be added to a Project if they are already a member of the parent Workspace.
9. Removing a member from a Project does not remove them from the Workspace.
10. Project permission always takes precedence over Workspace role within that Project (except Owner and Admin who always have Full Access).
11. A Project can contain multiple Lists and multiple Sprints — both are direct children of the Project.

---

## Implementation Notes

### Required Drizzle Indexes on SpaceMember

Every Private Space query filters by `(spaceId, userId)`. Without an index, this becomes a full table scan as SpaceMember grows.

In `db/schema/space.ts`:

```ts
// spaceMember table index config (third argument to pgTable)
uniqueIndex("space_member_space_user_idx").on(t.spaceId, t.userId)
// one record per user per space — the unique index also enforces no duplicate memberships
```

The `uniqueIndex` on `(spaceId, userId)` doubles as an index and enforces no duplicate memberships. Add a separate index on `userId` for `getAccessibleSpaceIds` lookups if needed at scale.

### `getAccessibleSpaceIds` -- The Core Privacy Enforcement Query

This function is called by search, My Tasks, notification scoping, and any cross-space query. It must be defined once and used everywhere -- never inlined differently per feature.

```typescript
// src/lib/permissions.ts

export async function getAccessibleSpaceIds(
  userId: string,
  workspaceId: string
): Promise<string[]> {
  // Owner and Admin can access all spaces
  const [member] = await db
    .select()
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))

  if (!member) return []

  if (member.role === 'OWNER' || member.role === 'ADMIN') {
    const all = await db
      .select({ id: space.id })
      .from(space)
      .where(and(eq(space.workspaceId, workspaceId), eq(space.isArchived, false)))
    return all.map(s => s.id)
  }

  // Members: public spaces + private spaces they are explicitly in
  const publicSpaces = await db
    .select({ id: space.id })
    .from(space)
    .where(and(eq(space.workspaceId, workspaceId), eq(space.isArchived, false), eq(space.isPrivate, false)))

  const privateSpaces = await db
    .select({ id: spaceMember.spaceId })
    .from(spaceMember)
    .innerJoin(space, eq(spaceMember.spaceId, space.id))
    .where(and(
      eq(spaceMember.userId, userId),
      eq(space.workspaceId, workspaceId),
      eq(space.isArchived, false),
      eq(space.isPrivate, true)
    ))

  return [...new Set([...publicSpaces.map(s => s.id), ...privateSpaces.map(s => s.id)])]
}
```

**Guests** have no implicit access to any space. For guests, the `isPrivate: false` branch still applies BUT a separate guest check is needed -- public spaces default to View for Members, but Guests only see spaces they are explicitly added to:

```typescript
  // For guests: only spaces they are explicitly a member of
  if (member.role === 'GUEST') {
    const memberships = await db
      .select({ spaceId: spaceMember.spaceId })
      .from(spaceMember)
      .innerJoin(space, eq(spaceMember.spaceId, space.id))
      .where(and(
        eq(spaceMember.userId, userId),
        eq(space.workspaceId, workspaceId),
        eq(space.isArchived, false)
      ))
    return memberships.map(m => m.spaceId)
  }
```

### Public -> Private Toggle Enforcement

When `isPrivate` is toggled on a Space, no SpaceMember records are deleted. Access is enforced purely at query time via `getAccessibleSpaceIds`. Non-members simply stop receiving the space in their results immediately -- no data migration needed.

```typescript
// PATCH /api/spaces/:id -- visibility toggle
await db.update(space).set({ isPrivate: true }).where(eq(space.id, spaceId))
// No SpaceMember cleanup needed -- query layer handles exclusion automatically
```

---

## Out of Scope (MVP)

- Project-level templates (pre-built Projects with Lists and tasks)
- Project duplication / copy
- Project-level analytics and reporting
- Public Projects visible outside the workspace (external sharing)
- Project-level custom fields
