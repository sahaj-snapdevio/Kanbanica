# Worker Setup

The worker is a separate long-running Node process (`scripts/worker.ts`) that consumes pg-boss jobs and performs all infrastructure mutations: SSH commands, Cube provisioning, snapshots, backups, billing, email delivery, periodic reconciliation. The web app NEVER touches infra directly — it only enqueues jobs.

The worker container also doubles as the host for `pnpm build:images` (VM image builds), `pnpm db:migrate`, and `pnpm make:admin`.

## Service shape

- **Image**: built from `Dockerfile.worker` (NOT the default Nixpacks build)
- **Base**: `node:22-slim` + Docker static-binary CLI + zstd
- **Start command** (`Dockerfile.worker` CMD): `pnpm worker:deploy` — runs `pnpm db:migrate && pnpm worker:start`, so every deploy applies pending migrations before the pg-boss worker boots
- `pnpm worker:start` alone (`tsx scripts/worker.ts`, no watch mode) is also available for local dev where you want to skip the migrate step

## Required environment variables

The same `lib/env.ts` schema as the web app. Set the **identical values** on both services — especially `DATABASE_URL` and `APP_SECRET` (the worker decrypts SSH keys with `APP_SECRET`).

See [02-app-setup.md § Required environment variables](./02-app-setup.md#required-environment-variables) for the full list.

Plus one worker-specific variable:

| Var | Required | Purpose |
|-----|----------|---------|
| `KROVA_BUILD_OUTDIR` | for image builds | Absolute path where `pnpm build:images` writes artifacts. Must exist on BOTH the host and inside the container at the SAME path. Recommended: `/opt/krova-build/images` |

## Required Dokploy bind mounts

Configure these in the worker service's **Volumes / Mounts** tab as **Bind Mount** (not "Volume Mount"):

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `/var/run/docker.sock` | `/var/run/docker.sock` | Lets the in-container Docker CLI talk to the host daemon for image builds (Docker-out-of-Docker) |
| `/opt/krova-build` | `/opt/krova-build` | Same path on both sides so `docker run -v` bind mounts work correctly when the CLI talks to the host daemon |

Before deploying, prepare the host path:

```bash
# On the Dokploy host (NOT inside any container):
mkdir -p /opt/krova-build
chmod 755 /opt/krova-build
```

After saving mounts, click **Deploy** (not Restart) so the new container is created with the mounts.

## Verify after deploy

Exec into the worker container:

```bash
docker exec -it <worker-container> bash
```

Then inside:

```bash
ls -la /var/run/docker.sock         # should show a socket file (srw-rw----)
ls -la /opt/krova-build              # should show the empty host directory
echo "$KROVA_BUILD_OUTDIR"           # should print /opt/krova-build/images
docker info | head -5                # should print client info from host daemon
```

If any of those fail, the bind mount or env var didn't apply — check the Dokploy service config and redeploy.

## What the worker runs

On startup it registers handlers for every job type and schedules these recurring jobs (all UTC, defined in [lib/worker/boss.ts](../lib/worker/boss.ts)):

| Job | Schedule | Purpose |
|-----|----------|---------|
| `billing.hourly` | `0 * * * *` | Charge running cubes for the hour; cascade through prepaid → overage → auto-sleep |
| `billing.topup-reconcile` | `30 * * * *` | Heal `pending` credit purchases if Polar already marked them paid (dropped-webhook backstop) |
| `subscription.reconcile` | `15 * * * *` | Poll Polar for every subscribing space; heal plan/period divergence via a synthetic event |
| `polar.meter-reconcile` | `*/10 * * * *` | Re-report `overage_charge` rows older than 5 min with `polar_meter_reported_at IS NULL` |
| `cube.state-sync` | `*/2 * * * *` | Sync DB cube status with Firecracker hypervisor state; auto-relaunch on guest-issued reboot |
| `cube.stale-check` | `*/5 * * * *` | Detect cubes stuck in `pending`/`booting`/`stopping`; salvage with pre-deletion backup if possible |
| `cube.reachability` | `* * * * *` | L1 vsock agent ping + L2 SSH `/dev/tcp` probe + L3 live metrics on every running cube |
| `terminal-session.reaper` | `*/5 * * * *` | Sweep orphaned `cube_terminal_sessions` rows whose worker process was SIGKILL'd |
| `server.reconcile` | `*/10 * * * *` | Detect DB↔hypervisor drift; surface orphans to admins (never auto-destroys) |
| `host.mount-reaper` | `5,15,25,35,45,55 * * * *` | Sweep stale `/tmp/krova-mount-<cubeId>` loop-mounts that pinned `(deleted)` inodes |
| `storage.health-check` | `*/30 * * * *` | `HeadBucket` probe every active storage backend; alert at 85% of configured capacity |
| `setup-reaper` | `*/5 * * * *` | Auto-reset server setup phases stuck at `running` longer than 1 hour |
| `job-logs.prune` | `0 3 * * *` | Daily 03:00 UTC; retention: info/warn 30d, errors 90d, webhook deliveries 30d |
| `cloudflare.hostname-poll` | `* * * * *` | Refresh `domain_mappings.cloudflareStatus`; push `domain.update` to the cube channel |
| `email.outbox-reap` | `*/15 * * * *` | Sweep `email_outbox` rows stuck in `sending` past the 10-min grace; mark `failed` |
| `email.events-prune-cron` | `20 3 * * *` | Daily 03:20 UTC; drop `email_events` rows older than 90 days |
| `restic.prune` | `0 4 * * 0` | Sundays 04:00 UTC; per-cube `restic prune` to reclaim orphaned chunks |
| `restic.check` | `0 6 * * 0` | Sundays 06:00 UTC; per-cube `restic check --read-data-subset=2%`; email admins on failure |
| `cube-imports.reaper` | `10 */6 * * *` | Every 6 hours at :10; abort abandoned multipart uploads; hard-delete stale terminal rows |
| `security.weekly-scan` | `0 8 * * 1` | Mondays 08:00 UTC; weekly CVE digest emailed to admins |
| `snapshot.auto` | configurable in `config/platform.ts` (disabled by default) | Per-cube automatic snapshots |

Every scheduled queue uses `policy: "exclusive"` so a slow tick can NEVER overlap the next one — see docs/architecture/backend-overview.md ("Worker Scaling") for the rationale. New `boss.schedule()` calls MUST come with a matching entry in `lib/worker/ensure-queues.ts`.

On-demand jobs (cube provision / delete / sleep / wake / transfer / resize, snapshots, backups, server setup phases, domains, TCP mappings, email send, browser-terminal bridge, etc.) fire only when triggered by the app or another job.

## Security note: docker.sock mount

Mounting `/var/run/docker.sock` into the worker is equivalent to giving the worker root on the host. Acceptable here because:

- The worker has no public-facing surface — no HTTP listener, no inbound traffic
- It only consumes pg-boss jobs from the DB (which itself is access-controlled)
- It needs Docker access for VM image builds

If you ever expose the worker to the network, **remove the docker.sock mount** and run image builds elsewhere.

## Stopping / restarting

`Restart` just restarts the existing container (mount config preserved). `Deploy` rebuilds the image and creates a fresh container. After any code or env change, use Deploy.

In-flight jobs survive a restart — pg-boss persists job state in Postgres and resumes on the next worker boot. Jobs that were halfway through SSH operations are picked up by the next worker; idempotency in each handler handles re-execution safely.
