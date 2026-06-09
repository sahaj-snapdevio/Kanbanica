# Per-domain "Clear cache" — design

**Date:** 2026-06-02
**Status:** Approved, implementing
**Branch:** `feat/domain-cache-purge`

## Problem

Customer custom domains route through Krova's Cloudflare-for-SaaS zone
(`krova.cloud`) via Custom Hostnames. Once a hostname is proxied + active,
Cloudflare's edge caches static assets for it. When a customer ships a new
version of their site, the stale assets can linger at the edge until TTL
expiry. There is no way today for a customer (or an operator) to purge the
edge cache for a single custom domain.

The customer's own DNS record is **grey-cloud / DNS-only** (mandatory — an
orange-cloud record hits Cloudflare Error 1014 "CNAME Cross-User Banned" and
breaks cert issuance), so the customer's Cloudflare caches nothing. ALL edge
caching lives on Krova's zone, which means **only Krova can issue the purge** —
the customer cannot do it from their own Cloudflare dashboard. Hence an
in-product "Clear cache" control.

## Goal

A per-domain **Clear cache** action that purges *only that hostname's* cached
assets from Krova's Cloudflare zone, isolated from every other customer's
cache, exposed on the customer dashboard, the Orbit admin domains table, and
the v1 API.

## Third-party API (verified 2026-06-02)

- **Endpoint:** `POST /zones/{zone_id}/purge_cache`
- **Body (purge by hostname):** `{ "hosts": ["app.customer.com"] }` — up to 30
  hostnames per request.
- **Plan availability:** purge-by-hostname is available on **all plans** (Free
  included) since Cloudflare's April 2025 "Instant Purge for all" change. No
  Enterprise requirement.
- **Rate limits (hostname/tag/prefix/everything bucket):** Free 5/min, Pro
  5/s, Business 10/s, Enterprise 50/s.
- **NEVER use "purge everything"** (`{ "purge_everything": true }`) on this
  zone — it would purge every customer's cached content at once. By-hostname
  only.

Sources: `developers.cloudflare.com/cache/how-to/purge-cache/`,
`.../purge-cache/purge-by-hostname/`, `blog.cloudflare.com/instant-purge-for-all/`.

## Architecture

Mirrors the existing `domain.add` / `domain.remove` pattern: API route →
pg-boss worker job → Cloudflare client. No SSH (Rule 1 clean either way; this
keeps it consistent with every other Cloudflare mutation).

### 1. Cloudflare helper — `lib/cloudflare/`

`purgeCustomHostnameCache(hostname: string): Promise<void>` next to the
custom-hostname CRUD, calling `cfRequest("POST", "/zones/{zone}/purge_cache",
{ hosts: [hostname] })`. Exported from `lib/cloudflare/index.ts`. A Cloudflare
`429` surfaces as a retryable `CloudflareError` so the worker backs off.

### 2. Schema — `db/schema/domains.ts`

Add `lastCachePurgeAt timestamptz` (nullable, `withTimezone: true`) to
`domain_mappings`. Additive/non-locking (Rule 40). Migration via
`pnpm db:generate` (Rule 6) — generated only, applied by the operator.

### 3. Config — `config/platform.ts`

`DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS = 60`.

### 4. Worker job — `lib/worker/`

- `JOB_NAMES.DOMAIN_PURGE_CACHE = "domain.purge-cache"`, payload
  `{ mappingId, cubeId, spaceId, domain }`.
- Explicit `QUEUE_OPTIONS` entry (Rule 56): `retryLimit: 5, retryDelay: 60`.
  Cloudflare's purge-by-hostname rate limit is **zone-wide + plan-tiered**
  (Free 5/min + 25-token burst bucket; Pro 5/s; Business 10/s; Enterprise
  50/s). On the Free plan a drained bucket refills at only 5/min, so retries
  are spaced a full minute apart (let the window refill) with a generous
  budget (~5 min) so a rate-limited purge eventually lands instead of
  false-failing — a cache purge is not latency-critical. Enqueued with
  `singletonKey: mappingId` to collapse rapid re-enqueues.
- Handler `lib/worker/handlers/domain-purge-cache.ts`: idempotent guards
  (mapping exists, `status='active'`, `cloudflareStatus='active'`) → guarded
  `purgeCustomHostnameCache` → `JobLogger` step + lifecycle log
  ("Cache cleared for `<domain>`") + `audit({ action: "domain.cache_purged" })`
  + Pusher `domain.cache-purged` on `private-cube-{cubeId}`.

### 5. Cooldown + shared enqueue — `lib/cloudflare/purge-enqueue.ts`

- Pure `cachePurgeCooldownRemainingMs(lastAt: Date | null, now: Date): number`
  (unit-tested).
- `enqueueDomainCachePurge({ mappingId, actor })`: loads the mapping, checks
  cooldown via the pure fn; within window → throws typed `CachePurgeCooldownError`
  carrying `retryAfterSeconds`; otherwise stamps `lastCachePurgeAt = now` and
  enqueues the job. Shared by all three routes (Rule 14).
- The worker's CF-429 auto-retry covers zone-level rate contention; the
  per-domain cooldown covers per-customer spam.

### 6. Entry points (full parity)

| Surface   | Route                                                                   | Auth                                   |
| --------- | ----------------------------------------------------------------------- | -------------------------------------- |
| Dashboard | `POST /api/spaces/[spaceId]/cubes/[cubeId]/domains/[mappingId]/purge-cache` | `requireSession` → `requireSpaceMember` → `cube.manage` → `requireCubeAccess` |
| v1 API    | `POST /api/v1/spaces/[spaceId]/cubes/[cubeId]/domains/[mappingId]/purge-cache` | `requireV1ApiKey` → `cube.manage` → `requireCubeAccess` |
| Orbit     | `POST /api/orbit/domains/[mappingId]/purge-cache`                        | `requireAdmin`                          |

All three call `enqueueDomainCachePurge` and return **202** `{ enqueued: true }`
or **429** `{ retryAfterSeconds }`. No duplicated logic.

### 7. UI

- **Customer** (`components/domain-mappings.tsx`): icon button in the existing
  actions column, shown only when `status==='active' && cloudflareStatus==='active'`
  (cache exists only once proxying is live), disabled with a tooltip otherwise.
  Click → `ConfirmActionDialog` ("Clear all cached content for `<domain>`?") →
  `useMutation` POST → toast. Pusher `domain.cache-purged` → "Cache cleared ✓"
  / error toast. 60s countdown disables the button after firing.
- **Orbit** (`app/(orbit)/orbit/domains/_components/domains-table.tsx`): same
  button + confirm hitting the Orbit route. (First mutation on this page.)

### 8. Tests (Rule 59 — Cloudflare stubbed)

- **Unit** (`pnpm test`): purge helper builds the correct `{ hosts: [...] }`
  body; `cachePurgeCooldownRemainingMs` boundary cases.
- **Integration** (`pnpm test:integration`): cooldown returns 429 inside the
  window / 202 outside; permission gating (non-`cube.manage` rejected); worker
  idempotency (non-active mapping → skip, no CF call); `lastCachePurgeAt`
  stamped at enqueue.

## Out of scope (YAGNI)

Purge-by-URL / by-tag, scheduled/auto purges, a global "purge all my domains"
button. By-hostname only.

## Rules touched

1 (worker job, not route), 4 (ORM only), 5 (env via lib/env if any — none new),
6 (db:generate), 8/9 (lifecycle + audit), 12 (AlertDialog confirm), 14 (shared
enqueue helper, no duplication), 40 (additive column), 56 (explicit
QUEUE_OPTIONS), 59 (tests), 60 (local only — migration generated not applied).
