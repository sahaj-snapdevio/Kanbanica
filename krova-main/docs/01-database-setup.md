# Database Setup

Krova needs a single PostgreSQL database. Both the web app and the worker connect to it.

## Provisioning

Any Postgres ≥ 14. Common choices:

- **Dokploy-managed Postgres** — easiest, lives next to your app/worker services
- **Self-managed Postgres on a cloud VM** — fine
- **Managed (Neon, Supabase, etc.)** — works as long as you can pass a `postgres://` URL

Note the connection string — both services need it. Format:

```
postgres://USER:PASSWORD@HOST:5432/DATABASE
```

## Required extensions

None — Krova uses only built-in Postgres features. `pg-boss` (background jobs) creates its own schema (`pgboss`) on first start.

## Initial schema

After the worker container is deployed (see [03-worker-setup.md](./03-worker-setup.md)), exec into it once to create all tables:

```bash
docker exec -it <worker-container> bash
cd /app
pnpm db:migrate
```

`drizzle-kit migrate` reads SQL files from `db/migrations/` and applies any that haven't been recorded in `drizzle.__drizzle_migrations`. On a fresh DB, it creates everything from scratch.

## Schema changes (going forward)

When you edit `db/schema/*.ts`:

```bash
pnpm db:generate   # creates db/migrations/000N_<name>.sql
git commit         # commit the schema + migration together
# deploy
docker exec -it <worker-container> pnpm db:migrate
```

## Resetting the DB (dev/staging only)

```bash
pnpm db:reset
```

This drops the `public` AND `drizzle` schemas, then re-runs all migrations. Destructive — wipes everything including pg-boss state.

**Don't run this against production.**

## Backup & restore

Krova doesn't ship a backup tool — use your DB provider's snapshot/PITR features. Critical tables to preserve:

- `user`, `account`, `session` — auth identities
- `spaces`, `space_memberships`, `member_permissions` — team data
- `cubes`, `domain_mappings`, `tcp_port_mappings` — running infra
- `billing_events` — credit history (immutable, never delete)
- `audit_logs` — compliance trail

`pgboss.*` and `drizzle.__drizzle_migrations` can be lost without consequence — the worker recreates them on next start, and migrations re-apply (but only their effects, since the schema already exists).
