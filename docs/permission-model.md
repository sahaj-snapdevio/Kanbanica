# Permission Model

## Overview

Teamority uses a **two-level permission system**:

1. **Workspace Role** — controls what a user can do at the workspace level
2. **Space Permission** — controls what a user can do inside a specific Space

Everything below a Space (Lists, Tasks, Subtasks) inherits from the Space Permission. There are no separate permission settings for Lists, Tasks, or Subtasks.

This keeps the model simple to understand, easy to manage, and straightforward to implement.

---

## Permission Hierarchy

```
Workspace Role          →  governs workspace-level actions (members, settings, spaces)
  └── Space Permission  →  governs everything inside a Space (lists, tasks)
        └── List        →  inherits Space Permission (no override)
              └── Task  →  inherits Space Permission (no override)
                    └── Subtask  →  inherits Space Permission (no override)
```

**Key rule:** A user's effective permission on a task = their Space Permission on the Space that contains that task.

**Exception:** Owner and Admin always have implicit Full Access everywhere, regardless of what Space Permission they are assigned.

---

## Level 1 — Workspace Roles

Every user in a Workspace has exactly one Workspace Role. The role controls workspace-level administration only — it does not directly grant access to work inside Spaces.

### Roles

| Role | Description |
|------|-------------|
| **Owner** | Full control over the workspace. Can manage everything including deleting the workspace and transferring ownership. Only one Owner per workspace. |
| **Admin** | Can manage all members, create and delete Spaces, and access all workspace settings. Cannot delete the workspace. |
| **Member** | Standard user. Can work inside Spaces they are given access to. Cannot manage workspace-level settings. |
| **Guest** | External collaborator. Can only access Spaces they are explicitly invited to. Invisible to them: all other Spaces, workspace settings, and member lists. |

### Workspace Role — Capability Matrix

| Action | Owner | Admin | Member | Guest |
|--------|:-----:|:-----:|:------:|:-----:|
| Delete Workspace | ✅ | ❌ | ❌ | ❌ |
| Transfer Ownership | ✅ | ❌ | ❌ | ❌ |
| Manage Billing | ✅ | ❌ | ❌ | ❌ |
| View Workspace Settings | ✅ | ✅ | ❌ | ❌ |
| Invite Members to Workspace | ✅ | ✅ | ❌ | ❌ |
| Manage All Members (view, change role, remove) | ✅ | ✅ | ❌ | ❌ |
| Create Space | ✅ | ✅ | ❌ | ❌ |
| Delete Space | ✅ | ✅ | ❌ | ❌ |
| View All Public Spaces | ✅ | ✅ | ✅ | ❌ |
| View Private Spaces (all) | ✅ | ✅ | ❌ | ❌ |
| Access Spaces they are invited to | ✅ | ✅ | ✅ | ✅ |
| View member list of workspace | ✅ | ✅ | ✅ | ❌ |

### Role change rules

| Who can change | Owner | Admin | Member | Guest |
|----------------|-------|-------|--------|-------|
| **Owner** | Transfer only (becomes Admin after) | ✅ | ✅ | ✅ |
| **Admin** | ❌ | ❌ | ✅ | ✅ |
| **Member** | ❌ | ❌ | ❌ | ❌ |
| **Guest** | ❌ | ❌ | ❌ | ❌ |

- There must always be exactly one Owner — ownership cannot be removed, only transferred
- An Owner cannot be demoted directly — they must first transfer ownership to another user

---

## Level 2 — Space Permissions

Each user gets a Space Permission level when added to a Space. This controls everything they can do inside that Space — Lists, Tasks, Subtasks, Comments.

### Permission Levels

| Permission | Description |
|-----------|-------------|
| **Full Access** | Complete control — create, edit, delete tasks and lists. Manage Space members and settings. |
| **Edit** | Can create and edit tasks, comments, subtasks. Cannot delete tasks or manage Space structure (lists, members). |
| **View** | Read-only. Can view all tasks and comment. Cannot create, edit, or delete anything. |

### Default Space Permission for new members

| How user is added | Default Space Permission |
|------------------|--------------------------|
| Added explicitly by Full Access / Admin (Member role) | Set by the person adding them (Full Access / Edit / View) |
| Added explicitly by Full Access / Admin (Guest role) | Set by the person adding them — **Edit or View only** (Full Access blocked) |
| Public Space — workspace Member joins | View |
| Admin added to a Space | Full Access |
| Owner accessing any Space | Full Access (implicit, always) |

---

## Space Permission — Full Capability Matrix

### Space & Structure Management

| Action | Full Access | Edit | View |
|--------|:-----------:|:----:|:----:|
| View Space content (lists, tasks) | ✅ | ✅ | ✅ |
| Edit Space settings (name, color, icon) | ✅ | ❌ | ❌ |
| Change Space visibility (public ↔ private) | ✅ | ❌ | ❌ |
| Archive Space | ✅ | ❌ | ❌ |
| Delete Space | ❌ (Admin+ only) | ❌ | ❌ |
| Manage Space Members (add, change permission, remove) | ✅ | ❌ | ❌ |
| Create List | ✅ | ❌ | ❌ |
| Edit List (name, color, description) | ✅ | ❌ | ❌ |
| Customize List statuses | ✅ | ❌ | ❌ |
| Archive / Delete List | ✅ | ❌ | ❌ |
| Move List to another Space | ✅ | ❌ | ❌ |
| Duplicate List | ✅ | ❌ | ❌ |

### Task & Subtask Actions

| Action | Full Access | Edit | View |
|--------|:-----------:|:----:|:----:|
| View tasks and subtasks | ✅ | ✅ | ✅ |
| Create Task | ✅ | ✅ | ❌ |
| Edit Task title & description | ✅ | ✅ | ❌ |
| Change Task status | ✅ | ✅ | ❌ |
| Set / change Task priority | ✅ | ✅ | ❌ |
| Assign / unassign users on a Task | ✅ | ✅ | ❌ |
| Set / change Due Date | ✅ | ✅ | ❌ |
| Add / edit Tags | ✅ | ✅ | ❌ |
| Add / manage Checklists | ✅ | ✅ | ❌ |
| Upload Attachments | ✅ | ✅ | ❌ |
| Delete own Attachment | ✅ | ✅ | ❌ |
| Delete others' Attachment | ✅ | ❌ | ❌ |
| Add / remove Dependencies | ✅ | ✅ | ❌ |
| Create Subtask | ✅ | ✅ | ❌ |
| Log time on Task | ✅ | ✅ | ❌ |
| Archive Task | ✅ | ❌ | ❌ |
| Delete Task | ✅ | ❌ | ❌ |
| Move Task to another List | ✅ | ❌ | ❌ |
| Duplicate Task | ✅ | ✅ | ❌ |
| Copy Task link | ✅ | ✅ | ✅ |

### Collaboration Actions

| Action | Full Access | Edit | View |
|--------|:-----------:|:----:|:----:|
| View comments and activity | ✅ | ✅ | ✅ |
| Post a comment | ✅ | ✅ | ✅ |
| Reply to a comment | ✅ | ✅ | ✅ |
| Edit own comment | ✅ | ✅ | ✅ |
| Delete own comment | ✅ | ✅ | ✅ |
| Delete others' comment | ✅ | ❌ | ❌ |
| Resolve / unresolve a comment thread | ✅ | ✅ | ❌ |
| Add emoji reaction | ✅ | ✅ | ✅ |
| @mention users | ✅ | ✅ | ✅ |
| Watch / unwatch a Task | ✅ | ✅ | ✅ |

### Sprint Actions

| Action | Full Access | Edit | View |
|--------|:-----------:|:----:|:----:|
| View Sprints and Sprint progress | ✅ | ✅ | ✅ |
| Create Sprint | ✅ | ❌ | ❌ |
| Edit Sprint (name, goal, end date) | ✅ | ❌ | ❌ |
| Start Sprint | ✅ | ❌ | ❌ |
| Close Sprint | ✅ | ❌ | ❌ |
| Add / remove Tasks from Sprint | ✅ | ✅ | ❌ |
| Set Story Points | ✅ | ✅ | ❌ |
| Delete Planned Sprint | ✅ | ❌ | ❌ |

---

## How Workspace Role + Space Permission Work Together

A user's final capability on any item is determined by combining their Workspace Role with their Space Permission.

### Resolution order (highest wins)

```
1. Owner          → always Full Access everywhere, no Space Permission needed
2. Admin          → always Full Access everywhere, no Space Permission needed
3. Space Permission (Full Access / Edit / View) → applies for Member and Guest
```

### Practical examples

| User | Workspace Role | Space Permission (Engineering) | What they can do |
|------|---------------|-------------------------------|-----------------|
| Alice | Owner | — | Everything in all Spaces |
| Bob | Admin | — | Everything in all Spaces |
| Carol | Member | Full Access | Create, edit, delete tasks and lists in Engineering |
| Dave | Member | Edit | Create and edit tasks in Engineering, no delete |
| Eve | Member | View | Read and comment only in Engineering |
| Frank | Guest | Edit (invited) | Create and edit tasks in Engineering only — cannot see any other Space |
| Grace | Member | View (Marketing) + Edit (Engineering) | Read-only in Marketing, can work in Engineering |

---

## Guest — Special Behavior

Guests are the most restricted role. They are designed for external collaborators (clients, contractors, freelancers).

| Behavior | Detail |
|----------|--------|
| Workspace visibility | Cannot see workspace name, settings, or member list |
| Space visibility | Only sees Spaces they are explicitly invited to |
| Other Spaces | Do not appear in sidebar — completely invisible |
| Navigation | Can only navigate within their invited Spaces |
| Invitation | Must be invited to a Space by a Full Access member, Admin, or Owner |
| Space Permission | **Maximum permission level is `Edit`** — Guests cannot be assigned `Full Access` on any Space |

> **Why Guests cannot have Full Access:** Full Access includes `Manage Space Members (add, change permission, remove)`. A Guest cannot see the workspace member list, so they have no pool of users to add — creating a functional deadlock. More critically, a Guest with Full Access could invite other external users or remove internal members — a security privilege escalation risk. The server enforces this: any attempt to assign `full_access` to a `guest` role user is rejected with `403 Forbidden`.

---

## Private Spaces

Private Spaces add an extra visibility layer on top of Space Permissions.

| User type | Can see Private Space? |
|-----------|----------------------|
| Owner | Always — even if not a member |
| Admin | Always — even if not a member |
| Member — explicitly invited | Yes |
| Member — not invited | No — Space does not appear in sidebar at all |
| Guest — explicitly invited | Yes |
| Guest — not invited | No |

- Changing a Space from **Public → Private** immediately removes it from the sidebar of all Members who are not explicitly listed as Space members
- Changing a Space from **Private → Public** makes it visible to all workspace Members with default **View** permission

---

## Permission Checks — Implementation Reference

When checking permissions server-side on every API request:

```
function canPerformAction(user, action, entity):

  1. If user.workspaceRole == OWNER or ADMIN:
       → allow (Full Access everywhere)

  2. Get user's SpacePermission for the Space that contains entity

  3. If no SpacePermission found (user not a member of that Space):
       → deny

  4. If Space is Private and user has no SpacePermission:
       → deny (do not reveal the Space exists)

  5. Check action against SpacePermission capability matrix:
       → allow or deny accordingly

function canAssignSpacePermission(actor, targetUser, permission):

  1. If targetUser.workspaceRole == GUEST and permission == FULL_ACCESS:
       → deny with 403 — Guests cannot hold Full Access on any Space
       → message: "Guests can only be assigned Edit or View access"

  2. Otherwise proceed with normal permission checks
```

All permission checks happen **server-side on every request**. The frontend hides UI elements based on permissions as a UX convenience only — the backend is the source of truth.

---

## Data Model

```
WorkspaceMember
├── workspace_id        (foreign key → Workspace)
├── user_id             (foreign key → User)
├── role                (enum: owner | admin | member | guest)
└── ...

SpaceMember
├── space_id            (foreign key → Space)
├── user_id             (foreign key → User)
├── permission          (enum: full_access | edit | view)
└── ...
```

> Only two tables drive the entire permission system. No separate permission tables for List, Task, or Subtask.

---

## Business Rules

1. Every user in a Workspace has exactly one Workspace Role.
2. A Workspace must always have exactly one Owner — ownership cannot be removed, only transferred.
3. Owner and Admin always have Full Access on all Spaces — their Space Permission record is not checked.
4. A Guest cannot see any Space they are not explicitly invited to — not even the Space name.
5. A user not in any SpaceMember record for a Space has no access to it (even if it is Public — Public spaces default to View for workspace Members, but Guests get no access unless explicitly added).
6. Space Permission is the single source of truth for all actions within a Space — no task-level or list-level overrides exist in MVP.
7. Even a View-only user can be assigned to a Task and can comment — assignment and commenting are not gated by edit permission.
8. A View-only user being assigned to a task does not upgrade their permission — they still cannot edit the task.
9. All permission checks must be enforced server-side — frontend permission hiding is UX only, not security.
10. When a user is removed from a Workspace, all their SpaceMember records are also removed.
11. When a user is removed from a Space, they lose access immediately — their assigned tasks remain but they can no longer view or act on them.
12. Changing a Space from Public to Private immediately removes access for all Members who are not explicitly in SpaceMember for that Space.

---

## Out of Scope (MVP)

- Custom roles (defining a role with a custom set of permissions)
- Task-level permission overrides (e.g. making a task visible only to specific members)
- List-level permission overrides
- Time-limited access (guest access that expires after N days)
- Permission templates (preset combinations for common team structures)
- Read-only link sharing (sharing a task or list via a public URL without login)
