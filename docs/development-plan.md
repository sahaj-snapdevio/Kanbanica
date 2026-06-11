# Development Plan

## How to use this file

Each phase is a self-contained development step. Work through them **in order** — each phase depends on the previous one being complete. Do not skip ahead.

At the start of each phase, reference the relevant feature doc from the `docs/` folder. At the end of each phase, the app should be in a working, testable state before moving to the next.

**Relevant docs:** All feature specs live in `f:\teamority\docs\`

---

## Tech Stack (reference)

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | Better Auth (with Admin Plugin) |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| State Management | Zustand (client state) + React Query / SWR (server state) |
| File Storage | S3-compatible (any provider) |
| Cache | None (MVP) — Better Auth built-in rate limiting |
| Email | SMTP (Nodemailer) |
| Rich Text | Tiptap |

---

## Phase Overview

```
Phase 0  →  Project Setup
Phase 1  →  Database Schema
Phase 2  →  Landing Page
Phase 3  →  Authentication Pages
Phase 4  →  Onboarding
Phase 5  →  Workspace
Phase 6  →  Space
Phase 7  →  Folder (Post-MVP — skipped in initial build)
Phase 8  →  List
Phase 9  →  Task
Phase 10 →  Subtask
Phase 11 →  Sprint
Phase 12 →  Views (Board + Calendar + My Tasks)
Phase 13 →  Collaboration (Comments + Activity)
Phase 14 →  Search & Filters
Phase 15 →  Notifications
Phase 16 →  Permission Enforcement (audit pass)
Phase 17 →  Admin Panel
Phase 18 →  Customer Support
Phase 19 →  QA & Launch Prep
```

---

## Phase 0 — Project Setup

**Goal:** Working Next.js project with all tools installed, all singletons created, infrastructure wired up, and both the Next.js and worker processes running.

**Reference docs:** [services.md](./services.md), [authentication.md](./authentication.md), [design-system.md](./design-system.md)

> Do not write any feature code until every task in this phase is complete. The singletons and patterns built here are used by every phase that follows.

### Step 1 — Scaffold

- [ ] Init Next.js 15 project
  ```bash
  npx create-next-app@latest teamority --typescript --tailwind --app --src-dir
  cd teamority
  ```
- [ ] Install shadcn/ui
  ```bash
  npx shadcn@latest init
  ```
- [ ] Install all dependencies in one pass
  ```bash
  pnpm add prisma @prisma/client better-auth @aws-sdk/client-s3 @aws-sdk/s3-request-presigner \
    nodemailer pg-boss zod \
    @tiptap/react @tiptap/starter-kit \
    zustand swr \
    date-fns sharp \
    lucide-react
  pnpm add -D @types/nodemailer tsx concurrently
  ```
- [ ] Set up route groups in `src/app/`:
  ```
  src/app/
  (marketing)/        <- public pages (landing, about)
      layout.tsx      <- no sidebar, no auth
  (auth)/             <- sign-in, onboarding
      layout.tsx      <- minimal layout
  (app)/              <- authenticated app
      layout.tsx      <- sidebar + auth guard
  admin/              <- platform admin panel
      layout.tsx      <- admin auth guard
  ```
- [ ] Set up full folder structure:
  ```
  src/
    app/
    components/
      ui/             <- shadcn primitives
      common/         <- shared app components
    lib/
      api/            <- auth-helpers.ts
      worker/         <- enqueue.ts, job-types.ts, handlers/
    server/           <- server actions (one file per feature)
    hooks/
    store/            <- Zustand stores
    types/
  ```

### Step 2 — Environment

- [ ] Copy `.env.example` to `.env.local` and fill local values:
  ```
  # Database
  DATABASE_URL=postgresql://postgres:dev@localhost:5432/teamority

  # Better Auth
  BETTER_AUTH_SECRET=                    # 32+ char random string
  BETTER_AUTH_URL=http://localhost:3000

  # SMTP (use Mailtrap or similar for local dev)
  SMTP_HOST=
  SMTP_PORT=587
  SMTP_SECURE=false
  SMTP_USER=
  SMTP_PASS=
  SMTP_FROM=noreply@teamority.com

  # Cloudflare R2 (or local MinIO for dev)
  R2_ENDPOINT=
  R2_ACCESS_KEY_ID=
  R2_SECRET_ACCESS_KEY=
  R2_BUCKET_NAME=teamority-dev
  R2_PUBLIC_URL=

  # App
  NEXT_PUBLIC_APP_URL=http://localhost:3000

  # Web Push (optional in dev)
  VAPID_PUBLIC_KEY=
  VAPID_PRIVATE_KEY=
  VAPID_SUBJECT=mailto:admin@teamority.com
  ```
- [ ] Create `src/lib/env.ts` -- Zod validation, fail fast on startup
  ```typescript
  import { z } from 'zod'
  const schema = z.object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number(),
    SMTP_SECURE: z.coerce.boolean().default(false),
    SMTP_USER: z.string().min(1),
    SMTP_PASS: z.string().min(1),
    SMTP_FROM: z.string().email(),
    R2_ENDPOINT: z.string().url(),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET_NAME: z.string().min(1),
    R2_PUBLIC_URL: z.string().url(),
    NEXT_PUBLIC_APP_URL: z.string().url(),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
  })
  export const env = schema.parse(process.env)
  ```

### Step 3 — Core Singletons (build in this order)

- [ ] `src/lib/db.ts` -- Prisma singleton
  ```typescript
  import { PrismaClient } from '@prisma/client'
  const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }
  export const db = globalForPrisma.prisma ?? new PrismaClient()
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
  ```
- [ ] `src/lib/auth.ts` -- Better Auth server instance (see [authentication.md](./authentication.md))
- [ ] `src/lib/storage.ts` -- R2 client singleton + `getAttachmentUrl(r2Key)` + `deleteFromR2(r2Key)` helpers (see [services.md](./services.md))
- [ ] `src/lib/email/` -- Nodemailer transporter singleton + send helper

### Step 4 — Worker Infrastructure

> Build this before any feature that uses async jobs. Jobs queue safely even with zero handlers registered.

- [ ] `src/lib/worker/job-types.ts` -- empty registry to start
  ```typescript
  export const JOB_NAMES = {} as const
  export type JobPayloadMap = Record<string, never>
  export const QUEUE_OPTIONS: Record<string, object> = {}
  ```
- [ ] `src/lib/worker/enqueue.ts` -- mutex-guarded PgBoss singleton (see [services.md](./services.md))
- [ ] `scripts/worker.ts` -- worker entrypoint (imports handlers, calls `boss.work()`)
- [ ] Update `package.json` scripts:
  ```json
  {
    "scripts": {
      "dev": "concurrently \"next dev\" \"tsx --watch scripts/worker.ts\"",
      "worker": "tsx scripts/worker.ts"
    }
  }
  ```
- [ ] Confirm both processes start with `pnpm dev` with no errors

### Step 5 — Permissions and Auth Helpers

- [ ] `src/lib/permissions.ts` -- `getAccessibleSpaceIds`, `requireSpaceMembershipAndPermission`, `hasPermissionLevel` (see [permission-model.md](./permission-model.md), [space.md](./space.md))
- [ ] `src/lib/api/auth-helpers.ts` -- `getSessionOrUnauthorized()` (see [authentication.md](./authentication.md))
- [ ] `src/lib/activity-log.ts` -- `writeActivityLog()` fire-and-forget (see [collaboration.md](./collaboration.md))

### Step 6 — Shared UI Primitives

- [ ] `src/components/ui/local-date.tsx` -- `<LocalDate />` with `relative`, `date`, `datetime` formats (see [design-system.md](./design-system.md))
- [ ] `GET /api/health` route returning `{ ok: true, db: 'connected' }` after `db.$queryRaw` SELECT 1

### Step 7 — Database

- [ ] Start PostgreSQL locally:
  ```bash
  docker run --name teamority-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=teamority -p 5432:5432 -d postgres:16
  ```
- [ ] `npx prisma init`
- [ ] Write full Prisma schema -- do in Phase 1 (see [database-schema.md](./database-schema.md))
- [ ] `npx prisma migrate dev --name init`
- [ ] `npx better-auth migrate`

### Definition of Done

- [ ] `pnpm dev` starts Next.js (port 3000) and the worker with no errors
- [ ] `GET /api/health` returns `{ ok: true, db: 'connected' }`
- [ ] `src/lib/env.ts` throws a descriptive error if any required env var is missing
- [ ] All singletons exist: `db.ts`, `auth.ts`, `storage.ts`, `permissions.ts`, `enqueue.ts`
- [ ] `<LocalDate />` renders correctly in a test page
- [ ] No feature code written yet -- infrastructure only

---


## Phase 1 — Database Schema

**Goal:** Full Prisma schema defined for all modules. All tables created in the database.

**Reference docs:** All feature docs (each has a Data Model section)

### Tasks

- [ ] Write Prisma schema for all models (in one `schema.prisma` file):

  **Auth tables (Better Auth managed):**
  - [ ] `User`
  - [ ] `Session`
  - [ ] `Account`
  - [ ] `Verification`

  **Core product tables:**
  - [ ] `Workspace`
  - [ ] `WorkspaceMember`
  - [ ] `Space`
  - [ ] `SpaceMember`
  - [ ] `Folder` (post-MVP — skip for now)
  - [ ] `List`
  - [ ] `ListStatus`
  - [ ] `Task`
  - [ ] `TaskAssignee`
  - [ ] `TaskWatcher`
  - [ ] `TaskTag`
  - [ ] `Tag`
  - [ ] `TaskDependency`
  - [ ] `Checklist`
  - [ ] `ChecklistItem`
  - [ ] `TaskAttachment`
  - [ ] `TaskTimeLog`
  - [ ] `Sprint`
  - [ ] `TaskSprint`
  - [ ] `Comment`
  - [ ] `CommentReaction`
  - [ ] `ActivityLog`

  **App feature tables:**
  - [ ] `Notification`
  - [ ] `UserNotificationPreference`
  - [ ] `UserEmailPreference`
  - [ ] `MutedEntity`
  - [ ] `PushSubscription`
  - [ ] `UserListViewPreference`
  - [ ] `UserMyTasksPreference`
  - [ ] `SavedFilter`
  - [ ] `UserSearchHistory`
  - [ ] `UserOnboardingProgress`

  **Platform tables:**
  - [ ] `SupportTicket`
  - [ ] `SupportTicketMessage`
  - [ ] `FeatureRequest`
  - [ ] `FeatureRequestVote`
  - [ ] `FeatureRequestComment`
  - [ ] `HelpArticle`
  - [ ] `PlatformAuditLog`

- [ ] Run initial migration:
  ```bash
  npx prisma migrate dev --name init
  ```
- [ ] Seed database with:
  - [ ] One platform admin user (for development)
- [ ] Confirm Prisma Studio opens and shows all tables:
  ```bash
  npx prisma studio
  ```

**Done when:** All tables exist in the database, seed data is populated, and Prisma Studio shows all tables correctly.

---

## Phase 2 — Landing Page

**Goal:** Full public-facing marketing site is live before auth pages. Visitors can see what the product is, view pricing, and click through to sign up.

**Reference doc:** [landing-page.md](./landing-page.md)

### Tasks

**Layout & Navigation:**
- [ ] Public layout (separate from app layout — no sidebar, no auth)
- [ ] Sticky nav bar (transparent → solid on scroll)
- [ ] Mobile hamburger menu
- [ ] Logo + wordmark
- [ ] Smooth scroll to section on anchor link click
- [ ] Nav links: Features, Help, Sign In, Get Started

**Sections (in order):**
- [ ] Hero section — headline, subheadline, primary + secondary CTA, trust nudge, hero image placeholder
- [ ] Social proof bar — static text e.g. `"500+ teams already using Teamority"`
- [ ] Features section — 6 feature cards (Tasks, Sprints, Views, Comments, Notifications, Search)
- [ ] How It Works — 4 steps (Create Workspace → Invite Team → Organize → Start Working)
- [ ] Views Showcase — tab switcher (List / Board / Calendar) with screenshots or placeholder images
- [ ] Testimonials — 3 static cards
- [ ] General FAQ — accordion (7 questions)
- [ ] Final CTA banner
- [ ] Footer — all links (Product, Company, Support, Legal, Social)

**Additional pages:**
- [ ] `/privacy` — Privacy Policy (required before launch — can be placeholder text initially)
- [ ] `/terms` — Terms of Service (required before launch)
- [ ] `/cookies` — Cookie Policy (required before launch)
- [ ] `/about` — simple static page

**SEO:**
- [ ] `<title>` and `<meta description>` on all public pages
- [ ] Open Graph tags (og:title, og:description, og:image)
- [ ] `sitemap.xml`
- [ ] `robots.txt`

**Performance:**
- [ ] Hero image uses Next.js `<Image>` with `priority` flag
- [ ] Lighthouse score 90+ (Performance, Accessibility, SEO)

**Analytics:**
- [ ] `page_view`, `cta_click_hero`, `cta_click_nav`, `cta_click_final`
- [ ] `pricing_toggle`, `pricing_plan_click`, `view_tab_switch`, `faq_expand`

**Done when:** Landing page is fully built, all sections render, pricing fetches from the DB, legal pages exist, and Lighthouse scores 90+. Sign In / Get Started buttons link to auth pages (which will be built next).

---

## Phase 3 — Authentication

**Goal:** Users can sign up, sign in, sign out, verify email, and reset password. Magic link passwordless login works.

**Reference doc:** [authentication.md](./authentication.md), [settings.md](./settings.md) (section 1.1 + 1.2)

### Tasks

**Better Auth setup:**
- [ ] Configure Better Auth in `src/lib/auth.ts`
  - Magic link provider (passwordless — sends a one-time sign-in link via email)
  - Admin Plugin
  - Prisma adapter
  - Session config (7-day TTL, 30-day with remember me)
- [ ] Mount Better Auth handler at `src/app/api/auth/[...all]/route.ts`
- [ ] Configure Nodemailer (SMTP) as the email provider for Better Auth

**Pages:**
- [ ] `/sign-in` — email input form; user enters email and receives a magic link
- [ ] `/magic-link` — handles token from URL, signs user in or shows expired error
- [ ] `/verify-email` — handles email verification token (for new accounts)

**Logic:**
- [ ] Rate limiting on magic link requests: rely on Better Auth's built-in rate limiting
- [ ] Magic link valid for **15 minutes**, single-use, invalidated after click
- [ ] If email is not registered: auto-create account on first magic link use (sign up = sign in)
- [ ] On magic link use: revoke the token immediately after session creation
- [ ] Redirect logged-in users away from auth pages → app
- [ ] Protect all app routes — unauthenticated users redirected to `/sign-in`

**Email templates (via SMTP / Nodemailer):**
- [ ] Magic link email (link valid 15 minutes)
- [ ] Welcome email (after first successful sign in — new account created)

**Account Settings (built here, used throughout):**
- [ ] `/settings/account` — update name, avatar upload
- [ ] `/settings/sessions` — view all active sessions, revoke individual, revoke all others

**Avatar system (build once here, used everywhere — reference [avatar-system.md](./avatar-system.md)):**
- [ ] `getInitials(fullName)` utility — first + last initial, max 2 chars, uppercased
- [ ] `getAvatarColor(userId)` utility — deterministic hash of UUID → index into 10-color palette
- [ ] `<Avatar>` component — accepts `user: { name, image, id }`, size prop (`xs/sm/md/lg/xl`), renders photo → initials fallback in correct priority order
- [ ] `<AvatarStack>` component — stacks up to 3 avatars with white border + `+N` overflow chip
- [ ] Avatar upload: resize server-side to max 256×256px before storing to R2, delete old file on replace
- [ ] Greyed-out avatar state (40% opacity + tooltip) for removed workspace members
- [ ] Workspace avatar: rounded square (8px radius), supports `logo_url` → `logo_emoji` → initials fallback
- [ ] "Deleted User" avatar: grey circle with person icon, no initials
- [ ] System event avatar: Teamority logo mark for automated activity log entries
- [ ] Delete account (with ownership transfer guard)

**Done when:** A new user can sign in via magic link (auto-creates account on first use), verify email, and sign out. All auth pages are styled consistently with the landing page.

---

## Phase 4 — Onboarding & Empty States

**Goal:** New users are guided to create a Workspace and first Space before reaching the main app. Every screen a user can land on with no data shows a clear empty state with a CTA.

**Reference docs:** [workspace.md](./workspace.md), [space.md](./space.md), [empty-states.md](./empty-states.md)

### Tasks

**Onboarding flow:**
- [ ] `/onboarding` route — protected, only accessible if user has no workspace
- [ ] If user already has a workspace: redirect away from `/onboarding` to their workspace
- [ ] Step 1 UI: Create Workspace
  - [ ] Explainer above input: *"Your Workspace is your company or team's home. Everything your team works on lives here."*
  - [ ] Name input (required)
  - [ ] Logo upload or emoji picker (optional)
- [ ] Step 2 UI: Create first Space
  - [ ] Hierarchy diagram shown above input: `Workspace → Space → List → Task` with example values (`Acme Inc → Engineering → Backlog → Fix login bug`)
  - [ ] Explainer: *"A Space is where your team's work lives — like a department or project area. You can create more later."*
  - [ ] Name input (required)
  - [ ] Color picker
- [ ] On Space creation: auto-create default List named `"List"` inside it
- [ ] On List creation: auto-create one demo welcome task inside it
  - [ ] Title: `"👋 Welcome to [Workspace Name] — click here to see how a task works"`
  - [ ] Description: pre-filled walkthrough copy
  - [ ] Assignee: workspace creator
  - [ ] Tag: `demo` (used to identify and auto-delete when creator makes their first real task)
- [ ] On completion: redirect to `/[workspaceId]/[spaceId]/list/[listId]`
- [ ] Workspace slug auto-generated from name (slugify) — ensure uniqueness; slug is vanity only, routing uses workspace id
- [ ] Create `UserOnboardingProgress` record for the workspace creator on workspace creation

**Getting Started checklist (workspace creator only):**
- [ ] Show checklist pinned above task list in the first List for the workspace creator
- [ ] 6 checklist items — steps 1 & 2 auto-checked, steps 3–6 tracked via `UserOnboardingProgress`
- [ ] Auto-check `step_first_task` when user creates any task
- [ ] Auto-check `step_invite` when user sends any workspace invite
- [ ] Auto-check `step_due_date` when user sets a due date on any task
- [ ] Auto-check `step_board_view` when user switches to Board view
- [ ] Progress bar fills as steps complete
- [ ] On all 6 complete: show `"You're all set! 🎉"` → fade out after 3 seconds
- [ ] `[Dismiss checklist]` link → sets `dismissed_at`, hides permanently

**Empty states (implement alongside each feature phase, but plan here):**
- [ ] Empty List (no tasks) — icon + headline + `"+ Add your first task"` CTA
- [ ] Empty Board View — 3 cases: no tasks, filtered no results, sprint with no tasks
- [ ] Empty Calendar View — no tasks with due dates
- [ ] Empty Backlog — all tasks are in sprints
- [ ] Empty Sprint panel — no sprints created yet
- [ ] My Tasks — no assigned tasks
- [ ] Empty Space — no Lists
- [ ] Empty Space — no Lists created yet (second empty state for when all lists are archived)
- [ ] Notifications inbox — zero notifications
- [ ] Search — no results (with recent searches)
- [ ] Comments — no comments (merges into composer)
- [ ] Support Tickets — no tickets submitted
- [ ] Workspace Members — only the creator (invite CTA)
- [ ] All empty states: do NOT show create CTAs to View-only permission users
- [ ] All empty states: show skeleton loader during fetch, switch to empty state only on confirmed zero results

**Done when:** A new user after sign-up is guided through onboarding, lands inside their first Space with a default List, sees the Getting Started checklist, and every other empty screen they might reach shows a clear message and CTA.

---

## Phase 5 — Workspace

**Goal:** Full workspace management — create, edit, switch, invite members, manage roles.

**Reference doc:** [workspace.md](./workspace.md), [settings.md](./settings.md) (sections 2 + 4)

### Tasks

**API Routes / Server Actions:**
- [ ] Create workspace
- [ ] Get workspaces for current user
- [ ] Get workspace details
- [ ] Update workspace (name, logo, slug)
- [ ] Delete workspace (Owner only, confirm by typing name)
- [ ] Invite member by email
- [ ] Generate / disable invite link
- [ ] Join via invite link
- [ ] List members
- [ ] Change member role
- [ ] Remove member
- [ ] Transfer ownership

**UI:**
- [ ] Workspace switcher (sidebar top-left) — shows all user workspaces
- [ ] `/[workspaceId]/settings/general` — edit name, logo, slug
- [ ] `/[workspaceId]/settings/members` — member list, invite, change role, remove
- [ ] `/[workspaceId]/settings/security` — invite link management
- [ ] Danger zone: Delete workspace with confirmation modal
- [ ] Transfer ownership modal
- [ ] **Sidebar bottom — Workspace Settings icon** (`Settings` from Lucide): links to `/[workspaceId]/settings/general`; visible to Owner and Admin only (hidden for Member/Guest)
- [ ] **Sidebar bottom — User profile row**: avatar + name; clicking opens a popover with links to `/settings/account`, `/settings/sessions`, `/settings/notifications`, and a Sign Out action (see [design-system.md](./design-system.md) Sidebar Bottom Bar section)

**Permission checks:**
- [ ] Only Owner can delete workspace or transfer ownership
- [ ] Only Owner and Admin can invite, manage members, access settings

**Done when:** Workspace creation, member invites (email + link), role changes, and deletion all work correctly with proper permission enforcement.

---

## Phase 6 — Space

**Goal:** Spaces can be created, edited, archived, with members and permissions managed.

**Reference doc:** [space.md](./space.md), [settings.md](./settings.md) (section 3)

### Tasks

**API Routes / Server Actions:**
- [ ] Create Space (with auto-created default List named "List")
- [ ] Get Spaces for workspace (respects private visibility)
- [ ] Get Space details
- [ ] Update Space (name, color, icon, visibility)
- [ ] Archive / Unarchive Space
- [ ] Delete Space (Admin+ only)
- [ ] List Space members
- [ ] Add member to Space (with permission level)
- [ ] Change member permission
- [ ] Remove member from Space

**UI:**
- [ ] Space section in left sidebar (grouped under Workspace)
- [ ] Create Space modal (name, color, icon, visibility)
- [ ] Space settings pages:
  - [ ] `/space/[spaceId]/settings/general`
  - [ ] `/space/[spaceId]/settings/members`
- [ ] Private Space shown with lock icon in sidebar
- [ ] Archived Spaces hidden from sidebar (accessible via settings)

**Permission checks:**
- [ ] Private Spaces invisible to non-members (even in API response)
- [ ] Owner and Admin always have access to all Spaces
- [ ] Only Full Access / Admin+ can manage Space members and settings

**Done when:** Spaces appear in sidebar, public/private visibility works correctly, members can be added with specific permissions, and permission checks are enforced on all actions.

---

## Phase 7 — Folder (POST-MVP — SKIP)

> **Do not implement this phase.** Folder is excluded from the MVP build. After completing Phase 6 (Space), go directly to Phase 8 (List). The `folder_id` field on the `List` model is nullable and stays `null` throughout MVP. See `docs/folder.md` for the full spec when you're ready to build it post-launch.

**Goal:** Folders can be created inside Spaces to organize Lists.

**Reference doc:** [folder.md](./folder.md)

### Tasks

**API Routes / Server Actions:**
- [ ] Create Folder in a Space
- [ ] Get Folders for a Space
- [ ] Update Folder (name, color)
- [ ] Archive / Unarchive Folder
- [ ] Delete Folder (folder-only mode — Lists move to Space root)
- [ ] Delete Folder with contents (permanent)
- [ ] Reorder Folders (drag-and-drop order)

**UI:**
- [ ] Folders shown as collapsible sections in sidebar under their Space
- [ ] Create Folder option in sidebar (next to Space name)
- [ ] Folder context menu (`...`): Edit, Archive, Delete
- [ ] Confirmation modal for Delete with two options (folder only vs. with contents)
- [ ] Drag-and-drop reorder in sidebar

**Done when:** Folders can be created, edited, collapsed in sidebar, and deleted with the correct behavior for each deletion mode.

---

## Phase 8 — List

**Goal:** Lists can be created inside Spaces or Folders. Custom statuses work. Lists have full CRUD.

**Reference doc:** [list.md](./list.md)

### Tasks

**API Routes / Server Actions:**
- [ ] Create List (with default statuses auto-seeded: Todo, In Progress, Review, Done)
- [ ] Get Lists for a Space
- [ ] Get List details
- [ ] Update List (name, color, description)
- [ ] Archive / Unarchive List
- [ ] Delete List
- [ ] Duplicate List
- [ ] Move List (to different Folder or Space)
- [ ] Reorder Lists
- [ ] Get statuses for a List
- [ ] Add status
- [ ] Update status (name, color, type)
- [ ] Delete status (blocked if tasks use it)
- [ ] Reorder statuses

**UI:**
- [ ] Lists shown in sidebar under their Folder or Space root
- [ ] Create List option in sidebar
- [ ] List header with name, view switcher, filter toolbar
- [ ] List settings modal: edit name, color, description, manage statuses
- [ ] Status management panel: add, edit, reorder, delete statuses with color picker
- [ ] Confirmation modal for delete

**Done when:** Lists with custom statuses work end-to-end. Sidebar shows correct nesting. Status CRUD is fully functional.

---

## Phase 9 — Task

**Goal:** Full task management — the core of the product. All task fields, CRUD, and detail panel.

**Reference doc:** [task.md](./task.md)

### Tasks

**API Routes / Server Actions:**
- [ ] Create Task (quick + full)
- [ ] Get Tasks for a List (with filter and sort params)
- [ ] Get Task details
- [ ] Update Task (all fields)
- [ ] Delete Task
- [ ] Archive / Unarchive Task
- [ ] Duplicate Task
- [ ] Move Task (to another List)
- [ ] Add / remove assignees
- [ ] Add / remove watchers
- [ ] Upload attachment
- [ ] Delete attachment
- [ ] Add / update / delete Checklist
- [ ] Add / update / check / delete ChecklistItem
- [ ] Add / remove Dependency
- [ ] Log time
- [ ] Get Activity Log for a Task

**UI:**
- [ ] List View — task rows with inline editable fields (status, priority, assignee, due date)
- [ ] Quick create task: inline input at bottom of List (`+ Add Task`) → Enter to save
- [ ] Task detail panel (slide-in from right or full page modal):
  - [ ] Title (inline edit)
  - [ ] Status pill dropdown
  - [ ] Priority badge dropdown
  - [ ] Assignees multi-select
  - [ ] Due date picker (single date + date range)
  - [ ] Tags multi-select with create-on-type
  - [ ] Description (Tiptap rich text editor)
  - [ ] Subtasks section (Phase 9)
  - [ ] Checklist section (add checklists, check items)
  - [ ] Dependencies section (add blocked-by / blocking)
  - [ ] Attachments section (upload, preview, download, delete)
  - [ ] Watchers section
  - [ ] Time log section
  - [ ] Activity timeline (comments + events interleaved — Phase 12)
- [ ] Task card context menu (`...`): Duplicate, Move, Archive, Delete, Copy Link
- [ ] Overdue tasks highlighted in red (due date passed, not closed)
- [ ] Recurring task configuration UI (daily / weekly / monthly / custom)
- [ ] Recurring task auto-create logic (background job or on-close trigger)

**Done when:** Tasks can be fully created, edited, and managed. The task detail panel shows all fields. Attachments upload to R2. Activity log records every change.

---

## Phase 10 — Subtask

**Goal:** Tasks can have subtasks nested one level deep. Progress rollup works.

**Reference doc:** [subtask.md](./subtask.md)

### Tasks

**API Routes / Server Actions:**
- [ ] Create Subtask under a parent Task
- [ ] Get Subtasks for a Task
- [ ] Reorder Subtasks
- [ ] Convert Checklist Item to Subtask
- [ ] All Task CRUD applies to Subtasks (same endpoints, `parent_task_id` set)

**UI:**
- [ ] Subtasks section inside Task detail panel
- [ ] Quick create subtask (inline input)
- [ ] Progress bar showing `closed / total` subtasks
- [ ] Fraction counter on parent task card in List / Board view (e.g. `2/5`)
- [ ] Collapse / expand subtask list (per user state)
- [ ] Subtask opens as its own full detail panel with breadcrumb: `List › Parent Task › Subtask`
- [ ] Convert checklist item to subtask (context menu on checklist item)
- [ ] Subtasks shown in My Tasks view (Phase 11) with parent context

**Done when:** Subtasks are creatable inside tasks, progress rollup shows correctly, and subtasks appear in My Tasks view.

---

## Phase 11 — Sprint

**Goal:** Sprints can be created, started, tasks added, and closed. Auto-create and auto-close toggles work.

**Reference doc:** [sprint.md](./sprint.md)

### Tasks

**API Routes / Server Actions:**
- [ ] Create Sprint (name, goal, start date, duration, auto-create toggle, auto-close toggle)
- [ ] Get Sprints for a List
- [ ] Get Sprint details + progress metrics
- [ ] Update Sprint
- [ ] Delete Planned Sprint
- [ ] Start Sprint
- [ ] Close Sprint (with incomplete task handling: backlog / next sprint / leave)
- [ ] Add Task to Sprint
- [ ] Remove Task from Sprint
- [ ] Update story points on TaskSprint
- [ ] Get Backlog tasks (not in any sprint)
- [ ] Auto-create next sprint job (triggered on end date)
- [ ] Auto-close sprint job (triggered on end date if toggle enabled)

**UI:**
- [ ] Sprint panel inside List view (above/alongside task list)
- [ ] Create Sprint modal: name, goal, start date, duration picker (1/2/3/4 weeks), auto-create toggle, auto-close toggle (only visible if auto-create on)
- [ ] Sprint progress bar + metrics (tasks done / total, story points, days remaining)
- [ ] Backlog section: tasks not in any sprint
- [ ] Add task to sprint (drag from backlog or click `+`)
- [ ] Story points input per task in sprint view
- [ ] Close Sprint modal: list of incomplete tasks with decision per task (or apply to all)
- [ ] Sprint History page: list of closed sprints with stats
- [ ] Board View in sprint mode: shows only active sprint tasks (toggle to show backlog)

**Done when:** Full sprint lifecycle works — create, start, add tasks, track progress, and close with incomplete task handling. Auto-create and auto-close toggles function correctly.

---

## Phase 12 — Views

**Goal:** Board View, Calendar View, and My Tasks View work alongside the existing List View.

**Reference doc:** [views.md](./views.md)

### Tasks

**Board View:**
- [ ] Tasks grouped into columns by status
- [ ] Drag-and-drop task cards between columns (updates status)
- [ ] Drag-and-drop within column (reorders)
- [ ] Quick create task at bottom of each column
- [ ] Task cards show: title, priority badge, assignee avatars, due date, subtask fraction

**Calendar View:**
- [ ] Monthly grid layout
- [ ] Weekly view toggle
- [ ] Tasks placed on their due date
- [ ] Date range tasks shown as spanning bars
- [ ] Unscheduled tasks sidebar panel (tasks with no due date)
- [ ] Drag task to different day to change due date
- [ ] Click day cell to quick-create task with that due date pre-filled
- [ ] Overdue days highlighted

**My Tasks View:**
- [ ] Global route `/my-tasks`
- [ ] Workspace-wide: shows all tasks + subtasks assigned to current user
- [ ] Default grouping: Overdue / Due Today / Due This Week / Upcoming / No Due Date
- [ ] Alternative grouping: By Space / By List / By Priority / By Status
- [ ] Each task shows breadcrumb context (Space › List)
- [ ] Inline status and due date change
- [ ] Filter: by Space, Priority, Status, toggle Show Completed

**View Switcher:**
- [ ] Tab bar in List header: `[ List ] [ Board ] [ Calendar ]`
- [ ] View preference saved per user per List (`UserListViewPreference`)
- [ ] Filters carry across view switches

**Done when:** All three views work with the same data. Drag-and-drop on Board View updates task status. Calendar drag updates due date. My Tasks shows correct grouped tasks.

---

## Phase 13 — Collaboration

**Goal:** Comments, replies, reactions, activity timeline, and file attachments all work.

**Reference doc:** [collaboration.md](./collaboration.md)

### Tasks

**Comments:**
- [ ] Post comment on Task (Tiptap rich text)
- [ ] Reply to comment (threaded)
- [ ] Edit own comment
- [ ] Delete comment (soft delete — show `[Comment deleted]` if has replies, hard delete if no replies)
- [ ] Resolve / unresolve comment thread
- [ ] Emoji reactions (add / remove toggle, count display)
- [ ] @mention in comment (user search dropdown on `@` trigger)
- [ ] Attach file inside comment

**Activity Timeline:**
- [ ] Record activity log entries on all tracked task events
- [ ] Display interleaved activity + comments chronologically in Task detail panel
- [ ] Each entry: avatar, name, action, timestamp (relative + hover for exact)

**Space Activity Feed:**
- [ ] `/space/[spaceId]/activity` page
- [ ] Shows all task changes in the Space (last 30 days)
- [ ] Filter by member, event type, List

**Done when:** Comments post with rich text, threads work, reactions toggle correctly, activity log records all events and displays correctly in the task panel.

---

## Phase 14 — Search & Filters

**Goal:** Global search works across the workspace. List filters and sort work per view.

**Reference doc:** [search-and-filters.md](./search-and-filters.md)

### Tasks

**Global Search:**
- [ ] `Ctrl+K` / `Cmd+K` opens search command palette (intercepts browser default using `{ capture: true }`)
- [ ] Search input with 300ms debounce
- [ ] Search tasks, lists, spaces, members (min 2 characters)
- [ ] Results grouped by type (Tasks / Lists / Spaces / Members)
- [ ] Max 10 results per group in dropdown
- [ ] Full results page at `/search?q=`
- [ ] Recent items shown when palette opens with no input
- [ ] Permission scoping — private Spaces excluded
- [ ] Archived items excluded by default (toggle to include)

**Keyboard Shortcuts (reference [keyboard-shortcuts.md](./keyboard-shortcuts.md)):**
- [ ] Global shortcut handler — single `keydown` listener on `window` with `{ capture: true }`, mounted in root client component
- [ ] Suppress single-key shortcuts when focus is inside `<input>`, `<textarea>`, or `contenteditable`
- [ ] `C` — open quick-create task (context-aware: inline in List View, modal elsewhere)
- [ ] `?` — open in-app keyboard shortcuts reference panel
- [ ] `Esc` — close topmost open modal / panel / dropdown (one layer at a time)
- [ ] `G` → `H` / `G` → `S` / `G` → `N` — sequential navigation shortcuts (1-second window)
- [ ] List View: `↑`/`↓` row focus, `Enter` open panel, `E` inline title edit, `Space` toggle checkbox
- [ ] Task detail panel: `A` assignee picker, `D` due date picker, `L` tag picker, `Ctrl/Cmd+Shift+,` cycle priority
- [ ] Rich text editor: `Ctrl/Cmd+Enter` submit comment — override Tiptap default if needed
- [ ] `Backspace`/`Delete` on focused task row — show confirmation modal, `event.preventDefault()` to block browser back
- [ ] Keyboard shortcuts panel UI: modal triggered by `?`, also linked from sidebar Help menu
- [ ] Verify `Ctrl/Cmd+K` inside Tiptap opens link dialog (not global search) — Tiptap handles this natively

**List Filters:**
- [ ] Filter panel in List / Board / Calendar view toolbar
- [ ] Filters: Status, Priority, Assignee, Due Date, Tags, Created By, Date Range
- [ ] Active filters shown as removable chips
- [ ] AND logic between different filter types, OR within same filter
- [ ] Clear all filters button
- [ ] Save filter combination with a name (`SavedFilter`)
- [ ] Saved filters dropdown for quick reapply
- [ ] Filter state carries across view switches (List ↔ Board ↔ Calendar)

**Sort:**
- [ ] Sort dropdown: Due Date, Priority, Status, Assignee, Created Date, Last Updated
- [ ] Sort disables drag-and-drop reordering
- [ ] Sort saved per user per List

**My Tasks Filters:**
- [ ] Filter by Space, List, Priority, Status, Due Date
- [ ] Toggle: Show Completed (default hidden)

**Done when:** `Ctrl+K` opens search, results are permission-scoped, filters work correctly in all views, saved filters persist.

---

## Phase 15 — Notifications

**Goal:** In-app, email, and browser push notifications work for all trigger events.

**Reference doc:** [notifications.md](./notifications.md)

### Tasks

**In-App Notifications:**
- [ ] Bell icon in top nav with unread count badge
- [ ] Notification panel (slide-out): All / Unread / Mentions tabs
- [ ] Notification items with actor, action, context, timestamp
- [ ] Mark individual as read
- [ ] Mark all as read
- [ ] Notification grouping (3+ events on same task within 10 min = one grouped notification)
- [ ] 90-day retention (cron job to delete old notifications)

**Notification triggers (create notification records on these events):**
- [ ] Task assigned / unassigned
- [ ] Due date reminder (1 day before, on due date, on overdue)
- [ ] Status changed (for watchers and assignees)
- [ ] New comment on task
- [ ] Reply to comment
- [ ] @mention in comment or description
- [ ] Sprint started / ending soon
- [ ] Workspace invite

**Email Notifications:**
- [ ] Instant email via SMTP (Nodemailer) on notification creation (if user preference = instant)
- [ ] Daily digest email (cron job at configured time)
- [ ] Skip digest if zero notifications
- [ ] Unsubscribe link in every email

**Browser Push:**
- [ ] `PushSubscription` record on permission grant
- [ ] Web Push API integration (use `web-push` npm package)
- [ ] Push for: @mention, task assigned, due date reminder, new comment, overdue

**Notification Settings:**
- [ ] `/settings/notifications` page
- [ ] Toggle per trigger: In-App / Email / Push
- [ ] Email delivery mode: Instant / Daily Digest / Off
- [ ] Digest time + timezone setting
- [ ] Per-Space mute (from Space sidebar `...`)
- [ ] Per-Task mute (from Task detail `...`)
- [ ] Muted items list with unmute option

**Due Date Reminder Job:**
- [ ] Cron: runs daily, finds tasks due tomorrow → send reminders
- [ ] Cron: runs daily, finds tasks due today → send reminders
- [ ] Cron: runs daily, finds tasks that became overdue → send reminders
- [ ] Skip if task is already closed

**Done when:** All notification triggers fire correctly, in-app bell shows unread count, email notifications send via SMTP, browser push works after permission grant.

---

## Phase 16 — Permission Enforcement Audit

**Goal:** Verify every API route and server action enforces permissions correctly. No route skips the check.

**Reference doc:** [permission-model.md](./permission-model.md)

### Tasks

- [ ] Audit every API route — confirm permission check exists at the top of every handler
- [ ] Implement a shared `checkPermission(user, action, entity)` utility used by all routes
- [ ] Verify Private Space invisibility — API must return 404 (not 403) for Private Spaces the user is not a member of (403 reveals the Space exists)
- [ ] Verify Owner / Admin bypass works correctly on all routes
- [ ] Verify Guest isolation — Guests cannot see workspace member list, settings, or other Spaces
- [ ] Write permission boundary tests for critical actions:
  - [ ] View-only user cannot create/edit tasks
  - [ ] View-only user CAN comment
  - [ ] Edit user cannot delete tasks or manage Space structure
  - [ ] Guest cannot see private Spaces
  - [ ] Member cannot access workspace settings
- [ ] Confirm frontend hides UI elements based on permission (UX only — backend is truth)

**Done when:** All permission rules from the permission model doc are enforced server-side with zero gaps. Tests pass for all boundary cases.

---

## Phase 17 — Admin Panel

**Goal:** Internal `/admin` panel works for platform admins. User management, workspace management, support tickets, and analytics.

**Reference doc:** [admin-panel.md](./admin-panel.md)

### Tasks

**Access control:**
- [ ] `/admin` route group — check `is_platform_admin = true` on session user, else redirect to `/`
- [ ] All `/api/admin/*` routes return 403 for non-platform-admins

**Dashboard:**
- [ ] Metrics cards (total users, workspaces, tasks, open tickets, sign-ups today/month)
- [ ] Sign-up trend chart (last 30 days)
- [ ] Recent platform activity feed

**User Management:**
- [ ] `/admin/users` — paginated list with search and filters
- [ ] `/admin/users/[id]` — user detail (profile, workspaces, sessions)
- [ ] Ban / Unban user (Better Auth Admin Plugin)
- [ ] Impersonate user (Better Auth Admin Plugin) — log in `PlatformAuditLog`
- [ ] Revoke sessions
- [ ] Send password reset email
- [ ] Manual email verification

**Workspace Management:**
- [ ] `/admin/workspaces` — paginated list with search and filters
- [ ] `/admin/workspaces/[id]` — workspace detail (overview, members, usage stats)
- [ ] Impersonate workspace Owner
- [ ] Force delete workspace (with email to Owner)

**Support Tickets:**
- [ ] `/admin/tickets` — list with search and filters
- [ ] `/admin/tickets/[id]` — ticket detail with reply thread
- [ ] Reply to ticket (customer-visible)
- [ ] Add internal note (admin-only)
- [ ] Change ticket status
- [ ] Assign ticket to admin

**Analytics:**
- [ ] `/admin/analytics` — feature usage charts, DAU/WAU/MAU, error monitoring
- [ ] CSV export for all reports

**Audit Log:**
- [ ] `/admin/audit-log` — paginated log of all admin actions
- [ ] Every sensitive admin action writes to `PlatformAuditLog`

**Done when:** Platform admins can log in to `/admin`, manage users and workspaces, respond to tickets, and view analytics. All sensitive actions are audit-logged.

---

## Phase 18 — Customer Support

**Goal:** Help Center, Support Tickets, and Feature Requests are all functional.

**Reference doc:** [customer-support.md](./customer-support.md)

### Tasks

**Help Center:**
- [ ] `/help` — article list grouped by category
- [ ] Article detail page with rich text content
- [ ] Search articles (title + content)
- [ ] `"Was this helpful?"` feedback (yes/no)
- [ ] Help Center side panel (slide-out from `?` icon in app)
- [ ] Admin: create/edit/publish articles at `/admin/help-center`

**Support Tickets:**
- [ ] `/support/tickets` — user's ticket list
- [ ] `/support/tickets/new` — submit ticket form (subject, category, description, attachment)
- [ ] `/support/tickets/[id]` — ticket detail + reply thread
- [ ] 5 open ticket limit enforcement
- [ ] Auto-close resolved tickets after 14 days (cron job)
- [ ] 2-day warning email before auto-close
- [ ] Reopen on user reply

**Feature Requests:**
- [ ] `/support/feature-requests` — public board (sortable by Most Voted / Newest)
- [ ] Submit feature request form
- [ ] Upvote / unvote (toggle)
- [ ] Status badges (Under Review / Planned / In Progress / Shipped / Declined)
- [ ] Comment on feature request
- [ ] Official response pin (admin)
- [ ] Status change notification to all voters
- [ ] Admin: manage feature request statuses at `/admin/feature-requests`

**Done when:** Users can self-serve via Help Center, submit and track tickets, and vote on feature requests. Admins can respond to all of these from the Admin Panel.

---

## Phase 19 — QA & Launch Prep

**Goal:** The product is stable, tested, and ready for real users.

### Tasks

**End-to-end testing:**
- [ ] Full user journey: Sign up → Onboarding → Create Space → Create List → Create Task → Assign → Comment → Close Task
- [ ] Full sprint lifecycle: Create → Start → Add Tasks → Close → handle incomplete tasks
- [ ] Permission boundary tests: each role + Space permission combination
- [ ] Email delivery tests (sign up, invite, reset, notifications, digest)
- [ ] Browser push notification test
- [ ] File upload + attachment preview (images and non-images)

**Security checks:**
- [ ] All admin routes return 403 for non-platform-admins
- [ ] Private Space invisibility (returns 404)
- [ ] No self-notifications
- [ ] Forgot password always returns same message
- [ ] Reset / verification tokens are single-use
- [ ] File URLs are not publicly accessible (signed URLs or auth check)

**Performance:**
- [ ] Database indexes on all foreign keys and commonly queried fields
- [ ] Slow query audit (no N+1 queries)
- [ ] Pagination on all list endpoints

**Pre-launch checklist:**
- [ ] `/privacy` page live
- [ ] `/terms` page live
- [ ] `/cookies` page live
- [ ] SMTP credentials configured and sending verified in production
- [ ] S3-compatible bucket configured for production
- [ ] Environment variables set in production
- [ ] Error monitoring set up (Sentry or similar)
- [ ] Create first platform admin account

**Done when:** All tests pass, all pre-launch checklist items are complete, and the app is deployed to production.

---

## Development Notes

- **Always build mobile-responsive** — every screen must work on small screens, not just desktop
- **Permission checks go first** — every API handler starts with a permission check before any DB query
- **Server Actions over API Routes where possible** — use Next.js Server Actions for mutations, API Routes for external consumers
- **Optimistic UI** — status changes, reactions, checklist checks should feel instant (update UI before server confirms)
- **Error states** — every async action needs a loading state and an error state in the UI
- **No magic numbers** — configurable values (limits, timeouts, retention periods) belong in config/constants, not scattered inline
