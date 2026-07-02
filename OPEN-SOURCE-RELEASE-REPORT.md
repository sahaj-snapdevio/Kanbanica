# Open Source Release Report — Kanbanica

**Status: Release Candidate.** Phases 1–3 of the open-source conversion plus the
self-hosting phase are complete and verified. What remains before `v1.0.0` is
GitHub-settings configuration and a full Docker end-to-end run — no code work.

- **Version:** 1.0.0 (release candidate)
- **Last updated:** 2026-07-02

> Companion docs: [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) (actionable
> steps), [OPEN-SOURCE-PROGRESS.md](./OPEN-SOURCE-PROGRESS.md) and
> [OPEN-SOURCE-READINESS-AUDIT.md](./OPEN-SOURCE-READINESS-AUDIT.md) (detail).

## Scope

This report is the final readiness assessment for publishing Kanbanica as an
open-source project. It summarizes the work completed across the conversion
phases, compares the repository against GitHub Community Standards, and
enumerates the remaining manual configuration and verification required before
tagging the first public release. It is a documentation deliverable only — it
does not change application code, and it does not alter the project roadmap.

## Executive summary

Kanbanica began as a commercial SaaS. Over four work phases it was made
publishable and self-hostable: legal/branding cleanup, community-health files,
CI, Docker-based self-hosting, and a hardening pass. Every file-based **GitHub
Community Standard is satisfied**, `pnpm typecheck` and `pnpm build` are green,
and the self-hosting path is verified at the application level. The remaining
items are GitHub settings (Discussions, Topics, labels, branch protection,
private reporting, description/social image) and the final containerized
end-to-end verification.

## Completed work

### Phase 1 — Legal & identity
- MIT `LICENSE`, `package.json` `"license": "MIT"`, renamed package → `kanbanica`.
- README rewritten for Kanbanica (overview, features, quick start, badges, license).
- Branding centralized: residual literals routed through `config/platform.ts`; support email/domain made env-overridable (`NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_MARKETING_DOMAIN`); user-facing export filename de-branded.
- Removed scaffold cruft (`cloud.md`, `AGENTS.md`, `krova-main/`); `CLAUDE.md` kept & generalized.
- Terms/Privacy pages marked as customizable templates.

### Phase 2 — Community & automation
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- `.github/`: issue templates (bug/feature/config), PR template.
- CI (`.github/workflows/ci.yml`): install → **typecheck (blocking)** → **build (blocking)** → **lint (advisory)**; `dependabot.yml` (npm + actions).
- `ARCHITECTURE.md`; env reference table added to `DEPLOYMENT.md`.

### Phase 3 — Hardening & polish
- **Rate limiting** (`lib/rate-limit.ts`): Better Auth magic-link/sign-in throttling; per-user limits on avatar, channel- and task-attachment uploads; invite create/resend/accept limits.
- **Admin surfaces audited** (`/admin` vs `/orbit`): documented canonical vs. entangled legacy in `docs/admin-panel.md`; not removed (unsafe — shared sidebar, unique pages, password login).
- **Assets** (`public/` 5.4 MB → 0.8 MB): oversized PNGs → WebP q90 (visually verified), orphans removed, `public/ATTRIBUTIONS.md` licensing record added.
- **Log hygiene**: magic-link and invite-URL logs gated to dev (no token/PII in prod logs); operational logs kept.
- **Internal docs** moved to `docs/internal/`.
- **Zero-config dev defaults** (dev-only; production unchanged/fail-fast).
- `CHANGELOG.md` (+ semver policy) and public `ROADMAP.md`.

### Self-hosting phase
- App `Dockerfile` (standalone) + `docker-compose.yml` (postgres + one-shot migrate + app + worker) + `Dockerfile.worker`.
- `/api/health` endpoint; container-safe migration runner (`scripts/migrate.ts`, `db:migrate:prod`).
- Production auth guard (SMTP **or** Google required in prod); S3/R2 storage switch.
- `SETUP.md` (local) and `DEPLOYMENT.md` (self-host) guides.

## GitHub Community Standards

| Standard | Status |
|----------|:---:|
| Description | ⚙️ set on GitHub |
| README | ✅ |
| Code of conduct | ✅ |
| Contributing | ✅ |
| License (MIT) | ✅ |
| Security policy | ✅ |
| Issue templates | ✅ |
| Pull request template | ✅ |

All file-based standards met. Optional extras not added: `.github/FUNDING.yml`, `.github/CODEOWNERS`.

## Remaining manual GitHub configuration

- Repo **Description** and **Topics**.
- Enable **Discussions**; create labels (`good first issue`, `help wanted`, `bug`, `enhancement`, `documentation`).
- Enable **Private Vulnerability Reporting**; set real security/conduct contacts.
- **Branch protection** on `main` requiring the CI check.
- **Social preview** image.
- Replace `OWNER/REPO` placeholders in `.github/ISSUE_TEMPLATE/config.yml`.

## Final Docker verification tasks (deferred to RC)

Full `docker compose up -d --build` from a clean clone: migrations run once and
are idempotent on a second `up`; app healthy via `/api/health`; login via a
configured provider; `make:admin`; **upload persistence across container
restart**; reverse-proxy HTTPS with un-buffered SSE. (See
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) §4.)

## Release sequence

1. Complete checklist §1–§5 (code, secrets, placeholders, Docker verify, docs).
2. Complete §6 GitHub settings.
3. Publish; confirm CI green + Community Standards all-green (§7).
4. Changelog `Unreleased` → `1.0.0`; tag `v1.0.0`; create GitHub Release (§8).

## Supported deployment

The supported production topology for v1.0.0 is a **single-server, self-hosted**
deployment via Docker Compose:

- **One** app instance (Next.js) and **exactly one** worker process.
- A **PostgreSQL** database (the bundled compose service, or a managed instance).
- File storage on a **local volume** (default) or **S3 / R2** object storage.
- An **SMTP provider or Google OAuth** configured for login, fronted by a
  reverse proxy terminating **HTTPS** (with the SSE endpoint un-buffered).

Multi-instance / horizontally-scaled deployments are **not** supported in v1.0.0
(see Current limitations). Setup is documented in
[SETUP.md](./SETUP.md) (local) and [DEPLOYMENT.md](./DEPLOYMENT.md) (self-host).

## Current limitations

- **Single-instance realtime**: SSE + notification registry is in-memory; multiple app instances behind a load balancer need Redis pub/sub (roadmapped). Run **one** app instance and **one** worker.
- **In-memory rate limiting**: per-process; a multi-instance deployment should back it with a shared store.
- **Lint backlog**: `pnpm lint` has a large pre-existing backlog, so CI lint is advisory (typecheck + build are the gates). Flip to required after cleanup.
- **Two admin surfaces**: `/orbit` (canonical entry) and `/admin` (most pages, password login) are entangled; consolidation is future work — neither can be safely removed yet.
- **Dead code**: `components/workspace/landing-page.tsx` is an unused duplicate (candidate for removal).
- **Legal pages**: Terms/Privacy ship as templates; self-hosters must supply their own.
- **Asset licensing**: confirm `log-illus.webp` provenance before publishing (`public/ATTRIBUTIONS.md`).
- **Docker end-to-end** not yet run in this environment (no Docker) — the RC step above closes this.

## Not included in v1.0.0

The following are intentionally out of scope for the first release and tracked in
[ROADMAP.md](./ROADMAP.md):

- Multi-instance / high-availability support (Redis-backed realtime and rate limiting).
- A hosted demo instance.
- Demo seed data (`pnpm seed:demo`).
- Consolidation of the `/admin` and `/orbit` admin surfaces.
- Clearing the lint backlog to make CI lint a required check.
- An automated test suite.

## Risk assessment

After Phases 1–3, publishing risk is **Low**. No secrets are committed; auth,
permissions, and uploads are validated and now rate-limited; every community and
legal file is present. The residual risk is operational (single-instance
limits) and procedural (complete the manual GitHub setup and the Docker
end-to-end before tagging `v1.0.0`).

## Release success criteria

The first public release is considered successful when all of the following hold:

- `pnpm typecheck` and `pnpm build` pass, and CI is green on `main`.
- No secrets are present in the repository; placeholder contacts and `OWNER/REPO`
  values are replaced.
- The full Docker end-to-end verification in
  [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) §4 passes on a clean clone.
- GitHub **Community Standards** shows all items complete.
- Required GitHub configuration (Discussions, Topics, labels, branch protection,
  private vulnerability reporting) is in place.
- `v1.0.0` is tagged and a GitHub Release is published from the changelog.

## Recommendation

Once the remaining GitHub configuration and the Release Candidate verification
are complete, **Kanbanica is ready for its first public open-source release.**
