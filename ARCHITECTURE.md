# Architecture

A high-level map of how Kanbanica is put together. For per-feature detail, see the specs in [`docs/`](./docs); for conventions, see [CLAUDE.md](./CLAUDE.md).

## The big picture

Kanbanica runs as **two processes** sharing one PostgreSQL database:

```
                         ┌──────────────────────────────┐
        HTTPS            │  Next.js app  (web)           │
  users ───────▶ proxy ─▶│  - App Router UI + API routes │
                         │  - server actions             │
                         │  - enqueues background jobs    │
                         │  - SSE stream to browsers      │
                         └───────────────┬───────────────┘
                                         │  SQL
                                   ┌─────▼──────┐
                                   │ PostgreSQL │◀── pg-boss job queue lives here too
                                   └─────▲──────┘
                                         │  SQL / polls queue
                         ┌───────────────┴───────────────┐
                         │  Worker  (scripts/worker.ts)   │
                         │  - pg-boss handlers            │
                         │  - email, digests, reminders,  │
                         │    sprint auto-close, cleanup  │
                         └────────────────────────────────┘
```

- **Web** (`next start` / `.next/standalone/server.js`) serves the UI and API and **enqueues** jobs.
- **Worker** (`pnpm worker:start`) **consumes** jobs. It must run as **exactly one** process.
- Both read configuration through the Zod-validated `lib/env.ts`.

In development, `pnpm dev` runs both together via `concurrently`, against a bundled embedded Postgres (`pnpm db:local`).

## Request & data flow

1. A browser action hits an **API route** (`app/api/**`) or invokes a **server action** (`app/actions/**`, `server/`).
2. The handler checks the session (Better Auth) and permissions, then reads/writes via **Drizzle ORM** (`lib/db.ts`, schema in `db/schema/`).
3. After any mutation it calls **`refreshWorkspace(workspaceId)`** (`lib/realtime/refresh.ts`), which revalidates paths and broadcasts a `data_changed` event.
4. Long-running or out-of-band work (sending email, digests) is **enqueued** to pg-boss (`lib/worker/enqueue.ts`) and handled later by the worker.

## Real-time (SSE)

- Browsers open one `EventSource` to `app/api/me/notifications/stream`.
- The server keeps an in-memory registry of connected clients (`lib/sse-clients.ts`, pinned to `globalThis`).
- Mutations broadcast via `refreshWorkspace` → `pushToUser`, and clients refresh.
- **Scaling note:** the registry is per-process. A single app instance is correct for typical self-hosting; multiple instances behind a load balancer would need a shared Redis pub/sub (not yet implemented). See [`docs/realtime.md`](./docs/realtime.md).

## Background jobs (pg-boss)

- Queue state is stored in Postgres, so jobs are durable across restarts.
- Handlers live in `lib/worker/handlers/` (email send, email outbox reap, notification digest scan/send, due-date reminders, sprint auto-close, cleanup jobs, etc.), registered in `lib/worker/boss.ts`.
- Cron-scheduled jobs are configured there too.

## Authentication & authorization

- **Auth:** Better Auth (`lib/auth.ts`) — passwordless **magic link** (email) and optional **Google OAuth**. `baseURL` derives from `NEXT_PUBLIC_APP_URL`. In production the app requires at least one auth provider to be configured (`lib/env.ts`).
- **Authorization:** two-level model — workspace role + per-project permission — enforced in `lib/` helpers and checked in every API route / server action. See [`docs/permission-model.md`](./docs/permission-model.md).

## File storage

- Abstracted via **files-sdk** (`lib/storage.ts`). `STORAGE_DRIVER=local` (default) stores under `./uploads/` and serves through `app/api/files/[...key]`; `s3`/`r2` use object storage. The DB stores a **storage key**, never a full URL.

## Email

- Outbound mail is written to a durable **outbox** and sent by the worker via Nodemailer/SMTP (`lib/smtp/`, `lib/email/`). Without SMTP configured (dev), messages are logged to the console instead of sent.

## Codebase layout

```
app/                 Next.js App Router
├── (auth)/          sign-in / onboarding
├── (app)/           authenticated app, workspace-scoped routes
├── (legal)/         Terms / Privacy (self-host templates)
├── (orbit)/ , admin/ admin panel
└── api/             route handlers (incl. /api/health)
components/          UI (ui/ = shadcn primitives, common/ = shared)
config/platform.ts   product name, logo, support email/domain (env-overridable)
db/schema/           Drizzle tables (one file per domain)
db/migrations/       generated SQL migrations
lib/                 db, auth, env, storage, realtime, notifications, worker, smtp, email
scripts/             dev-db, worker, migrate, make-admin
docs/                per-feature specifications
```

## Deployment shape

- **Dev:** `pnpm db:local` + `pnpm dev` (see [SETUP.md](./SETUP.md)).
- **Self-host:** Docker Compose runs `postgres` + a one-shot `migrate` + `app` + `worker` (see [DEPLOYMENT.md](./DEPLOYMENT.md)). `next.config.mjs` uses `output: "standalone"` for a lean app image; migrations apply via `scripts/migrate.ts`.
