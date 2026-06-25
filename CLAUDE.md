# Kanbanica — Claude Code Context

## What this project is

Kanbanica is a project management SaaS (ClickUp-style). Teams use it to organize work in Workspaces, Projects, Lists, Sprints, and Tasks.

Full product specs live in `docs/`. Read the relevant doc before implementing any feature.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Auth | Better Auth (with Admin Plugin) |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui |
| Rich Text | Tiptap |
| State | Zustand (client) + SWR (server) |
| File Storage | files-sdk (local `fs` adapter in dev → S3/R2/GCS in prod) |
| Background Jobs | pg-boss |
| Email | Nodemailer (SMTP) |

---

## Project Structure

```
app/                       ← Next.js App Router
├── (auth)/                ← sign-in, onboarding (unauthenticated layout)
├── (app)/                 ← main app (authenticated layout)
│   └── [workspaceId]/     ← workspace-scoped routes
├── api/                   ← API route handlers
└── admin/                 ← platform admin panel
components/
├── ui/                    ← shadcn/ui primitives
└── common/                ← shared app components
db/
├── schema/                ← Drizzle table definitions (one file per domain)
└── migrations/            ← generated SQL migrations
lib/
├── db.ts                  ← Drizzle client singleton
├── auth.ts                ← Better Auth server instance
└── utils.ts               ← shared utilities
hooks/                     ← custom React hooks
store/                     ← Zustand stores
types/                     ← TypeScript types and interfaces
server/                    ← server actions
```

---

## Key Decisions & Conventions

### UI Components
- **Always use shadcn/ui components** — never build custom UI primitives (calendars, dialogs, dropdowns, inputs, etc.).
- If a shadcn component isn't installed yet, add it with `npx shadcn@latest add <component>`.
- Custom components are only acceptable for app-specific composite UI that has no shadcn equivalent.

### User Avatars
- **Shared component:** `components/common/user-avatar.tsx` (`UserAvatar`) — use this everywhere a user avatar is shown. Props: `name`, `email`, `image` (storage key or null), `size` (`xs/sm/md/lg`), `className`.
- **Storage key → URL:** `user.image` in the DB is a storage key (e.g. `avatars/{userId}/{uuid}.webp`). Never use it directly as an `<img src>`. `UserAvatar` converts it internally. For files that use raw `AvatarImage` (e.g. task views with custom stacking styles), use the local helper `avatarSrc(key)` → `/api/files/${key}`.
- **Upload pipeline:** Sharp resizes to 256×256 WebP (quality 85) server-side before storing. Max raw upload: 2 MB.

### UI Consistency
- **Border radius:** All cards, modals, dialogs, popovers, and section containers must use `rounded-xl`. Buttons use `rounded-md`. Inputs use `rounded-md`. Never leave border radius missing on any surface.
- **Shadcn components only** — do not use native HTML `<select>`, `<input type="checkbox">`, `<input type="date">`, etc. Always use the shadcn equivalent (Select, Checkbox, Calendar/DatePicker).
- **Spacing:** Use consistent padding inside cards (`p-6` via `--card-spacing`). Section gaps use `space-y-6`.
- Before shipping any UI, verify every interactive element and container has correct border radius, hover states, and focus rings matching the design system.

### Routing
- All workspace routes use `[workspaceId]` (uuid) — NOT slug. Slug is a vanity alias only.
- Route shape: `/[workspaceId]/[spaceId]/list/[listId]` or `/[workspaceId]/[spaceId]/sprint/[sprintId]`

### Auth
- Magic link only — no passwords, no OAuth.
- Better Auth handles sessions. Use `auth.api.getSession()` server-side.
- All API routes check session first, return 401 if missing.

### Database
- Drizzle ORM. Schema files in `db/schema/`, migrations in `db/migrations/`.
- All IDs are UUIDs (generated via `crypto.randomUUID()` before insert).
- All tables have `createdAt` and `updatedAt` (updated manually on each write).
- Soft deletes use `isArchived` + `archivedAt` pattern (not a deleted flag).
- Hard deletes are immediate with no recovery unless otherwise stated in the feature doc.

### Permissions
- Two-level model: Workspace Role + Project Permission.
- Check workspace role first, then project permission for anything inside a project.
- Guests can only see Projects they are explicitly invited to.
- See `docs/permission-model.md` for the full matrix.

### API
- REST API under `/api/`.
- Always return `{ error: string }` on failure with the correct HTTP status.
- Never expose internal error messages to the client.

### File Uploads
- File storage is handled via **files-sdk** (`lib/storage.ts`) — a unified adapter layer.
- **Local dev:** `fs` adapter stores files in `./uploads/` and serves them via `/api/files/[...key]`.
- **Production:** swap adapter to S3/R2/GCS by setting `STORAGE_DRIVER` env var and credentials — no app code changes.
- The DB stores the **storage key** (e.g. `attachments/{workspaceId}/{taskId}/{uuid}/{filename}`) in the `file_url` column — never a full URL.
- Always delete the storage file before deleting the DB record (orphaned files are unrecoverable).
- Generate serving URLs on demand by calling `storage.url(key)` — never persist URLs.
- File size limit: 10 MB per file.

### Account Deletion
- **Block if sole owner**: before deleting, check `workspaceMember` for any workspace where this user is the only ACTIVE OWNER. If found, return an error telling them to transfer ownership first.
- **Storage cleanup**: delete the avatar file from storage (`storage.delete(user.image)`) before the DB transaction. Non-fatal — proceed even if it fails.
- **Full transaction order**: `notification` → `userNotificationPreference` / `userEmailPreference` / `mutedEntity` / `pushSubscription` → `userSearchHistory` / `savedFilter` / `userOnboardingProgress` → `taskAssignee` / `taskWatcher` / `timeLog` / `commentReaction` → `spaceMember` / `workspaceMember` / `channelMember` → `session` / `account` / `user`.
- **Comments & activity logs are NOT deleted** — `comment.authorId` and `activityLog.userId` are plain `text` columns with no FK constraint, so orphaned values are safe. Queries use `.leftJoin(user, ...)` which returns `null` for deleted users. Fallback: `authorName ?? "Deleted User"` and `name ?? "Deleted User"` in the mapping layer.
- See full spec in `docs/settings.md` § 1.1a.

### Task Descriptions
- Stored as Tiptap JSON in a `jsonb` column (`description`).
- Full-text search on description is post-MVP.

### Folder
- Folder is **post-MVP**. Do not implement it. `folder_id` on List is nullable and always null in MVP.

---

## Feature Docs (read before implementing)

| Feature | Doc |
|---------|-----|
| Auth | `docs/authentication.md` |
| Workspace | `docs/workspace.md` |
| Project (Space) | `docs/space.md` |
| List | `docs/list.md` |
| Task | `docs/task.md` |
| Subtask | `docs/subtask.md` |
| Sprint | `docs/sprint.md` |
| Pinned Tasks | `docs/pinned-tasks.md` |
| Views | `docs/views.md` |
| Collaboration | `docs/collaboration.md` |
| Notifications | `docs/notifications.md` |
| Search & Filters | `docs/search-and-filters.md` |
| Permissions | `docs/permission-model.md` |
| Settings | `docs/settings.md` |
| Admin Panel | `docs/admin-panel.md` |
| Empty States | `docs/empty-states.md` |
| Design System | `docs/design-system.md` |
| UI Redesign Guide | `docs/ui-redesign.md` |
| Database Schema | `docs/database-schema.md` |

---

## Development Plan

Phases are in `docs/development-plan.md`. Work through them in order. Do not skip phases.

**Retroactive changes** to already-implemented code are tracked in `docs/revision-plan.md`. Work through that file alongside the development plan.

Current phase: **Phase 7 (skipped) → Phase 8 — List**
