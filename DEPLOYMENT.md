# Deploying Kanbanica (Self-Hosting for Teams)

This guide runs Kanbanica in **production on your own server** so your team can use it. It's the production counterpart to [SETUP.md](./SETUP.md) (which covers local development).

> **Two ways to run Kanbanica:**
> - **Local development** — contributors use `pnpm db:local` + `pnpm dev` (see [SETUP.md](./SETUP.md)). Unchanged.
> - **Self-hosting** — teams use **Docker Compose** (this guide). This is an *additional* option, not a replacement.

The stack runs as three long-lived services plus a one-shot migration step:

| Service | What it does |
|---------|--------------|
| **postgres** | The database (with a persistent volume). |
| **migrate** | Applies pending DB migrations, then exits. Runs automatically on `up`. |
| **app** | The Next.js web server on port 3000. |
| **worker** | Background jobs: email, notification digests, due-date reminders, sprint auto-close. **Run exactly one.** |

---

## 1. Prerequisites

- A Linux server with **Docker** and the **Docker Compose plugin** (`docker compose version`).
- A **domain** pointed at the server (e.g. `tasks.yourcompany.com`).
- **An authentication provider** (see step 3) — either SMTP or Google OAuth. **This is required in production**; without it, users can't log in and the app refuses to start.

---

## 2. Get the code and create `.env`

```bash
git clone <REPO_URL> kanbanica
cd kanbanica
cp .env.example .env
```

---

## 3. Configure `.env` for production

Edit `.env` and set the following.

### Required

```bash
# Point at the bundled Postgres service (note host = "postgres", port 5432):
DATABASE_URL=postgresql://kanbanica:CHANGE_ME@postgres:5432/kanbanica

# A strong secret (generate one):  openssl rand -hex 32
APP_SECRET=<32+ random characters>

# Your real public URL (HTTPS). This is baked into the build.
NEXT_PUBLIC_APP_URL=https://tasks.yourcompany.com

# Postgres provisioning (must match DATABASE_URL above):
POSTGRES_USER=kanbanica
POSTGRES_PASSWORD=CHANGE_ME
POSTGRES_DB=kanbanica
```

### At least one authentication provider (required in production)

**Option A — SMTP** (enables magic-link login):

```bash
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=noreply@yourcompany.com
```

Set up SPF/DKIM/DMARC DNS records with your provider so magic-link emails aren't spam-filtered.

**Option B — Google OAuth** (login without email):

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

> If you configure **neither**, the app will exit on startup with a clear error — by design, so you never ship a silently broken login.

### Optional

- **File storage** — defaults to `STORAGE_DRIVER=local` (persisted in the `uploads` Docker volume). For object storage set `STORAGE_DRIVER=s3` (or `r2`) and the `S3_*` variables.
- **Web Push** — set the `VAPID_*` keys (`npx web-push generate-vapid-keys`).

### Environment variable reference

Complete list of variables (validated by `lib/env.ts`). "Client" means it's inlined into the browser bundle at build time (`NEXT_PUBLIC_*`).

| Variable | Required? | Default | Purpose |
|----------|-----------|---------|---------|
| `DATABASE_URL` | ✅ always | — | PostgreSQL connection string (Docker: host `postgres`, port `5432`). |
| `APP_SECRET` | ✅ always | — | Better Auth signing secret; 32+ chars (`openssl rand -hex 32`). |
| `NEXT_PUBLIC_APP_URL` | ✅ always | — | Public URL; used for auth, links, file URLs. **Build-time (client).** |
| `NODE_ENV` | — | `development` | Set to `production` in prod (compose/images already do). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | ⚠️ prod: SMTP **or** Google | `SMTP_PORT=587` | Magic-link + notification email. Unset in dev → emails logged to console. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ⚠️ prod: SMTP **or** Google | — | Optional Google OAuth login. |
| `EMAIL_WEBHOOK_SECRET` | optional | — | Auth for the SMTP provider delivery webhook. |
| `STORAGE_DRIVER` | optional | `local` | `local` (./uploads volume) or `s3` / `r2`. |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | needed if `STORAGE_DRIVER=s3\|r2` | MinIO-style defaults | Object-storage credentials. `S3_ENDPOINT` for R2/MinIO; omit for AWS S3. |
| `S3_PUBLIC_URL` | optional | — | CDN/public origin for serving stored files. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | optional | — | Web Push (`npx web-push generate-vapid-keys`). |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | optional | `support@kanbanica.com` | Override the support email shown in the UI. **Client.** |
| `NEXT_PUBLIC_MARKETING_DOMAIN` | optional | `kanbanica.com` | Override the marketing domain shown in the UI. **Client.** |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Docker only | `kanbanica` | Provision the bundled Postgres; must match `DATABASE_URL`. |
| `APP_PORT` | Docker only | `3000` | Host port mapped to the app container. |

> **Production auth rule:** if `NODE_ENV=production` and **neither** full SMTP **nor** Google OAuth is configured, the app refuses to start (so login can never silently break).

---

## 4. Bring it up

```bash
docker compose up -d --build
```

This builds the images, starts Postgres, runs migrations (the `migrate` service), then starts `app` and `worker`.

Check status and health:

```bash
docker compose ps
curl -f http://localhost:3000/api/health     # → {"ok":true,"db":"connected"}
```

---

## 5. Create your first admin

Sign in through the UI once (via magic link or Google) to create your user, then promote it:

```bash
docker compose exec worker pnpm make:admin you@yourcompany.com
```

---

## 6. HTTPS / reverse proxy

Run a reverse proxy in front of the app on port 3000 to terminate TLS on your domain.

**Caddy** (automatic HTTPS) — `Caddyfile`:

```
tasks.yourcompany.com {
    reverse_proxy localhost:3000
}
```

**Nginx** — key points:

```nginx
server {
    server_name tasks.yourcompany.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
    # Real-time (SSE): do not buffer this endpoint, or live updates lag/stall.
    location /api/me/notifications/stream {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }
}
```

Make sure `NEXT_PUBLIC_APP_URL` matches the public HTTPS URL. Auth uses it for secure cookies and callback/magic-link URLs.

---

## 7. Backups

- **Database:**
  ```bash
  docker compose exec postgres pg_dump -U kanbanica kanbanica > backup-$(date +%F).sql
  ```
- **Uploads** (only if `STORAGE_DRIVER=local`): back up the `uploads` Docker volume. With S3/R2, your provider handles durability.

---

## 8. Updating

```bash
git pull
docker compose up -d --build
```

The `migrate` service applies any new migrations automatically before the app starts.

---

## 9. Operational notes & limits

- **Run exactly one worker.** Do **not** `docker compose up --scale worker=N`. Jobs are durable in Postgres, but multiple workers can double-process.
- **Single app instance (for now).** Real-time updates and in-app notifications use an in-memory registry per process. Running **2+ app instances** behind a load balancer would drop cross-instance events — that needs a shared Redis pub/sub, which isn't implemented yet. One app instance is fine for typical team use.
- **Database connections.** The pool is `max: 20` (`lib/db.ts`). Tune for your Postgres if needed.
- **Changing the domain** requires a rebuild (`NEXT_PUBLIC_APP_URL` is inlined at build time): `docker compose up -d --build`.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| App exits on start: "No authentication provider configured" | Set SMTP **or** Google OAuth in `.env` (step 3). |
| Users never receive the magic-link email | SMTP misconfigured or DNS (SPF/DKIM) failing. Check `docker compose logs worker`. |
| `/api/health` returns 503 | App can't reach Postgres — check `DATABASE_URL` host is `postgres` and the DB is healthy (`docker compose ps`). |
| Real-time updates lag or don't appear | Reverse proxy is buffering `/api/me/notifications/stream` (see step 6), or you're running multiple app instances (step 9). |
| Uploaded files disappear after redeploy | Local storage without a persistent volume. The compose file mounts `uploads`; or switch to S3/R2. |
| Migrations didn't run | Check `docker compose logs migrate` — it must exit 0 before app/worker start. |

---

Questions or issues? Open a GitHub issue. Happy self-hosting. 🚀
