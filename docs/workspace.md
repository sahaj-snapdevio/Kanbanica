# Workspace

## Overview

Workspace is the top-level container in Kanbanica. Every user belongs to at least one Workspace. All Spaces, members, and settings live inside a Workspace.

**Real-world analogy:** A Workspace = your company or organization. e.g. `Acme Inc`, `Freelance Studio`, `My Team`

---

## User Stories

- As a new user, I want to create a Workspace during onboarding so I can start organizing my work immediately.
- As an Owner, I want to invite teammates via email or a shareable link so they can join quickly.
- As an Admin, I want to manage member roles so I can control who can do what.
- As a Member, I want to switch between multiple Workspaces I belong to.
- As an Owner, I want to transfer ownership to another Admin in case I leave.
- As an Owner, I want to delete the Workspace when it is no longer needed.

---

## Features

### 1. Create Workspace

- Triggered on first sign-up (onboarding flow) or manually from the workspace switcher
- Required fields:
  - Workspace Name (required)
  - Workspace Logo / Avatar (optional, upload image or pick emoji)
- On creation:
  - Creator is automatically assigned the **Owner** role
  - After workspace is created, onboarding guides the user to create their **first Space manually** (name + color step)
  - No Space is auto-created — every Space should have a meaningful name from day one
  - Once the first Space is created, a default List named **"List"** is auto-created inside it so the user can start adding tasks immediately

---

### 2. Edit Workspace

- Owner and Admin can edit:
  - Workspace Name
  - Workspace Logo / Avatar
  - Workspace URL slug (vanity alias — changing it never breaks existing links)
- Changes take effect immediately for all members

---

### 3. Delete Workspace

- Only **Owner** can delete a Workspace
- Requires confirmation (type workspace name to confirm)
- Cannot be undone
- **Deletion is asynchronous** — the API returns immediately with a `202 Accepted` response. The workspace is marked `status = deleting` and a background job handles the actual cascade deletion. See the Data Lifecycle section for details.

---

### 4. Switch Workspace

- A user can belong to multiple Workspaces
- Workspace switcher is accessible from the sidebar (top-left)
- Displays all workspaces the user is a member of
- One-click switch, no page reload required

---

### 5. Invite Members

**Via Email:**
- Owner / Admin can invite users by email address
- Invited user receives an email with a join link (valid for **7 days** — expires automatically)
- If the invite expires, Admin must re-send it
- Pending invites can be cancelled before acceptance

> **Reusable invite modal:** to invite from anywhere in the app (not just the Members settings page), use `components/workspace/invite-member-modal.tsx` (`<InviteMemberModal>`). Props: `open`, `onOpenChange`, `workspaceId`, and an `onInvited` callback so the caller can refresh its member list. It wraps the existing `inviteMember` server action — backend permissions/validation are unchanged — and validates the email format client-side before submitting, with a role select (Admin / Member / Guest).

**Pending Invite Visibility:**
- **Admin / Owner view (`Settings -> Members`):** A dedicated "Pending" section lists all outstanding invites — showing email, invited by, invited date, expiry date, and a Cancel button
- **Invited user view:** When an invited user logs in (or registers with the same email), they see a banner: `"You have a pending invite to join [Workspace Name]. [Accept] [Decline]"` — this ensures users who already have an account don't miss the invite

**Via Invite Link:**
- Generate a shareable invite link for the workspace
- Anyone with the link can join as a **Member** (default role)
- Link never expires by default — Admin can manually disable or regenerate it at any time
- Regenerating the link immediately invalidates the previous link

---

### 6. Manage Members

Accessible from **Workspace Settings -> Members**

- View all members (name, email, role, join date)
- Search / filter members by name or role
- Change a member's role (Owner can change any role; Admin can change Member / Guest only)
- Remove a member from the workspace
  - Their tasks (created by them) remain — reporter field is unchanged
  - Their `TaskAssignee` records are **preserved** — they are not auto-removed from task assignments
  - Their avatar appears greyed out on any task they were assigned to, with a tooltip: `"This user no longer has access to this workspace"`
  - Admins can manually clean up stale assignments from the task detail panel
- View pending invites in a separate "Pending" section — shows email, invited by, date sent, expiry date
- Cancel any pending invite before it is accepted

---

### 7. Roles & Permissions

| Role | Description |
|------|-------------|
| Owner | Full control — delete workspace, manage all members and settings. Only one Owner per workspace. |
| Admin | Manage members, create/delete spaces, access all settings. Cannot delete workspace. |
| Member | Standard user. Can work within spaces they have access to. Cannot manage workspace-level settings. |
| Guest | External collaborator. Can only access Spaces they are explicitly invited to. No workspace-level visibility. |

**Role change rules:**
- Only Owner can promote someone to Owner (transfers ownership)
- Admin can manage Member and Guest roles only
- An Owner cannot be removed — ownership must be transferred first

---

### 8. Transfer Ownership

- Only current Owner can initiate transfer
- Target user must already be a Member or Admin in the workspace
- After transfer:
  - Previous Owner becomes an Admin
  - New Owner gets full ownership privileges
- Requires email confirmation from the current Owner

---

### 9. Workspace Settings Page

Accessible by Owner and Admin only.

**General:**
- Edit name, logo, URL slug

**Members:**
- Invite, manage, remove members
- Manage pending invites

**Security:**
- Disable / regenerate invite link (regenerating immediately invalidates the old link)
- (Post-MVP) Force 2FA for all members

**Danger Zone:**
- Delete Workspace

---

## Workspace Member States

| State | Description |
|-------|-------------|
| Active | Member has accepted invite and has access |
| Invited | Invite email sent, not yet accepted |
| Removed | Member was removed, no longer has access |

---

## Data Model

```
Workspace
+-- id                  (uuid, primary key)
+-- name                (string, required)
+-- slug                (string, unique — vanity alias for URLs; routing uses id internally)
+-- logo_url            (string, nullable — R2 URL; takes priority over logo_emoji)
+-- logo_emoji          (string, nullable — single emoji character; used if logo_url is null)
+-- invite_link_token   (string, unique, nullable — null means link is disabled)
+-- task_seq            (integer, default: 0 — atomically incremented on each task creation, gives each task its #number)
+-- status              (enum: active | deleting, default: active — set to deleting on deletion confirm, background job does the rest)
+-- created_by          (user_id, foreign key)
+-- created_at          (timestamp)
L-- updated_at          (timestamp)

WorkspaceMember
+-- id                  (uuid, primary key)
+-- workspace_id        (foreign key -> Workspace)
+-- user_id             (foreign key -> User, nullable — null while invite is pending)
+-- email               (string, nullable — set while invite is pending, cleared on accept)
+-- role                (enum: owner | admin | member | guest)
+-- status              (enum: active | invited)
+-- invited_by          (user_id, nullable)
+-- invite_token        (string, unique, nullable — used in the email join link)
+-- invite_expires_at   (timestamp, nullable — 7 days from invite send date)
+-- joined_at           (timestamp, nullable)
L-- created_at          (timestamp)
```

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/workspaces` | Create a new workspace | Authenticated user |
| GET | `/api/workspaces` | List workspaces for current user | Authenticated user |
| GET | `/api/workspaces/:id` | Get workspace details | Member+ |
| PATCH | `/api/workspaces/:id` | Update workspace name / logo / slug | Admin+ |
| DELETE | `/api/workspaces/:id` | Delete workspace | Owner only |
| GET | `/api/workspaces/:id/members` | List all members | Member+ |
| POST | `/api/workspaces/:id/members/invite` | Invite by email | Admin+ |
| PATCH | `/api/workspaces/:id/members/:userId` | Change member role | Admin+ |
| DELETE | `/api/workspaces/:id/members/:userId` | Remove member | Admin+ |
| POST | `/api/workspaces/:id/invite-link` | Generate invite link | Admin+ |
| DELETE | `/api/workspaces/:id/invite-link` | Disable invite link | Admin+ |
| POST | `/api/workspaces/:id/transfer` | Transfer ownership | Owner only |

---

## UI Screens

| Screen | Route | Access |
|--------|-------|--------|
| Onboarding — Create Workspace | `/onboarding` | New user |
| Workspace Switcher | Sidebar (global) | All members |
| Workspace Settings — General | `/[workspaceId]/settings/general` | Admin+ |
| Workspace Settings — Members | `/[workspaceId]/settings/members` | Admin+ |
| Workspace Settings — Security | `/[workspaceId]/settings/security` | Owner only |
| Accept Invite | `/invite/:token` | Invited user |

---

## Data Lifecycle

### Archive
- Workspaces cannot be archived — only deleted or kept active.
- Individual Spaces, Folders, Lists, and Tasks within the workspace can be archived independently.

### Soft Delete / Async Deletion Pattern

Workspace deletion is **not synchronous** — a large workspace can contain thousands of tasks and attachments. Deleting everything in a single API request would exceed serverless execution timeouts (Vercel default: 15s) and risk orphaning files in R2 if the DB deletion succeeds but the R2 call fails.

**Deletion flow:**
1. Owner confirms deletion (types workspace name)
2. API call: workspace `status` is set to `deleting` — returns `202 Accepted` immediately
3. The workspace is immediately hidden from all members' workspace switchers
4. A background job (cron) picks up all workspaces with `status = deleting` and performs the full cascade:
   - Delete R2 files in chunks (attachments, avatars) — retries on failure
   - Delete DB child records in dependency order (TaskAttachment -> Task -> List -> Space -> Workspace)
5. On completion: send confirmation email to Owner

**Why this matters:** If R2 deletion runs before DB deletion and the job crashes, file references still exist in DB — recoverable. If DB deletes first and R2 crashes, files are orphaned forever — expensive and unrecoverable. Always delete storage last.

### Recovery Period
- There is **no recovery period** for a deleted Workspace.
- Once the Owner confirms, deletion begins immediately and cannot be stopped.
- **Best practice before deleting:** Advise users to export any important data manually. (Data export is a post-MVP feature.)

### Permanent Deletion Rules
- Only the **Owner** can delete a Workspace.
- Requires typing the Workspace name to confirm — prevents accidental deletion.
- Workspace `status` is set to `deleting` on confirm — the background job then permanently removes in cascade:
  - All Spaces (public and private)
  - All Lists, ListStatuses
  - All Tasks, Subtasks, Checklists, ChecklistItems
  - All Comments (including soft-deleted comment tombstones)
  - All Attachments — **R2 files deleted before DB records**
  - All ActivityLog entries
  - All Notifications scoped to this workspace
  - All SpaceMember, WorkspaceMember records
  - All SavedFilters, UserListViewPreferences scoped to this workspace
  - All Sprints and TaskSprint records
- The Workspace record itself is deleted last.
- A confirmation email is sent to the Owner after the background job completes.
- The deletion event is logged in `PlatformAuditLog` (platform-level — survives workspace deletion).

---

## Business Rules

1. Every user must belong to at least one Workspace after onboarding.
2. A Workspace must always have exactly one Owner.
3. Ownership cannot be removed — only transferred.
4. Deleting a Workspace is irreversible and requires explicit confirmation.
5. A Guest cannot see any Space unless explicitly invited to it.
6. Removing a member does not delete their created tasks — it only revokes access.
7. Invite links default to granting the **Member** role.
8. Workspace URL slug must be unique across the platform — it is a vanity alias only. All routes use the workspace `id` internally, so renaming the slug never breaks existing links or bookmarks.

---

## Out of Scope (MVP)

- Billing / subscription management
- Workspace-level 2FA enforcement
- SSO / SAML
- Audit log export
- Custom domain for workspace

---

## Implementation Notes

### Async Deletion Job Spec

The `DELETE /api/workspaces/:id` handler must:
1. Verify requester is the workspace Owner
2. Require confirmation token (workspace name match) in the request body
3. Set `workspace.status = 'deleting'` inside a DB transaction
4. Enqueue the deletion job **inside the same transaction** (so job payload is consistent with DB state)
5. Return `202 Accepted` with `{ status: "deleting" }`

```typescript
// src/lib/worker/job-types.ts
JOB_NAMES.WORKSPACE_DELETE = "workspace.delete"

interface WorkspaceDeletePayload {
  workspaceId: string
  requestedBy: string   // userId of the Owner who triggered it
  requestedAt: string   // ISO timestamp
}
```

**Queue options for this job:**
```typescript
QUEUE_OPTIONS[JOB_NAMES.WORKSPACE_DELETE] = {
  retryLimit: 3,
  retryDelay: 60,       // seconds between retries
  retryBackoff: true,
  singletonKey: (payload) => payload.workspaceId,  // prevents duplicate jobs
}
```

**Handler** (`src/lib/worker/handlers/workspace-delete.ts`):
1. Fetch workspace by `workspaceId` -- if `status !== 'deleting'`, log warning and return (idempotency guard)
2. Delete R2 files first (attachments, avatars) in batches of 50 using `@aws-sdk/client-s3` `DeleteObjectsCommand`
3. Delete DB records in dependency order inside `db.$transaction()`:
   - `TaskAttachment`, `TaskTimeLog`, `TaskWatcher`, `TaskAssignee`, `TaskTag`, `TaskDependency`
   - `ChecklistItem`, `Checklist`
   - `Comment`, `CommentReaction`
   - `ActivityLog`, `Notification`
   - `Task` (all, including subtasks -- cascade handles child order)
   - `ListStatus`, `List`
   - `SpaceMember`, `Space`
   - `WorkspaceMember`, `SavedFilter`, `UserListViewPreference`
   - `Sprint`, `TaskSprint`
   - `Workspace` (last)
4. Write `PlatformAuditLog` entry: `{ action: 'workspace.deleted', workspaceId, actorId: requestedBy }`
5. Send confirmation email to Owner via `src/lib/email/workspace-deleted.tsx`

**Why R2 before DB:** If the job crashes after R2 deletes but before DB deletes, the DB still has references and the job can be retried (R2 keys that no longer exist will return 404, which is safe to ignore on retry). If DB deletes first and R2 crashes, files are permanently orphaned.

### `taskSeq` Atomic Increment

When creating a Task, increment `Workspace.taskSeq` atomically inside the task creation transaction:

```typescript
// Inside db.$transaction()
const workspace = await tx.$executeRaw`
  UPDATE "Workspace"
  SET task_seq = task_seq + 1
  WHERE id = ${workspaceId}
  RETURNING task_seq
`
// Use returned task_seq as the new task's seq_number
```

Never read `task_seq` and then write `task_seq + 1` as two separate operations -- this causes duplicate numbers under concurrent task creation.

### Invite Token Lifecycle

- `invite_token` on `WorkspaceMember` is a `uuid` generated at invite time
- On accept: clear `invite_token`, set `user_id`, set `status = active`, set `joined_at`
- On expiry check: `invite_expires_at < NOW()` -- expired tokens are rejected at accept time
- On cancel: hard-delete the `WorkspaceMember` record (invite was never accepted)
- Never reuse tokens -- generate a fresh uuid on every re-invite

### Folder Mapping

```
src/
  app/
    (app)/[workspaceId]/
      settings/
        general/page.tsx      <- name, logo, slug
        members/page.tsx      <- members + pending invites
        security/page.tsx     <- invite link management
    api/
      workspaces/
        route.ts              <- POST (create), GET (list)
        [id]/
          route.ts            <- GET, PATCH, DELETE
          members/
            route.ts          <- GET (list), POST (invite)
            [userId]/route.ts <- PATCH (role), DELETE (remove)
          invite-link/route.ts <- POST (generate), DELETE (disable)
          transfer/route.ts   <- POST (ownership transfer)
  lib/
    workspaces/
      workspaces.ts           <- createWorkspace, deleteWorkspace, inviteMember, etc.
  lib/worker/handlers/
    workspace-delete.ts
  lib/email/
    workspace-invite.tsx
    workspace-deleted.tsx
```
