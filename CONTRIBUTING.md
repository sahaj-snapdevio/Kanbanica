# Contributing to Kanbanica

Thanks for your interest in contributing! This guide covers how to get set up, our conventions, and the pull-request process.

## Code of Conduct

By participating in this project you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md). Please be respectful and constructive.

## Getting set up

1. **Fork** the repository and clone your fork.
2. Follow **[SETUP.md](./SETUP.md)** to get a local instance running (Node.js 22 + pnpm; a Postgres is bundled for dev).

   ```bash
   pnpm install
   cp .env.example .env
   pnpm db:local     # bundled dev database (leave running)
   pnpm db:migrate   # first time only
   pnpm dev          # app + worker
   ```

3. Read **[CLAUDE.md](./CLAUDE.md)** and the relevant file(s) in **[`docs/`](./docs)** before implementing a feature — they capture the architecture and per-feature conventions.

## Development workflow

- Create a branch from `main`: `feat/<short-name>`, `fix/<short-name>`, or `docs/<short-name>`.
- Keep changes focused — one logical change per pull request.
- Before pushing, make sure the checks pass:

  ```bash
  pnpm typecheck   # must pass — this is a required CI gate
  pnpm build       # must succeed — required CI gate
  pnpm format      # format your changed files
  pnpm lint        # advisory: keep new code clean (see note below)
  ```

> **Note on linting:** the codebase currently carries a backlog of pre-existing
> lint findings that we're cleaning up incrementally, so `pnpm lint` is **not**
> yet a blocking CI gate. Please don't introduce *new* lint errors in code you
> touch, and run `pnpm format` on your changes.

## Commit messages

Use short, descriptive, [Conventional Commits](https://www.conventionalcommits.org/)-style messages:

```
feat(task): add due-date reminders
fix(auth): handle expired magic links
docs(readme): clarify self-hosting steps
```

Common types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`.

## Pull requests

1. Push your branch to your fork and open a PR against `main`.
2. Fill out the PR template (what changed, why, how you tested it).
3. Ensure CI is green (`typecheck` + `build`).
4. Link any related issue (`Closes #123`).
5. A maintainer will review — please be responsive to feedback.

## Reporting bugs & requesting features

Use the GitHub issue templates (Bug report / Feature request). For security
issues, **do not open a public issue** — see **[SECURITY.md](./SECURITY.md)**.

## Coding conventions (quick reference)

- **UI:** use shadcn/ui primitives; don't hand-roll dialogs, selects, inputs, etc.
- **Border radius:** cards/modals/popovers `rounded-xl`; buttons/inputs `rounded-md`.
- **Confirmations:** use a shadcn `Dialog`, never `window.confirm()`.
- **Database:** Drizzle ORM; UUID ids; `createdAt`/`updatedAt` on every table; soft-delete via `isArchived`.
- **Mutations:** every server action / route handler must call `refreshWorkspace(...)` after writing (see `docs/realtime.md`).

See [CLAUDE.md](./CLAUDE.md) for the full list.

Happy hacking! 🚀
