# Changelog

All notable changes to Kanbanica are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning policy

Given a version `MAJOR.MINOR.PATCH`:

- **MAJOR** — incompatible changes: database migrations that require manual
  steps, removed/renamed environment variables, or breaking API changes.
- **MINOR** — new features and enhancements that are backward compatible.
- **PATCH** — backward-compatible bug fixes and small improvements.

Until `1.0.0`, the project is considered pre-release: `0.x` versions may include
breaking changes in a MINOR bump. From `1.0.0` onward, the rules above apply
strictly. Each release is tagged `vX.Y.Z` in git.

<!--
Maintainers: when cutting a release, move items from "Unreleased" into a new
dated section, e.g.:

## [1.0.0] - 2026-08-01
### Added
### Changed
### Fixed
-->

## [Unreleased]

### Added
- Open-source release preparation: `LICENSE` (MIT), `README`, `CONTRIBUTING`,
  `SECURITY`, `CODE_OF_CONDUCT`, issue/PR templates, and CI (typecheck + build).
- Self-hosting support: application `Dockerfile`, `docker-compose.yml`,
  `/api/health` endpoint, container-safe migration runner, and `DEPLOYMENT.md`.
- Local-development guide (`SETUP.md`) and architecture overview
  (`ARCHITECTURE.md`).
- Configurable object storage via `STORAGE_DRIVER` (local / S3 / R2).
- Environment-overridable branding (support email, marketing domain).

### Changed
- Production startup now requires at least one authentication provider
  (SMTP or Google OAuth) so login cannot silently fail.

### Notes
- This is the pre-1.0 development line. The first public release will be tagged
  `v1.0.0` after the Release Candidate verification pass.
