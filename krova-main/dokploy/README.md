# Dokploy configuration

Single source of truth for the krova-cloud Swarm settings. Everything
here lives in code so an unintended Dokploy UI tweak can't drift this
back into a broken state.

## Worker service (`worker-stack.yml`)

This file holds the `deploy:` + `healthcheck:` config for the pg-boss
worker container.

### Why a single worker replica

pg-boss is concurrency-safe — many workers can poll the same queue and
no job is ever delivered twice. But during a deploy with `start-first`
rolling updates, you briefly run TWO containers on different versions
of the code. If a queued job hits the stale container before it
finishes draining, it can fail in ways the fresh container would have
handled correctly. The cure is **`stop-first` + `replicas: 1`** — drain
old before starting new. The deploy gap is harmless because pg-boss
persists every job to Postgres.

### How to apply

Pick one path:

**A. Dokploy "Swarm Settings" UI** (current setup) — open the worker
service, copy each field from `worker-stack.yml` into the matching
Swarm Settings input. The fields you must set:

| UI field              | Value                                              |
| --------------------- | -------------------------------------------------- |
| Stop Grace Period     | `2700000000000` (45m in nanoseconds)               |
| Update Config → Order | `stop-first`                                       |
| Update Parallelism    | `1`                                                |
| Failure Action        | `rollback`                                         |
| Rollback Order        | `stop-first`                                       |
| Rollback Parallelism  | `1`                                                |
| Restart Condition     | `on-failure`                                       |
| Restart Max Attempts  | `3`                                                |
| Restart Delay         | `10s`                                              |
| Restart Window        | `120s`                                             |
| Mode                  | `replicated`                                       |
| Replicas              | `1`                                                |
| Init (tini)           | `true`                                             |
| Health Check Command  | `pgrep -f 'scripts/worker.ts' \|\| exit 1`         |
| Health Check Interval | `30s`                                              |
| Health Check Timeout  | `10s`                                              |
| Start Period          | `120s`                                             |
| Retries               | `3`                                                |

> **Init / Health Check note.** `init: true` runs tini as PID 1 so SIGTERM is
> forwarded to the worker and zombie children (the local `docker` CLI used by
> `pnpm build:images`) are reaped. If the Dokploy UI has no "Init" toggle, use
> the Compose stack method (option B) — `init` is honoured by Swarm via the
> container spec. The health check greps `scripts/worker.ts` (the actual worker
> process), not `pnpm worker`, because the `Dockerfile.worker` CMD `exec`s Node
> directly (see below).
>
> **`pgrep` requires `procps`.** `node:22-slim` does NOT ship `pgrep`; the
> `Dockerfile.worker` apt step installs `procps` for exactly this reason. Without
> it the health check exits 127 on every probe → Swarm marks the task unhealthy →
> kill-loops the container (SIGTERM with no deploy). If you ever change the base
> image or the health-check command, keep `procps` installed.

**B. Dokploy "Compose" stack** — switch the worker service to a
Compose deployment, point it at `dokploy/worker-stack.yml`, and let
Dokploy merge the rest (image, env, mounts).

### What the deploy looks like with these settings

1. New build finishes, image is pushed.
2. Swarm sends SIGTERM to PID 1 (tini, via `init: true`), which forwards
   it to the worker Node process. Because the CMD `exec`s Node directly
   (no pnpm/sh layer), `process.on("SIGTERM")` in `scripts/worker.ts`
   fires reliably.
3. The old container stops polling for new jobs immediately
   (`scripts/worker.ts shutdown()` → `lib/worker/boss.ts stopWorker()` →
   pg-boss `boss.stop({ graceful: true, timeout: 40m, close: true })`)
   but lets any in-flight handler finish — up to **`stop_grace_period`
   (45m)**. Newly queued jobs pile up in Postgres.
4. Old container exits cleanly (well before the 45m SIGKILL deadline).
   New container starts.
5. `pnpm db:migrate` runs at boot (the worker is the single migration
   runner), then the worker `exec`s. Health check stays silent during
   `start_period: 120s`, which covers the migrate step.
6. Once `pgrep -f 'scripts/worker.ts'` succeeds, Swarm marks the service
   healthy. pg-boss takes over the backlog from step 3.

If you ever need to cut over faster (e.g. urgent hotfix while a 30-min
`cube.transfer` is in flight): cancel the running job from Orbit,
which lets the old container drain immediately and the new one start
within seconds.
