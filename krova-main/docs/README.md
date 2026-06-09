# Krova Operations Docs

Step-by-step guides for setting up and operating Krova in production.

## Setup order

For a new deployment, run through these in order:

1. **[Set up the database](./01-database-setup.md)** — Postgres + initial migrations
2. **[Deploy the web app](./02-app-setup.md)** — Next.js dashboard + admin UI
3. **[Deploy the worker](./03-worker-setup.md)** — pg-boss background processor + image-build host
4. **[Build VM images](./04-build-images.md)** — kernel + rootfs artifacts that bare-metal servers serve to Cubes
5. **[Provision a bare-metal server](./05-server-setup.md)** — the phased Orbit flow that turns a fresh VPS into a Krova hypervisor

## Day-to-day operations

- **Schema changes** — see [02-app-setup.md § Migrations](./02-app-setup.md#migrations)
- **Update VM images** — re-run `pnpm build:images` from inside the worker container (see [04-build-images.md](./04-build-images.md))
- **Add another bare-metal server** — repeat [05-server-setup.md](./05-server-setup.md) from the Orbit UI

## Quick reference

| Component | Where | Restart trigger |
|-----------|-------|-----------------|
| Web app | Dokploy `app` service | Code change, env change |
| Worker | Dokploy `worker` service | Code change, env change, schema migration |
| Postgres | Dokploy DB or external | Rare |
| Bare-metal servers | Dedicated bare-metal provider | Per-server, via Orbit UI |
| VM image builds | One-shot inside worker container | Whenever you bump Firecracker, kernel, or OS images |
