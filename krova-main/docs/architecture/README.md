# Krova Architecture Docs

Per-subsystem detail extracted from `CLAUDE.md`. `CLAUDE.md` keeps a one-paragraph summary + a pointer for each; the full reference lives here. **Read the relevant file before working in that subsystem, and keep it current when the subsystem changes (Rule 22).**

| File | Covers |
| --- | --- |
| [backend-overview.md](backend-overview.md) | Two-process model, worker scaling + idempotency patterns, `app/` route groups, `lib/` service-layer map |
| [database-schema.md](database-schema.md) | Load-bearing `db/schema` columns + their invariants and enum value-lists |
| [images-and-guest.md](images-and-guest.md) | Image hosting, kernel build, distros, live resize, AVX-512 mask, cube IPv4/IPv6 + host/guest networking, in-guest updates, hostname/cloud-init |
| [server-lifecycle.md](server-lifecycle.md) | Phased server setup, host-reboot recovery, guest-reboot auto-relaunch, error-recovery crons, mount reaper, guarded-connect invariant |
| [snapshots-backups.md](snapshots-backups.md) | restic snapshots vs rclone backups, retention, restore/export/clone/promote, `.cube` format + import, storage backends, data-safety invariants |
| [billing-plans.md](billing-plans.md) | Plans & tiers, per-space overrides, Polar subscriptions/webhooks, overage cascade, fee gross-up, credit top-up |
| [orbit-admin.md](orbit-admin.md) | Orbit `/orbit` admin surface — sidebar, tabbed detail-page convention, list/detail pages |
| [custom-domains.md](custom-domains.md) | Cloudflare for SaaS custom hostnames, per-server DNS, edge-cache purge, domain claims |
| [realtime-and-terminal.md](realtime-and-terminal.md) | Pusher/Soketi channels, cube reachability + metrics, browser terminal (xterm.js ⇄ vsock PTY) |
| [integrations.md](integrations.md) | Signup email validation, EmailIt, outbound webhooks, GTM analytics, deployment version-skew recovery |

See also: [../commands.md](../commands.md) (full command catalog) and [../development-practices.md](../development-practices.md) (behavioral guidelines).
