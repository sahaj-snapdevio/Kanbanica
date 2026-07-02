<div align="center">

# Kanbanica

**A modern, open-source project management tool for teams — boards, sprints, and tasks in one place.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)

</div>

---

## Overview

Kanbanica is a self-hostable, ClickUp-style project management app. Teams organize their work in **Workspaces → Projects → Lists / Sprints → Tasks**, with real-time collaboration, notifications, and a fast, keyboard-friendly UI. It's a complete, production-grade codebase you can clone, run, extend, and deploy on your own infrastructure.

## Features

- 🗂️ **Workspaces, Projects, Lists & Sprints** — a flexible hierarchy for organizing any team's work
- ✅ **Rich tasks** — assignees, due dates, priorities, subtasks/checklists, attachments, and Tiptap-powered descriptions
- 🏃 **Sprints** — sprint planning, story points, and automatic sprint close
- 📌 **Multiple views** — Board, List, Calendar, and a cross-workspace "My Tasks"
- 💬 **Collaboration** — comments, @mentions, reactions, and an activity feed
- ⚡ **Real-time sync** — live updates over SSE as teammates make changes
- 🔔 **Notifications** — in-app, email digests, and Web Push
- 🔐 **Two-level permissions** — workspace roles + per-project permissions, with guests
- 🔑 **Passwordless auth** — magic-link login (or Google OAuth)
- 🎨 **Themeable UI** — light/dark, built on shadcn/ui + Tailwind CSS v4
- 🛠️ **Admin panel** — user, queue, and email visibility

## Screenshots

> _Screenshots coming soon — replace these placeholders with real captures._

| Board view | List view | Sprint view |
|:---:|:---:|:---:|
| _`docs/screenshots/board.png`_ | _`docs/screenshots/list.png`_ | _`docs/screenshots/sprint.png`_ |

| Task detail | Mobile |
|:---:|:---:|
| _`docs/screenshots/task.png`_ | _`docs/screenshots/mobile.png`_ |

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Better Auth (magic link / Google OAuth) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Rich Text | Tiptap |
| State | Zustand (client) + SWR (server) |
| Real-time | Server-Sent Events (SSE) |
| Background Jobs | pg-boss worker |
| Email | Nodemailer (SMTP) |
| File Storage | files-sdk (local FS in dev → S3/R2 in prod) |

## Quick Start

Requires **Node.js 22** and **pnpm**. No separate database install needed — a local Postgres is bundled for development.

```bash
git clone <REPO_URL> kanbanica
cd kanbanica
pnpm install
cp .env.example .env
pnpm db:local     # start the bundled dev database (leave running)
pnpm db:migrate   # create the tables (first time only)
pnpm dev          # start the web app + worker
```

Open <http://localhost:3000>, sign in with a magic link (the link is printed in the terminal when SMTP isn't configured), then make yourself an admin:

```bash
pnpm make:admin you@example.com
```

📖 Full step-by-step walkthrough (with troubleshooting): **[SETUP.md](./SETUP.md)**.

## Local Development

- `pnpm dev` runs the Next.js app **and** the pg-boss worker together.
- `pnpm lint` / `pnpm typecheck` — code quality checks.
- Architecture, conventions, and per-feature specs live in [CLAUDE.md](./CLAUDE.md) and the [`docs/`](./docs) folder.

See **[SETUP.md](./SETUP.md)** for the complete local-development guide.

## Self-Hosting

Deploy Kanbanica for your team with Docker Compose (Postgres + app + worker, one command). See the full production guide: **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

```bash
cp .env.example .env   # configure DATABASE_URL, APP_SECRET, NEXT_PUBLIC_APP_URL + an auth provider
docker compose up -d --build
```

## Documentation

- [SETUP.md](./SETUP.md) — local development, start to finish
- [DEPLOYMENT.md](./DEPLOYMENT.md) — self-hosting with Docker
- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the system fits together
- [CLAUDE.md](./CLAUDE.md) — conventions and key decisions
- [ROADMAP.md](./ROADMAP.md) — planned features and direction
- [CHANGELOG.md](./CHANGELOG.md) — notable changes per release
- [`docs/`](./docs) — per-feature specifications (tasks, sprints, permissions, notifications, real-time, database schema, and more)

## Contributing

Contributions are welcome! Please read **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, coding conventions, and the pull-request process, and see **[SECURITY.md](./SECURITY.md)** to report vulnerabilities responsibly.

## Why Kanbanica?

- **Own your data** — self-host on your own infrastructure; no vendor lock-in.
- **Complete, not a toy** — real workspaces, sprints, permissions, real-time sync, notifications, and an admin panel out of the box.
- **Modern stack** — Next.js 16, TypeScript, Drizzle, Tailwind v4 — approachable to extend.
- **No SaaS strings attached** — no telemetry, no billing walls, no proprietary dependencies. MIT-licensed.

## License

Kanbanica is open source under the [MIT License](./LICENSE).
