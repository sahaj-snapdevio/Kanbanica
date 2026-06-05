# Services & Infrastructure

This document lists every external service or infrastructure component Teamority needs. The "decision" column reflects the confirmed choices.

---

## 1. Database

**What it does:** Primary relational data store. Stores all workspaces, users, tasks, comments, permissions, background job state (pg-boss uses the same DB).

| Decision | PostgreSQL |
|----------|------------|

**Notes:**
- Prisma ORM sits on top — the database engine just needs to be PostgreSQL-compatible
- pg-boss (background jobs) also uses PostgreSQL — no separate database needed
- Hosted options: **Neon** (serverless, generous free tier), **Supabase** (Postgres + extras), **Railway**, **Render**, **Fly.io**, self-hosted on VPS

---

## 2. File Storage

**What it does:** Stores all user-uploaded files — task attachments, workspace logos, user avatars.

| Decision | S3-compatible (provider TBD) |
|----------|------------------------------|

**Notes:**
- Code uses the AWS S3 SDK — any S3-compatible provider works without code changes
- Good options: **Cloudflare R2** (no egress fees), **Backblaze B2** (cheap), **MinIO** (self-hosted, free), **AWS S3**
- All file operations follow the rule: delete from storage before deleting the DB record
- Avatar uploads resize to 256×256 before storage (server-side)
- Environment variables: `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_REGION`

---

## 3. Authentication

**What it does:** Handles sign-in via magic link (passwordless), sessions, email verification, and the Admin Plugin for platform admin features.

| Decision | Better Auth + Admin Plugin |
|----------|---------------------------|

**Notes:**
- Better Auth is open-source and self-hosted — no per-user pricing
- **Magic link** = user enters their email → receives a one-time sign-in link → clicks it → session created. No passwords, no OAuth apps to configure
- First-time magic link use auto-creates the account (sign up = sign in, same flow)
- Admin Plugin provides user ban, impersonation, and platform-level user management
- Sessions stored in the database — no Redis needed

---

## 4. Email Sending

**What it does:** Sends all transactional emails — magic link sign-in, workspace invites, notification digests, account deletion confirmation.

| Decision | SMTP via Nodemailer |
|----------|---------------------|

**Notes:**
- Any SMTP provider works: **Gmail** (dev/testing), **Mailgun**, **Postmark**, **Amazon SES**, **Brevo**, or a self-hosted mail server
- Nodemailer is the Node.js standard library for SMTP — no vendor SDK, no lock-in
- Needs a sending domain with SPF, DKIM, DMARC DNS records configured for deliverability
- Environment variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
- Email templates needed: magic link, welcome, workspace invite, deletion confirmation, notification digest

---

## 5. Cache / Rate Limiting

**What it does:** Rate limiting on auth endpoints to prevent brute-force attacks.

| Decision | Skipped for MVP — Better Auth built-in |
|----------|-----------------------------------------|

**Notes:**
- Better Auth's built-in rate limiting covers the magic link abuse case (too many requests per email/IP)
- Sessions are stored in the database — no cache layer needed
- Redis can be added post-MVP if DB query caching becomes a performance need

---

## 6. Background Jobs

**What it does:** Runs deferred and scheduled tasks — workspace cascade deletion, sprint auto-close, recurring task creation, notification digest emails, notification TTL cleanup, expired invite cleanup.

| Decision | pg-boss |
|----------|---------|

**Notes:**
- pg-boss is a job queue backed entirely by PostgreSQL — no separate Redis or queue service needed
- Uses the same database as the rest of the app — one less infrastructure dependency
- Supports scheduled jobs (cron-style), delayed jobs, retries, and job visibility
- Job worker runs as a long-lived process alongside the app (or as a separate worker process)
- Key jobs: workspace deletion cascade, sprint auto-close, recurring task copy, digest email, notification cleanup, expired invite purge

---

## 7. Hosting / Deployment

**What it does:** Hosts the Next.js application (frontend + API routes + Server Actions) and the pg-boss worker.

| Decision | TBD |
|----------|-----|

**Notes:**
- Since deployment is not fixed, the app must not rely on Vercel-specific features (no Vercel Cron, no Vercel KV)
- pg-boss worker needs a persistent process — this rules out pure serverless (Vercel functions are stateless). Worker should run as a separate always-on process
- Good options: **Railway** (easy, supports multiple services), **Fly.io** (Docker-based, cheap), **Render**, self-hosted VPS (Hetzner + Coolify/Dokku)
- For local dev: `next dev` + a separate `node worker.ts` process

---

## 8. OAuth Providers

**What it does:** Social login via Google or GitHub.

| Decision | **Removed — using magic link instead** |
|----------|-----------------------------------------|

**Notes:**
- Magic link covers the same "no password" UX goal without needing OAuth app credentials on every deployment
- OAuth can be added post-MVP if there is user demand

---

## 9. Real-Time / WebSockets

**What it does:** Pushes live updates to connected clients without page refresh.

| Decision | Post-MVP — not needed for launch |
|----------|----------------------------------|

**Notes:**
- MVP uses optimistic UI + React Query refetch-on-focus — good enough for launch
- When ready: **SSE (Server-Sent Events)** is the simplest (no library, server→client only), **Soketi** is self-hosted and Pusher-compatible for bi-directional needs

---

## 10. Error Monitoring

**What it does:** Captures runtime errors and exceptions in production.

| Decision | TBD — configure before launch |
|----------|-------------------------------|

**Notes:**
- **Sentry** has a free tier and broad Next.js support
- **Glitchtip** is self-hostable and Sentry-SDK-compatible — good for open-source deployments
- Either can be added in the final QA phase without touching application code

---

## 11. Analytics

**What it does:** Tracks product usage and user behavior.

| Decision | Skip for MVP |
|----------|--------------|

**Notes:**
- Admin panel already shows basic platform stats (user/workspace counts) from the DB
- **PostHog** (self-hostable, open-source) or **Plausible** (privacy-first) are good post-MVP options

---

## 12. Browser Push Notifications

**What it does:** Sends push notifications to the user's browser even when the app is closed.

| Decision | Web Push API (native — no vendor) |
|----------|-----------------------------------|

**Notes:**
- No third-party service needed — uses the browser's built-in Web Push standard
- Requires a VAPID key pair (generated once, stored in env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`)
- `PushSubscription` objects stored in DB per device

---

## Summary Table

| # | Category | Decision | Status |
|---|----------|----------|--------|
| 1 | Database | PostgreSQL | ✅ Decided — choose hosted provider |
| 2 | File Storage | S3-compatible | ✅ Decided — choose provider (R2 / B2 / MinIO) |
| 3 | Authentication | Better Auth + Magic Link | ✅ Decided |
| 4 | Email Sending | SMTP / Nodemailer | ✅ Decided — choose SMTP provider |
| 5 | Cache / Rate Limiting | Skipped for MVP | ✅ Decided |
| 6 | Background Jobs | pg-boss | ✅ Decided |
| 7 | Hosting / Deployment | TBD | ⏳ Pending |
| 8 | OAuth Providers | Removed (magic link instead) | ✅ Decided |
| 9 | Real-Time / WebSockets | Post-MVP | ✅ Decided |
| 10 | Error Monitoring | TBD (Sentry / Glitchtip) | ⏳ Pending — configure before launch |
| 11 | Analytics | Skip for MVP | ✅ Decided |
| 12 | Browser Push Notifications | Web Push API (native) | ✅ Decided |
