# KROVA Scaffold

KROVA is a lean application scaffold for projects that need a real control-plane backbone from day one:

- Next.js App Router UI
- Postgres and Drizzle
- Better Auth magic-link login
- pg-boss worker queues
- durable email outbox via SMTP (nodemailer)
- Orbit admin for users, queue state, and email visibility

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm db:local
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`, sign in with a magic link, then promote your user:

```bash
pnpm make:admin you@example.com
```

Without `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`, the worker logs emails locally instead of sending them.

## Structure

- `app/` contains the public page, auth page, user dashboard, profile, Orbit admin, and API routes.
- `db/schema/` contains the scaffold tables.
- `lib/auth.ts` wires Better Auth magic links.
- `lib/email/` persists outbound email before enqueueing work.
- `lib/worker/` owns pg-boss queues and handlers.
- `components/` contains the small UI kit and scaffold shell.

See [docs/commands.md](./docs/commands.md) for the command list.
