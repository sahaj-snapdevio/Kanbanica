# Notifications

## Overview

Notifications keep team members informed about changes and activity that are relevant to them — without requiring them to constantly check the app. Notifications are contextual, actionable, and fully configurable per user.

**Three delivery channels:**
| Channel | Description |
|---------|-------------|
| In-App | Bell icon in the top nav — shown while using the app |
| Email | Sent to the user's registered email |
| Browser Push | Desktop browser push notification — shown even when app is not open |

---

## 1. Notification Triggers

Every event below creates a `Notification` record. Each trigger has:
- **Who gets notified** — the recipient set
- **Channels** — which delivery channels fire by default (In-App / Email / Push)
- **Configurable** — whether the user can turn it off in settings
- **Notification text** — the exact message shown in the panel and email subject

**Key rules that apply to all triggers:**
- The actor (person who caused the event) **never** receives a notification for their own action.
- If a user is both an Assignee and a Watcher, they receive **one** notification — no duplicates.
- If a task or Space is **muted** by the recipient, no notification is sent regardless of trigger.

---

### Task Notifications

> **Watcher pipeline:** "Watchers" in the table below refers to the `TaskWatcher` list on each task. Task creator and all assignees are auto-added as watchers. Any workspace member can manually watch/unwatch. For the full pipeline (auto-add rules, event list, delivery flow), see [collaboration.md — Watchers & Notification Pipeline](./collaboration.md#3-watchers--notification-pipeline).

| Trigger | Who gets notified | In-App | Email | Push | Configurable | Notification text |
|---------|------------------|:------:|:-----:|:----:|:------------|------------------|
| Task assigned to you | New assignee | [x] | [x] | [x] | Yes | *"[Actor] assigned you to [Task title]"* |
| Task unassigned from you | Former assignee | [x] | [x] | [ ] | Yes | *"[Actor] unassigned you from [Task title]"* |
| Task status changed | Assignees + Watchers | [x] | [x] | [ ] | Yes | *"[Actor] changed status of [Task title] to [New Status]"* |
| Task priority changed | Assignees + Watchers | [x] | [ ] | [ ] | Yes (default off) | *"[Actor] changed priority of [Task title] to [Priority]"* |
| Task due date changed | Assignees + Watchers | [x] | [x] | [ ] | Yes | *"[Actor] changed due date of [Task title] to [Date]"* |
| Task completed (status -> closed type) | Reporter + Watchers | [x] | [x] | [ ] | Yes | *"[Task title] was marked as done by [Actor]"* |
| Task moved to a different List | Assignees + Watchers | [x] | [ ] | [ ] | Yes (default off) | *"[Actor] moved [Task title] to [List name]"* |
| Task deleted | Assignees + Watchers | [x] | [ ] | [ ] | Yes | *"[Actor] deleted task [Task title]"* |
| Subtask assigned to you | New assignee | [x] | [x] | [x] | Yes | *"[Actor] assigned you to [Subtask title] in [Parent task title]"* |
| Subtask completed | Parent task assignees | [x] | [ ] | [ ] | Yes (default off) | *"[Actor] completed [Subtask title] in [Parent task title]"* |

---

### Due Date Notifications (System-generated, not actor-triggered)

These are sent by the system on a schedule — no human actor. Shown with a system icon in the notification panel.

| Trigger | Who gets notified | In-App | Email | Push | Configurable | Notification text |
|---------|------------------|:------:|:-----:|:----:|:------------|------------------|
| Due date reminder — 1 day before | Assignees + Watchers | [x] | [x] | [x] | Yes | *"[Task title] is due tomorrow"* |
| Due date reminder — on due date | Assignees | [x] | [x] | [x] | Yes | *"[Task title] is due today"* |
| Task overdue (next day, still not closed) | Assignees | [x] | [x] | [x] | Yes | *"[Task title] is overdue"* |

**Firing rules:**
- Reminders are sent once per trigger per task — not repeated daily.
- If the task is closed before the reminder fires, the reminder is **cancelled**.
- If the due date is changed after a reminder was sent, the new due date generates fresh reminders.

---

### Comment & Mention Notifications

| Trigger | Who gets notified | In-App | Email | Push | Configurable | Notification text |
|---------|------------------|:------:|:-----:|:----:|:------------|------------------|
| New comment on task | Assignees + Watchers | [x] | [x] | [x] | Yes | *"[Actor] commented on [Task title]: [first 80 chars of comment]"* |
| Reply to your comment | Original comment author | [x] | [x] | [x] | Yes | *"[Actor] replied to your comment on [Task title]"* |
| @mention in comment | Mentioned user | [x] | [x] | [x] | No (always on) | *"[Actor] mentioned you in [Task title]"* |
| @mention in task description | Mentioned user | [x] | [x] | [x] | No (always on) | *"[Actor] mentioned you in the description of [Task title]"* |
| Comment thread resolved | Original comment author | [x] | [ ] | [ ] | Yes (default off) | *"[Actor] resolved a comment thread on [Task title]"* |

**Deduplication rule for comments:**
- If 3 or more comment notifications on the same task arrive within a **10-minute window**, they are grouped into one:
  *"[Actor1] and 2 others commented on [Task title]"*
- Grouped notifications link to the task, not a specific comment.

---

### Workspace & Space Notifications

| Trigger | Who gets notified | In-App | Email | Push | Configurable | Notification text |
|---------|------------------|:------:|:-----:|:----:|:------------|------------------|
| Invited to workspace | Invited user | [x] | [x] (always) | [ ] | No (always on) | *"[Actor] invited you to [Workspace name]"* |
| Invite accepted | Inviter (Admin/Owner) | [x] | [ ] | [ ] | Yes | *"[User] accepted your invitation to [Workspace name]"* |
| Added to a Space | Added user | [x] | [x] | [ ] | Yes | *"[Actor] added you to [Space name]"* |
| Removed from a Space | Removed user | [x] | [x] | [ ] | Yes | *"[Actor] removed you from [Space name]"* |
| Role changed in workspace | Affected user | [x] | [x] | [ ] | Yes | *"[Actor] changed your role in [Workspace name] to [New Role]"* |
| Space permission changed | Affected user | [x] | [ ] | [ ] | Yes | *"[Actor] changed your permission in [Space name] to [Permission]"* |

---

### Sprint Notifications

| Trigger | Who gets notified | In-App | Email | Push | Configurable | Notification text |
|---------|------------------|:------:|:-----:|:----:|:------------|------------------|
| Sprint started | Members with tasks in the sprint | [x] | [x] | [ ] | Yes | *"[Actor] started [Sprint name] — you have [N] tasks in this sprint"* |
| Sprint ending soon (1 day before end) | Members with open tasks in the sprint | [x] | [x] | [x] | Yes | *"[Sprint name] ends tomorrow — you have [N] open tasks"* |
| Sprint closed | Members who had tasks in the sprint | [x] | [ ] | [ ] | Yes (default off) | *"[Actor] closed [Sprint name]"* |
| New sprint auto-created | Space members with Full Access | [x] | [ ] | [ ] | Yes (default off) | *"[Sprint name] was automatically created in [List name]"* |

---

### Notification Deduplication & Grouping Rules

| Rule | Detail |
|------|--------|
| No self-notifications | The actor never receives a notification for their own action |
| No duplicates | If a user qualifies via multiple roles (assignee + watcher), they receive one notification |
| Comment grouping | 3+ comments on the same task within 10 min -> grouped into one notification |
| Muted task | No notifications for any event on a muted task, regardless of trigger |
| Muted Space | No notifications for any task event in a muted Space |
| Task deleted before reminder fires | Reminder is cancelled — no notification sent |
| Task closed before due date reminder | All pending reminders for that task are cancelled |
| User loses Space access | Future notifications for tasks in that Space are not sent |

---

## 2. In-App Notifications

### Access

- Bell icon `ðŸ””` in the top navigation bar
- Unread count badge on the bell icon (e.g. `ðŸ”” 5`)
- Clicking the bell opens the notification panel (slide-out from the right)

### Notification panel

- **Tabs:**
  - `All` — every notification
  - `Unread` — only unread notifications
  - `Mentions` — only @mention notifications

- **Each notification item shows:**
  - Actor avatar + name (who triggered it)
  - Action description (e.g. *"assigned you to Fix login bug"*)
  - Task / Space / List context (breadcrumb)
  - Timestamp (relative: "5 min ago" — hover for exact time)
  - Unread indicator (blue dot on left)

- **Actions on each notification:**
  - Click -> navigate directly to the task / space / item
  - Mark as read (individually, on click)
  - Dismiss (X on hover) — permanently deletes the notification
  - **Mark all as read** — text button top-right of header, marks every notification read
  - **Clear all** — text button top-right of header (secondary), permanently deletes all notifications

- **Grouping:**
  - Notifications from the same task within a short window are grouped (e.g. "Jane and 2 others commented on Fix login bug" instead of 3 separate notifications)

- **Retention:**
  - Notifications are kept for **90 days**
  - Older notifications are auto-deleted

---

## 3. Email Notifications

### Delivery modes (user configurable)

| Mode | Description |
|------|-------------|
| Instant | Email sent immediately when the event occurs |
| Daily Digest | One summary email per day with all notifications from that day (sent at a fixed time, e.g. 8:00 AM user's timezone) |
| Off | No email notifications |

### Email content

- **Instant email:**
  - Subject: `"[Kanbanica] Jane assigned you to: Fix login bug"`
  - Body: actor, action, task title, task description snippet, direct link to the task
  - One email per notification event

- **Daily digest email:**
  - Subject: `"[Kanbanica] Your daily summary — 8 updates"`
  - Body: grouped list of all notifications from the past 24 hours
  - Each item has a direct link to the relevant task
  - Sent only if there is at least one new notification — no empty digest emails

### Always-on emails (cannot be disabled)

- Workspace invitation email
- Password reset email
- Email verification email

### Unsubscribe

- Every email has an unsubscribe link at the bottom
- Unsubscribing from an email disables that notification type for email only — in-app notifications are unaffected

---

## 4. Browser Push Notifications

Browser push notifications appear as OS-level desktop notifications even when the app tab is not active or the browser is minimized.

### Setup

- User must explicitly grant browser permission when prompted (one-time per browser/device)
- Prompt is shown after the user logs in for the first time
- If denied, push notifications are unavailable — user can re-enable from browser settings

### Triggers for push (MVP — limited set)

| Trigger | Shown |
|---------|-------|
| @mention | Yes |
| Task assigned to you | Yes |
| Due date reminder (1 day before) | Yes |
| Task overdue | Yes |
| New comment on your task | Yes |

### Push notification format

```
Kanbanica
Jane commented on "Fix login bug"
"Can you check the error logs for this?"
```

- Clicking the push notification opens the app and navigates to the relevant task
- Push notifications are shown for a maximum of **5 seconds** then auto-dismiss (OS behavior)

---

## 5. Due Date Reminders

Due date reminders are a special notification type triggered by the system on a schedule.

### Reminder schedule

| When | Notification sent to |
|------|---------------------|
| 1 day before due date | Assignees + Watchers |
| On the due date (start of day) | Assignees |
| Task becomes overdue (next day after due date, not closed) | Assignees |

- Reminders are sent via In-App + Email (if enabled) + Browser Push (if enabled)
- If a task has no due date, no reminders are sent
- If the task is closed before the reminder fires, the reminder is cancelled

---

## 6. Notification Settings

Users can configure notification preferences from their profile settings.

### Settings structure

**Global defaults (apply across all workspaces):**
- Email delivery mode: Instant / Daily Digest / Off
- Browser push: On / Off
- For each trigger type: In-App On/Off, Email On/Off, Push On/Off

**Per-workspace overrides:**
- Can override global defaults for a specific workspace
- e.g. Mute all notifications from a workspace you are a guest in

**Per-Space mute:**
- Mute an entire Space — no notifications from any task in that Space
- Accessible from Space sidebar -> `...` -> `Mute Space`

**Per-task mute:**
- Mute a specific task — unsubscribe from all notifications for that task
- Even if you are an assignee or watcher
- Accessible from Task detail -> `...` -> `Mute Task`
- Muting a task also removes you from Watchers

### Settings page layout

```
Notification Settings
+-- Email Notifications
|     +-- Delivery mode: [Instant] [Daily Digest] [Off]
|     L-- Digest time: [08:00 AM] [Timezone: Auto-detect]
+-- Browser Push
|     L-- Enable push notifications: [On/Off]
+-- Notification Events
|     +-- Task assigned to me        [In-App [x]] [Email [x]] [Push [x]]
|     +-- @mention                   [In-App [x]] [Email [x]] [Push [x]]
|     +-- New comment on my task     [In-App [x]] [Email [x]] [Push [x]]
|     +-- Task status changed        [In-App [x]] [Email [x]] [Push -]
|     +-- Due date reminder          [In-App [x]] [Email [x]] [Push [x]]
|     +-- Task completed             [In-App [x]] [Email -] [Push -]
|     L-- ... (all trigger types)
L-- Muted Spaces & Tasks
      L-- List of muted items with unmute option
```

---

## Data Model

```
Notification
+-- id                  (uuid, primary key)
+-- workspace_id        (foreign key -> Workspace)
+-- recipient_id        (foreign key -> User — who receives it)
+-- actor_id            (foreign key -> User — who triggered it, nullable for system events)
+-- trigger_type        (string — e.g. task_assigned, comment_added, due_date_reminder)
+-- entity_type         (enum: task | comment | space | workspace | sprint)
+-- entity_id           (uuid — id of the related entity)
+-- title               (string — short notification text)
+-- body                (string — longer description, nullable)
+-- is_read             (boolean, default: false)
+-- read_at             (timestamp, nullable)
+-- created_at          (timestamp)
L-- expires_at          (timestamp — 90 days from created_at)

UserNotificationPreference
+-- id                  (uuid, primary key)
+-- user_id             (foreign key -> User)
+-- workspace_id        (foreign key -> Workspace, nullable — null = global default)
+-- trigger_type        (string — matches trigger_type in Notification)
+-- in_app_enabled      (boolean, default: true)
+-- email_enabled       (boolean, default: true)
+-- push_enabled        (boolean, default: true)
L-- updated_at          (timestamp)

UserEmailPreference
+-- id                  (uuid, primary key)
+-- user_id             (foreign key -> User)
+-- delivery_mode       (enum: instant | digest | off, default: instant)
+-- digest_time         (time — HH:MM, default: 08:00)
+-- digest_timezone     (string — IANA timezone, e.g. "Asia/Kolkata")
L-- updated_at          (timestamp)

MutedEntity
+-- id                  (uuid, primary key)
+-- user_id             (foreign key -> User)
+-- entity_type         (enum: task | space)
+-- entity_id           (uuid)
L-- created_at          (timestamp)

PushSubscription
+-- id                  (uuid, primary key)
+-- user_id             (foreign key -> User)
+-- endpoint            (string — browser push endpoint URL)
+-- p256dh              (string — browser push encryption key)
+-- auth                (string — browser push auth secret)
+-- user_agent          (string — browser/device identifier)
L-- created_at          (timestamp)
```

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/me/notifications` | Get notifications (paginated, filterable by read/unread/mentions) | Authenticated user |
| **GET** | **`/api/me/notifications/stream`** | **SSE stream — server pushes `new_notification` events in real time** | **Authenticated user** |
| PATCH | `/api/me/notifications/:id/read` | Mark notification as read | Notification recipient |
| PATCH | `/api/me/notifications/read-all` | Mark all notifications as read | Authenticated user |
| DELETE | `/api/me/notifications/:id` | Dismiss a single notification | Notification recipient |
| DELETE | `/api/me/notifications` | Clear all notifications (hard delete all for this user) | Authenticated user |
| GET | `/api/me/notification-preferences` | Get notification preferences | Authenticated user |
| PATCH | `/api/me/notification-preferences` | Update notification preferences | Authenticated user |
| GET | `/api/me/email-preferences` | Get email delivery preferences | Authenticated user |
| PATCH | `/api/me/email-preferences` | Update email delivery mode / digest time | Authenticated user |
| POST | `/api/me/push-subscriptions` | Register browser push subscription | Authenticated user |
| DELETE | `/api/me/push-subscriptions/:id` | Remove push subscription (device) | Authenticated user |
| POST | `/api/me/muted` | Mute a task or Space | Authenticated user |
| DELETE | `/api/me/muted/:entityType/:entityId` | Unmute a task or Space | Authenticated user |

---

## UI Screens

| Screen | Route | Access |
|--------|-------|--------|
| Notification panel | Bell icon -> slide-out panel (global) | All workspace members |
| Notification settings | `/settings/notifications` | All workspace members |
| Muted items list | `/settings/notifications#muted` | All workspace members |

---

## Data Lifecycle

### Archive
- Notifications cannot be archived — they are either unread, read, dismissed, or cleared.
- Dismissing a single notification removes it from the panel (hard delete).
- **Clear all** removes every notification for the user (hard delete, no recovery).

### Soft Delete
- Notifications use **hard delete** only — no soft delete or tombstone.
- Dismissed notifications are permanently removed from the DB.

### Recovery Period
- **Dismissed notification:** No recovery. Hard deleted immediately.
- **Auto-expired notification:** No recovery. Auto-deleted by the cron job after **90 days**.
- **Unread notification:** Retained for 90 days from creation, then auto-deleted regardless of read state.

### Permanent Deletion Rules
- Notifications are permanently deleted in the following cases:
  1. **User dismisses** a notification — immediate hard delete.
  2. **Cron job** runs daily and deletes all Notification records where `created_at < now() - 90 days`.
  3. **Parent entity deleted** (e.g. the Task the notification references is deleted) — the Notification record is hard-deleted in cascade.
  4. **User account deleted** — all Notification records for that user are hard-deleted.
  5. **Workspace deleted** — all Notifications scoped to that workspace are hard-deleted.
- `PushSubscription` records are deleted when:
  - The user explicitly removes a device from settings.
  - The user account is deleted.
  - The push endpoint returns a `410 Gone` response from the browser vendor (endpoint expired).

---

## Business Rules

1. A user never receives a notification for an action they themselves performed (no self-notifications).
2. Muting a task removes the user from Watchers and suppresses all notifications for that task, even if they are an assignee.
3. If a user is both an assignee and a watcher, they receive only one notification per event — no duplicates.
4. Notification grouping applies when 3 or more events on the same task occur within 10 minutes — they are collapsed into a single grouped notification.
5. Invitation emails and security emails (password reset, email verification) are always sent regardless of notification preferences.
6. Daily digest emails are not sent if there are zero new notifications for that day.
7. Browser push requires explicit user permission — if denied, the option is grayed out in settings.
8. Due date reminders are cancelled automatically if the task is closed before the reminder fires.
9. Notifications older than 90 days are automatically deleted.
10. Notifications respect permissions — if a user loses access to a Space after a notification is created, the notification still exists but clicking it will show a "You no longer have access" message rather than the task.
11. Per-workspace settings override global defaults — per-task/space mutes override everything.

---

## Out of Scope (MVP)

- Mobile app push notifications (native iOS / Android)
- Slack / webhook integrations for notifications
- Notification rules / automation (e.g. "notify manager when task is overdue")
- In-app notification sounds
- Scheduled / snooze notifications ("remind me about this in 2 hours")
- Read receipts on comments

---

## Real-Time Delivery (SSE)

In-app notifications are delivered instantly via **Server-Sent Events (SSE)** — no polling.

### How it works

1. `NotificationBell` opens a persistent HTTP connection to `GET /api/me/notifications/stream` on mount.
2. The server holds the connection open and streams `data: {...}\n\n` events whenever `createNotifications` inserts a new row for that user.
3. On each event, the client calls SWR's global `mutate` to revalidate all `/api/me/notifications*` keys — the bell badge and the open panel update instantly.
4. A `: ping\n\n` comment is sent every 25 seconds to prevent proxy/load-balancer timeouts.
5. `EventSource` auto-reconnects if the connection drops (built-in browser behaviour).

### Server-side registry

`lib/sse-clients.ts` maintains an **in-memory Map** of open controllers:

```typescript
const clients = new Map<string, Set<ReadableStreamDefaultController>>();

registerClient(userId, ctrl)   // called on SSE connect
unregisterClient(userId, ctrl) // called on disconnect / abort
pushToUser(userId, data)       // called by createNotifications after DB insert
```

**Single-server limitation:** The in-memory Map is per-process. If the app runs behind multiple Node processes (e.g. clustered or on multiple servers), events pushed in process A won't reach clients connected to process B. Fix when needed: replace the Map with a Redis pub/sub channel — `pushToUser` publishes, each process subscribes and fans out to its local clients.

### Folder

```
lib/sse-clients.ts                            ← in-memory registry
app/api/me/notifications/stream/route.ts      ← SSE endpoint
```

---

## Implementation Notes

### VAPID Setup (Required for Push)

Generate VAPID keys once and store in env vars:

```bash
npx web-push generate-vapid-keys
```

Add to `.env.local`:
```
VAPID_PUBLIC_KEY=BFc...     # starts with B, ~88 chars
VAPID_PRIVATE_KEY=...       # ~43 chars
VAPID_SUBJECT=mailto:push@Kanbanica.com
```

These are **optional** env vars -- if missing, push notifications are silently disabled (graceful degradation). Add to `src/lib/env.ts` Zod schema as optional:

```typescript
vapidPublicKey: z.string().optional(),
vapidPrivateKey: z.string().optional(),
vapidSubject: z.string().optional(),
```

**VAPID key rotation warning:** If VAPID keys are ever rotated (e.g. a key leak), all stored `PushSubscription` records become invalid. WebPush will return HTTP 410 Gone. The push handler must delete the subscription on 410:

```typescript
try {
  await webpush.sendNotification(subscription, payload)
} catch (err) {
  if (err.statusCode === 410) {
    // Subscription is expired/invalid -- delete it
    await db.pushSubscription.delete({ where: { id: subscriptionId } })
  }
}
```

### Daily Digest Job Architecture

`UserEmailPreference.digestTime` is a per-user HH:MM delivery time (e.g. "08:00"). A single daily cron cannot honor arbitrary per-user delivery times.

**Architecture:** A 30-minute batch cron runs continuously. On each tick it finds users whose digest window has just arrived and fans out per-user digest jobs.

```typescript
// JOB_NAMES.NOTIFICATION_DIGEST_SCAN = "notification.digest-scan"
// Schedule: every 30 minutes
// This job finds eligible users and enqueues per-user digest jobs

// JOB_NAMES.NOTIFICATION_DIGEST_SEND = "notification.digest-send"
// Enqueued per user by the scan job
interface NotificationDigestSendPayload {
  userId: string
  windowStart: string   // ISO -- start of the 24h window to aggregate
  windowEnd: string     // ISO -- end of the window (= now)
}
```

**Scan handler logic** (`src/lib/worker/handlers/notification-digest-scan.ts`):
```typescript
// Find users whose digestTime falls within the last 30-minute window
const now = new Date()
const windowStart = new Date(now.getTime() - 30 * 60 * 1000)

// Convert digestTime (HH:MM) + digestTimezone to a UTC timestamp for today
// If that UTC timestamp falls in [windowStart, now], enqueue a digest for that user
const eligibleUsers = await db.userEmailPreference.findMany({
  where: { deliveryMode: 'DIGEST' }
})

for (const pref of eligibleUsers) {
  const digestUtc = toUtcDateTime(pref.digestTime, pref.digestTimezone, now)
  if (digestUtc >= windowStart && digestUtc <= now) {
    await enqueueJob(JOB_NAMES.NOTIFICATION_DIGEST_SEND, {
      userId: pref.userId,
      windowStart: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      windowEnd: now.toISOString(),
    }, { singletonKey: `digest:${pref.userId}:${now.toDateString()}` })
    // singletonKey prevents duplicate digests if the scan runs twice in the same window
  }
}
```

**Digest send handler** (`src/lib/worker/handlers/notification-digest-send.ts`):
1. Query unread `Notification` records for `userId` where `createdAt` between `windowStart` and `windowEnd`
2. If zero notifications -- skip (do not send an empty digest email)
3. Group by entity / trigger type
4. Send email via `src/lib/email/notification-digest.tsx`
5. Do NOT mark notifications as read -- that is the user's action

### Notification Cleanup Job

```typescript
JOB_NAMES.NOTIFICATION_CLEANUP = "notification.cleanup"

// Schedule: daily at 01:00 UTC
// Handler: DELETE FROM Notification WHERE created_at < NOW() - INTERVAL '90 days'
// Batch deletions to avoid long-running transactions (1000 rows per batch)
```

### Due Date Reminder Jobs

Due date reminders are fired by a cron that checks for tasks with upcoming due dates:

```typescript
JOB_NAMES.DUE_DATE_REMINDER = "notification.due-date-reminder"
// Schedule: every hour
// Handler: find tasks where due_date_end = CURRENT_DATE + 1 (1-day reminder)
//          AND no existing reminder Notification for that task+trigger_type
```

**Idempotency:** Before creating a reminder notification, check if one already exists:
```typescript
const existing = await db.notification.findFirst({
  where: {
    entityId: taskId,
    triggerType: 'due_date_reminder_1day',
    createdAt: { gte: startOfToday() }
  }
})
if (existing) return  // already sent today
```

### ActivityLog vs Notification Separation

These are two distinct write paths:

| | ActivityLog | Notification |
|--|------------|-------------|
| Purpose | Immutable audit trail | Actionable user alert |
| Written by | `writeActivityLog()` (fire-and-forget) | `createNotification()` (fire-and-forget) |
| Deleted | Only when parent Task deleted | After 90 days or on dismiss |
| Reads | Task detail timeline | Notification panel |

Never merge these two writes into one call. They serve different purposes and have different retention rules.

### Notification Creation Pattern

```typescript
// src/lib/notifications/create-notification.ts

export function createNotifications(
  recipients: string[],        // userIds
  actorId: string,
  trigger: NotificationTrigger,
  entity: { type: string; id: string },
  workspaceId: string
): void {
  // Fire-and-forget -- never block the mutation response
  const eligibleRecipients = recipients.filter(id => id !== actorId)
  if (eligibleRecipients.length === 0) return

  db.notification.createMany({
    data: eligibleRecipients.map(recipientId => ({
      workspaceId,
      recipientId,
      actorId,
      triggerType: trigger.type,
      entityType: entity.type,
      entityId: entity.id,
      title: trigger.title(actorId, entity),
      expiresAt: addDays(new Date(), 90),
    }))
  }).catch(err => {
    console.error('Notification creation failed', { trigger, err })
  })
}
```

### Folder Mapping

```
src/
  lib/
    notifications/
      create-notification.ts    <- createNotifications (fire-and-forget)
      push.ts                   <- sendPushNotification with 410 handler
    email/
      notification-digest.tsx   <- React Email template for digest
      notification-instant.tsx  <- React Email template for instant
  lib/worker/handlers/
    notification-digest-scan.ts
    notification-digest-send.ts
    notification-cleanup.ts
    due-date-reminder.ts
  app/api/me/
    notifications/route.ts
    notifications/[id]/read/route.ts
    notifications/read-all/route.ts
    notification-preferences/route.ts
    email-preferences/route.ts
    push-subscriptions/route.ts
    push-subscriptions/[id]/route.ts
    muted/route.ts
    muted/[entityType]/[entityId]/route.ts
```
