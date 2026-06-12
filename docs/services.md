# Services

## Goal

Document every infrastructure service Kanbanica depends on, the decision rationale, required configuration, startup behavior, and local development setup. This is the operational reference for Phase 0 setup and production deployment.

---

## Existing Scope

12 infrastructure services covering database, storage, auth, email, background jobs, web push, and hosting.

---

## Service Inventory

### 1. PostgreSQL

**Role:** Primary relational database for all application data.

**Decision:** Industry-standard, mature, strong Prisma support, excellent full-text search capabilities for future use, `jsonb` for Tiptap content storage.

**ORM:** All DB access via `src/lib/db.ts` Prisma singleton. Never use raw SQL unless Prisma cannot express the query. No second DB client.

**Required env vars:**
```
DATABASE_URL=postgresql://user:password@host:5432/Kanbanica
```

**Local dev setup:**
```bash
# Option A: Docker
docker run --name Kanbanica-db \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=Kanbanica \
  -p 5432:5432 -d postgres:16

# Option B: local Postgres
createdb Kanbanica

# Apply schema
npx prisma migrate dev --name init

# Apply Better Auth tables (separately -- do NOT include in Prisma migrations)
npx better-auth migrate
```

**Connection pool:** Prisma's default pool. For serverless deployments, add `connection_limit=5&pool_timeout=20` to the connection string.

**Startup behavior:** Application fails to start if `DATABASE_URL` is missing or unreachable (validated in `src/lib/env.ts`).

---

### 2. S3-Compatible Storage (Cloudflare R2)

**Role:** File storage for task attachments, workspace/user avatars, and all user-uploaded content.

**Decision:** Cloudflare R2 has no egress fees (vs AWS S3), S3-compatible API, integrates with `@aws-sdk/client-s3`.

**Required env vars:**
```
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=Kanbanica-uploads
R2_PUBLIC_URL=https://pub-xxxx.r2.dev
```

**R2 key naming convention:**
```
avatars/users/{userId}.jpg
avatars/workspaces/{workspaceId}.jpg
attachments/{workspaceId}/{taskId}/{attachmentId}/{filename}
```

**Upload pipeline (presigned URL flow):**
1. Client requests `POST /api/upload/presigned-url` with `{ filename, mimeType, size }`
2. Server validates size (max 10MB), MIME type (allowed list), and user permissions
3. Server generates presigned PUT URL (15-minute expiry) via `@aws-sdk/s3-request-presigner`
4. Client uploads directly to R2 using the presigned URL
5. Client calls `POST /api/upload/confirm` with the S3 key
6. Server creates the DB record (e.g., `TaskAttachment`)

**Critical ordering rule:** When deleting a file, always delete the R2 object BEFORE deleting the DB record. An orphaned R2 file cannot be automatically recovered. A failed R2 delete must block the DB delete (return error to caller, do not proceed).

**Local dev:** Use Cloudflare R2 free tier, or MinIO as a local substitute:
```bash
docker run -p 9000:9000 -p 9001:9001 \
  minio/minio server /data --console-address ":9001"
```

---

### 3. Better Auth

**Role:** Authentication provider handling magic-link sign-in, session management, and platform admin capabilities.

**Decision:** Native Next.js support, magic link out of the box, Admin Plugin for impersonation, no password complexity to manage, database-backed sessions.

**Required env vars:**
```
BETTER_AUTH_SECRET=your-32-char-secret-here
BETTER_AUTH_URL=https://app.Kanbanica.com
```

**Auth tables:** Managed exclusively by `npx better-auth migrate`. Never include `User`, `Session`, `Account`, or `Verification` tables in Prisma migrations. Do not run `prisma migrate dev` for these tables.

**Session check pattern (server-side):**
```typescript
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

const session = await auth.api.getSession({ headers: await headers() })
if (!session) return { error: 'Unauthorized' }
```

**Session TTL:** 7-day sliding window. Sessions auto-extend on each request. Magic link tokens expire after 15 minutes.

**Startup behavior:** `BETTER_AUTH_SECRET` is validated at startup. Missing secret causes a startup error.

---

### 4. SMTP / Nodemailer

**Role:** Transactional email delivery for magic links, workspace invites, notifications, and daily digest.

**Decision:** Nodemailer is the simplest SMTP client for Node.js. No vendor lock-in. Any SMTP provider works (Postmark, Resend, Gmail SMTP in dev only).

**Required env vars:**
```
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-api-token
SMTP_PASS=your-api-token
SMTP_FROM=noreply@Kanbanica.com
```

**Email templates:** All templates are React Email components in `src/lib/email/`. Never use raw HTML strings.

**Deliverability (required before launch):**
- Add SPF record: `v=spf1 include:your-smtp-provider.com ~all`
- Add DKIM via your SMTP provider's dashboard
- Add DMARC record: `v=DMARC1; p=quarantine; rua=mailto:dmarc@Kanbanica.com`
- Verify with mail-tester.com -- target score 10/10
- DNS propagation takes 24-48 hours; do this before launch, not on launch day

**Rate limits:** Gmail SMTP is 500/day (dev only). Do not use Gmail SMTP in production.

**Startup behavior:** SMTP env vars validated at startup. Missing vars cause a startup failure.

---

### 5. pg-boss (Background Jobs)

**Role:** Persistent job queue backed by PostgreSQL. Used for workspace deletion, sprint auto-close, notification cleanup, daily digest emails, and support ticket auto-close.

**Decision:** Uses the existing PostgreSQL connection -- no additional infrastructure (no Redis, no separate message broker). Jobs survive process restarts because they are stored in the DB.

**Required env vars:** Same `DATABASE_URL` as the application.

**Two-process architecture:**
```
Process 1: Next.js (web)    -- enqueues jobs via src/lib/worker/enqueue.ts
Process 2: Worker           -- scripts/worker.ts, runs pg-boss handlers
```

Both processes run simultaneously in development:
```json
// package.json scripts
"dev": "concurrently -n next,worker -c blue,yellow \"next dev --turbopack\" \"tsx --watch scripts/worker.ts\""
```

**Job registry:** All job names defined in `src/lib/worker/job-types.ts` as a `JOB_NAMES` const. Every `JOB_NAMES` entry MUST have a corresponding entry in `QUEUE_OPTIONS` (compile-time guard prevents missing queue definitions).

**Job handler rules:**
- All handlers must be idempotent (safe to retry on failure)
- Check DB state (claim current status) before performing side effects
- Write a lifecycle log entry at start and end of each handler
- Never throw from a handler without pg-boss being able to mark the job failed

**Kanbanica job inventory:**

| Job Name | Trigger | Schedule | Purpose |
|----------|---------|----------|---------|
| `workspace.delete` | API (202 response) | On-demand | Cascade delete workspace and all contents |
| `sprint.auto-close` | pg-boss cron | Every 15 min | Auto-close sprints past their `endDate` |
| `notification.cleanup` | pg-boss cron | Daily 01:00 UTC | Delete notifications older than 90 days |
| `notification.digest` | pg-boss cron | Every 30 min | Send digest emails for users whose `digestTime` window has arrived |
| `support.ticket-auto-close` | pg-boss cron | Daily 02:00 UTC | Close tickets with 14 days of inactivity |

---

### 6. No Cache / Redis (MVP)

**Decision:** Redis adds operational complexity. At MVP scale, PostgreSQL query performance is sufficient. All data is fetched fresh from the DB on each request.

**Post-MVP:** Redis can be added for session caching and notification fan-out if performance requires it. Better Auth supports Redis-backed session caching.

---

### 7. Web Push (VAPID)

**Role:** Browser push notifications for task assignments, comments, and @mentions when the user is not actively using the app.

**Decision:** Web Push API with VAPID keys -- no third-party push service. Free, no vendor dependency, works in all modern browsers.

**Required env vars:**
```
VAPID_PUBLIC_KEY=BFc...   (starts with B)
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:push@Kanbanica.com
```

**Key generation:**
```bash
npx web-push generate-vapid-keys
```

**Browser support:** Chrome, Firefox, Edge (full support). Safari 16+ (partial). iOS Safari 16.4+ (supported only in installed PWA, not mobile browser tab).

**Subscription flow:**
1. User grants notification permission in browser
2. Client calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`
3. Client POSTs subscription (endpoint, p256dh, auth) to `POST /api/push/subscribe`
4. Server stores in `PushSubscription` table
5. On trigger event, server sends notification via `webpush.sendNotification()` from a pg-boss job

**Key rotation warning:** If VAPID keys are changed, all stored `PushSubscription` records become invalid. Push sends will receive HTTP 410 Gone. The handler must delete the `PushSubscription` record on 410 to prevent repeated failed sends.

**Startup behavior:** VAPID env vars are optional. Push notifications are silently disabled if not configured (graceful degradation).

---

### 8. Hosting (TBD)

**Decision:** Not yet decided. Candidates: Vercel, Railway, Fly.io, or VPS.

**Requirements for any hosting choice:**
- Must support two separate processes (Next.js + pg-boss worker)
- Must support environment variables
- Must allow a managed or external PostgreSQL connection
- Worker process (`scripts/worker.ts`) must run continuously -- not on a serverless function timeout

**Vercel note:** Vercel does not natively support long-running background processes. The pg-boss worker must run on a separate service (Railway worker, Fly machine, or EC2 instance) if Vercel is used for Next.js.

---

## Environment Variable Reference

Complete list of required and optional env vars. Validated at startup by `src/lib/env.ts` using Zod.

```bash
# Required -- app fails to start if missing
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_PUBLIC_URL

# Optional -- app degrades gracefully if missing
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
NEXT_PUBLIC_GTM_CONTAINER_ID
NEXT_PUBLIC_APP_URL
```

---

## Startup / Teardown Order

**Startup:**
1. Validate all env vars (`src/lib/env.ts`) -- fail fast with clear error messages
2. Prisma client initializes (lazy singleton in `src/lib/db.ts`)
3. Better Auth initializes (lazy)
4. pg-boss worker starts (`scripts/worker.ts`): calls `boss.start()`, registers all handlers and cron jobs

**Teardown (SIGTERM):**
1. pg-boss: `boss.stop()` -- drains in-flight jobs gracefully
2. Prisma: `prisma.$disconnect()`
3. Next.js: default graceful shutdown

**Health check endpoint:** `GET /api/health` -- returns `{ ok: true, db: 'connected' }` after a `prisma.$queryRaw\`SELECT 1\`` check. Used by load balancer / container orchestrator.

---

## `enqueueJob` -- Singleton Implementation

PgBoss must only be initialised once per process. Use a mutex-guarded lazy singleton so concurrent enqueue calls during startup do not create multiple PgBoss instances:

```typescript
// src/lib/worker/enqueue.ts

import PgBoss from 'pg-boss'
import { env } from '@/lib/env'
import { QUEUE_OPTIONS, JOB_NAMES, type JobPayloadMap } from './job-types'

let boss: PgBoss | null = null
let initPromise: Promise<PgBoss> | null = null

async function getBoss(): Promise<PgBoss> {
  if (boss) return boss
  if (initPromise) return initPromise  // already initialising -- wait for it

  initPromise = (async () => {
    const instance = new PgBoss(env.DATABASE_URL)
    await instance.start()
    boss = instance
    return instance
  })()

  return initPromise
}

export async function enqueueJob<K extends keyof JobPayloadMap>(
  name: K,
  payload: JobPayloadMap[K],
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const b = await getBoss()
  const queueOpts = QUEUE_OPTIONS[name] ?? {}
  return b.send(name, payload, { ...queueOpts, ...options })
}
```

**Why the mutex pattern:** In Next.js, multiple concurrent requests during a cold start can each call `enqueueJob` before the first `getBoss()` resolves. Without the `initPromise` guard, each call creates and starts a separate PgBoss instance, causing duplicate job processing and connection leaks.

**Worker process** (`scripts/worker.ts`) initialises PgBoss directly and calls `boss.work()` -- it does not go through `enqueueJob`. The singleton above is for the Next.js process only.

## Folder Mapping

```
src/
  lib/
    db.ts               <- Prisma singleton
    auth.ts             <- Better Auth server instance
    env.ts              <- Zod env validation (validated at startup)
    storage.ts          <- R2/S3 client + upload helpers
    permissions.ts      <- requireSpaceMembershipAndPermission, hasPermissionLevel
    email/              <- React Email templates + Nodemailer sender
    api/
      auth-helpers.ts   <- getSessionOrUnauthorized (shared API route helper)
    worker/
      enqueue.ts        <- enqueueJob() + PgBoss singleton (mutex-guarded)
      job-types.ts      <- JOB_NAMES const + payload types + QUEUE_OPTIONS
      handlers/         <- one file per job handler
scripts/
  worker.ts             <- worker entrypoint (process 2)
  seed-plans.ts         <- optional dev seeding
```

---

## Edge Cases

| Scenario | Handling |
|----------|---------|
| pg-boss worker crashes mid-job | pg-boss marks job as `failed`; retry policy per job (default 3 retries); all handlers must be idempotent |
| Database unreachable at startup | App exits with error; env validation passes but Prisma connection fails; health check returns 503 |
| R2 bucket unreachable during upload | Return 503 to client; do not create DB record; user retries |
| VAPID keys changed after subscriptions stored | Existing `PushSubscription` records become invalid; handle HTTP 410 by deleting the subscription |
| SMTP provider rate limit hit | Email enqueued as pg-boss job; retries with exponential backoff; after max retries, log to error monitoring |
| Worker not running | Jobs queue up in pg-boss tables safely; nothing is lost; worker drains queue on restart |

---

## Acceptance Criteria

- [ ] `pnpm dev` starts both Next.js and the worker process without errors
- [ ] `GET /api/health` returns `{ ok: true }` after successful DB connection
- [ ] Magic link email is sent successfully (requires SMTP configuration)
- [ ] Task attachment upload succeeds via presigned URL flow (requires R2 configuration)
- [ ] Workspace deletion enqueues a pg-boss job and returns HTTP 202
- [ ] pg-boss job completes and workspace is fully deleted from the DB
- [ ] All required env vars validated at startup with clear error messages on missing vars
- [ ] `npx prisma migrate dev` and `npx better-auth migrate` run without conflicts

---

## Local Dev Setup (Complete)

```bash
# 1. Clone and install
git clone https://github.com/org/Kanbanica
cd Kanbanica
pnpm install

# 2. Create .env.local
cp .env.example .env.local
# Edit .env.local with your local values

# 3. Start PostgreSQL (Docker)
docker run --name Kanbanica-db \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=Kanbanica \
  -p 5432:5432 -d postgres:16

# 4. Apply Prisma schema
npx prisma migrate dev --name init

# 5. Apply Better Auth tables
npx better-auth migrate

# 6. Seed plans (optional, for pricing page)
npx tsx scripts/seed-plans.ts

# 7. Generate VAPID keys (optional, for push notifications)
npx web-push generate-vapid-keys
# Add output to .env.local

# 8. Start Next.js + worker concurrently
pnpm dev
```
