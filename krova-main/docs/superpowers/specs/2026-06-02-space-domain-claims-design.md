# Space-wide domain claims (TXT-verified domain locking)

**Status:** Approved — implementing
**Date:** 2026-06-02
**Branch:** `feat/space-domain-claims` (off `main`)

---

## 1. Problem

A space maps custom domains to its cubes. Today the only cross-space guard is
an **exact-hostname** uniqueness check in `addDomainAction`
([lib/cube-actions/domains.ts](../../../lib/cube-actions/domains.ts)) — so
`app.acme.com` in space A and `api.acme.com` in space B both pass, with **no
proof of ownership** and no protection for a customer who owns `acme.com`
(including its wildcard `*.acme.com`). The old per-hostname
`domainMappings.verificationStatus` flow is vestigial.

A customer who points a wildcard domain at Krova has no way to assert that
`acme.com` (and everything under it) belongs to **their** space and no one
else's.

## 2. Decision

Add a **space-level domain claim**: a space proves ownership of a registrable
domain (e.g. `acme.com`) by adding **one TXT record**. Once verified, that
domain **and all its subdomains/wildcards** are **locked to that space** — no
other space may map any hostname under it.

- **Coverage:** registrable domain + all subdomains (one claim, one TXT record,
  covers the wildcard case).
- **Enforcement:** **optional + additive.** Claiming is opt-in; a verified
  claim only *locks others out*. Unclaimed domains still map first-come (today's
  behavior). No disruption to existing live domains, no forced migration.
- **Placement:** a **space-settings card** ("Verified Domains"), framed as
  space-wide domain locking. Nothing on the cube.
- **Architecture-independent:** claims are about *ownership*, not routing, so
  this is unaffected by the CF-for-SaaS → self-hosted-ingress decision.

## 3. Data model — `space_domain_claims`

New table ([db/schema/domain-claims.ts](../../../db/schema/domain-claims.ts)):

| column           | type                                   | notes |
| ---------------- | -------------------------------------- | ----- |
| `id`             | text PK (cuid2)                        |       |
| `space_id`       | text NOT NULL → `spaces.id` (cascade)  |       |
| `domain`         | text NOT NULL                          | normalized lowercase registrable domain, e.g. `acme.com` |
| `token`          | text NOT NULL                          | per-claim secret (`randomBytes(16).hex`), in the TXT value |
| `status`         | `domain_claim_status` enum             | `pending \| verified \| failed` |
| `verified_at`    | timestamptz nullable                   |       |
| `last_checked_at`| timestamptz nullable                   | last DNS check (verify or recheck cron) |
| `failed_checks`  | integer NOT NULL default 0             | consecutive recheck misses (drives auto-release) |
| `created_at`     | timestamptz default now                |       |
| `updated_at`     | timestamptz default now                |       |

**Indexes / constraints:**

- `index(space_id)`.
- `uniqueIndex(space_id, domain)` — a space lists a domain once.
- **`uniqueIndex(domain) WHERE status='verified'`** — a domain is verified by at
  most one space (the DB-level lock; mirrors the existing
  `domain_mappings_domain_verified_unique` pattern).
- `index(domain)` — fast lookup for the enforcement query.

`domain_claim_status` is added to [lib/status-display.ts](../../../lib/status-display.ts)
(Rule 44) for the badge.

## 4. Pure logic — `lib/domains/claim-coverage.ts` (unit-tested)

- `normalizeClaimDomain(input): string | null` — trim/lowercase/strip trailing
  dot, validate via `validateDomain` (already rejects wildcards + single-label),
  return null if invalid.
- `claimCovers(claimDomain, hostname): boolean` — `hostname === claimDomain ||
  hostname.endsWith("." + claimDomain)`. The dot-boundary means `acme.com` does
  **not** cover `notacme.com`.
- `candidateParentDomains(hostname): string[]` — every ≥2-label suffix of
  `hostname` (`a.b.acme.com` → `a.b.acme.com`, `b.acme.com`, `acme.com`). Used to
  query "is any verified claim covering this hostname?" with an indexed
  `domain IN (...)`.
- `claimsOverlap(a, b): boolean` — `claimCovers(a,b) || claimCovers(b,a)`; for
  the disjoint-subtree rule across spaces.

TXT record shape (constants in [config/platform.ts](../../../config/platform.ts)):
host `_krova-verify.<domain>`, value `krova-domain-verification=<token>`.

## 5. DNS verification — `lib/domains/verify-txt.ts`

`verifyClaimTxt(domain, token): Promise<boolean>` — `dns.resolveTxt(\`_krova-verify.${domain}\`)`,
join each record's chunk array, return true iff any equals
`krova-domain-verification=<token>`. **Fail-closed**: any miss / NXDOMAIN /
timeout / error → `false` (3 s timeout, mirrors the [email-validation](../../../lib/email-validation/index.ts)
DNS pattern but inverted polarity — verification must be positively proven).

## 6. Actions — `app/actions/domain-claims.ts` (`"use server"`)

All gated by `requireActionMembershipAndPermission(spaceId, "cube.manage")`
(the permission already governing custom domains; owners always have it). Each
writes an `audit()` row (category `domain`) + a `space` lifecycle log.

- **`createDomainClaim(spaceId, rawDomain)`** — normalize; reject if it
  `claimsOverlap` any **other** space's verified claim (→ "locked to another
  space"); reject duplicate in this space; generate token; insert `pending`.
  Returns `{ claim, txtName, txtValue }`.
- **`verifyDomainClaim(spaceId, claimId)`** — load (scoped to space); run
  `verifyClaimTxt` (fail-closed). On success, inside a transaction: re-check no
  **other** space has a verified overlapping claim, and **no other space has an
  active `domain_mappings` row under this domain** (§7 conflict) → flip to
  `verified` (`verified_at=now`, `failed_checks=0`). The partial unique index is
  the backstop (catch `23505` → "claimed by another space"). On DNS failure →
  stay `pending`, return a clear message.
- **`releaseDomainClaim(spaceId, claimId)`** — delete the row (releases the
  lock). The space's own existing mappings are untouched.

## 7. Enforcement (the lock) — in `addDomainAction`

Before the existing exact-hostname check, for hostname `H` in space `S`:

```
parents = candidateParentDomains(H)
verifiedCovering = SELECT * FROM space_domain_claims
                   WHERE domain IN (parents) AND status='verified' LIMIT 1
if verifiedCovering && verifiedCovering.space_id !== S:
    return 409 "This domain is locked to another space."
```

Owned-by-`S` or none → proceed (today's first-come exact-hostname rule still
applies to unclaimed domains). Runs in `addDomainAction`, so it covers the
dashboard route **and** the v1 API route (both call it).

**Verify-time conflict (conservative, §6):** if another space already holds an
active mapping under the domain being verified, **block the verify** with a
clear conflict error + notify admins (`getErrorNotifyEmails()` / audit). Never
auto-evict a live customer domain — an operator resolves it (matches the
codebase's "warn, don't auto-destroy" posture).

## 8. Re-check cron — `domain-claim.recheck`

[lib/worker/handlers/domain-claim-recheck.ts](../../../lib/worker/handlers/domain-claim-recheck.ts),
daily, `policy:"exclusive"`, explicit `QUEUE_OPTIONS` entry (Rule 56), scheduled
in [boss.ts](../../../lib/worker/boss.ts).

Re-resolves each `verified` claim's TXT. On success → `failed_checks=0`,
`last_checked_at=now`. On miss → `failed_checks++`; once it reaches
`DOMAIN_CLAIM_MAX_FAILED_CHECKS` (default 3 ⇒ ~3 days), flip `verified→failed`
(releasing the lock), audit + `space` lifecycle log, and email the space owner
(`lib/email/templates/domain-claim-released.ts`). Prevents a removed-TXT /
transferred domain from holding a lock hostage forever. Idempotent; unreachable
DNS is a "miss" but the 3-strike threshold tolerates transient blips.

## 9. UI

**Customer — "Verified Domains" card in space settings**
([components/space-settings.tsx](../../../components/space-settings.tsx) renders a
new `components/space-domain-claims.tsx`; data fetched in
[settings/page.tsx](../../../app/(dashboard)/[spaceId]/settings/page.tsx)):

- Lists claims (domain · status badge · verified-at) with a **"Claim a domain"**
  Sheet: enter `acme.com` → shows the `TXT _krova-verify.acme.com →
  krova-domain-verification=<token>` record (copy buttons) → **Verify** button.
- Per-row **Verify** (re-runs the check) and **Release** (`ConfirmActionDialog`).
- Header copy: *"Lock a domain to this space. Once verified, no other space can
  use it or its subdomains."* Gated on `cube.manage` (read-only otherwise).

**Cube "Add domain" sheet** — unchanged, except a blocked map now surfaces
*"This domain is locked to another space."* (the 409 message). No claim UI here.

**Orbit** — a claims list across all spaces
([app/(orbit)/orbit/domains](../../../app/(orbit)/orbit/domains)) for visibility
+ conflict resolution (admin release), gated by `requireAdmin`.

## 10. Testing (Rule 59)

- **Unit (`pnpm test`):** `claimCovers` (incl. the `notacme.com` dot-boundary +
  apex equality), `candidateParentDomains`, `claimsOverlap`,
  `normalizeClaimDomain` (rejects wildcard / single-label / invalid).
- **Integration (`pnpm test:integration`, DNS stubbed):** create rejects
  overlap with another space's verified claim; verify flips pending→verified +
  the partial-unique blocks a second space verifying the same domain; the
  `addDomainAction` lock blocks a cross-space map and allows the owning space;
  verify blocked when another space has an active mapping under the domain;
  release frees the lock.

## 11. Out of scope (YAGNI)

Auto-evicting another space's live domain on verify (operator-resolved); CNAME /
file verification methods (TXT only); a dedicated `domain.manage` permission
(reuse `cube.manage`); a public-suffix-list dependency (TXT proof self-protects
against claiming a public suffix — you can't add a TXT to `com`).

## 12. Build order

1. Schema (`domain-claims.ts`) + barrel + types + `pnpm db:generate` (migration).
2. Config constants + `status-display` enum entry.
3. Pure `claim-coverage.ts` + `verify-txt.ts` (+ unit tests).
4. `addDomainAction` lock enforcement.
5. Actions (`domain-claims.ts`).
6. Worker recheck cron + email template.
7. UI: settings card + Orbit list.
8. Tests (unit + integration) → `pnpm test:all` → docs (CLAUDE.md, README) → commit.

## Rules touched

1 (DNS verify inline is not SSH — consistent with email-validation; the cron's
DNS runs in the worker), 4 (ORM only), 5 (no new `process.env`), 6 (db:generate),
8/9 (lifecycle + audit), 12 (ConfirmActionDialog), 14 (shared pure logic + one
enforcement path), 22 (docs), 40 (additive table, no destructive change), 44
(status-display), 56 (explicit QUEUE_OPTIONS), 59 (tests), 60 (migration
generated, not applied; operator runs it).
