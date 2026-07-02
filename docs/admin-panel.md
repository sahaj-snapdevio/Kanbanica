# Admin Panel

> **Admin surfaces — canonical vs. legacy (audit note).**
> The codebase currently has **two** admin surfaces, and they are intertwined:
> - **`/orbit`** (`app/(orbit)/`) is the **canonical entry point** — admins are
>   redirected here after login (`app/post-auth/page.tsx`) and the in-app "Admin
>   Panel" button links here (`components/scaffold/app-shell.tsx`). It uses
>   session-based auth (`requireAdmin`, `lib/authz.ts`) and covers overview,
>   users, queues, and email.
> - **`/admin`** (`app/admin/`) holds most feature pages (workspaces, tickets,
>   help center, analytics, audit log), has its own **password-based** login
>   (`/admin/login`, used by `scripts/create-admin.ts`), and is reached via the
>   **shared** `AdminSidebar` that both surfaces render.
>
> Because the shared sidebar links to `/admin/*`, `/admin` has unique pages, and
> `/admin/login` provides password auth, **neither surface can be safely removed
> or redirected without breaking navigation or admin login.** Consolidating them
> is a deliberate refactor tracked as future work — do not delete either surface
> in the meantime. The spec below documents the `/admin` feature set.

## Overview

The Admin Panel is an internal tool for the Kanbanica platform operators (us) to monitor, manage, and support the SaaS platform. It is completely separate from the customer-facing app and is not accessible to any customer regardless of their Workspace Role.

**Who has access:** Platform operators only — defined by a separate `is_platform_admin` flag on the User record. Being a Workspace Owner does NOT grant Admin Panel access.

**Access URL:** `/admin` — protected route, separate auth check

---

## Sections

1. [Dashboard](#1-dashboard)
2. [User Management](#2-user-management)
3. [Workspace Management](#3-workspace-management)
4. [Support Tickets](#4-support-tickets)
5. [Analytics](#5-analytics)

---

## 1. Dashboard

The landing page of the Admin Panel. Shows a real-time health overview of the platform at a glance.

### Metrics — Top Stats Cards

| Metric | Description |
|--------|-------------|
| Total Users | All registered users (including banned) |
| Total Workspaces | All workspaces (including deleted — for audit) |
| Active Workspaces | Workspaces with at least one task created in the last 30 days |
| Total Tasks | All tasks across all workspaces |
| New Sign-ups Today | Users who registered today |
| New Sign-ups This Month | Users who registered this month |
| Open Support Tickets | Unresolved support tickets count |

### Charts

**Sign-up Trend (last 30 days):**
- Line chart — daily new user registrations
- X-axis: date, Y-axis: new users

**Active Workspaces Trend (last 30 days):**
- Line chart — workspaces that had at least one task update per day

**Workspace Activity Distribution:**
- Pie / donut chart — Active vs Inactive vs New (created in last 7 days) workspaces

### Recent Activity Feed

- Last 20 platform-level events:
  - New user registered
  - New workspace created
  - Support ticket opened
  - User banned / unbanned
  - Workspace deleted
- Each entry: timestamp, event type, actor (user email), affected entity

---

## 2. User Management

View and manage all registered users across the platform.

### User List

- Paginated table of all users (50 per page)
- Columns: Avatar, Name, Email, Status, Plan (via workspace), Joined Date, Last Active
- Default sort: newest first (Joined Date descending)

**Search:**
- Search by name or email (real-time, minimum 2 characters)

**Filters:**
- Status: All / Active / Banned
- Join date range: custom date picker
- Last active: Last 7 days / Last 30 days / Over 30 days inactive / Never active

### User Detail Page

Clicking a user opens their detail page showing:

**Profile section:**
- Avatar, name, email, join date, last active timestamp
- Email verified status (Yes / No)
- Platform admin flag (Yes / No)

**Workspaces section:**
- List of all workspaces the user belongs to
- Columns: Workspace name, Role in that workspace, Joined workspace date
- Click workspace name -> navigate to that workspace's detail page in Admin Panel

**Session section:**
- List of active sessions (device, browser, last used, IP address)
- Revoke individual session button
- Revoke all sessions button

**Actions:**

| Action | Description |
|--------|-------------|
| Ban User | Immediately invalidates all sessions. User cannot log in. Existing data is preserved. |
| Unban User | Restores login access. |
| Impersonate User | Log in as this user to reproduce issues. Opens a new browser tab with their session. Impersonation is logged. |
| Reset Password | Send a password reset email to the user. |
| Verify Email (manual) | Mark email as verified manually (for support cases). |
| Grant Platform Admin | Give this user access to the Admin Panel. Use with extreme caution. |
| Revoke Platform Admin | Remove Admin Panel access. |

**Impersonation notice:**
- When impersonating, a red banner is shown at the top of the customer app: `"You are viewing as [user name]. Exit impersonation"`
- All actions taken while impersonating are logged with `impersonated_by: admin_user_id`
- Impersonating admins cannot change passwords or delete the workspace while in impersonation mode

---

## 3. Workspace Management

View and manage all workspaces on the platform.

### Workspace List

- Paginated table of all workspaces (50 per page)
- Columns: Name, Owner email, Members count, Created Date, Last Active, Status
- Default sort: newest first

**Search:**
- Search by workspace name or owner email

**Filters:**
- Status: Active / Inactive / Deleted
- Created date range

### Workspace Detail Page

Clicking a workspace opens its detail page:

**Overview section:**
- Workspace name, logo, URL slug
- Created date, last active date
- Owner name + email

**Members section:**
- List of all members: name, email, workspace role, join date
- Total member count

**Usage stats section:**
- Total Spaces, Lists, Tasks, Comments, Attachments
- Storage used (total file size of attachments)
- Sprint count

**Actions:**

| Action | Description |
|--------|-------------|
| Impersonate Owner | Log in as the workspace Owner (same impersonation flow as User Management) |
| Force Delete Workspace | Permanently delete the workspace and all its data. Requires typing the workspace name to confirm. Cannot be undone. |
| Send Email to Owner | Open a pre-filled email draft to the workspace owner (opens email client) |

**Force Delete:**
- Only available to platform admins
- Deletes: all Spaces, Lists, Tasks, Subtasks, Comments, Attachments, Members, Sprints
- Sends an email to the workspace Owner notifying them of the deletion
- Logged in platform audit log with admin user, reason (optional text field), and timestamp

---

## 4. Support Tickets

View and respond to support tickets submitted by customers from within the app.

### Ticket List

- Paginated table of all tickets
- Columns: Ticket ID, Subject, Category, Status, Submitted by, Workspace, Created Date, Last Updated
- Default sort: newest first

**Search:**
- Search by ticket subject or user email

**Filters:**
- Status: Open / In Progress / Resolved / All
- Category: Bug / Question
- Date range: Created / Last updated

**Quick stats at top:**
- Open tickets count
- In Progress tickets count
- Avg response time (last 30 days)

### Ticket Detail Page

- **Ticket info:** ID, category, status, submitted by (name + email), workspace, created date
- **Subject + original message** (read-only)
- **Reply thread:** chronological exchange between customer and admin
- **Internal notes:** admin-only notes not visible to the customer (marked with a different background color)

**Reply composer:**
- Rich text editor (bold, lists, links, code block)
- Toggle: `Reply to customer` / `Internal note`
- Send reply -> changes ticket status to In Progress automatically (if it was Open)

**Status management:**
- Change status manually: Open / In Progress / Resolved
- Resolving a ticket sends the customer a notification: `"Your ticket #1234 has been resolved"`
- Resolved tickets can be reopened if the customer replies

**Assign ticket:**
- Assign a ticket to a specific platform admin for ownership
- Assigned admin is notified

### Ticket Notifications (internal)

- New ticket submitted -> all platform admins receive an in-app notification
- Customer replies to a resolved/in-progress ticket -> assigned admin notified

---

## 5. Analytics

Platform-level usage metrics to understand how the product is being used.

### Feature Usage

| Metric | Description |
|--------|-------------|
| Tasks created per day | Line chart — last 30 days |
| Comments posted per day | Line chart — last 30 days |
| Spaces created per day | Bar chart — last 30 days |
| Sprints created | Total count + active sprints |
| Attachments uploaded | Total count + total storage size |
| Search queries per day | Line chart — last 30 days |

### User Engagement

| Metric | Description |
|--------|-------------|
| DAU (Daily Active Users) | Users with at least one action in the last 24 hours |
| WAU (Weekly Active Users) | Last 7 days |
| MAU (Monthly Active Users) | Last 30 days |
| DAU / MAU ratio | Stickiness metric |
| Avg tasks per active workspace | Mean tasks created per workspace that had activity |

### Error Monitoring

- Count of 4xx and 5xx API errors per day (line chart)
- Top 10 most frequent error types (table: endpoint, error code, count, last occurred)
- Clicking an error -> shows recent log entries for that error

### Data export

- All analytics tables can be exported as CSV
- Date range picker for all reports (default: last 30 days)

---

## Admin Panel — Access Control

| Feature | Access |
|---------|--------|
| View Dashboard | Platform Admin |
| View / search users | Platform Admin |
| Ban / unban users | Platform Admin |
| Impersonate users | Platform Admin |
| Grant / revoke Platform Admin | Platform Admin (senior — separate flag `is_super_admin` for MVP can be hardcoded) |
| View / manage workspaces | Platform Admin |
| Force delete workspace | Platform Admin |
| View / reply to support tickets | Platform Admin |
| View analytics | Platform Admin |

---

## Data Model

```
-- Platform admin flag lives on User table
User
+-- ...
+-- is_platform_admin   (boolean, default: false)
L-- ...

SupportTicket
+-- id                  (uuid, primary key)
+-- workspace_id        (foreign key -> Workspace, nullable)
+-- submitted_by        (foreign key -> User)
+-- assigned_to         (foreign key -> User — platform admin, nullable)
+-- subject             (string, required)
+-- category            (enum: bug | question)
+-- status              (enum: open | in_progress | resolved)
+-- created_at          (timestamp)
L-- updated_at          (timestamp)

SupportTicketMessage
+-- id                  (uuid, primary key)
+-- ticket_id           (foreign key -> SupportTicket)
+-- author_id           (foreign key -> User)
+-- body                (text — rich text)
+-- is_internal_note    (boolean, default: false)
L-- created_at          (timestamp)

PlatformAuditLog
+-- id                  (uuid, primary key)
+-- admin_id            (foreign key -> User — platform admin who performed action)
+-- action              (string — e.g. user_banned, workspace_deleted, impersonation_started)
+-- target_type         (enum: user | workspace | ticket)
+-- target_id           (uuid)
+-- meta                (json — additional context e.g. reason, old value, new value)
L-- created_at          (timestamp)
```

---

## API Endpoints

All admin endpoints are prefixed with `/api/admin/` and require `is_platform_admin = true` on the authenticated user. Any request from a non-admin is rejected with `403 Forbidden`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/dashboard` | Get dashboard metrics and recent activity |
| GET | `/api/admin/users` | List all users (paginated, filterable) |
| GET | `/api/admin/users/:id` | Get user detail |
| POST | `/api/admin/users/:id/ban` | Ban a user |
| POST | `/api/admin/users/:id/unban` | Unban a user |
| POST | `/api/admin/users/:id/impersonate` | Start impersonation session |
| POST | `/api/admin/users/:id/reset-password` | Send password reset email |
| POST | `/api/admin/users/:id/verify-email` | Manually verify user's email |
| GET | `/api/admin/workspaces` | List all workspaces (paginated, filterable) |
| GET | `/api/admin/workspaces/:id` | Get workspace detail and usage stats |
| DELETE | `/api/admin/workspaces/:id` | Force delete workspace |
| POST | `/api/admin/workspaces/:id/impersonate-owner` | Impersonate workspace owner |
| GET | `/api/admin/tickets` | List all support tickets (paginated, filterable) |
| GET | `/api/admin/tickets/:id` | Get ticket detail and message thread |
| POST | `/api/admin/tickets/:id/messages` | Reply to ticket or add internal note |
| PATCH | `/api/admin/tickets/:id/status` | Change ticket status |
| PATCH | `/api/admin/tickets/:id/assign` | Assign ticket to a platform admin |
| GET | `/api/admin/analytics/feature-usage` | Get feature usage metrics |
| GET | `/api/admin/analytics/engagement` | Get DAU / WAU / MAU metrics |
| GET | `/api/admin/analytics/errors` | Get error monitoring data |
| GET | `/api/admin/audit-log` | Get platform audit log |

---

## UI Screens

| Screen | Route |
|--------|-------|
| Dashboard | `/admin` |
| User List | `/admin/users` |
| User Detail | `/admin/users/:id` |
| Workspace List | `/admin/workspaces` |
| Workspace Detail | `/admin/workspaces/:id` |
| Support Tickets List | `/admin/tickets` |
| Ticket Detail | `/admin/tickets/:id` |
| Analytics | `/admin/analytics` |
| Audit Log | `/admin/audit-log` |

---

## Data Lifecycle

### PlatformAuditLog
- Audit log entries are **immutable and permanent** — never deleted, never soft-deleted.
- Even if a Workspace or User is deleted, their audit log entries are retained forever.
- This is the only table that survives Workspace and User deletion for compliance purposes.

### Workspace Force Delete (Admin action)
- Hard delete — same cascade rules as Owner-initiated workspace deletion.
- Sends notification email to workspace Owner before deletion.
- The deletion event itself is recorded in `PlatformAuditLog` before the workspace data is removed.
- No recovery period — immediate and permanent.

### User Ban / Unban
- **Ban:** Soft disable — User record stays intact, `banned = true`. All sessions revoked. User data preserved.
- **Unban:** Soft re-enable — `banned = false`. User can log in again. No data loss.
- Banning is **not** deletion — all workspace memberships, tasks, and comments are preserved.

### Impersonation Sessions
- Impersonation creates a temporary Session record with `impersonated_by` set to the admin's user ID.
- Impersonation sessions auto-expire after **1 hour** of inactivity.
- When the admin exits impersonation, the impersonated session is immediately hard-deleted.
- The `PlatformAuditLog` entry for the impersonation start is **never deleted**.

### Support Ticket Messages (Admin)
- Internal notes (`is_internal_note = true`) are never exposed to customers — no delete needed for security.
- Admin replies and internal notes are retained for as long as the Support Ticket exists.
- No individual message deletion in MVP (post-MVP: admin can redact a message).

---

## Business Rules

1. Admin Panel access is controlled by `is_platform_admin` flag on the User table — no customer role grants access.
2. Every destructive or sensitive admin action (ban, delete workspace, impersonation) is logged in `PlatformAuditLog` with actor, target, and timestamp.
3. Impersonation must be logged before the session is created — the log entry is written first.
4. While impersonating, the admin cannot perform irreversible actions: delete workspace, change password.
5. Impersonation sessions are time-limited — automatically expire after **1 hour** of inactivity.
6. Force deleting a workspace sends a notification email to the workspace Owner before deletion completes.
7. Internal notes on support tickets are never visible to the customer under any circumstance.
9. Resolving a support ticket automatically notifies the customer.
10. All admin API endpoints return `403 Forbidden` for non-platform-admin users — no information about the admin routes is exposed.

---

## Implementation Notes

### Impersonation Cleanup Job (Security-Critical)

Impersonation sessions auto-expire after 1 hour. This must be enforced by a background job -- the 1-hour rule has no effect without it.

```typescript
// src/lib/worker/job-types.ts
JOB_NAMES.IMPERSONATION_CLEANUP = "impersonation.cleanup"
QUEUE_OPTIONS[JOB_NAMES.IMPERSONATION_CLEANUP] = {
  retryLimit: 2,
}
```

**Cron schedule:** every 5 minutes

```typescript
// scripts/worker.ts
await boss.schedule(JOB_NAMES.IMPERSONATION_CLEANUP, '*/5 * * * *', {})
```

**Handler:**

```typescript
// src/lib/worker/handlers/impersonation-cleanup.ts

export async function handleImpersonationCleanup() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000)  // 1 hour ago

  // Better Auth stores impersonation sessions with impersonatedBy set.
  // Delete any impersonation session older than 1 hour.
  const expired = await db.session.findMany({
    where: {
      impersonatedBy: { not: null },
      createdAt: { lt: cutoff }
    },
    select: { id: true, impersonatedBy: true, userId: true }
  })

  if (expired.length === 0) return

  await db.session.deleteMany({
    where: { id: { in: expired.map(s => s.id) } }
  })

  // Audit log each expired session
  await db.platformAuditLog.createMany({
    data: expired.map(s => ({
      action: 'impersonation_expired',
      actorId: s.impersonatedBy!,
      targetUserId: s.userId,
      meta: { reason: 'auto_expired_1h' }
    }))
  })
}
```

**Idempotency:** safe to run multiple times -- `deleteMany` on already-deleted sessions is a no-op.

**Note on `impersonatedBy` field:** Better Auth's Admin Plugin adds this field to the Session model. Confirm the exact field name against the installed version of `better-auth` -- it may be `impersonatorId` depending on the plugin version. Check `node_modules/better-auth` types at setup time.

---

## Out of Scope (MVP)

- Role-based access within the Admin Panel (e.g. Support agent vs regular admin)
- Bulk user operations (bulk ban, bulk export)
- Advanced analytics (cohort analysis, funnel, retention curves)
- Customer-facing status page (uptime monitoring)
- Automated fraud detection
