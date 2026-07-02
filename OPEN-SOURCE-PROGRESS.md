# Kanbanica — Open-Source Progress & Remaining Work

> Read-only status report. Compares the **Open-Source Readiness Audit** and the **Implementation Roadmap** against what's actually in the repo today (verified by inspection), then gives a **revised roadmap of only the remaining work**. Nothing here implements or changes code.
>
> Legend: ✅ Completed · 🟡 Partially completed · ❌ Not started
>
> Item IDs (C1–C6, R1–R8, N1–N10) map to `OPEN-SOURCE-IMPLEMENTATION-ROADMAP.md`.

---

## What was completed since the roadmap (the self-hosting / production phase)

The most recent work delivered a working single-server self-hosting story and several production-readiness fixes. Verified present in the repo:

| Delivered | Files | Satisfies |
|-----------|-------|-----------|
| App Docker image + full stack orchestration | `Dockerfile`, `docker-compose.yml` (postgres + migrate + app + worker), existing `.dockerignore`/`Dockerfile.worker` | **R2 ✅** |
| Lean container build | `next.config.mjs` (`output: "standalone"`) | R2 enabler ✅ |
| Container-safe migrations | `scripts/migrate.ts`, `package.json` `db:migrate:prod` | R2/deploy ✅ |
| Health endpoint (was documented-but-missing) | `app/api/health/route.ts` | Prod-readiness ✅ |
| Login-safety guard (prod requires SMTP **or** Google) | `lib/env.ts` | Prod-readiness ✅ |
| Object-storage switch enabled | `lib/storage.ts`, `lib/env.ts` (`STORAGE_DRIVER`), `@aws-sdk/s3-presigned-post` dep | Audit "Upload system" ✅ |
| Local-dev onboarding guide (<10 min) | `SETUP.md` | R3 (DEVELOPMENT) ✅ |
| Self-hosting guide | `DEPLOYMENT.md` | R3 (DEPLOYMENT) ✅ |
| Planning deliverables | `OPEN-SOURCE-READINESS-AUDIT.md`, `OPEN-SOURCE-IMPLEMENTATION-ROADMAP.md` | Audit ✅ |
| `.env.example` production polish | `.env.example` | R6 (partial) 🟡 |

> Docker deployment was **verified at the application level** (migrations apply + idempotent, standalone build boots, `/api/health` 200/503, auth guard, `make:admin`). Full container-orchestration + upload-volume-persistence verification is **intentionally deferred to the Release Candidate phase**.

---

## Full task status

### Category A — Must do before public release
| ID | Task | Status | Notes |
|----|------|:---:|-------|
| C1 | MIT `LICENSE` + `package.json` license field | ❌ | No `LICENSE`, no `license` field. **Legal blocker.** |
| C2 | Rotate secrets; confirm `.env` not published | ❌ | Owner action; `.env` correctly git-ignored but local copy holds real creds. |
| C3 | Rewrite README + rename package | ❌ | README still "# KROVA Scaffold"; `package.json` name still `krova-scaffold`. |
| C4 | CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / `.github/` templates | ❌ | None present; no `.github/`. |
| C5 | Remove residual branding literals; env-overridable support email/domain | ❌ | `config/platform.ts` still hardcodes `support@kanbanica.com`; residual literals remain. |
| C6 | Keep Terms/Privacy but mark as templates | ❌ | Pages exist; no template banner yet. |
| R1 | Prune scaffold cruft (keep `CLAUDE.md`; keep `krova` DB) | ❌ | `cloud.md`, `AGENTS.md`, `krova-main/` still present. `CLAUDE.md` present (correctly). |

### Category B — Recommended before v1.0
| ID | Task | Status | Notes |
|----|------|:---:|-------|
| R2 | App Dockerfile + docker-compose | ✅ | Done in self-hosting phase (+ health, standalone, migrate). |
| R3 | ARCHITECTURE / DEVELOPMENT / DEPLOYMENT docs | 🟡 | DEPLOYMENT ✅ (`DEPLOYMENT.md`), DEVELOPMENT ✅ (`SETUP.md`). **ARCHITECTURE.md still missing.** |
| R4 | GitHub Actions CI + Dependabot | ❌ | Depends on C4 (`.github/`). Lint/typecheck/build scripts already exist. |
| R5 | API rate limiting | ❌ | Still none (magic-link + upload endpoints). |
| R6 | Env reference table + `.env.example` polish | 🟡 | `.env.example` ✅; DEPLOYMENT has a required-vars block but **no full all-vars reference table**. |
| R7 | Reconcile `/admin` vs `/orbit` | ❌ | Both surfaces still present; not verified/documented. |
| R8 | Verify asset licensing (MIT-safe) + compress `public/` | ❌ | ~5 MB of PNGs unverified. |

### Category C — Nice to have after release
| ID | Task | Status | Notes |
|----|------|:---:|-------|
| N1 | Demo seed script | ❌ | Future-only by prior decision. |
| N2 | CHANGELOG + semver + release workflow | ❌ | Depends on C4. |
| N3 | Keep & generalize `CLAUDE.md` | 🟡 | Kept ✅; not yet generalized/company-stripped. |
| N4 | GitHub Discussions + labels | ❌ | Repo-settings action. |
| N5 | Public `ROADMAP.md` | 🟡 | Internal OSS roadmap exists; no public product `ROADMAP.md`. |
| N6 | GitHub Topics + social preview | ❌ | Repo-settings action. |
| N7 | Hosted demo instance | ❌ | Future, non-blocking. |
| N8 | Console/TODO cleanup | ❌ | ~30 context-tagged logs + 1 TODO. |
| N9 | Trim internal spec docs | ❌ | `docs/` still has internal roadmaps. |
| N10 | Zero-config defaults | ❌ | Depends on C5/R6. |

**Scorecard:** ✅ 3 fully (R2, plus DEPLOYMENT & DEVELOPMENT halves of R3) · 🟡 4 (R3, R6, N3, N5) · ❌ 15.
The completed work removed the hardest *engineering* blockers. What remains is overwhelmingly **docs, legal, community, and configuration** — lower complexity, high importance.

---

## Dependencies (drive execution order)

```
C5 (branding) ─┐
R1 (cruft)  ───┼──▶ C3 (README + rename)          # README should reflect cleaned branding + new name
C4 (.github) ──┬──▶ R4 (CI + Dependabot)
               └──▶ N2 (release workflow)
C5 + R6 ───────────▶ N10 (zero-config defaults)
R7: VERIFY /admin vs /orbit  ──▶  remove/redirect (never delete before verifying)
C1 (LICENSE) ─────▶  publish gate
C2 (rotate)  ─────▶  at/just before publish
```
**Independent, start anytime:** C1, C2, C6, R5, R8, R3-ARCHITECTURE, R6-table, N3, N4, N6, N8, N9.

---

## Revised Roadmap (remaining work only)

### Phase 1 — Legal & Identity  *(critical path — blocks public release)*
- C1 — Add MIT `LICENSE` + `package.json` license field
- C5 — Remove residual branding literals; make support email/domain env-overridable
- R1 — Prune scaffold cruft (`cloud.md`, `AGENTS.md`, `krova-main/`); keep `CLAUDE.md`; keep `krova` dev DB
- C3 — Rewrite README for Kanbanica + rename package `krova-scaffold` → `kanbanica`  *(after C5, R1)*
- C6 — Mark Terms/Privacy pages as templates
- C2 — Rotate secrets; confirm `.env` absent from the published tree  *(owner action, at publish)*

### Phase 2 — Community & Automation
- C4 — `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/` issue + PR templates
- R4 — GitHub Actions CI (lint + typecheck + build) + Dependabot  *(after C4)*
- R3 — Finish docs: add **ARCHITECTURE.md** (DEPLOYMENT + DEVELOPMENT already done)
- R6 — Finish: add a full **env reference table** to the deployment docs

### Phase 3 — Hardening & Pre-v1.0 Polish
- R5 — API rate limiting (magic-link + upload endpoints first)
- R7 — Verify `/admin` vs `/orbit`; remove legacy (with redirect) or document the canonical surface
- R8 — Verify asset licensing (MIT-safe) + compress `public/`
- N8 — Console/TODO cleanup
- N9 — Trim/relocate internal spec docs
- N3 — Generalize `CLAUDE.md`
- N10 — Zero-config defaults  *(after C5, R6)*
- N2 — `CHANGELOG.md` + semver tags + release workflow  *(after C4)*
- N4 — Enable GitHub Discussions + labels
- N5 — Public `ROADMAP.md`
- N6 — GitHub Topics + social preview image

### Final Release Candidate
- Fresh clone verification
- Docker deployment verification  *(deferred from the self-hosting phase — run full `docker compose up` on a Docker host)*
- Upgrade verification (apply new migrations over an existing DB)
- Backup / restore verification (`pg_dump` + `uploads` volume / S3)
- Release checklist (community-standards green, secrets rotated, license present)
- **v1.0.0 release**

### Post-1.0 (future, non-blocking)
- N1 — Demo seed script · N7 — Hosted demo instance · Multi-instance Redis pub/sub for realtime

---

## Bottom line
The engineering-heavy production/self-hosting work is complete and app-level-verified. To reach the **first public open-source release**, the remaining critical path is short and mostly non-code: **Phase 1 (legal + identity)** unblocks publishing, **Phase 2 (community + CI)** makes it contributable, **Phase 3** polishes it to v1.0, and the **Release Candidate** phase does the final fresh-clone + Docker + upgrade + backup verification before tagging v1.0.0.
