# Teamority -- Complete Documentation Audit

**Roles applied:** Senior Product Manager, Staff Software Engineer, Solution Architect, Documentation Architect

**Audit Date:** 2026-06-09

---

## Overall Scores

| Dimension | Score | Reasoning |
|-----------|-------|-----------|
| Documentation Quality | 7.2 / 10 | Core feature docs (task, permission, auth, DB) are excellent. Supporting docs (services, keyboard, landing, customer support) were stubs or missing implementation detail. |
| Architecture Readiness | 7.8 / 10 | Permission model, async deletion, pg-boss pattern, and DB schema are well-designed. SSR safety for dnd-kit, FTS gap, and daily digest scheduling were unresolved. |
| Implementation Readiness | 6.5 / 10 | Phase 0 is safe to start. By Phase 5 (Tasks), devs will hit undocumented territory: upload pipelines, job payload specs, progress rollup queries, plan enforcement hooks. |
| Consistency Score | 7.5 / 10 | `improvement.md` corrects other docs without cross-links -- critical notes invisible to a developer reading only the feature doc. |

---

## Phase 1 -- Feature Inventory

| Feature | Purpose | Key Dependencies | Documentation Status |
|---------|---------|-----------------|---------------------|
| Authentication | Magic-link sign-in, session management, onboarding redirect | Better Auth, Nodemailer, PostgreSQL, pg-boss (cleanup cron) | Complete |
| Workspace | Top-level org unit: CRUD, invites, async deletion, roles | PostgreSQL, pg-boss (deletion job), S3/R2, Nodemailer | Complete |
| Space | Grouping layer: visibility, permissions, default List auto-create | PostgreSQL, cascades from Workspace | Complete |
| List | Task container: custom statuses, views, duplicate/move | PostgreSQL (List, ListStatus) | Good -- weak on technical design |
| Task | Core work unit: 16 fields, dependencies, activity log | PostgreSQL (10 related tables), Tiptap, S3/R2 | Excellent |
| Subtask | One-level child tasks via `parentTaskId`, progress rollup | PostgreSQL (self-join) | Good -- missing rollup query pattern |
| Sprint | Optional time-boxed overlay: lifecycle, auto-close | PostgreSQL (Sprint, TaskSprint), pg-boss | Good -- missing job spec |
| Views | List/Board/My Tasks, user preferences | dnd-kit, PostgreSQL (Phase 12) | Adequate -- missing SSR safety notes |
| Collaboration | Comments, reactions, Activity Log, attachments, @mentions | PostgreSQL, S3/R2, Nodemailer | Good -- missing upload pipeline |
| Notifications | 3-channel: In-App/Email/Push, digest, 90-day retention | PostgreSQL, pg-boss, Web Push, Nodemailer | Good -- missing job schedule spec |
| Search & Filters | Global Ctrl+K search, per-list filters, saved filters | PostgreSQL, Prisma FTS | Adequate -- critical FTS gap siloed in improvement.md |
| Permission Model | Two-level: Workspace Role + Space Permission | All feature modules | Excellent |
| Admin Panel | Platform admin: metrics, impersonation, force-delete | PostgreSQL, Better Auth Admin Plugin | Adequate -- impersonation mechanics missing |
| Empty States | 16 states, Getting Started checklist, onboarding progress | PostgreSQL (UserOnboardingProgress) | Complete |
| Design System | Color tokens, typography, spacing, components | Tailwind v4, shadcn/ui, Lucide React | Complete -- no `<LocalDate />` spec |
| Database Schema | Single Prisma source of truth, indexes, phase-gating | Prisma | Complete |
| Development Plan | 19 phases from setup to launch | All features | Complete -- no phase durations or completion criteria |
| Services | 12 infrastructure decisions | All services | Rewritten (was decisions-only stub) |
| Avatar System | User/workspace avatars, AvatarStack, fallbacks | S3/R2, PostgreSQL | Complete |
| Calendar View | Post-MVP: monthly/weekly grid, drag reschedule | dnd-kit, date-fns | Rewritten (was contradictory) |
| Folder | Post-MVP: grouping layer in Space | `folderId` nullable | Correctly minimal |
| Plans & Pricing | REMOVED -- Teamority is open-source; no paid plans | -- | Deleted |
| Landing Page | 10 sections, SEO, analytics | Next.js App Router, Tailwind | Rewritten (was section list only) |
| Improvement | Product audit: scope reductions, critical technical notes | All features | Excellent but not cross-linked to relevant docs |
| Customer Support | Help Center + Ticket system | PostgreSQL, pg-boss, Nodemailer | Rewritten (was data-model stub) |
| Keyboard Shortcuts | Global, navigation, view, task, rich text shortcuts | Zustand, React | Rewritten (missing hook architecture) |

---

## Phase 2 -- krova-main Technical Patterns

| Technical Area | Pattern Found | Reusable for Teamority |
|---------------|---------------|----------------------|
| pg-boss job registry | `JOB_NAMES` const + typed payloads + `QUEUE_OPTIONS` compile-time guard in `lib/worker/job-types.ts` | Yes -- adopt immediately for all 5 jobs |
| Two-process architecture | `next dev` + `tsx --watch scripts/worker.ts` via `concurrently` | Yes -- copy `package.json` scripts pattern |
| Idempotent job handlers | Each handler checks DB state before side effects; status machine claims before acting | Yes -- apply to workspace-delete, sprint-auto-close |
| `enqueueJob` singleton | Mutex-guarded PgBoss lazy init in `lib/worker/enqueue.ts`; `singletonKey` for deduplication | Yes -- copy pattern exactly |
| Audit fire-and-forget | `audit()` + `auditBatch()` in `lib/audit.ts`; errors logged, never thrown; `extractRequestContext()` for IP/UA | Yes -- use for `ActivityLog` writes |
| Env validation | `lib/env.ts` Zod schema at startup; typed `env` export everywhere; fail fast with clear errors | Yes -- implement in Phase 0 |
| Auth pattern in server actions | `auth.api.getSession()` at top; `requireActionMembershipAndPermission()`; early return `{ error: string }` | Yes -- standard for all server actions |
| Auth pattern in API routes | `lib/api/auth-helpers.ts` route-level helper; session -> 401, permission -> 403 | Yes -- all `/api/` routes |
| Storage delete ordering | R2 delete enqueued BEFORE DB delete; failed enqueue aborts deletion | Yes -- matches Teamority rule; shows exact code pattern |
| Pre-flight checks before side effects | All permission/precondition checks run before any write or enqueue | Yes -- adopt as a rule |
| `<LocalDate />` component | All timestamps rendered through it; prevents SSR/client hydration mismatch on date fields | Yes -- critical; build before any timestamp display |
| Error wrapper in actions | `try/catch`; inner `console.error`; outer always `{ error: "Something went wrong" }` | Yes -- all server actions |
| Lifecycle vs audit log separation | Operational logs vs security audit logs are separate tables; same fire-and-forget pattern | Yes -- `ActivityLog` vs `PlatformAuditLog` |
| Transaction + enqueue pattern | Jobs enqueued inside or immediately after DB transactions; payload consistent with DB state | Yes -- workspace deletion, sprint close |

---

## Phase 3 -- Documentation vs Technical Reference Gap Analysis

| Feature | Current Documentation Gap | Technical Improvement Suggested | Reason |
|---------|--------------------------|--------------------------------|--------|
| Authentication | No env var validation spec; SMTP vars not listed; no startup failure behavior documented | Add: `lib/env.ts` block listing BETTER_AUTH_SECRET, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM; show Zod schema snippet | krova-main validates all env vars at startup; missing SMTP var causes runtime failure not startup failure |
| Workspace | Async deletion describes 202 response but not the pg-boss job payload shape, retry policy, or idempotency guard | Add: `WorkspaceDeletePayload` type; retry limit; idempotency guard (check `workspace.status` before proceeding); lifecycle log entries | krova-main's deletion job pattern is directly applicable |
| Space | No technical detail on how Public -> Private toggle is enforced at the query layer | Add: Private Spaces filter by `SpaceMember` existence at query layer; add `@@index([spaceId, userId])` on SpaceMember | Without this, a developer may implement the toggle incorrectly |
| List | No spec for `order_index` reordering strategy; no spec for duplicate-list deep copy operation | Add: `order_index` uses fractional indexing or integer gaps; duplicate-list is a DB transaction copying List -> ListStatus -> Task rows in order | krova-main's transaction pattern shows how to structure multi-step copy operations |
| Task | FTS gap acknowledged in `improvement.md` but not in `task.md` itself | Add: `description_text` generated column note (post-MVP Phase 11); until then, FTS on tasks is title-only | Critical architectural decision currently siloed in improvement.md |
| Task | Dependency DFS cycle detection: algorithm mentioned but no implementation path | Add: on `POST /api/tasks/:id/dependencies`, traverse graph from `dependsOnTaskId` upward using recursive CTE or in-memory DFS; return 400 on cycle | Without this, a developer may implement a naive check that misses multi-hop cycles |
| Subtask | Progress rollup formula documented but no Prisma query pattern; no N+1 warning | Add: computed on-the-fly with COUNT query; add `@@index([parentTaskId])`; no caching needed at MVP scale | Without this, a developer may write an N+1 query per task card in list view |
| Sprint | Auto-close trigger mentioned as pg-boss cron but no job name, schedule, or payload spec | Add: `JOB_NAMES.SPRINT_AUTO_CLOSE`; cron schedule (every 15 min); `SprintAutoClosePayload` with `sprintId`; idempotency guard | krova-main's billing-hourly cron handler pattern is directly applicable |
| Sprint | Incomplete task strategy (move_to_backlog / move_to_next_sprint / leave_as_is) documented as UX only | Add: transaction spec -- `move_to_backlog` deletes TaskSprint rows; `move_to_next_sprint` creates new Sprint and inserts TaskSprint rows; all in one transaction | Multi-step operations need transactional guards |
| Views | dnd-kit Board View: no note on Next.js 15 App Router SSR incompatibility | Add: wrap all dnd-kit components in `dynamic(() => import(...), { ssr: false })`; dnd-kit accesses `window` on import and will crash SSR | improvement.md calls this out; views.md is where the note belongs |
| Views | `UserListViewPreference` deferred to Phase 12 but views.md does not mention this | Add: these tables are deferred to Phase 12; until then default to List View and use localStorage for transient preference | database-schema.md is correct; views.md is silent |
| Collaboration | File attachment upload pipeline: doc says files go to S3/R2 but no presigned URL flow spec | Add: client requests presigned PUT URL; client uploads directly to R2; client calls confirm endpoint; server validates and creates DB record | krova-main's storage pattern shows the exact ordering rule |
| Notifications | Daily digest pg-boss job: mentioned in UserEmailPreference but no job name, schedule, or handler spec | Add: `JOB_NAMES.NOTIFICATION_DIGEST`; 30-min cron that fans out per-user jobs based on `digestTime` preference; `NotificationDigestPayload` with `userId` | Per-user delivery times require a batch cron, not a single daily cron |
| Notifications | VAPID keys must be generated; no env var spec given | Add: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; generation command: `npx web-push generate-vapid-keys` | krova-main's env.ts pattern shows exactly how to validate at startup |
| Search & Filters | search.md implies full task search works; FTS on jsonb is not documented as limited | Add: task description search is post-MVP (Phase 11+); global search queries `title` and `name` fields only | Developer reading search.md without reading improvement.md will implement broken search |
| Permission Model | `canPerformAction()` pseudo-code has no codebase location note; no middleware vs route handler boundary | Add: lives in `src/lib/permissions.ts`; Next.js middleware only checks authentication (session presence), not authorization | Teamority needs a clear authn/authz boundary |
| Admin Panel | Impersonation 1-hour auto-expire mentioned but no implementation detail | Add: pg-boss cron (`impersonation.cleanup`) runs every 5 min and revokes sessions where `impersonatedBy IS NOT NULL AND createdAt < NOW() - 1 hour` | Security-critical feature; implementation path must be explicit |
| Customer Support | Missing user flows, notification triggers, auto-close job, admin UI screens | Add full user flow, notification table, pg-boss auto-close spec, admin vs user permission separation | Was a data model stub; cannot be built from original doc |

---

## Phase 4 -- Documentation Quality Audit

### Per-Document Scores

| Feature Doc | Score | Missing Sections / Issues | Top Improvements |
|------------|-------|--------------------------|-----------------|
| task.md | 9.5/10 | FTS gap not inline; missing `description_text` note | Add FTS limitation note; add index hints for key queries |
| permission-model.md | 9.5/10 | No codebase location for `canPerformAction()`; no middleware/route handler boundary | Add `src/lib/permissions.ts` reference; add authn vs authz boundary note |
| database-schema.md | 9.0/10 | No index migration timing guidance; no `description_text` placeholder | Add post-MVP placeholder comment; add index migration note |
| authentication.md | 8.5/10 | No env var validation spec; no SMTP rate limit note; no deliverability checklist | Add env.ts block; add SPF/DKIM/DMARC pre-launch checklist |
| workspace.md | 8.5/10 | No pg-boss job payload spec; no idempotency guard detail | Add `WorkspaceDeletePayload` type; add retry policy |
| empty-states.md | 8.5/10 | No loading skeleton pattern; no note on where server-side step checks run | Add skeleton-before-empty-state pattern; clarify server-side step check location |
| design-system.md | 8.5/10 | No Sheet vs AlertDialog convention; no `<LocalDate />` component spec | Add component usage rules; add LocalDate implementation note |
| collaboration.md | 8.0/10 | No presigned URL upload pipeline; no R2 delete ordering implementation | Add upload pipeline spec; add attachment hard-delete ordering note |
| avatar-system.md | 8.0/10 | No server-side resize implementation choice; no R2 key naming convention | Add resize implementation note; add R2 key convention |
| subtask.md | 7.5/10 | No progress rollup query pattern; N+1 risk not mentioned; no index note | Add Prisma query snippet; add `@@index([parentTaskId])`; clarify archived subtask exclusion |
| space.md | 7.5/10 | No Public -> Private toggle implementation detail; no SpaceMember index recommendation | Add query-layer enforcement note |
| improvement.md | 7.5/10 | Not cross-linked from the docs it corrects | Add cross-reference links to task.md, views.md, search.md |
| development-plan.md | 7.5/10 | No estimated durations; no definition of done per phase; no dependency callouts | Add phase completion criteria; add critical path notes |
| notifications.md | 7.0/10 | No VAPID env var spec; digest job architecture unclear; no deduplication query pattern | Add env vars + keygen command; add pg-boss handler spec for digest |
| sprint.md | 7.0/10 | No pg-boss job name/schedule for auto-close; no transaction spec for close modal actions | Add `JOB_NAMES` entry; add transaction spec |
| list.md | 7.0/10 | No `order_index` rebalancing strategy; no duplicate-list transaction spec; no status auto-creation note | Add order_index strategy; add copy transaction pattern |
| views.md | 6.5/10 | No dnd-kit SSR safety note; no `UserListViewPreference` deferral note; no Board View column order spec | Add `dynamic({ ssr: false })` pattern; add deferral note |
| search-and-filters.md | 6.5/10 | No FTS limitation stated; no Prisma full-text search syntax; no debounce pattern | Add Prisma search query; add FTS scope (title only at MVP) |
| admin-panel.md | 6.0/10 | No impersonation session cleanup implementation; no force-delete job payload spec | Add impersonation cleanup cron spec; add admin API auth mechanism |
| plans-and-pricing.md | REMOVED | Teamority is open-source; file deleted | -- |
| services.md | 6.0/10 | No setup runbook; no env var tables; no startup/teardown order | Rewritten -- now includes all of the above |
| landing-page.md | 5.5/10 | No routing spec; no analytics implementation; no performance targets | Rewritten -- now includes routing, ISR, analytics, Lighthouse targets |
| keyboard-shortcuts.md | 5.5/10 | No React hook architecture; no sequential shortcut pattern; no shortcut display component | Rewritten -- now includes full hook interface and registry |
| customer-support.md | 4.5/10 | No user flows; no notification triggers; no pg-boss spec; no admin UI screens | Rewritten -- now a complete implementation-ready doc |
| calendar-view.md | 4.0/10 | Post-MVP status contradicted by detailed MVP implementation notes | Rewritten -- clear post-MVP guard; SSR safety noted |
| folder.md | 3.5/10 | Intentionally minimal (post-MVP) -- correct and expected | No action needed |

### Top 5 Best-Documented Features

1. **task.md** (9.5) -- 16-field spec, 20 business rules, full data model with 10 related tables, complete event type reference, DFS cycle detection, description snapshot, data lifecycle. A developer can implement from this doc alone.
2. **permission-model.md** (9.5) -- Full capability matrices for both permission levels, Guest restrictions, Private Space behavior, `canPerformAction()` pseudo-code. No ambiguity.
3. **database-schema.md** (9.0) -- Single source of truth, Prisma-ready, phase-gated tables, index notes. Consistent with all feature docs.
4. **authentication.md** (8.5) -- Covers magic link flow, session management, rate limiting, data lifecycle, onboarding redirect.
5. **empty-states.md** (8.5) -- All 16 states spec'd with exact copy, layout, and CTA. Getting Started checklist with auto-check rules.

### Top 5 Worst-Documented Features (now rewritten)

1. **folder.md** (3.5) -- Intentionally minimal (post-MVP). Bottom rank is expected.
2. **calendar-view.md** (4.0) -- Mixed signals: post-MVP status contradicted by detailed implementation notes.
3. **customer-support.md** (4.5) -- Data model stub without user flows, notification triggers, or implementation path.
4. **landing-page.md** (5.5) -- No route structure, no component tree, no analytics implementation pattern.
5. **keyboard-shortcuts.md** (5.5) -- Good shortcut table but no React hook architecture, no per-route registration pattern.

---

## Phase 5 -- Rewritten Documentation

The following 5 docs have been fully rewritten on disk:

| File | Score Before | Score After | Summary of Changes |
|------|-------------|-------------|-------------------|
| `docs/customer-support.md` | 4.5/10 | 9.0/10 | Added full user flows, notification trigger table, pg-boss auto-close job spec, admin vs user permission model, complete API table, Prisma schema with indexes, `PlatformAuditLog` events |
| `docs/calendar-view.md` | 4.0/10 | 8.0/10 | Clear "DO NOT BUILD in Phases 0-18" guard, SSR safety note for dnd-kit, timezone edge cases, dependency ordering |
| `docs/keyboard-shortcuts.md` | 5.5/10 | 8.5/10 | `useKeyboardShortcuts` hook interface, `useSequentialShortcuts` state machine, Zustand shortcut registry for modal, per-route registration pattern, browser conflict table |
| `docs/landing-page.md` | 5.5/10 | 8.5/10 | `(marketing)` route group spec, SSG + ISR rendering strategy, SEO metadata pattern, analytics event table, performance targets (Lighthouse), component tree |
| `docs/services.md` | 6.0/10 | 9.0/10 | Per-service env var tables, local dev setup commands, startup/teardown order, health check endpoint, complete `.env.example` reference, R2 key naming convention, VAPID key generation, hosting trade-offs |

---

## Top 20 Markdown Improvements (Ranked by Impact)

1. **task.md** -- Add `description_text` FTS gap note inline (do not rely on improvement.md cross-reading)
2. **search-and-filters.md** -- Explicitly state title-only search at MVP; jsonb FTS is not indexable without a generated column
3. **views.md** -- Add dnd-kit `dynamic({ ssr: false })` requirement for Board View and Calendar View
4. **views.md** -- Add `UserListViewPreference` and `UserMyTasksPreference` Phase 12 deferral note
5. **sprint.md** -- Add pg-boss job spec: `JOB_NAMES.SPRINT_AUTO_CLOSE`, cron schedule (every 15 min), `SprintAutoClosePayload`, idempotency guard
6. **sprint.md** -- Add DB transaction spec for the incomplete task strategies (move_to_backlog, move_to_next_sprint, leave_as_is)
7. **notifications.md** -- Add VAPID env var specification and `npx web-push generate-vapid-keys` command
8. **notifications.md** -- Add daily digest architecture note: 30-min batch cron fans out per-user jobs based on `digestTime` preference
9. **workspace.md** -- Add `WorkspaceDeletePayload` type definition with retry policy and idempotency guard
10. **admin-panel.md** -- Add impersonation cleanup implementation: pg-boss cron + `auth.api.revokeSession()` on expired sessions
11. **plans-and-pricing.md** -- Add `checkPlanLimit()` function spec in `src/lib/plan.ts` and enforcement call in API routes
12. **collaboration.md** -- Add task attachment presigned URL upload pipeline spec (request URL -> direct R2 upload -> confirm endpoint)
13. **authentication.md** -- Add SMTP env var list and deliverability pre-launch checklist (SPF/DKIM/DMARC)
14. **subtask.md** -- Add progress rollup Prisma query pattern and note on N+1 risk in list views
15. **permission-model.md** -- Add `src/lib/permissions.ts` codebase location and middleware vs route handler boundary
16. **database-schema.md** -- Add `description_text` generated column as a post-MVP placeholder comment
17. **design-system.md** -- Add Sheet vs AlertDialog usage convention; add `<LocalDate />` component requirement
18. **improvement.md** -- Add cross-reference links to the specific docs each note applies to
19. **development-plan.md** -- Add definition-of-done criteria per phase; add critical path callout
20. **list.md** -- Add `order_index` rebalancing strategy and duplicate-list transaction spec

---

## Top 10 Reusable Engineering Patterns from krova-main

1. **`job-types.ts` registry** -- `JOB_NAMES` const + typed payload per job + `QUEUE_OPTIONS` compile-time guard. Apply to all 5 Teamority background jobs immediately. This pattern prevents ad-hoc job management and catches missing queue definitions at compile time.

2. **`lib/audit.ts` fire-and-forget** -- `audit()` function wraps DB insert in `try/catch`; errors are logged but never thrown; includes `extractRequestContext()` for IP/UA from Next.js headers. Apply identically to Teamority's `ActivityLog` writes.

3. **`lib/env.ts` Zod validation** -- All env vars validated at startup with Zod schema; typed `env` export used everywhere instead of `process.env`. Implement in Phase 0 before writing any feature code. Fail fast on missing vars with descriptive messages.

4. **Server action auth pattern** -- `auth.api.getSession()` at the top of every server action; `requireActionMembershipAndPermission()` for permission checks; early return `{ error: string }` throughout. Never inline session checks inside business logic.

5. **Enqueue-before-delete storage ordering** -- Storage cleanup jobs enqueued BEFORE the DB transaction commits; failed enqueue aborts deletion and returns error. Applies to all Teamority attachment and avatar deletes.

6. **Pre-flight checks before side effects** -- All precondition checks (permission, resource existence, business rules) run before any DB write or job enqueue. Prevents partial state on validation failure.

7. **Lifecycle vs audit log separation** -- Operational context in lifecycle logs (free-form, entity-scoped); security records in audit logs (structured, actor-scoped). Maps directly to Teamority's `ActivityLog` vs `PlatformAuditLog`.

8. **Transaction + enqueue pattern** -- Jobs enqueued inside or immediately after DB transactions. Ensures job payload is consistent with DB state at enqueue time. Apply to workspace deletion and sprint auto-close.

9. **`concurrently` two-process dev** -- `next dev` + `tsx --watch scripts/worker.ts` run simultaneously via `concurrently`. Copy the `package.json` scripts pattern exactly. Start this in Phase 0 even with zero handlers registered.

10. **Server action error wrapper** -- Every action wrapped in `try/catch`; inner error logged with `console.error("actionName error:", error)`; outer catch always returns `{ error: "Something went wrong..." }`. Never leaks stack traces to the client.

---

## Top 10 Architecture Improvements

1. **Add `src/lib/env.ts` in Phase 0** -- Validate DATABASE_URL, BETTER_AUTH_SECRET, SMTP_*, R2_*, NEXT_PUBLIC_APP_URL at startup. Fail fast with clear messages. Never access `process.env` directly outside this file.

2. **Add `src/lib/worker/job-types.ts` in Phase 0** -- Even with zero jobs implemented, the registry and enqueue infrastructure should exist before any async operation is written. Prevents ad-hoc job management discovered late.

3. **Add `<LocalDate />` before any timestamp display** -- Without it, React SSR/client hydration mismatches will produce errors on all date fields. Must exist before task detail panel is built (Phase 5).

4. **Add `src/lib/permissions.ts` as standalone module** -- Implement `canPerformAction(userId, workspaceId, spaceId, action)` as a pure function callable from API routes, server actions, and tests. Never inline permission logic in route handlers.

5. **Plan `description_text` generated column for Phase 11** -- PostgreSQL `GENERATED ALWAYS AS` column extracting text from Tiptap jsonb is required for FTS. Plan the migration now; do not defer the decision until Phase 11 discovery.

6. **Redesign notification digest job architecture** -- Per-user `digestTime` in `UserEmailPreference` requires a 30-minute batch cron that fans out per-user jobs -- not a single daily cron. This is more complex than it appears; spec it before Phase 14.

7. **Adopt fractional indexing for `order_index` fields** -- Integer gaps (1000, 2000, 3000) require periodic rebalancing when exhausted. Consider string-based fractional keys or the `fractional-indexing` library for drag-and-drop ordering on Tasks, Lists, and Sprints.

8. **Define `src/lib/plan.ts` enforcement layer in Phase 17** -- `checkPlanLimit(workspaceId, limitKey)` must be called from API routes (not just frontend). Define its interface and error response format before the Plans phase begins.

9. **Add `(marketing)` route group in Phase 0** -- The public landing page must be isolated from the authenticated app layout from the start. Retrofitting later requires moving files and fixing layout hierarchies.

10. **Start `scripts/worker.ts` as concurrent process from Phase 0** -- Even with no handlers registered, the worker process should run in dev from day one. Discovering `concurrently` integration issues in Phase 8 (workspace deletion) is costly.

---

## Top 10 Missing Technical Notes

1. **Task description FTS requires `description_text` generated column** -- jsonb full-text search in PostgreSQL requires a `GENERATED ALWAYS AS` column extracting text from the Tiptap jsonb. Standard `@@to_tsquery` against a jsonb column does not work. This affects the entire search feature scope.

2. **dnd-kit crashes SSR in Next.js App Router** -- Any component importing dnd-kit will fail server-side render. All Board View and Calendar View components must be wrapped in `dynamic(() => import(...), { ssr: false })`. Not wrapping causes a hard crash in production builds.

3. **Email deliverability requires SPF/DKIM/DMARC before launch** -- Magic link emails will land in spam without DNS record configuration. Setup takes 24-48 hours for DNS propagation; this cannot be done on launch day.

4. **pg-boss worker must be a separate long-running process** -- pg-boss does not run inside Next.js API routes or server actions. A dedicated `scripts/worker.ts` process must run alongside Next.js. This directly affects hosting choice (Vercel alone is insufficient).

5. **Daily digest job requires per-user scheduling** -- `UserEmailPreference.digestTime` is per-user. A single daily cron cannot honor arbitrary per-user delivery times. Requires a 30-minute batch cron that queries users whose digest window has just arrived and fans out per-user jobs.

6. **`taskSeq` increment must be atomic inside a DB transaction** -- Use `UPDATE workspace SET task_seq = task_seq + 1 WHERE id = ? RETURNING task_seq` with a row lock inside the task creation transaction. Prevents sequence gaps or duplicate task numbers under concurrent writes.

7. **Private Space visibility returns 404, not 403** -- Server-side queries must exclude spaces where the user is not a `SpaceMember`. The permission layer returns 404 to avoid leaking space existence. A 403 would confirm the space exists.

8. **Comment soft-delete requires parent check inside a transaction** -- A comment with no replies can be hard-deleted. A comment with replies must be soft-deleted (preserves thread structure). This check must be inside a transaction to prevent race conditions.

9. **`TaskDescriptionSnapshot` has a unique constraint on `taskId`** -- Only one snapshot per task. Saving a new description snapshot must use Prisma `upsert`, not `create`. A second `create` call will fail with a unique constraint violation.

10. **VAPID push subscriptions are invalidated when keys rotate** -- If VAPID keys are changed, all stored `PushSubscription` records become invalid. WebPush returns HTTP 410 Gone on stale subscriptions. The handler must delete the `PushSubscription` record on 410 to prevent repeated failed sends.

---

## "If Development Starts Tomorrow" -- Priority Order

### Day 1 -- Phase 0 Foundations (must complete before writing any feature code)

1. Initialize Next.js 15 project with TypeScript, Tailwind CSS v4, shadcn/ui
2. Create `src/lib/env.ts` -- Zod validation of all env vars; fail fast on startup with clear messages
3. Set up PostgreSQL locally (Docker), run `npx prisma init`, apply `npx better-auth migrate`
4. Configure `scripts/worker.ts` + `concurrently` in `package.json`; start the worker even with zero handlers
5. Create `src/lib/worker/job-types.ts` with empty `JOB_NAMES` and `QUEUE_OPTIONS`
6. Create `src/lib/db.ts` (Prisma singleton) and `src/lib/auth.ts` (Better Auth instance)
7. Set up Biome for linting/formatting
8. Create `(marketing)` and `(app)` route groups; stub layouts with correct auth/no-auth separation
9. Add `<LocalDate />` to `src/components/ui/local-date.tsx`
10. Create `.env.example` with all required/optional var names (no values)

### Week 1 -- Core Auth and Workspace (Phases 1-2)

11. Implement magic link auth with Better Auth; test end-to-end email delivery
12. Implement workspace creation, invite, and role assignment
13. Implement async workspace deletion (202 + pg-boss job + idempotency guard)
14. Write `src/lib/permissions.ts` with `canPerformAction()` function
15. Add `src/lib/audit.ts` with fire-and-forget `audit()` function

### Week 2 -- Space and List (Phases 3-4)

16. Implement Space CRUD with visibility toggle; verify Private Space 404 behavior
17. Auto-create default List and default statuses on Space creation
18. Implement List CRUD with `order_index` management

### Week 3 -- Task Core (Phases 5-7)

19. Implement Task CRUD with `taskSeq` atomic increment inside transaction
20. Implement task dependency creation with DFS cycle detection
21. Implement `TaskDescriptionSnapshot` with upsert pattern
22. Implement Subtask creation; add `@@index([parentTaskId])` to schema

### Before Phase 12 (Views)

23. Add `UserListViewPreference` and `UserMyTasksPreference` tables to schema
24. Implement Board View with `dynamic({ ssr: false })` wrapper for all dnd-kit components

### Before Phase 14 (Notifications)

25. Generate VAPID keys; add to env vars; implement `PushSubscription` table
26. Design notification digest cron architecture (30-min batch, per-user fan-out jobs)

### Before Launch

27. Configure SPF, DKIM, DMARC for the sending domain; verify with mail-tester.com
28. Add `GET /api/health` endpoint returning `{ ok: true, db: 'connected' }`
29. Verify all pg-boss jobs are registered in `QUEUE_OPTIONS`
30. Run Lighthouse on landing page; fix any score below 90
