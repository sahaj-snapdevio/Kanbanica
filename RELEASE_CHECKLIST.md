# Release Checklist

Everything required to publish Kanbanica as an open-source project and cut the
first release. Work top-to-bottom. Boxes marked **⚙️ manual** are GitHub
settings (not files in the repo).

---

## 1. Pre-flight — code & build

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] `pnpm lint` reviewed (advisory — a known backlog exists; not a blocker)

## 2. Secrets & privacy

- [ ] `.env` is **not** committed: `git ls-files | grep -E '\.env'` returns only `.env.example`
- [ ] `git log --all -- .env` is empty (never committed historically)
- [ ] Rotate any real dev credentials that were used locally (Google OAuth secret, SMTP user/pass, `APP_SECRET`)
- [ ] Perform a proper secrets review before making the repository public — use a dedicated secrets-scanning tool (e.g. GitHub Secret Scanning once published, `gitleaks`, or `trufflehog`) across the working tree **and git history**, not just keyword grep, and remediate any findings

## 3. Fill in placeholders

- [ ] Replace `OWNER/REPO` in `.github/ISSUE_TEMPLATE/config.yml` (Discussions + security-advisory URLs)
- [ ] Set a real security contact in `SECURITY.md` (or rely on GitHub Private Vulnerability Reporting)
- [ ] Set a real enforcement contact in `CODE_OF_CONDUCT.md`
- [ ] Resolve the ⚠️ item in `public/ATTRIBUTIONS.md` — confirm `log-illus.webp` is redistribution-safe, or replace it

## 4. Docker / self-host verification (deferred RC checks)

Run on a machine with Docker, from a clean clone:

- [ ] Verify from a **completely fresh environment** (new machine, VM, or container) with no cached dependencies, images, or previous setup — this confirms the docs and deployment process work for a genuine first-time user
- [ ] `cp .env.example .env` and set `DATABASE_URL` (host `postgres`), `APP_SECRET`, `NEXT_PUBLIC_APP_URL`, `POSTGRES_*`, and an auth provider (SMTP or Google)
- [ ] `docker compose up -d --build` brings up postgres + migrate + app + worker
- [ ] `migrate` service runs migrations once and exits `0`
- [ ] `curl -f http://localhost:3000/api/health` → `{"ok":true,"db":"connected"}`
- [ ] App container reports healthy (`docker compose ps`)
- [ ] Login works via the configured provider (magic link email or Google)
- [ ] `docker compose exec worker pnpm make:admin you@example.com` promotes a user
- [ ] File upload persists across `docker compose down && docker compose up -d`
- [ ] A second `docker compose up -d --build` does **not** re-run completed migrations and does not break the deployment
- [ ] Behind a reverse proxy: HTTPS works and `/api/me/notifications/stream` is **not** buffered (real-time updates arrive)

## 5. Documentation sanity

- [ ] README renders correctly (badges, license section, all internal links resolve)
- [ ] **Release requirement:** verify the documented local contributor workflow from a **fresh clone** — `pnpm install` → `pnpm db:local` → `pnpm db:migrate` → `pnpm dev` — works end-to-end (most contributors use this rather than Docker)
- [ ] `SETUP.md` local flow works end-to-end (`db:local` → `db:migrate` → `dev`)
- [ ] `DEPLOYMENT.md` matches the compose file and env reference
- [ ] `CHANGELOG.md` "Unreleased" section reflects what's shipping
- [ ] `ROADMAP.md` is current

## 6. GitHub repository setup (⚙️ manual settings)

- [ ] ⚙️ Set the repo **Description**
- [ ] ⚙️ Add **Topics**: `kanban`, `project-management`, `nextjs`, `typescript`, `react`, `drizzle`, `postgres`, `open-source`, `self-hosted`
- [ ] ⚙️ Enable **Discussions**
- [ ] ⚙️ Create **labels**: `good first issue`, `help wanted`, `bug`, `enhancement`, `documentation`
- [ ] ⚙️ Enable **Private Vulnerability Reporting** (Settings → Security)
- [ ] ⚙️ Add a **social preview image** (Settings → General)
- [ ] ⚙️ Enable **branch protection** on `main` requiring the CI check (typecheck + build) to pass
- [ ] ⚙️ Confirm default branch is `main`
- [ ] ⚙️ Verify repository **metadata** accurately represents Kanbanica: repository **name**, **description**, **homepage URL** (if configured), and **social preview image**

## 7. First publish

- [ ] Push the repository (make public)
- [ ] CI runs and is green on `main`
- [ ] GitHub **Insights → Community Standards** shows all items complete
- [ ] GitHub correctly **detects the MIT license** and displays it on the repository homepage
- [ ] Dependabot is active (Settings → Security)

## 8. Cut the release

- [ ] Move `CHANGELOG.md` items from **Unreleased** into a dated `## [1.0.0]` section
- [ ] Tag `v1.0.0` (`git tag v1.0.0 && git push --tags`)
- [ ] Create the **GitHub Release** for `v1.0.0` using the changelog notes

## 9. Post-release

- [ ] Monitor first issues / PRs and Discussions
- [ ] Schedule the lint-backlog cleanup, then remove `continue-on-error` from the CI lint step to make it a required check
- [ ] Track multi-instance (Redis) support if scaling demand appears (see `ROADMAP.md`)

---

_See [OPEN-SOURCE-RELEASE-REPORT.md](./OPEN-SOURCE-RELEASE-REPORT.md) for the full status report and known limitations._
