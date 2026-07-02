# Getting Started with Kanbanica

Run Kanbanica on your own machine in **5–10 minutes**. No prior knowledge of the project needed — just follow the steps top to bottom.

Kanbanica is a project-management app (workspaces → projects → lists/sprints → tasks) with real-time collaboration and notifications. This guide gets a full local copy running: web app **and** the background worker, backed by a database — **without installing Postgres or Docker** (a local database is bundled).

---

## 1. Prerequisites (install these once)

You need three things. Check what you already have:

```bash
node --version   # must be 22.x  (see .node-version)
pnpm --version   # must be 9+    (project uses pnpm 11)
git --version    # any recent version
```

If any are missing:

| Tool | How to get it |
|------|---------------|
| **Node.js 22** | Install from <https://nodejs.org> (choose the "22 LTS" build), or with a version manager: `nvm install 22 && nvm use 22`. |
| **pnpm** | `npm install -g pnpm` (or `corepack enable` if you have Corepack). |
| **git** | <https://git-scm.com/downloads> |

> 💡 You do **not** need to install PostgreSQL or Docker. Kanbanica starts a private database for you in step 4.

---

## 2. Get the code

```bash
git clone <REPO_URL> kanbanica
cd kanbanica
pnpm install
```

`pnpm install` downloads all dependencies. It takes a minute or two the first time.

---

## 3. Create your config file

Copy the example environment file. The defaults already work for local development — you don't need to edit anything to get started.

```bash
cp .env.example .env
```

That's it for now. (Email, Google login, and cloud file storage are all **optional** and covered in [Optional extras](#7-optional-extras) later.)

---

## 4. Start the database

Kanbanica ships with a self-contained PostgreSQL that runs from a local folder — nothing to install.

Open a terminal and run:

```bash
pnpm db:local
```

Leave this terminal **running**. When you see a line like:

```
Postgres running at postgresql://krova:krova@localhost:54329/krova
```

…the database is up. The data is saved in a `.krova-postgres/` folder, so it survives restarts.

> Keep this window open the whole time you use the app. To stop the database later, press `Ctrl+C` here.

---

## 5. Set up the database tables (first time only)

Open a **second** terminal (leave the database running in the first one) and run:

```bash
pnpm db:migrate
```

This creates all the tables. You only need to run this once (and again after pulling changes that add new migrations).

---

## 6. Start the app

In that second terminal, run:

```bash
pnpm dev
```

This starts **two** things at once (you'll see color-coded logs):

- `next` — the web app at **<http://localhost:3000>**
- `worker` — the background worker (sends emails, notifications, reminders, sprint auto-close)

Open <http://localhost:3000> in your browser. 🎉

### Sign in (magic link)

Kanbanica uses passwordless **magic-link** sign-in.

1. On the login page, enter any email address (e.g. `you@example.com`) and submit.
2. Because email (SMTP) isn't configured yet, **the magic link is printed in your terminal** — look at the `worker`/`next` logs for a line containing a `http://localhost:3000/...` link.
3. Copy that link into your browser and open it. You're now signed in, and your account is created.

### Make yourself an admin (optional)

To access the admin panel, promote the account you just created:

```bash
pnpm make:admin you@example.com
```

Use the same email you signed in with. Done — you now have full access.

---

## ✅ You're running!

You should now have:

| Terminal 1 | Terminal 2 | Browser |
|------------|------------|---------|
| `pnpm db:local` (database) | `pnpm dev` (app + worker) | <http://localhost:3000> |

Create a workspace, add a project, and start making tasks.

**To start again next time:** run `pnpm db:local` in one terminal and `pnpm dev` in another. (You do **not** need to repeat `pnpm install` or `pnpm db:migrate` unless dependencies or migrations changed.)

---

## 7. Optional extras

Everything below is optional — the app works fully without it in local development.

### Real email (SMTP)
Without SMTP, emails (including magic links) are logged to the terminal instead of sent. To send real email, fill these in `.env` (works with Mailtrap, SendGrid, Postmark, AWS SES, etc.):

```
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=you@yourdomain.com
```

Restart `pnpm dev` after editing `.env`.

### Google sign-in
Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` to enable "Sign in with Google". Leave blank to use magic links only.

### Cloud file storage (S3 / Cloudflare R2)
By default, uploads are stored in the local `./uploads/` folder. For production, set `STORAGE_DRIVER=s3` (or `r2`) and the `S3_*` credentials in `.env`.

### Web Push notifications
Set the `VAPID_*` keys in `.env` to enable browser push notifications.

---

## 8. Handy commands

| Command | What it does |
|---------|--------------|
| `pnpm db:local` | Start the bundled local database (keep running) |
| `pnpm db:migrate` | Create/update database tables |
| `pnpm dev` | Start web app + worker together |
| `pnpm dev:next` | Start only the web app (no worker) |
| `pnpm worker` | Start only the worker |
| `pnpm make:admin <email>` | Promote an existing user to admin |
| `pnpm db:reset` | ⚠️ Wipe the database and re-apply all migrations |
| `pnpm lint` / `pnpm typecheck` | Check code style / types |
| `pnpm build` | Production build |

---

## 9. Troubleshooting

**`DATABASE_URL is not set`** — You skipped step 3. Run `cp .env.example .env`.

**`pnpm db:migrate` errors with a connection refused** — The database isn't running. Make sure `pnpm db:local` is running in another terminal and shows "Postgres running…" before you migrate.

**Port 3000 already in use** — Another app is using it. Stop that app, or run `pnpm dev:next` on a different port with `next dev -p 3001` (and update `NEXT_PUBLIC_APP_URL` in `.env`).

**Port 54329 already in use** — A previous database is still running. Find and stop it, or delete the `.krova-postgres/` folder to start fresh (this erases local data).

**I never got the magic-link email** — That's expected without SMTP. The link is printed in the terminal running `pnpm dev`. Search the logs for `localhost:3000`.

**Wrong Node version** — Run `node --version`; it must be `22.x`. Switch with `nvm use 22`.

**Start completely over** — Stop everything (`Ctrl+C` in both terminals), delete `.krova-postgres/`, then repeat steps 4 → 5 → 6.

---

## 10. What's running under the hood

- **Web app** (Next.js) — the UI and API at `localhost:3000`.
- **Worker** — a separate process that handles background jobs (email, notification digests, due-date reminders, sprint auto-close). It's why `pnpm dev` starts *two* things.
- **Database** (PostgreSQL) — stores everything; runs locally from `.krova-postgres/` in development.

In production these run as separate processes (web app + worker) against a managed PostgreSQL. See the deployment docs for details.

---

Questions or stuck? Open an issue — and welcome to Kanbanica. 🚀
