# Teamority — Project Management SaaS (ClickUp-style)

## Product Vision

Build a project management platform that helps teams organize, collaborate, execute, and track work efficiently — from startups to enterprise.

**Goals:**
- Simple, fast onboarding
- Flexible team collaboration
- Scalable SaaS architecture

---

## Product Hierarchy

```
Workspace
  └── Space
        └── Folder (Optional)
              └── List
                    └── Task
                          └── Subtask
```

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Workspace](#2-workspace)
3. [Space](#3-space)
4. [Folder](#4-folder-optional)
5. [List](#5-list)
6. [Task](#6-task)
7. [Subtask](#7-subtask)
8. [Sprint](#8-sprint-optional)
9. [Views](#9-views)
10. [Collaboration](#10-collaboration)
11. [Search & Filters](#11-search--filters)
12. [Notifications](#12-notifications)
13. [Permission Model](#13-permission-model)
14. [Admin Panel](#14-admin-panel)
15. [Customer Support](#15-customer-support)
16. [MVP Scope](#16-mvp-scope)
17. [Tech Stack](#tech-stack-planned)

---

## 1. Authentication

User identity and access management.

**Powered by:** [Better Auth](https://better-auth.com) with Admin Plugin

**Features:**
- Sign up (Email + Password)
- Sign in / Sign out
- OAuth login (Google, GitHub)
- Forgot password / Reset password
- Email verification
- Session management (secure, database-backed sessions)
- Multi-device login / session list
- Ban / unban users (via Admin Plugin)
- Impersonate users (via Admin Plugin)
- Revoke sessions (via Admin Plugin)

---

## 2. Workspace

Top-level organization container. Every user belongs to at least one workspace.

**Example:** `Acme Company`

**Features:**
- Create Workspace
- Edit Workspace (name, logo, settings)
- Delete Workspace
- Switch between Workspaces
- Invite members via email or invite link
- Manage members (view, edit role, remove)
- Workspace-level roles
- Workspace settings page
- Transfer Ownership

**Roles:**

| Role | Description |
|------|-------------|
| Owner | Full control, billing, delete workspace |
| Admin | Manage members, spaces, settings |
| Member | Create and manage own work |
| Guest | Limited access to specific Spaces/Lists |

---

## 3. Space

Logical grouping for teams or departments within a Workspace.

**Examples:** Engineering, Marketing, HR, Design

**Features:**
- Create Space
- Edit Space (name, color, icon)
- Delete / Archive Space
- Space members & permissions
- Private Space (invite-only) vs Public Space
- Space-level notifications settings

**Permissions:**

| Level | Description |
|-------|-------------|
| Full Access | Create, edit, delete everything |
| Edit | Create and edit tasks, no delete |
| View | Read-only access |

---

## 4. Folder (Optional)

Organizes multiple Lists under a logical group within a Space.

**Examples:** Mobile App, Website, Internal Tools

**Features:**
- Create Folder
- Edit Folder (name, color)
- Delete / Archive Folder
- Move Lists in/out of Folder
- Folder is optional — Lists can exist directly under a Space

---

## 5. List

Primary container for Tasks. Equivalent to a project or board.

**Examples:** Backlog, Sprint 12, Bugs, Feature Requests

**Features:**
- Create List
- Edit List (name, color, description)
- Delete / Archive List
- List Status Customization (custom statuses per list)
- Duplicate List
- Move List (between Folders or Spaces)
- List-level sharing

**Default Statuses:**
- Open
- In Progress
- Review
- Closed

---

## 6. Task

Core work item. Everything actionable lives here.

**Fields:**

| Field | Details |
|-------|---------|
| Title | Required |
| Description | Rich text editor (bold, lists, code blocks, links) |
| Status | Customizable per List |
| Priority | None / Low / Medium / High / Urgent |
| Assignees | Multiple users |
| Reporter | Who created the task |
| Due Date | Single date or date range (start + end) |
| Time Estimate | Estimated hours |
| Time Tracked | Logged time |
| Tags / Labels | Custom multi-select tags |
| Attachments | Files, images |
| Comments | Thread of comments |
| Checklists | Sub-items within a task |
| Dependencies | Blocked by / Blocking other tasks |
| Parent Task | For subtasks |
| Watchers | Users following the task |
| Custom Fields | Text, Number, Dropdown, Date, Checkbox, URL |

**Status (Default):**
- Todo
- In Progress
- Review
- Done

**Priority:**
- None
- Low
- Medium
- High
- Urgent

**Task Features:**
- Create Task
- Edit Task
- Duplicate Task
- Move Task (between Lists)
- Copy Task link
- Archive / Delete Task
- Assign multiple users
- Set due date & reminders
- Add checklists
- Link dependencies (blocked by / blocking)
- Activity timeline (full audit log)
- Recurring Tasks (daily / weekly / monthly / custom)
- Task Templates
- Notifications on task updates

---

## 7. Subtask

Tasks nested under a parent Task.

**Features:**
- Create Subtask within a Task
- Subtasks inherit List and Space context
- Subtasks have the same fields as Tasks (status, assignee, due date)
- Progress rollup from subtasks to parent task
- Collapse / expand subtask list

---

## 8. Sprint (Optional)

Agile execution layer for time-boxed iterations.

**Features:**
- Create Sprint
- Sprint Name & Goal
- Start Date / End Date
- Add Tasks to Sprint
- Story Points per Task
- Sprint Progress (% complete, burndown)
- Close Sprint (move incomplete tasks)
- Sprint History

---

## 9. Views

Multiple ways to visualize and interact with work.

**MVP Views:**

| View | Description |
|------|-------------|
| List View | Default line-by-line task list |
| Board View | Kanban columns by status |
| Calendar View | Tasks on a monthly/weekly calendar |
| My Tasks | Personal view of all tasks assigned to me |

**Post-MVP Views (future):**
- Gantt / Timeline View
- Table / Spreadsheet View
- Workload View

---

## 10. Collaboration

**Comments:**
- Rich text comments on tasks
- Reply to comments (thread)
- @mention users in comments
- Emoji reactions on comments
- Edit / Delete own comments
- Resolve comment threads

**Activity Log:**
- Full audit trail per task (who changed what, when)
- Workspace-level activity feed

**File Attachments:**
- Upload files to tasks (images, PDFs, docs)
- Preview images inline
- File size limits per plan

**Mentions:**
- @mention users in task descriptions and comments
- Mention sends a notification

---

## 11. Search & Filters

**Global Search:**
- Search tasks, spaces, lists, members across the workspace
- Search by title, description, tag, assignee

**Filters (per List/View):**
- Filter by Status
- Filter by Priority
- Filter by Assignee
- Filter by Due Date
- Filter by Tags
- Filter by Custom Fields
- Save Filters

**Sort:**
- Sort by Due Date, Priority, Status, Assignee, Created Date

---

## 12. Notifications

**In-App Notifications:**
- Task assigned to you
- Task due date reminder
- Comment on your task
- @mention
- Status change on watched task
- Task completed

**Email Notifications:**
- Digest (daily / instant) configurable by user
- Invitation emails

**Push Notifications (mobile / browser):**
- Due date reminders
- @mentions

**Notification Settings:**
- Per-workspace notification preferences
- Mute specific tasks or Lists

---

## 13. Permission Model

Permission is managed at two levels only: **Workspace Role** and **Space Permission**.
Lists, Tasks, and Subtasks inherit from the Space — no separate permission configuration needed.

---

### Workspace Roles

Controls what a user can do at the workspace level (settings, members, spaces).

| Action | Owner | Admin | Member | Guest |
|--------|-------|-------|--------|-------|
| Delete Workspace | Yes | No | No | No |
| Manage Billing | Yes | No | No | No |
| Manage All Members | Yes | Yes | No | No |
| Create / Delete Spaces | Yes | Yes | No | No |
| Invite Members to Workspace | Yes | Yes | No | No |
| View Workspace Settings | Yes | Yes | No | No |
| Access assigned Spaces | Yes | Yes | Yes | Yes (invited only) |

> **Guest** can only access Spaces they are explicitly invited to. They cannot see anything else in the workspace.

---

### Space Permissions

Assigned per user per Space. Controls everything inside a Space (Folders, Lists, Tasks).

| Action | Full Access | Edit | View |
|--------|-------------|------|------|
| View Lists and Tasks | Yes | Yes | Yes |
| Create Task | Yes | Yes | No |
| Edit Task (title, description, fields) | Yes | Yes | No |
| Change Task Status | Yes | Yes | No |
| Assign Task to others | Yes | Yes | No |
| Comment on Task | Yes | Yes | Yes |
| Delete Task | Yes | No | No |
| Create List / Folder | Yes | No | No |
| Edit List / Folder | Yes | No | No |
| Delete List / Folder | Yes | No | No |
| Manage Space Members | Yes | No | No |

> **View** users are read-only collaborators — they can follow progress and comment, but cannot modify anything.

---

### How Roles + Space Permissions Work Together

The **Workspace Role** controls workspace-level actions. The **Space Permission** controls everything inside a Space. When a user is added to a Space, they are given a Space Permission level regardless of their Workspace Role.

**Examples:**
- A **Member** with **Full Access** on Engineering Space → can create, edit, delete tasks and lists in that space
- A **Member** with **View** on Marketing Space → can only read and comment in Marketing, even though they are a Member
- A **Guest** invited to Design Space with **Edit** → can create and edit tasks in Design Space only, nothing else visible
- An **Admin** always gets **Full Access** on all Spaces they are added to by default

---

### Task Operations — Who Can Do What

To be clear: **task-level permissions are NOT separate**. Everything derives from the Space Permission the user holds.

| Task Action | Full Access | Edit | View |
|-------------|-------------|------|------|
| Create Task / Subtask | Yes | Yes | No |
| Edit own Task | Yes | Yes | No |
| Edit others' Task | Yes | Yes | No |
| Change Status | Yes | Yes | No |
| Set Priority | Yes | Yes | No |
| Assign / Unassign users | Yes | Yes | No |
| Set Due Date | Yes | Yes | No |
| Add Checklist items | Yes | Yes | No |
| Upload Attachments | Yes | Yes | No |
| Comment | Yes | Yes | Yes |
| Delete Task | Yes | No | No |
| Move Task to another List | Yes | No | No |

> No task-level permission overrides needed for MVP. Space Permission is sufficient.

---

### Private Spaces

- Visible only to explicitly invited members
- A workspace Member or Guest who is not invited cannot see the Space exists at all
- Owner and Admin can always see and access all Spaces including private ones

---

## 14. Admin Panel

Internal panel for us (operators) to manage the SaaS platform.

**Dashboard:**
- Total Workspaces, Users, Tasks
- Active vs churned workspaces
- Sign-up trend chart

**User Management:**
- List all users
- Search users by name / email
- View user's workspaces
- Ban / reactivate user

**Workspace Management:**
- List all workspaces
- View workspace details and members
- Force delete workspace
- Impersonate workspace (for support)

**Subscription Management:**
- View plan per workspace (Free / Pro / Business)
- Override plan manually
- View billing status

**Support Tickets:**
- View all submitted support tickets
- Reply to tickets
- Change ticket status (Open / In Progress / Resolved)

**Analytics:**
- Feature usage stats
- Error rate monitoring

---

## 15. Customer Support

**Help Center:**
- Searchable FAQ articles
- Getting started guides
- Feature documentation

**Support Tickets:**
- Raise a ticket from within the app
- Ticket categories (Bug, Question, Feature Request, Billing)
- Track ticket status
- Reply thread

**Feature Requests:**
- Submit a feature request
- Vote on existing requests
- Status (Under Review / Planned / Shipped / Declined)

---

## 16. MVP Scope

### Included in MVP

- [x] Authentication (Email + Google OAuth)
- [x] Workspace (create, invite, roles)
- [x] Space (create, permissions, private/public)
- [x] Folder (optional grouping)
- [x] List (custom statuses)
- [x] Task (full fields, checklists, dependencies)
- [x] Subtask
- [x] List View
- [x] Board View (Kanban)
- [x] My Tasks View
- [x] Comments & Mentions
- [x] Activity Log
- [x] File Attachments
- [x] Global Search
- [x] Filters & Sort
- [x] In-app Notifications
- [x] Email Notifications
- [x] Permission Model
- [x] Admin Panel (basic)
- [x] Support Tickets

### Excluded from MVP (Post-MVP)

- [ ] AI Features (Task Creation, Search, Summary, Suggestions)
- [ ] Gantt / Timeline View
- [ ] Workload View
- [ ] Automations / Rules
- [ ] Custom Roles (beyond Owner/Admin/Member/Guest)
- [ ] Docs (wiki-style)
- [ ] Whiteboard
- [ ] Advanced Analytics
- [ ] Time Tracking (built-in timer)
- [ ] Integrations (Slack, GitHub, Jira)
- [ ] Marketplace / Apps
- [ ] Mobile App (native iOS/Android)
- [ ] Billing / Subscription (Stripe)
- [ ] SSO / SAML

---

## Tech Stack (Planned)

| Layer | Choice |
|-------|--------|
| Frontend | Next.js (React) |
| Backend | Next.js API Routes / Server Actions |
| Database | PostgreSQL |
| ORM | Prisma |
| Cache | Redis |
| File Storage | S3 / Cloudflare R2 |
| Auth | Better Auth (with Admin Plugin) |

---

*Last updated: 2026-06-03*
