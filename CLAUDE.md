# Teamority — Claude Code Context

## What this project is

Teamority is a project management SaaS (ClickUp-style). Teams use it to organize work in Workspaces, Spaces, Lists, and Tasks.

Full product specs live in `docs/`. Read the relevant doc before implementing any feature.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | Better Auth (with Admin Plugin) |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui |
| Rich Text | Tiptap |
| State | Zustand (client) + SWR (server) |
| File Storage | S3-compatible (Cloudflare R2) |
| Background Jobs | pg-boss |
| Email | Nodemailer (SMTP) |

---

## Project Structure

```
src/
├── app/                   ← Next.js App Router
│   ├── (auth)/            ← sign-in, onboarding (unauthenticated layout)
│   ├── (app)/             ← main app (authenticated layout)
│   │   └── [workspaceId]/ ← workspace-scoped routes
│   ├── api/               ← API route handlers
│   └── admin/             ← platform admin panel
├── components/
│   ├── ui/                ← shadcn/ui primitives
│   └── common/            ← shared app components
├── lib/
│   ├── db.ts              ← Prisma client singleton
│   ├── auth.ts            ← Better Auth server instance
│   └── utils.ts           ← shared utilities
├── hooks/                 ← custom React hooks
├── store/                 ← Zustand stores
├── types/                 ← TypeScript types and interfaces
└── server/                ← server actions
```

---

## Key Decisions & Conventions

### Routing
- All workspace routes use `[workspaceId]` (uuid) — NOT slug. Slug is a vanity alias only.
- Route shape: `/[workspaceId]/[spaceId]/list/[listId]`

### Auth
- Magic link only — no passwords, no OAuth.
- Better Auth handles sessions. Use `auth.api.getSession()` server-side.
- All API routes check session first, return 401 if missing.

### Database
- Prisma ORM. Schema in `prisma/schema.prisma`.
- All IDs are UUIDs (`@default(uuid())`).
- All tables have `createdAt` and `updatedAt` (`@updatedAt`).
- Soft deletes use `isArchived` + `archivedAt` pattern (not a deleted flag).
- Hard deletes are immediate with no recovery unless otherwise stated in the feature doc.

### Permissions
- Two-level model: Workspace Role + Space Permission.
- Check workspace role first, then space permission for anything inside a space.
- Guests can only see Spaces they are explicitly invited to.
- See `docs/permission-model.md` for the full matrix.

### API
- REST API under `/api/`.
- Always return `{ error: string }` on failure with the correct HTTP status.
- Never expose internal error messages to the client.

### File Uploads
- All files go to Cloudflare R2 (S3-compatible).
- Always delete the R2 file when deleting the DB record.
- Never delete the DB record before the R2 file (orphaned files are unrecoverable).

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
| Space | `docs/space.md` |
| List | `docs/list.md` |
| Task | `docs/task.md` |
| Subtask | `docs/subtask.md` |
| Sprint | `docs/sprint.md` |
| Views | `docs/views.md` |
| Collaboration | `docs/collaboration.md` |
| Notifications | `docs/notifications.md` |
| Search & Filters | `docs/search-and-filters.md` |
| Permissions | `docs/permission-model.md` |
| Admin Panel | `docs/admin-panel.md` |
| Empty States | `docs/empty-states.md` |
| Design System | `docs/design-system.md` |
| Database Schema | `docs/database-schema.md` |

---

## Development Plan

Phases are in `docs/development-plan.md`. Work through them in order. Do not skip phases.

Current phase: **Phase 0 — Project Setup**
