# Web App Setup

The Next.js web app serves the customer dashboard, the Orbit admin UI, and all REST API routes. It does NOT do background work — that's the worker.

## Service shape

- **Image**: built from the project root using Dokploy's default Nixpacks/Buildpack (no custom Dockerfile for the web app)
- **Start command**: `pnpm start` (runs `next start` against the production build)
- **Build command**: `pnpm build`
- **Port**: 3000 (Next.js default)

## Required environment variables

All defined in `lib/env.ts` — the app fails fast on boot if any required value is missing or invalid. Set the **same values** on both the web app and the worker.

### Core (required)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres connection string |
| `APP_SECRET` | AES-256-GCM key (Krova encrypts SSH keys, S3 backend credentials, etc. with this). **Same value on app and worker.** Generate with `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | Public URL of the app, e.g. `https://krova.example.com` |
| `NODE_ENV` | Optional. Defaults to `development`; set to `production` on deploy |

### Authentication (required)

| Var | Purpose |
|-----|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

### Email — EmailIt (required)

Krova uses the EmailIt HTTP API for transactional email and the EmailIt audience API for marketing-contact sync. There is **no SMTP**.

| Var | Required | Purpose |
|-----|----------|---------|
| `EMAILIT_API_KEY` | yes | EmailIt API key |
| `EMAILIT_FROM` | yes | Default From address; the domain must be verified in the EmailIt workspace |
| `EMAILIT_WEBHOOK_SECRET` | optional | `whsec_…` signing secret from EmailIt (Webhooks → Webhook secret). When unset, the `/api/webhooks/emailit` route rejects all deliveries with 503 |
| `EMAILIT_AUDIENCE_ID` | optional | `aud_…` audience id for marketing-contact sync. When unset, contact sync is inert (transactional email and webhooks still work) |

### Real-time — Pusher / Soketi (required)

| Var | Required | Purpose |
|-----|----------|---------|
| `PUSHER_APP_ID` | yes | Pusher / Soketi app ID |
| `PUSHER_KEY` | yes | Public key (also exposed to the browser) |
| `PUSHER_SECRET` | yes | Server-side secret |
| `PUSHER_CLUSTER` | one of | Pusher cloud cluster (e.g. `eu`) |
| `PUSHER_HOST` | one of | Soketi self-hosted host (use this OR `PUSHER_CLUSTER`, not both) |
| `PUSHER_PORT` | optional | Soketi port (defaults to 443) |

### Custom domains — Cloudflare for SaaS (optional)

When unset, the custom-domain feature is inert and the `install` server setup phase will fail.

| Var | Purpose |
|-----|---------|
| `CLOUDFLARE_API_TOKEN` | API token with `Zone.DNS:Edit` + `Account.Custom Hostnames:Edit` |
| `CLOUDFLARE_ZONE_ID` | Zone id for `krova.cloud` (or your platform base domain) |
| `CLOUDFLARE_ACCOUNT_ID` | Account id for Cloudflare for SaaS |
| `CLOUDFLARE_ORIGIN_CERT` | PEM-encoded wildcard Origin CA certificate installed on each Caddy host |
| `CLOUDFLARE_ORIGIN_KEY` | Private key matching `CLOUDFLARE_ORIGIN_CERT` |

### Billing — Polar (optional)

When unset, subscription/top-up checkout is inert, the `/api/webhooks/polar` route returns 503, and the `subscription.reconcile` / `billing.topup-reconcile` crons no-op. Orbit's manual credit-grant path is unaffected. The product / meter IDs themselves live in the DB (`plans.polarProductId`, `platform_settings.polarCreditProductId`, `platform_settings.polarOverageMeterId`) and are managed through Orbit.

| Var | Purpose |
|-----|---------|
| `POLAR_ACCESS_TOKEN` | Polar API access token |
| `POLAR_WEBHOOK_SECRET` | Standard-Webhooks signing secret |
| `POLAR_SERVER` | `sandbox` (default) or `production` |

### Analytics — Google Tag Manager (optional, public)

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_GTM_CONTAINER_ID` | GTM container id (`GTM-XXXXXXX`). When unset, the analytics provider renders children verbatim and every `analytics.track()` is a silent no-op. Configure GA4 + any other vendor tags inside the GTM workspace, **not** here — the customer-facing GA4 measurement id is not a GTM container id |

## OAuth callback URL

Add the following to your Google OAuth app's authorized redirect URIs:

```
${NEXT_PUBLIC_APP_URL}/api/auth/callback/google
```

## First-time setup after first deploy

1. Sign in via Google or magic-link to create your user.
2. Promote yourself to admin from inside the worker container:

   ```bash
   docker exec -it <worker-container> pnpm make:admin you@example.com
   ```

3. Open `${NEXT_PUBLIC_APP_URL}/orbit` to access the admin UI.

## Migrations

The web app does **not** auto-run migrations. The **worker container** does — its `CMD` is `pnpm worker:deploy` which runs `pnpm db:migrate && pnpm worker:start`, so every worker restart applies any pending migrations before booting pg-boss.

Workflow: edit `db/schema/*.ts` → `pnpm db:generate` (writes a SQL file + journal entry under `db/migrations/`) → commit → deploy. The next worker restart applies the migration.

For local dev (where the worker isn't running under `worker:deploy`), apply manually:

```bash
pnpm db:migrate
```

Never hand-edit `db/migrations/meta/_journal.json` or migration SQL files — that has caused silent prod outages (see CLAUDE.md Rule 6).

## What the app does NOT do

- **No SSH operations** — those are worker-only. API routes that mutate infra always enqueue a pg-boss job and return immediately.
- **No background timers** — billing, snapshots, server reconcile are all worker cron jobs.
- **No image building** — that runs inside the worker container (see [04-build-images.md](./04-build-images.md)).

## Health check

`GET /` returns the landing page. `GET /api/regions` returns regions JSON (public). For a dependency check:

```bash
curl -fsS https://your-host/api/regions
```

Should return `{"regions":[…]}` once the DB has data, or `{"regions":[]}` on a fresh install.
