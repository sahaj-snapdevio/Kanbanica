# Kanbanica — Open-Source Readiness Audit & Release Plan

## Context

Kanbanica is a Next.js 15 project-management SaaS (ClickUp-style: Workspaces → Projects/Spaces → Lists/Sprints → Tasks) that the owner wants to publish as a self-hostable open-source project expecting significant community traction. This document is a **read-only audit** — no code was changed. It identifies every SaaS-specific assumption, security/secret/licensing concern, and community-health gap, then gives a prioritized, phased implementation plan.

The good news up front: the codebase is **well-engineered and unusually close to OSS-ready**. Branding is centralized (`config/platform.ts`), env vars are Zod-validated in one place (`lib/env.ts`), there is **no analytics/telemetry, no Stripe/billing, and no proprietary/private npm packages**, all optional services degrade gracefully, and permission/auth checks are consistent. The blockers are almost entirely **missing legal + community files, a misleading README, and infra/docs gaps** — not code rot.

**User decisions captured (2026-07-01):**
- **License: MIT.**
- **Seed/demo data: recommendation only** (no commitment to build it now).
- **Internal docs: prune the scaffold cruft** (remove `cloud.md`, `krova-main/`, `AGENTS.md`; generalize the rest).

---

## Critical (must fix before open source)

### C1 — No LICENSE file (legal blocker)
- **Files:** repo root (missing `LICENSE`).
- **Why:** Without a license, default copyright applies — nobody may legally clone, modify, or redistribute. "Open source" without a license is a contradiction.
- **Impact:** Legally blocks the entire goal.
- **Solution:** Add `LICENSE` with the **MIT** license text and correct copyright holder/year. Add a License section to the README. Set `"license": "MIT"` in `package.json`.
- **Priority:** Critical · **Effort:** 15 min

### C2 — Rotate the real secrets currently in the local `.env`
- **Files:** `.env` (on disk, **correctly git-ignored** via `.gitignore` `.env*` rule — never committed; verified `git log` shows no history).
- **Why:** The working `.env` holds **real** credentials: Google OAuth client secret (`GOCSPX-…`), Mailtrap SMTP user/pass, and a 42-char `APP_SECRET`. These are not in git, so they will **not** be published — but they were surfaced during this audit and should be treated as exposed.
- **Impact:** Not a publishing blocker (git-ignored), but the OAuth secret in particular should be rotated. Mailtrap sandbox creds are low-risk.
- **Solution:** Before/after publishing, rotate the Google OAuth client secret in Google Cloud Console; regenerate Mailtrap creds; generate a fresh `APP_SECRET`. Double-check `.env` is absent from the published tree. **Do not** commit `.env`.
- **Priority:** Critical · **Effort:** 30 min

### C3 — README describes the wrong product ("KROVA Scaffold")
- **Files:** `README.md`, `cloud.md`, `AGENTS.md`, `package.json` (`"name": "krova-scaffold"`).
- **Why:** The README pitches a generic "KROVA Scaffold / Orbit admin," not Kanbanica. A visitor cannot tell what the repo is, what it does, or why to use it. This is the single biggest first-impression failure for a repo hoping for stars.
- **Impact:** Kills discoverability and trust; contradicts the actual product.
- **Solution:** Rewrite `README.md` for Kanbanica with:
  - A one-line pitch + a **"Why Kanbanica?"** section (what problem it solves, who it's for).
  - **Multiple screenshots** — Board view, List view, Sprint view, Task detail, and Mobile (reuse/expand `public/before2.png`/`after2.png`/`width_497.png`; capture fresh ones as needed).
  - A **supported-features** list and a **feature comparison table** (e.g. vs. ClickUp/Trello/self-hosted alternatives) to help visitors size it up.
  - **GitHub badges** (license, build/CI status, release version, stars, PRs-welcome).
  - Tech-stack table, a clear **installation flow**, links to the new docs (ARCHITECTURE/DEVELOPMENT/DEPLOYMENT), and a License section.
  - Rename `package.json` to `kanbanica`. (Cruft removal handled in R-series.)
- **Priority:** Critical · **Effort:** 3–4 h

### C4 — No community-health files (CONTRIBUTING / SECURITY / CODE_OF_CONDUCT)
- **Files:** missing `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`; missing `.github/` entirely (no issue templates, PR template, CI, dependabot).
- **Why:** Contributors have no idea how to set up, submit PRs, or report vulnerabilities responsibly. GitHub surfaces these as "community standards"; their absence signals an unmaintained project.
- **Impact:** High friction for the "many contributors" goal; no responsible-disclosure path for security bugs.
- **Solution:** Add `CONTRIBUTING.md` (setup, branch/commit conventions, `pnpm lint`/`typecheck`, PR process), `SECURITY.md` (private disclosure contact + supported versions), `CODE_OF_CONDUCT.md` (Contributor Covenant), `.github/ISSUE_TEMPLATE/` (bug + feature), `.github/PULL_REQUEST_TEMPLATE.md`.
- **Priority:** Critical · **Effort:** 3 h

### C5 — Hardcoded SaaS branding still leaks past `config/platform.ts`
- **Files:** `config/platform.ts` (source of truth: `PRODUCT_NAME`, `SUPPORT_EMAIL="support@kanbanica.com"`, `MARKETING_DOMAIN="kanbanica.com"`), plus literal `"Kanbanica"` strings still in `app/layout.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/_components/watermark-background.tsx`, `components/workspace/landing-page.tsx`, `components/landing-page.tsx`, `app/(app)/[workspaceId]/settings/themes/page.tsx`.
- **Why:** Branding is *mostly* centralized (50+ correct references to the config constant — excellent), but the residual literals plus a placeholder support email/domain mean a self-hoster can't fully rebrand from one place. `support@kanbanica.com` / `kanbanica.com` may not even be real inboxes.
- **Impact:** Self-hosters ship Kanbanica's brand/support address by accident; "customize branding" story is incomplete.
- **Solution:** Replace residual literals with `PRODUCT_NAME` from `config/platform.ts`. Make `SUPPORT_EMAIL`/`MARKETING_DOMAIN` env-overridable (add to `lib/env.ts` with the current values as defaults). Document rebranding (logo swap in `public/`, `LOGO_PATH`, favicons) in the README.
- **Priority:** Critical (for a clean release) · **Effort:** 2–3 h

### C6 — Legal pages ship placeholder Terms/Privacy
- **Files:** `app/(legal)/terms/page.tsx`, `app/(legal)/privacy/page.tsx`, `app/(legal)/layout.tsx`.
- **Why:** Bundled Terms/Privacy referencing "Kanbanica" become the self-hoster's legal text by default — inappropriate and potentially misleading for a downstream deployment.
- **Impact:** Downstream deployers unknowingly publish someone else's legal boilerplate.
- **Solution:** **Keep the pages — do not remove them.** Mark them clearly as **templates** for self-hosters (a visible banner/notice: "This is a template — replace with your own legal text before production use"). Optionally source the copy from a `docs/legal-templates/` file. Document that self-hosters must supply their own.
- **Priority:** Critical · **Effort:** 1 h

---

## Recommended (high-value, do before or shortly after launch)

### R1 — Prune scaffold cruft (per your decision)
- **Files:** `cloud.md`, `krova-main/ANALYSIS-KROVA.md` (+ folder), `AGENTS.md`, README "KROVA" language, `"krova-scaffold"` name, and `krova`/`Orbit` identifiers in code where user-facing.
- **Why:** These are upstream-scaffold leftovers with no meaning to contributors and actively confuse the project identity.
- **Detail:**
  - Remove `cloud.md`, `krova-main/`, `AGENTS.md` (or replace `AGENTS.md` with a real agent/contributor pointer).
  - **Keep `CLAUDE.md` — do NOT delete it.** Rename/generalize it and strip any company-specific information; it contains genuinely useful architecture context for contributors. (See N3.)
  - **Do NOT rename internal database names in this release.** `krova` appears as the embedded-postgres DB/user name in `scripts/dev-db.ts` (port 54329) and in `app/api/account/export/route.ts`. These are **not user-facing** — renaming them would break every existing local developer environment for zero user benefit. Leave them as-is; defer any rename to a future **major** release.
  - The admin panel is branded **"Orbit"** and lives at `app/(orbit)/orbit/` (there is also `app/admin/`). Reconcile per R7 — do not delete either until verified.
- **Priority:** High · **Effort:** 2–3 h

### R2 — Add a Next.js app Dockerfile + docker-compose for one-command self-host
- **Files:** only `Dockerfile.worker` exists; missing app `Dockerfile`, `docker-compose.yml`. `.dockerignore` present and correct.
- **Why:** Self-hosting is a core OSS promise. Today a user must hand-wire Postgres + Next.js + a separate worker process. The two-process architecture (`pnpm start` + `pnpm worker:start`, 11 pg-boss cron handlers in `lib/worker/handlers/`) is only documented in `docs/services.md`.
- **Impact:** "Can they deploy easily?" — currently no. Biggest self-host friction point.
- **Solution:** Add a multi-stage app `Dockerfile` (mirror `Dockerfile.worker` style, `node:22-bookworm-slim`, non-root) and a `docker-compose.yml` wiring `postgres` + `app` + `worker` with volumes, ports, health checks, and an app health endpoint (a `GET /api/health` reportedly exists — verify and document). Add `docker compose up` to the README.
- **Priority:** High · **Effort:** 6–8 h

### R3 — Rewrite/replace the developer setup story
- **Files:** `README.md`, `docs/commands.md` (429 B, too terse), new `docs/DEVELOPMENT.md` / `docs/DEPLOYMENT.md` / `docs/ARCHITECTURE.md`.
- **Why:** The 10-minute onboarding test partly passes (embedded Postgres via `pnpm db:local`, `pnpm dev` runs Next + worker via `concurrently`) but is undocumented: a newcomer won't know the worker starts with `pnpm dev`, that `pnpm make:admin <email>` promotes the first user, or how the two-process prod model works.
- **Impact:** Contributor drop-off; repeated "how do I run this" issues.
- **Solution:** ARCHITECTURE (system diagram: Next.js ↔ Postgres ↔ pg-boss worker, SSE real-time via `lib/sse-clients.ts`, storage via `files-sdk`), DEVELOPMENT (prereqs: Node from `.node-version`, pnpm 11.6; step-by-step install → env → db:local → db:migrate → dev → make:admin), DEPLOYMENT (env matrix, prod two-process model, storage/SMTP setup). The internal `docs/services.md` and `docs/database-schema.md` are excellent raw material.
- **Priority:** High · **Effort:** 6–8 h

### R4 — Add CI (GitHub Actions) + Dependabot
- **Files:** missing `.github/workflows/`, `.github/dependabot.yml`.
- **Why:** No automated lint/typecheck/build gate. `biome check` and `tsc --noEmit` scripts already exist and are cheap to run in CI.
- **Impact:** Contributor PRs can silently break `main`; reviewers do manual checks.
- **Solution:** Add a CI workflow: `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm build` on PR/push. Add Dependabot for `npm` + `github-actions`. Optional: a Postgres service container to smoke-test migrations.
- **Priority:** High · **Effort:** 3–4 h

### R5 — Add API rate limiting
- **Files:** `app/api/**` route handlers — notably auth/magic-link, `app/api/user/avatar/route.ts` (2 MB), `app/api/channel-attachments/route.ts` (25 MB), `app/api/support/tickets/route.ts`, file serving `app/api/files/[...key]/route.ts`.
- **Why:** Auth checks are consistent (every route validates session / admin role — verified across ~47 routes) and uploads are validated (size + MIME whitelist + server-side `sharp` re-encode), but there is **no rate limiting**. A public self-hostable app invites abuse (magic-link spam, upload floods).
- **Impact:** DoS / resource-exhaustion / email-bombing risk on public deployments.
- **Solution:** Add lightweight middleware or per-route limiting (e.g. an in-memory/Redis token bucket), starting with magic-link request and upload endpoints. Document the Redis-in-prod expectation (already noted for SSE registry in `docs/realtime.md`).
- **Priority:** High · **Effort:** 4–6 h

### R6 — Env var documentation & `.env.example` polish
- **Files:** `lib/env.ts` (Zod schema, ~21 vars — source of truth), `.env.example`.
- **Why:** `.env.example` is solid (required vs optional clearly split, storage/SMTP explained) but a couple of values are Kanbanica-specific (`S3_BUCKET=kanbanica`, DB name `krova`) and there's no single reference table mapping each var to required/optional × dev/prod.
- **Classification (from `lib/env.ts`):**
  - **Required (all envs):** `DATABASE_URL`, `APP_SECRET`, `NEXT_PUBLIC_APP_URL`.
  - **Optional / feature-gated:** `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM` (unset → worker logs emails to stdout; local dev works with **no** SMTP), `GOOGLE_CLIENT_ID/SECRET` (OAuth optional), `EMAIL_WEBHOOK_SECRET`, `STORAGE_DRIVER` (default `local`), `S3_*` (only when driver=s3/r2), `VAPID_*` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (Web Push).
  - **Should get neutral defaults:** `S3_BUCKET` example → generic. (Leave the local dev DB name `krova` as-is — see R1; it is not user-facing and renaming breaks existing dev envs.)
- **Solution:** Add an env reference table to `docs/DEPLOYMENT.md`; neutralize product-specific example values; note how to generate `APP_SECRET` and VAPID keys.
- **Priority:** Medium · **Effort:** 1–2 h

### R7 — Reconcile duplicate admin surfaces & `create:admin`/`make:admin` flow
- **Files:** `app/admin/` vs `app/(orbit)/orbit/`, `scripts/create-admin.ts`, `scripts/make-admin.ts`, `lib/admin-auth.ts`.
- **Why:** Two admin route trees exist; unclear which is canonical. Admin access is correctly gated (`session.user.role === "admin"`, no hardcoded backdoors), but two surfaces confuse contributors and double the security surface.
- **Impact:** Maintenance/security ambiguity; onboarding confusion.
- **Solution:** **Verify whether both `/admin` and `/orbit` are actually required before deleting either.** If one is legacy, remove it (with a redirect); if both serve distinct purposes, keep them and clearly **document the intended admin surface(s)**. Either way, document the `make:admin` promotion flow in the README.
- **Priority:** Medium · **Effort:** 2–3 h

### R8 — Verify asset licensing & trim large binaries
- **Files:** `public/before2.png` (1.4 MB), `after2.png` (1.3 MB), `log-illus.png` (1.6 MB), `width_497.png` (295 KB), `Kanbanica2/3.png`, icons; recently-added PDFs/WEBP (commit `6cb3b86`).
- **Why:** ~5 MB of marketing PNGs in `public/` bloat clones. Confirm all illustrations/screenshots are original or permissively licensed (no paid stock, no licensed fonts — fonts are via `next/font`/Google Fonts, good).
- **Solution:** Confirm provenance; compress or move marketing images to a `docs/assets/` or external CDN; keep only what the app serves.
- **Priority:** Medium · **Effort:** 1–2 h

---

## Nice to have (polish & automation)

- **N1 — Demo seed script** (`pnpm seed:demo`): **Future recommendation only — do NOT implement as part of the initial OSS release.** A script creating a demo workspace + users + a populated project would dramatically improve first-run experience; there is currently **no** seed data (only `create-admin`/`make-admin`/`seed-support-sequence`). Revisit post-launch. **Effort:** 4–6 h.
- **N2 — CHANGELOG.md + semantic versioning + release workflow.** Currently none. Add `CHANGELOG.md`, adopt **semver** with git tags (`v1.0.0`, `v1.1.0`, …), and a GitHub release workflow (draft release notes from merged PRs on tag push). **Effort:** 2–3 h.
- **N3 — Keep & generalize `CLAUDE.md` (do not delete).** It's a genuinely useful architecture map for contributors; strip company-specific details and add a note that it's an AI-agent/contributor context file. **Effort:** 30 min.
- **N4 — GitHub Discussions + community labels.** Enable **GitHub Discussions** for Q&A/ideas, and set up recommended labels: `good first issue`, `help wanted`, `bug`, `enhancement`, `documentation`. Lowers the barrier for first-time contributors. **Effort:** 30 min.
- **N5 — ROADMAP.md.** Add a public roadmap so contributors know what's planned next (can seed it from `docs/development-plan.md` / `docs/revision-plan.md`, generalized for a public audience). **Effort:** 1–2 h.
- **N6 — GitHub Topics + social preview.** Before publishing, add repo Topics: `kanban`, `project-management`, `nextjs`, `typescript`, `react`, `drizzle`, `postgres`, `open-source`, `self-hosted` (and similar). Add a social-preview image. Adoption polish. **Effort:** 30 min.
- **N7 — Hosted demo instance (future work, non-blocking).** A public read-only/reset-on-schedule demo would boost adoption. Recommended later — **do not block the OSS release on it.** **Effort:** TBD.
- **N8 — Clean the ~30 console statements & the single TODO** (`app/actions/list.ts:194`, R2 batch-delete). Most logs are context-tagged and intentional (worker/auth/email-dev); low priority. Note `lib/auth.ts:66` logs the magic-link URL + email in dev — fine for local, but confirm it's dev-guarded. **Effort:** 1–2 h.
- **N9 — Trim internal spec docs for a public audience.** `docs/` has 32 files (development-plan.md, revision-plan.md, documentation-audit.md are internal roadmaps). Keep contributor-relevant ones, move internal planning docs to an `internal/` subfolder or drop. **Effort:** 2 h.
- **N10 — Consider `NEXT_PUBLIC_APP_URL`-derived defaults** so a fresh clone runs with zero required config edits beyond `DATABASE_URL`/`APP_SECRET`.

> **Asset-licensing note (cross-ref R8):** before an MIT release, **verify that every bundled image, icon, font, and other asset is original or appropriately licensed for MIT redistribution** — no paid stock, no restrictively-licensed fonts (current fonts load via `next/font`/Google Fonts, which is fine).

---

## Final Output

### 1. Open-Source Readiness Score: **62 / 100**

**Justification.** The **engineering** is genuinely strong (would score ~85 alone): centralized branding, Zod-validated env, no telemetry/analytics, no billing, no private/paid dependencies (`files-sdk` is public MIT), consistent auth on ~47 API routes, validated uploads, ORM-parameterized queries (no injection), graceful degradation of every optional service, and thorough internal docs. What drags the score down is everything a **public repository** needs and lacks: no LICENSE (legal blocker), a README describing the wrong product, no CONTRIBUTING/SECURITY/CODE_OF_CONDUCT, no `.github/` (CI, templates, dependabot), no app Dockerfile/compose, no deployment/architecture docs, residual scaffold cruft, and no rate limiting. These are high-effort-to-discover but mostly low-to-medium-effort to fix — hence a middling score with a clear, fast path upward.

### 2. Prioritized Phased Checklist

**Phase 1 — Publishing blockers (must complete before the repo goes public; ~1 day)**
- [ ] C1 Add MIT `LICENSE` + `package.json` license field + README badge
- [ ] C2 Rotate Google OAuth / SMTP / `APP_SECRET`; confirm `.env` not in published tree
- [ ] C3 Rewrite `README.md` for Kanbanica; rename package `krova-scaffold` → `kanbanica`
- [ ] C4 Add CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, `.github/` issue+PR templates
- [ ] C5 Remove residual `"Kanbanica"` literals; make support email/domain env-overridable
- [ ] C6 Keep Terms & Privacy pages but mark them clearly as **templates**
- [ ] R1 Remove scaffold cruft (`cloud.md`, `krova-main/`, `AGENTS.md`, KROVA naming) — **keep `CLAUDE.md`**, **don't rename the `krova` dev DB**

**Phase 2 — Self-host & contributor experience (first week; ~2–3 days)**
- [ ] R2 App `Dockerfile` + `docker-compose.yml` (postgres + app + worker, health checks)
- [ ] R3 ARCHITECTURE / DEVELOPMENT / DEPLOYMENT docs
- [ ] R4 GitHub Actions CI (lint + typecheck + build) + Dependabot
- [ ] R5 API rate limiting (magic-link + upload endpoints first)
- [ ] R6 Env reference table; neutralize product-specific example values
- [ ] R7 **Verify** whether `/admin` and `/orbit` are both required; remove legacy or document the intended surface; document `make:admin`
- [ ] R8 Verify asset licensing (MIT-safe) & compress `public/` assets

**Phase 3 — Polish & growth (post-launch)**
- [ ] N2 CHANGELOG + semver tags (`v1.0.0`…) + release workflow
- [ ] N3 Keep & generalize `CLAUDE.md`
- [ ] N4 Enable GitHub Discussions + labels (`good first issue`, `help wanted`, `bug`, `enhancement`, `documentation`)
- [ ] N5 Add `ROADMAP.md`
- [ ] N6 Add GitHub Topics + social preview image
- [ ] N8–N10 Console/TODO cleanup, internal-doc pruning, zero-config defaults
- [ ] N1 (future) `pnpm seed:demo` demo workspace · N7 (future) hosted demo instance

### 3. Potential Breaking Changes to Watch

- **Renaming `package.json` `name`** (`krova-scaffold` → `kanbanica`): harmless unless anything references the package name; verify.
- **Dev DB / user `krova`** (`scripts/dev-db.ts`, `DATABASE_URL` default port 54329, `.krova-postgres` data dir): **decision — do NOT rename in this release.** It is not user-facing, and renaming breaks every existing local dev env for no benefit. Defer to a future major release.
- **Making support email/domain env-driven** (C5): if defaults aren't set, emails/footers could render blank — ship sane defaults in `lib/env.ts`.
- **Terms & Privacy routes** (C6): kept as template pages — no route change, so no 404 risk; only the content/banner changes.
- **Removing one admin surface** (R7): only if verification confirms one is legacy — ensure no links/bookmarks/tests point at the removed path; add redirects.
- **Docker prod model:** the app **requires a separate worker process** — a compose/Docker setup that forgets the worker will silently drop emails, digests, reminders, and sprint auto-close. Make the worker a first-class service.
- **Rotating `APP_SECRET`** invalidates all existing sessions — expected, but note it.

### 4. Risk Assessment for Publishing As-Is: **HIGH**

Publishing today is **high risk — but almost entirely for legal/reputational, not security, reasons.** The dominant risk is **C1 (no license)**: publishing without one creates legal ambiguity and, combined with the "KROVA Scaffold" README, makes the repo look abandoned/mislabeled — squandering the launch. Security posture is comparatively **low-to-medium risk**: no secrets are committed, auth/permission checks are consistent, and uploads are validated; the real gaps are the missing rate limiting (R5) and placeholder legal pages (C6). **After Phase 1, publishing risk drops to Low–Medium; after Phase 2 it is Low.** Recommendation: do **not** publish until Phase 1 is complete; schedule Phase 2 within the first week to make self-hosting and contribution viable.

---

## Verification (for when implementation begins)

Since this phase is audit-only, verification applies to the *fixes*:
- **Legal/community:** GitHub's "Insights → Community Standards" checklist should show all green after Phase 1.
- **Branding:** `grep -rn "Kanbanica" app components lib | grep -v config/platform` should return only intentional references; a rebrand test (change `PRODUCT_NAME` + logo) should update the whole UI.
- **Self-host:** `docker compose up` from a clean clone should bring up postgres + app + worker; sign in via magic link (check worker stdout for the link when SMTP is unset), create a workspace, upload an avatar.
- **CI:** open a throwaway PR and confirm lint/typecheck/build gates run and pass.
- **Onboarding time-box:** a fresh contributor following the new README should reach a running app in <10 minutes on a machine with Node + pnpm.
- **No secrets:** `git ls-files | grep -E '\.env$'` returns nothing; `git log --all -- .env` is empty (already verified).
