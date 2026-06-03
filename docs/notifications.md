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

These are the events that generate a notification. Each trigger can be enabled or disabled per user in notification settings.

### Task Notifications

| Trigger | Who gets notified | Default |
|---------|------------------|---------|
| Task assigned to you | Assignee | On |
| Task unassigned from you | Former assignee | On |
| Task due date reminder | Assignees + Watchers | On |
| Task overdue (past due date, not closed) | Assignees | On |
| Task status changed | Assignees + Watchers | On |
| Task priority changed | Assignees + Watchers | Off |
| Task due date changed | Assignees + Watchers | On |
| Task moved to a different List | Assignees + Watchers | Off |
| Task completed (status → closed) | Reporter + Watchers | On |
| Task deleted | Assignees + Watchers | On |
| Subtask assigned to you | Assignee | On |
| Subtask completed | Parent task assignees | Off |

### Comment Notifications

| Trigger | Who gets notified | Default |
|---------|------------------|---------|
| New comment on task | Assignees + Watchers | On |
| Reply to your comment | Comment author | On |
| @mention in comment | Mentioned user | On |
| @mention in task description | Mentioned user | On |
| Comment resolved | Comment author | Off |

### Workspace / Space Notifications

| Trigger | Who gets notified | Default |
|---------|------------------|---------|
| Invited to workspace | Invited user | On (always) |
| Added to a Space | Added user | On |
| Removed from a Space | Removed user | On |
| Role changed in workspace | Affected user | On |

### Sprint Notifications

| Trigger | Who gets notified | Default |
|---------|------------------|---------|
| Sprint started | All members with tasks in the sprint | On |
| Sprint ending soon (1 day before end date) | All members with open tasks in the sprint | On |
| Sprint closed | All members who had tasks in the sprint | Off |
| New sprint auto-created | Space members with Full Access | Off |

---

## 2. In-App Notifications

### Access

- Bell icon `🔔` in the top navigation bar
- Unread count badge on the bell icon (e.g. `🔔 5`)
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
  - Click → navigate directly to the task / space / item
  - Mark as read (individually)
  - Mark all as read (bulk button at top)

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
  - Subject: `"[Teamority] Jane assigned you to: Fix login bug"`
  - Body: actor, action, task title, task description snippet, direct link to the task
  - One email per notification event

- **Daily digest email:**
  - Subject: `"[Teamority] Your daily summary — 8 updates"`
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
Teamority
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
- Accessible from Space sidebar → `...` → `Mute Space`

**Per-task mute:**
- Mute a specific task — unsubscribe from all notifications for that task
- Even if you are an assignee or watcher
- Accessible from Task detail → `...` → `Mute Task`
- Muting a task also removes you from Watchers

### Settings page layout

```
Notification Settings
├── Email Notifications
│     ├── Delivery mode: [Instant] [Daily Digest] [Off]
│     └── Digest time: [08:00 AM] [Timezone: Auto-detect]
├── Browser Push
│     └── Enable push notifications: [On/Off]
├── Notification Events
│     ├── Task assigned to me        [In-App ✓] [Email ✓] [Push ✓]
│     ├── @mention                   [In-App ✓] [Email ✓] [Push ✓]
│     ├── New comment on my task     [In-App ✓] [Email ✓] [Push ✓]
│     ├── Task status changed        [In-App ✓] [Email ✓] [Push -]
│     ├── Due date reminder          [In-App ✓] [Email ✓] [Push ✓]
│     ├── Task completed             [In-App ✓] [Email -] [Push -]
│     └── ... (all trigger types)
└── Muted Spaces & Tasks
      └── List of muted items with unmute option
```

---

## Data Model

```
Notification
├── id                  (uuid, primary key)
├── workspace_id        (foreign key → Workspace)
├── recipient_id        (foreign key → User — who receives it)
├── actor_id            (foreign key → User — who triggered it, nullable for system events)
├── trigger_type        (string — e.g. task_assigned, comment_added, due_date_reminder)
├── entity_type         (enum: task | comment | space | workspace | sprint)
├── entity_id           (uuid — id of the related entity)
├── title               (string — short notification text)
├── body                (string — longer description, nullable)
├── is_read             (boolean, default: false)
├── read_at             (timestamp, nullable)
├── created_at          (timestamp)
└── expires_at          (timestamp — 90 days from created_at)

UserNotificationPreference
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── workspace_id        (foreign key → Workspace, nullable — null = global default)
├── trigger_type        (string — matches trigger_type in Notification)
├── in_app_enabled      (boolean, default: true)
├── email_enabled       (boolean, default: true)
├── push_enabled        (boolean, default: true)
└── updated_at          (timestamp)

UserEmailPreference
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── delivery_mode       (enum: instant | digest | off, default: instant)
├── digest_time         (time — HH:MM, default: 08:00)
├── digest_timezone     (string — IANA timezone, e.g. "Asia/Kolkata")
└── updated_at          (timestamp)

MutedEntity
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── entity_type         (enum: task | space)
├── entity_id           (uuid)
└── created_at          (timestamp)

PushSubscription
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── endpoint            (string — browser push endpoint URL)
├── p256dh              (string — browser push encryption key)
├── auth                (string — browser push auth secret)
├── user_agent          (string — browser/device identifier)
└── created_at          (timestamp)
```

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/me/notifications` | Get notifications (paginated, filterable by read/unread/mentions) | Authenticated user |
| PATCH | `/api/me/notifications/:id/read` | Mark notification as read | Notification recipient |
| PATCH | `/api/me/notifications/read-all` | Mark all notifications as read | Authenticated user |
| DELETE | `/api/me/notifications/:id` | Dismiss a notification | Notification recipient |
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
| Notification panel | Bell icon → slide-out panel (global) | All workspace members |
| Notification settings | `/settings/notifications` | All workspace members |
| Muted items list | `/settings/notifications#muted` | All workspace members |

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
