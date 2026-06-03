# Collaboration

## Overview

Collaboration features enable team communication and visibility directly inside tasks — without switching to a separate tool. Everything is contextual: comments, mentions, activity, and file attachments all live on the task they belong to.

**Collaboration happens at three levels:**
- **Task level** — comments, activity log, attachments (primary)
- **Space level** — activity feed of all changes across a Space
- **Workspace level** — global activity feed (Admin / Owner only)

---

## 1. Comments

Comments are threaded discussions attached to a Task. They keep all conversation about a piece of work in one place.

### Features

**Writing a comment:**
- Rich text editor supporting:
  - Bold, italic, underline, strikethrough
  - Bullet list, numbered list
  - Inline code, code block
  - Hyperlinks
  - @mentions (see [Mentions](#3-mentions))
- Attach a file directly inside a comment (image or document)
- Press `Ctrl + Enter` (or `Cmd + Enter`) to submit

**Comment thread (replies):**
- Any comment can be replied to — creates a nested thread under the parent comment
- Thread is collapsible — reply count shown on the parent comment (e.g. `3 replies`)
- All replies notify the parent comment author and anyone mentioned in the thread

**Emoji reactions:**
- Any comment can receive emoji reactions
- Click the emoji icon on a comment → pick from emoji picker
- Multiple users can react with the same emoji — count is shown (e.g. 👍 3)
- A user can add or remove their own reaction at any time

**Edit comment:**
- Author can edit their own comment at any time
- Edited comments show an `(edited)` label with the last edited timestamp
- Editing is not available for other users' comments (Admin cannot edit others' comments in MVP)

**Delete comment:**
- Author can delete their own comment
- Admin and Owner can delete any comment
- Deleting a parent comment with replies removes the parent text but keeps the replies visible with a `[Comment deleted]` placeholder

**Resolve thread:**
- A comment thread can be marked as **Resolved** by:
  - The comment author
  - Task assignees
  - Members with Full Access, Admin, Owner
- Resolved threads are collapsed and grayed out — still visible but not prominent
- Can be unresolve if discussion needs to continue
- Useful for Q&A-style threads (e.g. "Is this design approved?" → answer → resolve)

**Comment ordering:**
- Oldest first (chronological) — consistent with most tools

---

## 2. Activity Log

The Activity Log is a complete, immutable audit trail of everything that has happened on a Task. It is automatically generated — no user action required.

### What is tracked

| Event | Example log entry |
|-------|-------------------|
| Task created | *John created this task* |
| Title changed | *Jane changed title from "Fix bug" to "Fix login bug"* |
| Status changed | *John changed status from In Progress → Review* |
| Priority changed | *Jane changed priority from Medium → High* |
| Assignee added | *John assigned Jane* |
| Assignee removed | *John unassigned Jane* |
| Due date set | *Jane set due date to Jun 15, 2026* |
| Due date changed | *Jane changed due date from Jun 15 → Jun 20* |
| Due date removed | *John removed due date* |
| Description updated | *Jane updated the description* |
| Comment added | *John left a comment* |
| Comment deleted | *John deleted a comment* |
| Checklist added | *Jane added checklist "Pre-launch"* |
| Checklist item checked | *John checked "Write unit tests"* |
| Checklist item unchecked | *Jane unchecked "Write unit tests"* |
| Attachment uploaded | *John uploaded "mockup-v2.png"* |
| Attachment deleted | *Jane deleted "mockup-v1.png"* |
| Dependency added | *John added dependency: blocked by "Setup DB schema"* |
| Dependency removed | *John removed dependency* |
| Task moved | *Jane moved task from Backlog → Sprint 12* |
| Watcher added | *John started watching this task* |
| Sprint assigned | *Jane added task to Sprint 12* |
| Subtask created | *John created subtask "Write test cases"* |
| Task archived | *Jane archived this task* |

### Display

- Shown as a chronological feed at the bottom of the Task detail panel, below comments
- Each entry shows: **avatar + name**, **action description**, **timestamp** (relative: "2 hours ago" — hover for exact datetime)
- Comments and activity entries are **interleaved** chronologically so the full story of the task is readable top to bottom
- Activity entries are read-only — cannot be edited or deleted

### Space-level Activity Feed

- Accessible from the Space sidebar: `Space → Activity`
- Shows all task changes across all Lists in the Space for the past 30 days
- Filterable by: member, event type (status change, comment, assignment), List

### Workspace-level Activity Feed

- Accessible from Workspace Settings → Activity (Admin / Owner only)
- Shows all activity across all Spaces in the Workspace
- Useful for Admins monitoring overall workspace usage

---

## 3. Mentions

@mentions link a user directly in text, notify them instantly, and draw attention to what needs their input.

### Where mentions work

- Task description (rich text)
- Comments and comment replies

### How it works

- Type `@` anywhere in a description or comment → triggers a user search dropdown
- Search by name or email — shows workspace members who have access to the Space
- Select a user → their name appears as a highlighted mention chip (e.g. `@Jane Doe`)
- On submit, the mentioned user receives a notification immediately

### Notification triggered

- In-app notification: `"John mentioned you in Task: Fix login bug"`
- Email notification (if user has email notifications enabled for mentions)

### Rules

- You can only mention users who are members of the Workspace
- Guests can only be mentioned if they have access to the Space the task is in
- Mentioning yourself is allowed but triggers no notification

---

## 4. File Attachments

Files uploaded directly to a task to share designs, documents, screenshots, or any supporting material.

### Uploading

- **Who can upload:** Members with **Edit** or **Full Access**, Admin, Owner
- Upload methods:
  - Click the attachment icon in the Task detail panel
  - Drag and drop a file onto the Task detail panel
  - Paste an image from clipboard directly into the comment editor
- Files can also be attached inside a comment

### Supported file types

- Images: JPG, PNG, GIF, WebP, SVG
- Documents: PDF, DOCX, XLSX, PPTX, TXT, CSV
- Archives: ZIP, RAR
- Any other file type is accepted but shown as a generic file card

### File display

- **Images** — displayed as inline thumbnails in the Attachments section; click to open full-size preview
- **Non-image files** — shown as a file card with: file name, file type icon, file size, upload date, uploader name, download button
- Attachments section shows total count and total size (e.g. `4 files · 12.3 MB`)

### Limits (MVP)

- Max file size: **10 MB per file**
- No limit on number of files per task

### Deleting attachments

- Uploader can delete their own attachment
- Members with Full Access, Admin, Owner can delete any attachment
- Deletion removes the DB record and the file from storage (S3 / Cloudflare R2)
- Deletion is recorded in the Activity Log

### Storage

- Files stored in **S3 / Cloudflare R2**
- Each file gets a unique, signed URL for access
- URLs are not publicly accessible — require authenticated session to view

---

## Data Model

```
Comment
├── id                  (uuid, primary key)
├── task_id             (foreign key → Task)
├── parent_comment_id   (foreign key → Comment, nullable — null = top-level comment)
├── author_id           (foreign key → User)
├── body                (text / rich text JSON — stores formatted content)
├── is_deleted          (boolean, default: false — soft delete to preserve thread context)
├── is_resolved         (boolean, default: false)
├── resolved_by         (foreign key → User, nullable)
├── resolved_at         (timestamp, nullable)
├── edited_at           (timestamp, nullable)
├── created_at          (timestamp)
└── updated_at          (timestamp)

CommentReaction
├── id                  (uuid, primary key)
├── comment_id          (foreign key → Comment)
├── user_id             (foreign key → User)
├── emoji               (string — unicode emoji character)
└── created_at          (timestamp)

ActivityLog
├── id                  (uuid, primary key)
├── task_id             (foreign key → Task)
├── user_id             (foreign key → User)
├── event_type          (string — e.g. status_changed, assignee_added, comment_added)
├── meta                (json — { from, to, value } depends on event type)
└── created_at          (timestamp)

TaskAttachment
├── id                  (uuid, primary key)
├── task_id             (foreign key → Task)
├── comment_id          (foreign key → Comment, nullable — set if attached inside a comment)
├── uploaded_by         (foreign key → User)
├── file_name           (string)
├── file_url            (string — S3 / R2 storage URL)
├── file_size           (integer — bytes)
├── mime_type           (string)
└── created_at          (timestamp)
```

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/tasks/:taskId/comments` | Get all comments (with replies) for a task | Space member |
| POST | `/api/tasks/:taskId/comments` | Add a comment | Space member (any permission) |
| PATCH | `/api/comments/:id` | Edit a comment | Author only |
| DELETE | `/api/comments/:id` | Delete a comment | Author / Full Access / Admin+ |
| POST | `/api/comments/:id/resolve` | Resolve a comment thread | Assignee / Full Access / Admin+ |
| POST | `/api/comments/:id/unresolve` | Unresolve a comment thread | Assignee / Full Access / Admin+ |
| POST | `/api/comments/:id/reactions` | Add emoji reaction | Space member |
| DELETE | `/api/comments/:id/reactions/:emoji` | Remove own emoji reaction | Reaction owner |
| GET | `/api/tasks/:taskId/activity` | Get activity log for a task | Space member |
| GET | `/api/spaces/:spaceId/activity` | Get Space-level activity feed | Space member |
| GET | `/api/workspaces/:workspaceId/activity` | Get Workspace-level activity feed | Admin+ |
| GET | `/api/tasks/:taskId/attachments` | Get all attachments for a task | Space member |
| POST | `/api/tasks/:taskId/attachments` | Upload an attachment | Edit / Full Access / Admin+ |
| DELETE | `/api/attachments/:id` | Delete an attachment | Uploader / Full Access / Admin+ |

---

## UI Screens

| Screen | Description | Access |
|--------|-------------|--------|
| Task detail — Comments section | Comment thread with replies, reactions, resolve | All Space members |
| Task detail — Activity section | Interleaved activity + comment feed | All Space members |
| Task detail — Attachments section | File grid with preview and download | All Space members |
| Space Activity Feed | `/space/:spaceId/activity` | Space members |
| Workspace Activity Feed | `/settings/activity` | Admin+ |

---

## Business Rules

1. Any Space member — including View-only members — can post comments and reactions. View permission does not restrict communication.
2. Comment editing is limited to the author — no one else can edit another user's comment, including Admin.
3. Deleting a parent comment soft-deletes it — the text is replaced with `[Comment deleted]` but replies remain visible.
4. Deleting a comment that has no replies is a hard delete — no placeholder needed.
5. Activity log entries are immutable — they cannot be edited or deleted by anyone, including Owner.
6. Mentions only work for users who are workspace members — external email mentions are not supported in MVP.
7. A user can only react once per emoji per comment — reacting again with the same emoji removes the reaction (toggle).
8. Attachment files are stored externally (S3 / R2) — deleting the DB record must also delete the file from storage.
9. Files attached inside a comment are associated with both the comment and the task — deleting the comment does not auto-delete its attachments.
10. Space-level and Workspace-level activity feeds are read-only aggregated views — no actions can be taken from them.

---

## Out of Scope (MVP)

- Real-time collaborative editing of task description (simultaneous multi-user editing)
- Comment drafts (auto-save unsent comment)
- Direct messages between users (not tied to a task)
- Video / voice comments
- Comment search within a task
- Pinning important comments
- Workspace-level announcement channel
