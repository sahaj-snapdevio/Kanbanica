import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { TERMINAL_BRIDGE_EXPIRE_SECONDS } from "@/config/platform";
import { db } from "@/lib/db";
import { JOB_NAMES, type JobName } from "@/lib/worker/job-types";

/**
 * pg-boss queue policy. Default is `standard` — with `standard`, `singletonKey`
 * is a label only and does NOT dedupe. Setting `exclusive` makes the unique
 * index `job_i6` enforce one row per (queue, singletonKey) across both
 * `created` and `active` states. Every queue we ever pass `singletonKey` to
 * MUST be `exclusive` (or another dedup-aware policy) or the dedup silently
 * does nothing. See `node_modules/pg-boss/dist/types.d.ts` `QueuePolicy`.
 *
 * RULE FOR RECURRING QUEUES (`boss.schedule()`): every cron-scheduled queue
 * MUST be `policy: "exclusive"`. pg-boss's internal scheduler automatically
 * inserts each tick with `singletonKey = "${queueName}__"`, and the exclusive
 * policy then enforces "at most one tick in-flight at a time" via the unique
 * index. Without exclusive, a slow handler (e.g. billing.hourly holding per-
 * space locks for >1 hour, restic.prune weekly sweep taking 7+ days on a
 * growing fleet) can stack ticks → multiple workers run the same recurring
 * job in parallel, double-charging or corrupting state. With exclusive, the
 * next tick is REJECTED at enqueue while the previous run is `active`; the
 * tick AFTER fires normally. Idempotent recurring handlers self-heal on the
 * next interval — this is the right tradeoff. See audit 2026-05-24.
 */
type QueuePolicy = "standard" | "short" | "singleton" | "stately" | "exclusive";

/**
 * Queue-level retry and expiration config per job category.
 *
 * RULE 56 — this is a FULL `Record<JobName, …>`, NOT `Partial`. Every job in
 * `JOB_NAMES` MUST have an entry here. That makes it a COMPILE-TIME guard:
 * `pnpm typecheck` / `pnpm build` fails the moment a new job is added to
 * `JOB_NAMES` without a queue config, so a job can never again silently fall
 * back to pg-boss defaults (the `CUBE_TRANSFER_CANCEL` gap, 2026-05-29 audit).
 * If a job genuinely wants pg-boss defaults, give it an explicit `{}` entry
 * with a one-line comment saying why — make the choice visible, never implicit.
 */
export const QUEUE_OPTIONS: Record<
  JobName,
  {
    retryLimit?: number;
    retryDelay?: number;
    expireInSeconds?: number;
    policy?: QueuePolicy;
  }
> = {
  // Cube lifecycle: retryLimit 3, retryDelay 60s, expire in 30 min
  [JOB_NAMES.CUBE_PROVISION]: {
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 1800,
  },
  [JOB_NAMES.CUBE_DELETE]: {
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 1800,
  },
  [JOB_NAMES.CUBE_SLEEP]: {
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 1800,
  },
  [JOB_NAMES.CUBE_POWER_OFF]: {
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 1800,
  },
  [JOB_NAMES.CUBE_WAKE]: {
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 1800,
  },
  // policy=exclusive + singletonKey=`cube-cold-restart:${cubeId}` (set at every
  // enqueue site: the customer + orbit cold-restart routes and the restartCube
  // action) collapses a double-click / navigate-back-and-click into ONE job per
  // cube. Cold-restart deliberately keeps cubes.status='running' the whole time
  // (no transitional status to gate the UI on), so without this dedup a second
  // request enqueues a second kill+relaunch — two kernel reboots + two prorated
  // charges (2026-05-31 double-fire audit). The handler's running→stopping claim
  // only collapses TRULY-concurrent jobs, not a second job that runs after the
  // first flips the cube back to 'running'.
  [JOB_NAMES.CUBE_COLD_RESTART]: {
    retryLimit: 1,
    retryDelay: 60,
    expireInSeconds: 1800,
    policy: "exclusive",
  },
  // Auto-relaunch after guest-issued reboot. Same characteristics as
  // CUBE_COLD_RESTART (one-shot startCube call, idempotent claim).
  // policy=exclusive + singletonKey=cubeId at the enqueue site (state-sync)
  // collapses repeated triggers — state-sync fires every 2 min and may catch
  // the same dead Firecracker on multiple ticks before the relaunch finishes;
  // dedup keeps it to one in-flight job per cube. retryLimit=1 covers a
  // transient SSH/host hiccup; beyond that the handler marks `error` and
  // notifies admins.
  [JOB_NAMES.CUBE_AUTO_RELAUNCH]: {
    retryLimit: 1,
    retryDelay: 60,
    expireInSeconds: 1800,
    policy: "exclusive",
  },
  // Per-cube auto error-recovery. retryLimit=0 is DELIBERATE: the
  // `cube.error-recovery-scan` cron + the `cubes.error_recovery_attempts`
  // counter own all retries (hard 3-strike cap). Letting pg-boss retry too
  // would double-count attempts. exclusive + singletonKey=cubeId (set at the
  // scan's enqueue site) collapses repeat enqueues to one in-flight per cube.
  [JOB_NAMES.CUBE_ERROR_RECOVERY]: {
    retryLimit: 0,
    expireInSeconds: 1800,
    policy: "exclusive",
  },
  // Error-recovery scan: 5-min cron. exclusive (cron rule) so a slow scan
  // (per-server reachability probes) can never overlap the next tick.
  [JOB_NAMES.CUBE_ERROR_RECOVERY_SCAN]: {
    retryLimit: 1,
    expireInSeconds: 300,
    policy: "exclusive",
  },
  // Cube transfer: compress + upload + download + decompress + boot can take
  // tens of minutes for multi-GB rootfs. retryLimit=1 because the handler is
  // idempotent and resumes from `transferState`, but we don't want runaway
  // retries on a stubborn failure — admin should investigate before re-trying.
  // policy=exclusive + singletonKey=`cube-transfer:${cubeId}` (set at the
  // transfer route) is defense-in-depth on top of the route's atomic
  // transferState claim: two submits can't enqueue two concurrent transfers
  // that would race on the same rootfs / source teardown / domain re-point
  // (2026-05-31 double-fire audit).
  [JOB_NAMES.CUBE_TRANSFER]: {
    retryLimit: 1,
    retryDelay: 120,
    expireInSeconds: 7200,
    policy: "exclusive",
  },
  // Cube transfer CANCEL: best-effort destination teardown + source wake +
  // Cloudflare origin restore + transfer-state reset. The handler is
  // idempotent (re-reads state; the final transferState reset is
  // unconditional), so retrying a transient DB/SSH hiccup is safe — and
  // NECESSARY: a cube left in `cancelling` is excluded from cube.state-sync /
  // cube.reachability and has NO reaper, so a terminal failure here would
  // strand it forever. retryLimit 3 gives the reset a chance to land.
  // policy=exclusive + singletonKey=`transfer-cancel:${cubeId}` (set at the
  // enqueue site) collapses a double-click; the cancel API's flip out of
  // CANNABLE_STATES (→ `cancelling`) is the primary dedup.
  [JOB_NAMES.CUBE_TRANSFER_CANCEL]: {
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 900,
    policy: "exclusive",
  },
  // Cube resize: live RAM/disk grow or cold CPU change. retryLimit=1 because
  // the resize is destructive (host file truncate, virtio-mem plug, cold
  // restart) and resuming midway through partial state is risky — operator
  // should investigate before retrying. 30 min budget covers cold restarts on
  // larger rootfs.
  // policy=exclusive + singletonKey=`cube-resize:${cubeId}` (set in
  // lib/cube-resize/enqueue.ts) collapses a double-submit into one resize per
  // cube — the handler's running|sleeping→stopping claim covers truly-concurrent
  // jobs, this stops a second job from being queued at all (2026-05-31 audit).
  [JOB_NAMES.CUBE_RESIZE]: {
    retryLimit: 1,
    retryDelay: 60,
    expireInSeconds: 1800,
    policy: "exclusive",
  },

  // Domain/TCP jobs: retryLimit 3, retryDelay 30s, expire in 15 min
  [JOB_NAMES.DOMAIN_ADD]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 900,
  },
  [JOB_NAMES.DOMAIN_REMOVE]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 900,
  },
  // Cache purge: one fast Cloudflare API call. Cloudflare's purge-by-hostname
  // rate limit is ZONE-WIDE and plan-tiered (Free 5/min with a 25-token burst
  // bucket; Pro 5/s; Business 10/s; Enterprise 50/s). On the Free plan a
  // drained bucket returns 429, and the bucket refills at only 5/min — so
  // retries are spaced a FULL MINUTE apart (let the window refill) with a
  // generous budget (5 × 60s ≈ 5 min) so a rate-limited purge eventually lands
  // instead of false-failing. A cache purge isn't latency-critical, so the wait
  // is fine. The per-domain 60s cooldown (DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS)
  // bounds per-domain spam; exclusive + singletonKey=mappingId dedupes
  // back-to-back clicks. expireInSeconds is PER-ATTEMPT (a purge is sub-second),
  // not the total across retries.
  [JOB_NAMES.DOMAIN_PURGE_CACHE]: {
    retryLimit: 5,
    retryDelay: 60,
    expireInSeconds: 300,
    policy: "exclusive",
  },
  // Cloudflare status poll: periodic, idempotent, fast.
  // exclusive (cron): prevents the next 1-min tick from racing if a
  // previous poll over many hostnames runs long.
  [JOB_NAMES.CLOUDFLARE_HOSTNAME_POLL]: {
    retryLimit: 1,
    expireInSeconds: 300,
    policy: "exclusive",
  },
  [JOB_NAMES.TCP_MAPPING_ADD]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 900,
  },
  [JOB_NAMES.TCP_MAPPING_REMOVE]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 900,
  },
  [JOB_NAMES.TCP_MAPPING_UPDATE_WHITELIST]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 900,
  },
  [JOB_NAMES.TCP_MAPPING_UPDATE_CUBE_PORT]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 900,
    // Per-mapping exclusive so back-to-back port edits on the same mapping
    // can't race the iptables swap. The PATCH endpoint also passes a
    // singletonKey on the mapping id so a duplicate enqueue collapses.
    policy: "exclusive",
  },
  [JOB_NAMES.TCP_MAPPING_DISABLE]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 900,
  },
  [JOB_NAMES.TCP_MAPPING_ENABLE]: {
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 900,
  },

  // Snapshot jobs: retryLimit 2, retryDelay 120s, expire in 60 min
  [JOB_NAMES.SNAPSHOT_CREATE]: {
    retryLimit: 2,
    retryDelay: 120,
    expireInSeconds: 3600,
  },
  [JOB_NAMES.SNAPSHOT_RESTORE]: {
    retryLimit: 2,
    retryDelay: 120,
    expireInSeconds: 3600,
  },
  [JOB_NAMES.SNAPSHOT_DELETE]: {
    retryLimit: 2,
    retryDelay: 120,
    expireInSeconds: 3600,
  },
  // Per-plan scheduler: hourly cron, idempotent (per-cube cadence gate).
  // exclusive (cron rule): prevents a slow scan from racing the next tick.
  [JOB_NAMES.SNAPSHOT_SCHEDULER]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },
  // Stale-snapshot reaper: hourly cron, single bounded DELETE, idempotent.
  // exclusive (cron rule).
  [JOB_NAMES.SNAPSHOT_STALE_CHECK]: {
    retryLimit: 1,
    expireInSeconds: 300,
    policy: "exclusive",
  },
  // Daily auto-prune cron: per-cube `restic forget` with the plan's
  // retention buckets. Sequential per-cube SSH; bounded by a generous
  // 60 min budget. exclusive (cron rule).
  [JOB_NAMES.SNAPSHOT_AUTO_PRUNE]: {
    retryLimit: 1,
    expireInSeconds: 3600,
    policy: "exclusive",
  },
  // Snapshot export: materialize + zstd + tar + upload + presign + email.
  // Long-running for multi-GB rootfs; one in flight per snapshot via the
  // server action's pending-row pre-check. retryLimit=1 because resuming
  // a half-uploaded `.cube` is fragile — better to surface the failure.
  [JOB_NAMES.SNAPSHOT_EXPORT]: {
    retryLimit: 1,
    retryDelay: 120,
    expireInSeconds: 3600,
    policy: "exclusive",
  },
  // Hourly export reaper. exclusive (cron rule).
  [JOB_NAMES.SNAPSHOT_EXPORT_REAP]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },
  // Promote snapshot to backup: same restic-dump pipeline as export, but
  // writes to backups prefix and updates a `cube_backups` row.
  [JOB_NAMES.SNAPSHOT_PROMOTE_TO_BACKUP]: {
    retryLimit: 1,
    retryDelay: 120,
    expireInSeconds: 3600,
    policy: "exclusive",
  },
  // Clone snapshot into a new cube: allocate, restic-dump to destination
  // server, boot. Long-running. retryLimit=1 — the new cube is in
  // `pending` and a half-restored rootfs is unsafe to retry blindly.
  [JOB_NAMES.CUBE_FROM_SNAPSHOT]: {
    retryLimit: 1,
    retryDelay: 120,
    expireInSeconds: 3600,
  },

  // Backup jobs: retryLimit 2, retryDelay 120s, expire in 60 min
  [JOB_NAMES.BACKUP_CREATE]: {
    retryLimit: 2,
    retryDelay: 120,
    expireInSeconds: 3600,
  },
  [JOB_NAMES.BACKUP_DELETE]: {
    retryLimit: 2,
    retryDelay: 120,
    expireInSeconds: 3600,
  },
  // Hourly cron: flip cube_backups rows stranded in `creating` with no upload
  // to `failed` (frees the burned maxBackups slot). Pure DB sweep — exclusive
  // so a slow tick can't overlap the next (recurring-queue rule).
  [JOB_NAMES.BACKUP_STALE_CHECK]: {
    retryLimit: 1,
    expireInSeconds: 300,
    policy: "exclusive",
  },
  [JOB_NAMES.BACKUP_REDEPLOY]: {
    retryLimit: 2,
    retryDelay: 120,
    expireInSeconds: 3600,
  },

  // Billing crons: retryLimit 3 (safe due to prorated elapsed-time billing),
  // retryDelay 120s, expire in 30 min. ALL recurring/cron queues use
  // `policy: "exclusive"` so the next tick is REJECTED at enqueue time if
  // the previous run is still active. pg-boss's scheduler automatically
  // provides a fixed singletonKey (`${queueName}__`), so exclusive +
  // singletonKey pairs to enforce one-in-flight-at-a-time across the
  // entire fleet. See the queue-policy block at the top of this file.
  [JOB_NAMES.BILLING_HOURLY]: {
    retryLimit: 3,
    retryDelay: 120,
    expireInSeconds: 1800,
    policy: "exclusive",
  },
  [JOB_NAMES.BILLING_TOPUP_RECONCILE]: {
    retryLimit: 3,
    retryDelay: 120,
    expireInSeconds: 1800,
    policy: "exclusive",
  },
  [JOB_NAMES.SUBSCRIPTION_RECONCILE]: {
    retryLimit: 3,
    retryDelay: 120,
    expireInSeconds: 1800,
    policy: "exclusive",
  },
  [JOB_NAMES.POLAR_METER_RECONCILE]: {
    retryLimit: 3,
    retryDelay: 120,
    expireInSeconds: 1800,
    policy: "exclusive",
  },

  // Cleanup jobs: retryLimit 3, retryDelay 60s, expire in 30 min
  [JOB_NAMES.STORAGE_CLEANUP]: {
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 1800,
  },

  // Space deletion: orchestrates cube deletion + storage cleanup, then drops
  // the space row. The job re-enqueues itself (bounded by the payload
  // `attempt` counter) while cubes are still being deleted, so it relies on
  // that loop rather than pg-boss retries — retryLimit covers genuine errors.
  // policy=exclusive + singletonKey=spaceId in the API route: prevents a
  // double-click on Delete from queuing two parallel deletes that would race
  // on the same cube rows.
  [JOB_NAMES.SPACE_DELETE]: {
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 1800,
    policy: "exclusive",
  },

  // Email: the `email_outbox` row state machine owns retries (the handler
  // transitions `queued → sending → sent|queued|failed` atomically per
  // attempt). pg-boss only triggers the next attempt, never the decision
  // to retry. Keeping pg-boss `retryLimit > 0` here would race the
  // handler's state machine and re-fire jobs after the row already
  // moved to `failed`. `retryLimit: 0` makes pg-boss treat each enqueue
  // as one-shot; the handler itself re-enqueues a new job (with a fresh
  // pg-boss job id) when it transitions `sending → queued` on a
  // retryable failure. expireInSeconds bounds the time the row can sit
  // in `sending` before the email.outbox-reap cron sweeps it.
  [JOB_NAMES.EMAIL_SEND]: { retryLimit: 0, expireInSeconds: 600 },

  // EmailIt contact sync: external API; retry a few times on transient
  // failures (rate limit / network) with a longer backoff. policy=exclusive
  // + singletonKey=`emailit-sync:${userId}` at the enqueue site collapses
  // back-to-back triggers for the same user (e.g. a customer mutating cubes
  // rapidly) into a single in-flight upsert — without it every trigger
  // fires its own job and burns an EmailIt API request.
  [JOB_NAMES.EMAILIT_SYNC_CONTACT]: {
    retryLimit: 3,
    retryDelay: 120,
    policy: "exclusive",
  },
  // EmailIt contact DELETE: external API, fired from 3 sites (space delete,
  // user delete, admin user-delete). Standard policy (NOT exclusive) on
  // purpose — there is no per-site singletonKey, and exclusive without one
  // would serialize EVERY contact delete fleet-wide. The handler is
  // idempotent: deleting an already-removed EmailIt contact 404s harmlessly,
  // so a duplicate from two paths is safe. retryLimit 3 covers transient
  // rate-limit / network failures.
  [JOB_NAMES.EMAILIT_DELETE_CONTACT]: {
    retryLimit: 3,
    retryDelay: 120,
  },

  // Outbound webhook delivery: 4 retries at 60s spacing (= 5 total attempts).
  // Documented in docs/api/v1.md. Retry config lives here (queue-level) per
  // the project convention — the dispatcher just enqueues, never sets retry
  // options per-job. Parallel deliveries across endpoints are desirable, so
  // no `policy: "exclusive"` — each delivery row is independent.
  [JOB_NAMES.OUTBOUND_WEBHOOK_DELIVER]: {
    retryLimit: 4,
    retryDelay: 60,
  },

  // Server setup phases: NO auto-retry (operator must explicitly retry from UI
  // after fixing the underlying problem). Long expiry to allow image pulls.
  [JOB_NAMES.SERVER_BOOTSTRAP]: { retryLimit: 0, expireInSeconds: 1800 },
  [JOB_NAMES.SERVER_INSTALL]: { retryLimit: 0, expireInSeconds: 3600 },
  [JOB_NAMES.SERVER_PULL_IMAGES]: { retryLimit: 0, expireInSeconds: 3600 },
  [JOB_NAMES.SERVER_NETWORK]: { retryLimit: 0, expireInSeconds: 1800 },
  // Reboot phase polls for the host to drop + return (up to ~10 min), so it
  // needs a longer expiry. retryLimit 0 — the operator retries from the UI.
  [JOB_NAMES.SERVER_REBOOT]: { retryLimit: 0, expireInSeconds: 1200 },
  [JOB_NAMES.SERVER_VERIFY]: { retryLimit: 0, expireInSeconds: 600 },

  // Image refresh: SFTP all platform_images onto an active server. Same
  // budget as pull-images phase since it does the same work.
  // policy=exclusive + singletonKey=`update-images:${serverId}` (set at the
  // route) — mirrors update-caddy/refresh-caddy/refresh-hardware. Without it a
  // double-click queues two concurrent image SFTPs racing on the same files in
  // /var/lib/krova/images (2026-05-31 double-fire audit).
  [JOB_NAMES.SERVER_UPDATE_IMAGES]: {
    retryLimit: 0,
    expireInSeconds: 3600,
    policy: "exclusive",
  },

  // Caddy reconcile: atomic routes/automation rebuild. NO auto-retry —
  // operator-initiated, idempotent; the operator re-runs from the UI after
  // investigating a failure. 30 min budget covers a slow SSH round-trip.
  // policy=exclusive + singletonKey=`refresh-caddy:${serverId}` protects
  // against operator double-clicks queueing two reconciles for the same
  // server that would race on the Caddy Admin API.
  [JOB_NAMES.SERVER_REFRESH_CADDY]: {
    retryLimit: 0,
    expireInSeconds: 1800,
    policy: "exclusive",
  },

  // Caddy package upgrade: apt/dnf upgrade + restart. NO auto-retry —
  // operator-initiated and idempotent; the operator re-runs from the UI
  // after investigating a failure. 30 min budget covers a slow apt-get
  // update + install. policy=exclusive +
  // singletonKey=`update-caddy:${serverId}` protects against operator
  // double-clicks queueing two upgrades that would race on dpkg/apt.
  [JOB_NAMES.SERVER_UPDATE_CADDY]: {
    retryLimit: 0,
    expireInSeconds: 1800,
    policy: "exclusive",
  },

  // Hardware refresh: 3 read-only SSH commands (nproc, /proc/meminfo,
  // df). Idempotent. NO auto-retry — operator-initiated, the operator
  // re-runs from the UI after investigating a failure. 5 min budget is
  // generous for three sub-second probes plus SSH handshake. exclusive +
  // singletonKey=`refresh-hardware:${serverId}` protects against operator
  // double-clicks queueing two refreshes for the same server.
  [JOB_NAMES.SERVER_REFRESH_HARDWARE]: {
    retryLimit: 0,
    expireInSeconds: 300,
    policy: "exclusive",
  },

  // Reboot recovery: SSH-driven restart of cubes after a host reboot.
  // retryLimit=1 lets a single transient SSH failure retry automatically;
  // idempotency gate (lastBootId) makes re-runs safe. policy=exclusive +
  // singletonKey=serverId prevents the krova-boot-notify POST + every
  // cube.state-sync tick during a long recovery from each enqueuing their
  // own duplicate recovery — only ONE in-flight or queued per server.
  [JOB_NAMES.SERVER_REBOOT_RECOVERY]: {
    retryLimit: 1,
    expireInSeconds: 1800,
    policy: "exclusive",
  },

  // job-logs prune: idempotent + recurring; safe to retry. exclusive (cron).
  [JOB_NAMES.JOB_LOGS_PRUNE]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },

  // Setup reaper: periodic, idempotent, fast. exclusive (cron).
  [JOB_NAMES.SETUP_REAPER]: {
    retryLimit: 1,
    expireInSeconds: 300,
    policy: "exclusive",
  },

  // Cube reachability poll: per-server SSH-batched vsock ping + nc-z + metrics
  // for every running cube, once a minute. Pure observer — never transitions
  // state. Single retry covers a transient SSH hiccup; the next tick re-tries
  // any cube the worker skipped anyway. 90s budget covers a slow tick on the
  // largest current server (~30 cubes) with headroom. exclusive (cron) keeps
  // a slow tick that bleeds past the 1-min interval from racing the next one.
  [JOB_NAMES.CUBE_REACHABILITY]: {
    retryLimit: 1,
    expireInSeconds: 90,
    policy: "exclusive",
  },

  // Browser terminal bridge: long-lived interactive shell session.
  // retryLimit=0 — never auto-retry. If the bridge errors mid-session the
  // customer reconnects from the browser (a new session_id is minted),
  // because resuming an in-flight PTY stream is impossible across worker
  // restarts. The handler's own teardown logic owns the lifecycle. Expiry
  // is the platform's hard-timeout ceiling plus a 5-min safety margin.
  // policy=exclusive + singletonKey=sessionId is belt-and-suspenders
  // alongside retryLimit=0 and the handler's atomic `pending → running`
  // row claim: any duplicate enqueue for the same session is rejected by
  // pg-boss before it can race the in-handler claim.
  [JOB_NAMES.CUBE_TERMINAL_BRIDGE]: {
    retryLimit: 0,
    expireInSeconds: TERMINAL_BRIDGE_EXPIRE_SECONDS,
    policy: "exclusive",
  },

  // Terminal session reaper: periodic cleanup of cube_terminal_sessions
  // rows orphaned by worker SIGKILL (OOM, hard restart). Idempotent
  // pure-DB sweep; runs in seconds. retryLimit=1 is enough; expiry short.
  // exclusive (cron).
  [JOB_NAMES.TERMINAL_SESSION_REAPER]: {
    retryLimit: 1,
    expireInSeconds: 300,
    policy: "exclusive",
  },

  // Weekly security scan: notify-only, network calls to GitHub + npm + kernel.org.
  // retryLimit=1 because a single transient outage shouldn't double-email admins;
  // worst case the operator misses one Monday and gets the next week's digest.
  // exclusive (cron).
  [JOB_NAMES.SECURITY_WEEKLY_SCAN]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },

  // Weekly refresh of the `disposable_email_domains` blocklist from
  // upstream (fetch + TRUNCATE + bulk INSERT in one tx, all-or-nothing).
  // retryLimit=0 — a transient upstream blip is fine to skip; the next
  // weekly tick heals it, and the operator can run the manual
  // `pnpm refresh:disposable-emails` script in between if needed.
  // 5 min budget is generous for a ~5,500-row replacement; the actual
  // work runs in ~1 s. exclusive (cron) per the platform rule.
  [JOB_NAMES.DISPOSABLE_EMAILS_REFRESH]: {
    retryLimit: 0,
    expireInSeconds: 300,
    policy: "exclusive",
  },
  // Domain-claim recheck: daily, idempotent, re-resolves each verified claim's
  // TXT. exclusive (cron rule); retryLimit 1 — a transient failure self-heals
  // on the next day's tick (and the 3-strike counter tolerates blips anyway).
  [JOB_NAMES.DOMAIN_CLAIM_RECHECK]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },

  // Restic prune sweep: SSH-driven `restic prune` over EVERY cube with a
  // snapshot repo (~40 today, growing). Each prune holds an exclusive repo
  // lock and can take 30s–2min depending on repo size + chunk churn.
  // No auto-retry — a per-cube failure is already isolated inside the handler,
  // and the natural retry is next Sunday. 4-hour budget covers a large fleet
  // with headroom for slow S3 backends. exclusive (cron) is critical here:
  // a weekly sweep that bleeds past 7 days would otherwise double-run.
  [JOB_NAMES.RESTIC_PRUNE]: {
    retryLimit: 0,
    expireInSeconds: 14_400,
    policy: "exclusive",
  },

  // Restic check sweep: `restic check --read-data-subset=2%` over every cube.
  // Reads + verifies 2% of every cube's repo over the network. Same
  // characteristics as RESTIC_PRUNE — no auto-retry, 4-hour budget. Integrity
  // failures email admins per-cube; the next week's run retries naturally.
  // exclusive (cron) same reasoning as RESTIC_PRUNE.
  [JOB_NAMES.RESTIC_CHECK]: {
    retryLimit: 0,
    expireInSeconds: 14_400,
    policy: "exclusive",
  },

  // Cube import: download a multi-GB `.cube` from S3, extract, decompress,
  // mount + inject SSH key, boot. retryLimit=1 because the rootfs path is
  // partially destructive (the prior failed attempt's rootfs is wiped at
  // the start of every retry) and a runaway loop on a stubborn failure
  // wastes the customer's upload — operator investigates after one retry.
  // 2-hour budget covers ~50 GB archives on a same-region S3 backend.
  [JOB_NAMES.CUBE_IMPORT_ROOTFS]: {
    retryLimit: 1,
    retryDelay: 120,
    expireInSeconds: 7200,
  },

  // Cube imports reaper: idempotent + periodic; safe to retry once on a
  // transient S3 / DB hiccup. exclusive (cron).
  [JOB_NAMES.CUBE_IMPORTS_REAPER]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },

  // ─── Cron queues with NO explicit prior config (defaults to `standard`
  //     policy, which allows next tick to enqueue while the previous run is
  //     still active). Added here purely to set `policy: "exclusive"` so
  //     recurring jobs cannot stack. Retry/expire budgets sized for each
  //     handler's typical runtime.

  // cube.stale-check (every 5 min). Pure DB sweep + occasional
  // backup.create enqueue. Fast. exclusive prevents two ticks racing on
  // the same "stuck" cube row.
  [JOB_NAMES.CUBE_STALE_CHECK]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },

  // cube.state-sync (every 2 min). Per-server SSH-batched
  // getCubeStatus + reboot-recovery enqueue + (now) clean-exit detection.
  // A slow tick over many servers can approach the 2-min interval;
  // exclusive prevents stacking.
  [JOB_NAMES.CUBE_STATE_SYNC]: {
    retryLimit: 1,
    expireInSeconds: 300,
    policy: "exclusive",
  },

  // server.reconcile (every 10 min). SSH per server, lists /var/lib/krova/cubes,
  // emails admins about orphans. Idempotent. exclusive (cron).
  [JOB_NAMES.SERVER_RECONCILE]: {
    retryLimit: 1,
    expireInSeconds: 900,
    policy: "exclusive",
  },

  // server.measure-disk (hourly at :40). SSH per server, measures real disk
  // overhead (df_used − du(cubes)) so the allocator caps reservations at the
  // effective capacity (totalDiskGb − overhead). Pure observer. Idempotent.
  // exclusive (cron).
  [JOB_NAMES.SERVER_MEASURE_DISK]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },

  // host.mount-reaper (every 10 min offset). SSH per server, sweeps stale
  // /tmp/krova-mount-* loop mounts. Idempotent. exclusive (cron).
  [JOB_NAMES.HOST_MOUNT_REAPER]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },

  // storage.health-check (every 30 min). Probes each active backend's
  // free capacity, emails admins on low-space. Idempotent. exclusive (cron).
  [JOB_NAMES.STORAGE_HEALTH_CHECK]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },

  // email.events-prune-cron (daily 03:20 UTC). Deletes email_events older
  // than 90 days. Idempotent. exclusive (cron).
  [JOB_NAMES.EMAIL_EVENTS_PRUNE_CRON]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },

  // email.outbox-reap (every 15 min). Sweeps stuck `sending` outbox rows
  // past 10-min grace into `failed`. Idempotent. exclusive (cron).
  [JOB_NAMES.EMAIL_OUTBOX_REAP]: {
    retryLimit: 1,
    expireInSeconds: 600,
    policy: "exclusive",
  },
};

const JOB_QUEUES: JobName[] = Object.values(JOB_NAMES);

function isQueueAlreadyExistsError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  const message = err.message.toLowerCase();
  return (
    message.includes("already exists") || message.includes("duplicate key")
  );
}

export async function ensureJobQueues(boss: PgBoss): Promise<void> {
  for (const queue of JOB_QUEUES) {
    try {
      const opts = QUEUE_OPTIONS[queue];
      await boss.createQueue(queue, opts);
    } catch (err) {
      if (!isQueueAlreadyExistsError(err)) {
        throw err;
      }
    }
  }

  // Migrate the policy of every queue whose desired policy differs from
  // what's currently in `pgboss.queue`. Necessary because pg-boss v12's
  // `updateQueue` API explicitly forbids changing `policy`
  // (`UpdateQueueOptions = Omit<Queue, 'name' | 'partition' | 'policy'>`)
  // and `createQueue` no-ops on an existing queue, so without this any
  // queue that was created BEFORE we added `policy: "exclusive"` would
  // silently keep its old `standard` policy and our `singletonKey` dedup
  // would do nothing. pg-boss reads the queue's policy via JOIN at every
  // `send()` (`plans.js` line ~960) and writes it onto the job row, where
  // the partial unique indexes fire — so flipping the queue's policy
  // column takes effect for every subsequent enqueue without dropping any
  // pending jobs (existing rows keep their old `policy` value and finish
  // under the old indexes; new rows get the new one).
  for (const queue of JOB_QUEUES) {
    const desired = QUEUE_OPTIONS[queue]?.policy;
    if (!desired) {
      continue;
    }
    await db.execute(sql`
      UPDATE pgboss.queue
      SET policy = ${desired}, updated_on = now()
      WHERE name = ${queue} AND policy IS DISTINCT FROM ${desired}
    `);
  }
}
