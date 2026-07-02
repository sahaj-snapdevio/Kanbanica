# Roadmap

A high-level view of where Kanbanica is headed. This is a **living document** and
not a commitment — priorities may shift based on community feedback. Have an idea?
Open a [feature request](./.github/ISSUE_TEMPLATE/feature_request.yml) or start a
discussion.

> Legend: 🎯 Near-term · 🔭 Later · 💡 Idea / exploring

## Toward v1.0 (first public release)

- 🎯 Release Candidate verification: fresh-clone, Docker deployment, upgrade, and
  backup/restore checks
- 🎯 Clear the lint backlog so `lint` becomes a required CI check
- 🎯 Screenshots and a short demo in the README

## Self-hosting & operations

- 🔭 **Multi-instance / high availability** — replace the in-memory SSE +
  notification registry with a shared Redis pub/sub so the app can run behind a
  load balancer with more than one instance
- 🔭 First-class object-storage guides (S3 / R2 / MinIO) beyond the current
  configuration switch
- 💡 One-click deploy templates (Railway / Fly / Render)
- 💡 Optional hosted demo instance for evaluation

## Product features

- 🔭 **Folders** — an organizational layer above Lists (currently post-MVP;
  `folder_id` exists but is unused — see [docs/folder.md](./docs/folder.md))
- 🔭 Full-text search across task descriptions
- 🔭 Richer reporting / dashboards and burndown analytics
- 💡 Public API + webhooks for integrations
- 💡 Import/export from other tools
- 💡 Custom fields and automation rules

## Developer experience

- 🔭 Demo seed script (`pnpm seed:demo`) to populate a sample workspace
- 🔭 Automated test suite and test coverage in CI
- 💡 Storybook / component playground

## Community

- 🎯 Enable GitHub Discussions and triage labels
- 🔭 Contribution guides for common extension points (new views, new job types)

---

_See [CHANGELOG.md](./CHANGELOG.md) for what has already shipped._
