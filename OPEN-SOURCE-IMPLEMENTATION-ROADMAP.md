# Kanbanica — Open-Source Implementation Roadmap

> Companion to `OPEN-SOURCE-READINESS-AUDIT.md`. This document turns the audit findings into a **prioritized, dependency-aware execution plan**. No code has been changed. Item IDs (C1–C6, R1–R8, N1–N10) map 1:1 to the audit.

**Complexity key:** **S** = Small (≤1 h, mechanical) · **M** = Medium (few hours, some judgment) · **L** = Large (a day+, cross-cutting).
**⚠ = can break the app or affect existing users** — see "Breaking / Risk" column.

---

## 1. Category A — Must do before public release

These are legal/reputational blockers. Publishing without them is high-risk.

| ID | Task | Complexity | Depends on | Breaking / Risk |
|----|------|:---:|---|---|
| C1 | Add MIT `LICENSE` + `package.json` `"license"` field + README badge | **S** | — | None |
| C2 | Rotate Google OAuth secret / SMTP creds / `APP_SECRET`; confirm `.env` absent from published tree | **S** | — | ⚠ Rotating `APP_SECRET` invalidates existing sessions (dev-only; expected) |
| R1 | Prune scaffold cruft: delete `cloud.md`, `krova-main/`, `AGENTS.md`. **Keep `CLAUDE.md`. Do NOT rename the `krova` dev DB.** | **S** | — | Low — internal-only files |
| C6 | Keep Terms/Privacy pages; add a visible **"template — replace before production"** banner | **S** | — | None (routes unchanged) |
| C5 | Remove residual `"Kanbanica"` literals (route through `config/platform.ts`); make support email/domain env-overridable in `lib/env.ts` | **M** | — | ⚠ Blank footer/email if defaults omitted — ship the current values as defaults |
| C4 | Add `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md` | **M** | — | None |
| C3 | Rewrite `README.md` for Kanbanica (pitch, "Why Kanbanica?", screenshots, feature table, badges, install flow); rename package → `kanbanica` | **M** | C5 (branding clean), R1 (cruft gone); soft-links to R2/R3 docs | ⚠ Package rename — verify nothing references `krova-scaffold` |

**Category A total: ~1–1.5 days.**

---

## 2. Category B — Recommended before v1.0

Not blockers for the first public commit, but needed before calling it **v1.0** / a real self-hostable product.

| ID | Task | Complexity | Depends on | Breaking / Risk |
|----|------|:---:|---|---|
| R8 | Verify all `public/` assets are MIT-safe (original/licensed); compress/relocate large PNGs | **S–M** | — | None |
| R6 | Env reference table in deployment docs; neutralize product-specific example values in `.env.example` (leave `krova` DB name) | **S** | ties to C5, R3 | None |
| R4 | GitHub Actions CI (`install → lint → typecheck → build`) + Dependabot | **M** | C4 (`.github/` exists) | None (gates PRs) |
| R7 | **Verify** `/admin` vs `/orbit` — remove legacy (with redirect) or document intended surface; document `make:admin` | **M** | Verification step first | ⚠ Removing a live admin route breaks bookmarks/links — add redirect |
| R5 | API rate limiting (magic-link + upload endpoints first) | **M** | — | ⚠ Misconfigured limits can block legit traffic — start permissive, document Redis-in-prod |
| R3 | ARCHITECTURE / DEVELOPMENT / DEPLOYMENT docs | **M** | R2 (deployment doc references compose) | None |
| R2 | App `Dockerfile` + `docker-compose.yml` (postgres + app + **worker** + health checks) | **L** | Verify `GET /api/health` | ⚠ Compose that omits the **worker** silently drops emails/digests/reminders/sprint-auto-close — worker must be first-class |

**Category B total: ~2.5–3 days.**

---

## 3. Category C — Nice to have after release

Growth, polish, and automation. None block publishing or v1.0.

| ID | Task | Complexity | Depends on | Breaking / Risk |
|----|------|:---:|---|---|
| N4 | Enable GitHub Discussions + labels (`good first issue`, `help wanted`, `bug`, `enhancement`, `documentation`) | **S** | repo public | None |
| N6 | Add GitHub Topics (`kanban`, `project-management`, `nextjs`, `typescript`, `react`, `drizzle`, `postgres`, `open-source`, `self-hosted`) + social preview image | **S** | repo public | None |
| N3 | Keep & generalize `CLAUDE.md` (strip company specifics; note it's an AI-agent/contributor context file) | **S** | — | None |
| N5 | Add `ROADMAP.md` (seed from `docs/development-plan.md`, generalized) | **S** | — | None |
| N2 | `CHANGELOG.md` + semver tags (`v1.0.0`…) + GitHub release workflow | **S–M** | C4 (`.github/`) | None |
| N8 | Clean ~30 console statements + single TODO (`app/actions/list.ts:194`); confirm `lib/auth.ts:66` magic-link log is dev-guarded | **S** | — | None |
| N9 | Trim/relocate internal spec docs in `docs/` (move roadmaps to `internal/`) | **S–M** | — | Low |
| N10 | Zero-config defaults (derive from `NEXT_PUBLIC_APP_URL`) so a clone runs with only `DATABASE_URL`/`APP_SECRET` set | **M** | C5, R6 | ⚠ Changing default resolution could shift behavior for configured deployments — gate carefully |
| N1 | Demo seed script (`pnpm seed:demo`) — **future only** | **M** | — | None |
| N7 | Hosted demo instance — **future, non-blocking** | **L** | R2 (Docker) | None |

**Category C total: ongoing, ~2–3 days of effort spread post-launch.**

---

## 4. Dependency Map (what must precede what)

```
C5 (branding cleanup) ─┐
R1 (remove cruft) ─────┼──▶ C3 (README rewrite) ──▶ (links into) R3 docs
                       │
C4 (.github/ files) ───┼──▶ R4 (CI + Dependabot)
                       └──▶ N2 (release workflow)

Verify /api/health ────▶ R2 (Docker/compose) ──▶ R3 (DEPLOYMENT doc) ──▶ N7 (hosted demo)

C5 + R6 ──▶ N10 (zero-config defaults)

R7 verification ──▶ R7 removal/redirect (do not delete before verifying)
```

**Independent (no blockers, can start anytime):** C1, C2, C6, R5, R8, N3, N4, N5, N6, N8, N9.

---

## 5. Tasks that can break the app or affect existing users (watch-list)

| ID | Risk | Mitigation |
|----|------|-----------|
| C2 | Rotating `APP_SECRET` invalidates all sessions | Expected; only affects local/existing dev — communicate in changelog |
| C3 | Renaming `package.json` name | Grep for `krova-scaffold` references before renaming |
| C5 | Env-driven support email/domain could render blank | Ship current values (`support@kanbanica.com`, `kanbanica.com`) as defaults in `lib/env.ts` |
| R2 | Docker setup omitting the worker silently disables emails/digests/reminders/sprint-auto-close | Make `worker` a first-class compose service; document the two-process model |
| R5 | Over-aggressive rate limits block legitimate users | Start permissive, make limits env-configurable, test before enforcing |
| R7 | Removing a live admin surface breaks bookmarks/tests | Verify it's truly legacy first; add redirect, not a hard delete |
| N10 | Changing default config resolution shifts behavior for existing deployments | Only apply when values are unset; preserve explicit-config precedence |
| — | **Do NOT rename the `krova` dev DB / user** (`scripts/dev-db.ts`, `.krova-postgres`) | Left intentionally unchanged; defer to a future major release |

---

## 6. Phased Implementation Plan

### Phase 1 — Make it legally & identity-clean (before first public push · ~1–1.5 days)
- Add **LICENSE** (MIT) + package license field + badge — **C1** *(S)*
- **Rotate secrets**; confirm `.env` not published — **C2** *(S)*
- **Remove internal/scaffold files** (`cloud.md`, `krova-main/`, `AGENTS.md`); keep `CLAUDE.md`; keep `krova` dev DB — **R1** *(S)*
- Mark **Terms/Privacy as templates** — **C6** *(S)*
- **Branding cleanup** (residual literals → config; support email/domain env-overridable) — **C5** *(M)*
- **README rewrite** + package rename — **C3** *(M)*

### Phase 2 — Community & contribution scaffolding (~0.5–1 day)
- **CONTRIBUTING / SECURITY / CODE_OF_CONDUCT** — **C4** *(M)*
- **Issue templates + PR template** (`.github/`) — **C4** *(M)*
- **CI workflow** (lint + typecheck + build) + **Dependabot** — **R4** *(M)*

### Phase 3 — Self-host & docs (before calling it v1.0 · ~2–3 days)
- Verify `GET /api/health`, then **app Dockerfile + docker-compose** (postgres + app + worker) — **R2** *(L, ⚠ worker)*
- **ARCHITECTURE / DEVELOPMENT / DEPLOYMENT docs** — **R3** *(M)*
- **Env reference table** + `.env.example` polish — **R6** *(S)*
- **API rate limiting** — **R5** *(M, ⚠)*
- **Reconcile `/admin` vs `/orbit`** (verify → remove/redirect/document) — **R7** *(M, ⚠)*
- **Asset licensing verify + compress** — **R8** *(S–M)*

### Phase 4 — Growth & polish (post-launch, ongoing)
- **GitHub Discussions + labels** — **N4** *(S)*
- **GitHub Topics + social preview** — **N6** *(S)*
- **Generalize `CLAUDE.md`** — **N3** *(S)*
- **ROADMAP.md** — **N5** *(S)*
- **CHANGELOG + semver + release workflow** — **N2** *(S–M)*
- **Console/TODO cleanup** — **N8** *(S)*
- **Trim internal docs** — **N9** *(S–M)*
- **Zero-config defaults** — **N10** *(M, ⚠)*
- **Demo seed script** — **N1** *(M, future)*
- **Hosted demo instance** — **N7** *(L, future)*

---

## 7. Effort Summary

| Category | Items | Rough effort | Gate |
|----------|-------|--------------|------|
| A — Must do before public release | C1, C2, C3, C4, C5, C6, R1 | ~1.5–2.5 days | **Blocks publishing** |
| B — Recommended before v1.0 | R2, R3, R4, R5, R6, R7, R8 | ~2.5–3 days | **Blocks v1.0 label** |
| C — Nice to have after release | N1–N10 | ~2–3 days, spread out | Non-blocking |

**Recommended sequence:** Phase 1 → publish (repo is now legal + coherent) → Phase 2 (open to contributors) → Phase 3 (tag v1.0) → Phase 4 (grow). Phases 1–2 are the minimum for a credible public launch; Phase 3 is the minimum for a trustworthy v1.0.
