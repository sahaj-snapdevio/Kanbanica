import { type Job, PgBoss } from "pg-boss";
import { DISK_IO_STORAGE_TUNING_ENABLED } from "@/config/platform";
import { env } from "@/lib/env";
import { normalizePgConnectionString } from "@/lib/pg-connection";
import { sleep } from "@/lib/utils";
import { ensureJobQueues } from "@/lib/worker/ensure-queues";
import { JOB_NAMES } from "@/lib/worker/job-types";
import { withDeadLetterMonitoring } from "@/lib/worker/monitor";

const boss = new PgBoss(normalizePgConnectionString(env.DATABASE_URL));

export { boss };

/**
 * Register a handler wrapped with dead-letter monitoring.
 *
 * MUST pass `{ includeMetadata: true }` so pg-boss delivers `JobWithMetadata`
 * (the ONLY shape carrying `retryCount` / `retryLimit` in v12) — without it the
 * wrapper can't tell a transient first-attempt failure from a genuinely
 * exhausted one and mislabels every blip a "permanent failure". See monitor.ts.
 */
function workMonitored<T>(
  name: string,
  handler: (jobs: Job<T>[]) => Promise<void>
): Promise<string> {
  return boss.work<T>(
    name,
    { includeMetadata: true },
    withDeadLetterMonitoring(name, handler)
  );
}

let initialized = false;

async function initializeBossInfrastructure(): Promise<void> {
  if (initialized) {
    return;
  }

  boss.on("error", (error) => {
    console.error("[worker] pg-boss error", error);
  });

  await ensureJobQueues(boss);
  initialized = true;
}

/** Start pg-boss with retry logic for database connection failures. */
async function startBossWithRetry(maxRetries = 10): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await boss.start();
      console.log("[worker] pg-boss started");
      return;
    } catch (err) {
      console.error(
        `[worker] pg-boss start failed (attempt ${attempt}/${maxRetries}):`,
        err instanceof Error ? err.message : err
      );
      if (attempt === maxRetries) {
        throw new Error(`pg-boss failed to start after ${maxRetries} attempts`);
      }
      const delay = Math.min(2000 * 2 ** (attempt - 1), 30_000);
      console.log(`[worker] retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
}

export async function startWorker(): Promise<void> {
  await startBossWithRetry();

  await initializeBossInfrastructure();

  // Import handlers
  const { handleCubeProvision } = await import(
    "@/lib/worker/handlers/cube-provision"
  );
  const { handleCubeDelete } = await import(
    "@/lib/worker/handlers/cube-delete"
  );
  const { handleCubeSleep } = await import("@/lib/worker/handlers/cube-sleep");
  const { handleCubePowerOff } = await import(
    "@/lib/worker/handlers/cube-power-off"
  );
  const { handleCubeWake } = await import("@/lib/worker/handlers/cube-wake");
  const { handleCubeColdRestart } = await import(
    "@/lib/worker/handlers/cube-cold-restart"
  );
  const { handleCubeAutoRelaunch } = await import(
    "@/lib/worker/handlers/cube-auto-relaunch"
  );
  const { handleCubeErrorRecovery } = await import(
    "@/lib/worker/handlers/cube-error-recovery"
  );
  const { handleCubeErrorRecoveryScan } = await import(
    "@/lib/worker/handlers/cube-error-recovery-scan"
  );
  const { handleCubeTransfer } = await import(
    "@/lib/worker/handlers/cube-transfer"
  );
  const { handleCubeTransferCancel } = await import(
    "@/lib/worker/handlers/cube-transfer-cancel"
  );
  const { handleCubeResize } = await import(
    "@/lib/worker/handlers/cube-resize"
  );
  const { handleDomainAdd } = await import("@/lib/worker/handlers/domain-add");
  const { handleCloudflareHostnamePoll } = await import(
    "@/lib/worker/handlers/cloudflare-hostname-poll"
  );
  const { handleDomainRemove } = await import(
    "@/lib/worker/handlers/domain-remove"
  );
  const { handleDomainPurgeCache } = await import(
    "@/lib/worker/handlers/domain-purge-cache"
  );
  const { handleBillingHourly } = await import(
    "@/lib/worker/handlers/billing-hourly"
  );
  const { handleBillingTopupReconcile } = await import(
    "@/lib/worker/handlers/billing-topup-reconcile"
  );
  const { handleSubscriptionReconcile } = await import(
    "@/lib/worker/handlers/subscription-reconcile"
  );
  const { handlePolarMeterReconcile } = await import(
    "@/lib/worker/handlers/polar-meter-reconcile"
  );
  const { handleEmailSend } = await import("@/lib/worker/handlers/email-send");
  const { handleTcpMappingAdd } = await import(
    "@/lib/worker/handlers/tcp-mapping-add"
  );
  const { handleTcpMappingRemove } = await import(
    "@/lib/worker/handlers/tcp-mapping-remove"
  );
  const { handleTcpMappingUpdateWhitelist } = await import(
    "@/lib/worker/handlers/tcp-mapping-update-whitelist"
  );
  const { handleTcpMappingUpdateCubePort } = await import(
    "@/lib/worker/handlers/tcp-mapping-update-cube-port"
  );
  const { handleTcpMappingDisable } = await import(
    "@/lib/worker/handlers/tcp-mapping-disable"
  );
  const { handleTcpMappingEnable } = await import(
    "@/lib/worker/handlers/tcp-mapping-enable"
  );
  const { handleCubeStaleCheck } = await import(
    "@/lib/worker/handlers/cube-stale-check"
  );
  const { handleCubeStateSync } = await import(
    "@/lib/worker/handlers/cube-state-sync"
  );
  const { handleCubeReachability } = await import(
    "@/lib/worker/handlers/cube-reachability"
  );
  const { handleCubeTerminalBridge } = await import(
    "@/lib/worker/handlers/cube-terminal-bridge"
  );
  const { handleTerminalSessionReaper } = await import(
    "@/lib/worker/handlers/terminal-session-reaper"
  );
  const { handleServerReconcile } = await import(
    "@/lib/worker/handlers/server-reconcile"
  );
  const { handleServerMeasureDisk } = await import(
    "@/lib/worker/handlers/server-measure-disk"
  );
  const { handleHostMountReaper } = await import(
    "@/lib/worker/handlers/host-mount-reaper"
  );
  const { handleSnapshotCreate } = await import(
    "@/lib/worker/handlers/snapshot-create"
  );
  const { handleSnapshotRestore } = await import(
    "@/lib/worker/handlers/snapshot-restore"
  );
  const { handleSnapshotDelete } = await import(
    "@/lib/worker/handlers/snapshot-delete"
  );
  const { handleSnapshotScheduler } = await import(
    "@/lib/worker/handlers/snapshot-scheduler"
  );
  const { handleSnapshotStaleCheck } = await import(
    "@/lib/worker/handlers/snapshot-stale-check"
  );
  const { handleBackupStaleCheck } = await import(
    "@/lib/worker/handlers/backup-stale-check"
  );
  const { handleSnapshotAutoPrune } = await import(
    "@/lib/worker/handlers/snapshot-auto-prune"
  );
  const { handleSnapshotExport } = await import(
    "@/lib/worker/handlers/snapshot-export"
  );
  const { handleSnapshotExportReap } = await import(
    "@/lib/worker/handlers/snapshot-export-reap"
  );
  const { handleCubeFromSnapshot } = await import(
    "@/lib/worker/handlers/cube-from-snapshot"
  );
  const { handleSnapshotPromoteToBackup } = await import(
    "@/lib/worker/handlers/snapshot-promote-to-backup"
  );
  const { handleBackupCreate } = await import(
    "@/lib/worker/handlers/backup-create"
  );
  const { handleBackupDelete } = await import(
    "@/lib/worker/handlers/backup-delete"
  );
  const { handleBackupRedeploy } = await import(
    "@/lib/worker/handlers/backup-redeploy"
  );
  const { handleCubeImportRootfs } = await import(
    "@/lib/worker/handlers/cube-import-rootfs"
  );
  const { handleCubeImportsReaper } = await import(
    "@/lib/worker/handlers/cube-imports-reaper"
  );
  const { handleStorageCleanup } = await import(
    "@/lib/worker/handlers/storage-cleanup"
  );
  const { handleSpaceDelete } = await import(
    "@/lib/worker/handlers/space-delete"
  );
  const { handleStorageHealthCheck } = await import(
    "@/lib/worker/handlers/storage-health-check"
  );
  const { handleServerBootstrap } = await import(
    "@/lib/worker/handlers/server-bootstrap"
  );
  const { handleServerInstall } = await import(
    "@/lib/worker/handlers/server-install"
  );
  const { handleServerPullImages } = await import(
    "@/lib/worker/handlers/server-pull-images"
  );
  const { handleServerNetwork } = await import(
    "@/lib/worker/handlers/server-network"
  );
  const { handleServerReboot } = await import(
    "@/lib/worker/handlers/server-reboot"
  );
  const { handleServerVerify } = await import(
    "@/lib/worker/handlers/server-verify"
  );
  const { handleServerUpdateImages } = await import(
    "@/lib/worker/handlers/server-update-images"
  );
  const { handleServerRefreshCaddy } = await import(
    "@/lib/worker/handlers/server-refresh-caddy"
  );
  const { handleServerUpdateCaddy } = await import(
    "@/lib/worker/handlers/server-update-caddy"
  );
  const { handleServerRefreshHardware } = await import(
    "@/lib/worker/handlers/server-refresh-hardware"
  );
  const { handleServerRebootRecovery } = await import(
    "@/lib/worker/handlers/server-reboot-recovery"
  );
  const { handleJobLogsPrune } = await import(
    "@/lib/worker/handlers/job-logs-prune"
  );
  const { handleSetupReaper } = await import(
    "@/lib/worker/handlers/setup-reaper"
  );
  const { handleSecurityWeeklyScan } = await import(
    "@/lib/worker/handlers/security-weekly-scan"
  );

  // Register all job handlers (critical queues wrapped with dead-letter monitoring)
  await workMonitored(JOB_NAMES.CUBE_PROVISION, handleCubeProvision);
  await workMonitored(JOB_NAMES.CUBE_DELETE, handleCubeDelete);
  await workMonitored(JOB_NAMES.CUBE_SLEEP, handleCubeSleep);
  await workMonitored(JOB_NAMES.CUBE_POWER_OFF, handleCubePowerOff);
  await workMonitored(JOB_NAMES.CUBE_WAKE, handleCubeWake);
  await workMonitored(JOB_NAMES.CUBE_COLD_RESTART, handleCubeColdRestart);
  await workMonitored(JOB_NAMES.CUBE_AUTO_RELAUNCH, handleCubeAutoRelaunch);
  await workMonitored(JOB_NAMES.CUBE_ERROR_RECOVERY, handleCubeErrorRecovery);
  await boss.work(JOB_NAMES.CUBE_ERROR_RECOVERY_SCAN, async () => {
    await handleCubeErrorRecoveryScan();
  });
  await workMonitored(JOB_NAMES.CUBE_TRANSFER, handleCubeTransfer);
  await workMonitored(JOB_NAMES.CUBE_TRANSFER_CANCEL, handleCubeTransferCancel);
  await workMonitored(JOB_NAMES.CUBE_RESIZE, handleCubeResize);
  await boss.work(
    JOB_NAMES.DOMAIN_ADD,
    { includeMetadata: true },
    handleDomainAdd
  );
  await boss.work(
    JOB_NAMES.DOMAIN_REMOVE,
    { includeMetadata: true },
    handleDomainRemove
  );
  await boss.work(
    JOB_NAMES.DOMAIN_PURGE_CACHE,
    { includeMetadata: true },
    handleDomainPurgeCache
  );
  await boss.work(JOB_NAMES.CLOUDFLARE_HOSTNAME_POLL, async () => {
    await handleCloudflareHostnamePoll();
  });
  await boss.work(JOB_NAMES.TCP_MAPPING_ADD, handleTcpMappingAdd);
  await boss.work(JOB_NAMES.TCP_MAPPING_REMOVE, handleTcpMappingRemove);
  await boss.work(
    JOB_NAMES.TCP_MAPPING_UPDATE_WHITELIST,
    handleTcpMappingUpdateWhitelist
  );
  await boss.work(
    JOB_NAMES.TCP_MAPPING_UPDATE_CUBE_PORT,
    { includeMetadata: true },
    handleTcpMappingUpdateCubePort
  );
  await boss.work(JOB_NAMES.TCP_MAPPING_DISABLE, handleTcpMappingDisable);
  await boss.work(JOB_NAMES.TCP_MAPPING_ENABLE, handleTcpMappingEnable);
  await boss.work(JOB_NAMES.SNAPSHOT_CREATE, handleSnapshotCreate);
  await boss.work(JOB_NAMES.SNAPSHOT_RESTORE, handleSnapshotRestore);
  await boss.work(JOB_NAMES.SNAPSHOT_DELETE, handleSnapshotDelete);
  await boss.work(JOB_NAMES.SNAPSHOT_SCHEDULER, handleSnapshotScheduler);
  await boss.work(JOB_NAMES.SNAPSHOT_STALE_CHECK, async () => {
    await handleSnapshotStaleCheck();
  });
  await boss.work(JOB_NAMES.BACKUP_STALE_CHECK, async () => {
    await handleBackupStaleCheck();
  });
  await boss.work(JOB_NAMES.SNAPSHOT_AUTO_PRUNE, handleSnapshotAutoPrune);
  await boss.work(JOB_NAMES.SNAPSHOT_EXPORT, handleSnapshotExport);
  await boss.work(JOB_NAMES.SNAPSHOT_EXPORT_REAP, handleSnapshotExportReap);
  await boss.work(JOB_NAMES.CUBE_FROM_SNAPSHOT, handleCubeFromSnapshot);
  await boss.work(
    JOB_NAMES.SNAPSHOT_PROMOTE_TO_BACKUP,
    handleSnapshotPromoteToBackup
  );
  await workMonitored(JOB_NAMES.BACKUP_CREATE, handleBackupCreate);
  await workMonitored(JOB_NAMES.BACKUP_DELETE, handleBackupDelete);
  await workMonitored(JOB_NAMES.BACKUP_REDEPLOY, handleBackupRedeploy);
  await workMonitored(JOB_NAMES.CUBE_IMPORT_ROOTFS, handleCubeImportRootfs);
  await boss.work(JOB_NAMES.CUBE_IMPORTS_REAPER, async () => {
    await handleCubeImportsReaper();
  });
  await boss.work(JOB_NAMES.STORAGE_CLEANUP, handleStorageCleanup);
  await workMonitored(JOB_NAMES.SPACE_DELETE, handleSpaceDelete);
  await boss.work(JOB_NAMES.STORAGE_HEALTH_CHECK, async () => {
    await handleStorageHealthCheck();
  });
  await workMonitored(JOB_NAMES.BILLING_HOURLY, handleBillingHourly);
  await boss.work(JOB_NAMES.BILLING_TOPUP_RECONCILE, async () => {
    await handleBillingTopupReconcile([]);
  });
  await boss.work(JOB_NAMES.SUBSCRIPTION_RECONCILE, async () => {
    await handleSubscriptionReconcile([]);
  });
  await boss.work(JOB_NAMES.POLAR_METER_RECONCILE, async () => {
    await handlePolarMeterReconcile([]);
  });
  await boss.work(JOB_NAMES.EMAIL_SEND, handleEmailSend);
  await boss.work(JOB_NAMES.CUBE_STALE_CHECK, async () => {
    await handleCubeStaleCheck();
  });
  await boss.work(JOB_NAMES.CUBE_STATE_SYNC, async () => {
    await handleCubeStateSync();
  });
  await boss.work(JOB_NAMES.CUBE_REACHABILITY, async () => {
    await handleCubeReachability();
  });
  // EXCEPTION to the global `localConcurrency: 1` rule. Terminal bridges
  // are long-lived (up to 4h hard timeout), interactive, customer-facing,
  // and fully isolated per-session: each bridge owns its own SSH client,
  // its own Pusher subscriber, and its own PTY stream — there is no
  // cross-bridge state inside the worker process. With the default
  // localConcurrency=1, one in-flight bridge would block every other
  // customer's terminal across the entire fleet for hours; sessions queued
  // behind it would see "Connected" in the browser but no shell output
  // (the bridge job is queued in pg-boss, never runs) and eventually
  // teardown with "browser_did_not_join_within_30s" once the bridge does
  // get a slot (the browser-side subscription is stale by then).
  //
  // 50 concurrent terminals per worker replica is generous and well
  // within the SSH-connection + Pusher-subscriber budget. Scale by
  // adding worker replicas if a single replica saturates.
  await boss.work(
    JOB_NAMES.CUBE_TERMINAL_BRIDGE,
    { localConcurrency: 50 },
    handleCubeTerminalBridge
  );
  await boss.work(JOB_NAMES.TERMINAL_SESSION_REAPER, async () => {
    await handleTerminalSessionReaper();
  });
  await boss.work(JOB_NAMES.SERVER_RECONCILE, async () => {
    await handleServerReconcile();
  });
  await boss.work(JOB_NAMES.SERVER_MEASURE_DISK, async () => {
    await handleServerMeasureDisk();
  });
  await boss.work(JOB_NAMES.HOST_MOUNT_REAPER, async () => {
    await handleHostMountReaper();
  });
  await boss.work(JOB_NAMES.SERVER_BOOTSTRAP, handleServerBootstrap);
  await boss.work(JOB_NAMES.SERVER_INSTALL, handleServerInstall);
  await boss.work(JOB_NAMES.SERVER_PULL_IMAGES, handleServerPullImages);
  await boss.work(JOB_NAMES.SERVER_NETWORK, handleServerNetwork);
  await boss.work(JOB_NAMES.SERVER_REBOOT, handleServerReboot);
  await boss.work(JOB_NAMES.SERVER_VERIFY, handleServerVerify);
  await boss.work(JOB_NAMES.SERVER_UPDATE_IMAGES, handleServerUpdateImages);
  await boss.work(JOB_NAMES.SERVER_REFRESH_CADDY, handleServerRefreshCaddy);
  await boss.work(JOB_NAMES.SERVER_UPDATE_CADDY, handleServerUpdateCaddy);
  await boss.work(
    JOB_NAMES.SERVER_REFRESH_HARDWARE,
    handleServerRefreshHardware
  );
  await boss.work(JOB_NAMES.SERVER_REBOOT_RECOVERY, handleServerRebootRecovery);
  await boss.work(JOB_NAMES.JOB_LOGS_PRUNE, async () => {
    await handleJobLogsPrune();
  });
  await boss.work(JOB_NAMES.SETUP_REAPER, async () => {
    await handleSetupReaper();
  });
  await boss.work(JOB_NAMES.SECURITY_WEEKLY_SCAN, async () => {
    await handleSecurityWeeklyScan();
  });

  const { handleEmailEventsPruneCron } = await import(
    "@/lib/worker/handlers/email-events-prune-cron"
  );
  const { handleEmailOutboxReap } = await import(
    "@/lib/worker/handlers/email-outbox-reap"
  );
  const { handleResticPrune } = await import(
    "@/lib/worker/handlers/restic-prune"
  );
  const { handleResticCheck } = await import(
    "@/lib/worker/handlers/restic-check"
  );
  const { handleEmailitSyncContact } = await import(
    "@/lib/worker/handlers/emailit-sync-contact"
  );
  const { handleEmailitDeleteContact } = await import(
    "@/lib/worker/handlers/emailit-delete-contact"
  );
  const { handleOutboundWebhookDeliver } = await import(
    "@/lib/worker/handlers/outbound-webhook-deliver"
  );
  const { handleDisposableEmailsRefresh } = await import(
    "@/lib/worker/handlers/disposable-emails-refresh"
  );
  const { handleDomainClaimRecheck } = await import(
    "@/lib/worker/handlers/domain-claim-recheck"
  );
  await boss.work(JOB_NAMES.EMAIL_EVENTS_PRUNE_CRON, async () => {
    await handleEmailEventsPruneCron();
  });
  await boss.work(JOB_NAMES.EMAIL_OUTBOX_REAP, async () => {
    await handleEmailOutboxReap();
  });
  await boss.work(JOB_NAMES.RESTIC_PRUNE, async () => {
    await handleResticPrune();
  });
  await boss.work(JOB_NAMES.RESTIC_CHECK, async () => {
    await handleResticCheck();
  });
  await boss.work(JOB_NAMES.EMAILIT_SYNC_CONTACT, handleEmailitSyncContact);
  await boss.work(JOB_NAMES.EMAILIT_DELETE_CONTACT, handleEmailitDeleteContact);
  await boss.work(
    JOB_NAMES.OUTBOUND_WEBHOOK_DELIVER,
    handleOutboundWebhookDeliver
  );
  await boss.work(
    JOB_NAMES.DISPOSABLE_EMAILS_REFRESH,
    handleDisposableEmailsRefresh
  );
  await boss.work(JOB_NAMES.DOMAIN_CLAIM_RECHECK, async () => {
    await handleDomainClaimRecheck();
  });

  // Schedule recurring jobs
  await boss.schedule(JOB_NAMES.BILLING_HOURLY, "0 * * * *");
  await boss.schedule(JOB_NAMES.BILLING_TOPUP_RECONCILE, "30 * * * *"); // hourly at :30 — offset from billing.hourly
  await boss.schedule(JOB_NAMES.SUBSCRIPTION_RECONCILE, "15 * * * *"); // hourly at :15 — offset from billing.hourly + topup-reconcile
  await boss.schedule(JOB_NAMES.POLAR_METER_RECONCILE, "*/10 * * * *"); // every 10 min — re-report any unconfirmed overage events
  await boss.schedule(JOB_NAMES.CUBE_STALE_CHECK, "*/5 * * * *"); // every 5 minutes
  await boss.schedule(JOB_NAMES.CUBE_STATE_SYNC, "*/2 * * * *"); // every 2 minutes
  await boss.schedule(JOB_NAMES.CUBE_REACHABILITY, "* * * * *"); // every 1 minute — agent ping + ssh probe + live metrics on every running cube
  await boss.schedule(JOB_NAMES.TERMINAL_SESSION_REAPER, "*/5 * * * *"); // every 5 minutes — sweep orphaned terminal sessions left by SIGKILL'd workers
  await boss.schedule(JOB_NAMES.SERVER_RECONCILE, "*/10 * * * *"); // every 10 minutes
  await boss.schedule(JOB_NAMES.SERVER_MEASURE_DISK, "40 * * * *"); // hourly at :40 — measure real disk overhead so the allocator caps reservations at effective capacity
  await boss.schedule(JOB_NAMES.HOST_MOUNT_REAPER, "5,15,25,35,45,55 * * * *"); // every 10 minutes, offset by 5 from server.reconcile
  await boss.schedule(JOB_NAMES.STORAGE_HEALTH_CHECK, "*/30 * * * *"); // every 30 minutes
  await boss.schedule(JOB_NAMES.SETUP_REAPER, "*/5 * * * *"); // every 5 minutes
  await boss.schedule(JOB_NAMES.JOB_LOGS_PRUNE, "0 3 * * *"); // daily 03:00 UTC
  await boss.schedule(JOB_NAMES.CLOUDFLARE_HOSTNAME_POLL, "*/1 * * * *"); // every 1 minute
  await boss.schedule(JOB_NAMES.EMAIL_EVENTS_PRUNE_CRON, "20 3 * * *"); // daily 03:20 UTC
  await boss.schedule(JOB_NAMES.EMAIL_OUTBOX_REAP, "*/15 * * * *"); // every 15 min — sweep stuck `sending` rows past 10-min grace
  await boss.schedule(JOB_NAMES.RESTIC_PRUNE, "0 4 * * 0"); // Sundays 04:00 UTC — weekly per-cube `restic prune` to reclaim orphan chunks
  await boss.schedule(JOB_NAMES.RESTIC_CHECK, "0 6 * * 0"); // Sundays 06:00 UTC — weekly `restic check --read-data-subset=2%` integrity sweep + admin alert on failures
  await boss.schedule(JOB_NAMES.CUBE_IMPORTS_REAPER, "10 */6 * * *"); // every 6 hours at :10 — abort abandoned multipart uploads + hard-delete old failed rows
  await boss.schedule(JOB_NAMES.SECURITY_WEEKLY_SCAN, "0 8 * * 1"); // Mondays 08:00 UTC — weekly CVE digest to admins
  await boss.schedule(JOB_NAMES.DISPOSABLE_EMAILS_REFRESH, "0 4 * * 0"); // Sundays 04:00 UTC — weekly refresh of the disposable-email blocklist from upstream (same window as restic.prune; both are idempotent, no DB lock conflict)
  await boss.schedule(JOB_NAMES.DOMAIN_CLAIM_RECHECK, "0 5 * * *"); // daily 05:00 UTC — re-resolve verified domain-claim TXT records; auto-release a lock whose TXT vanished (3-strike)
  await boss.schedule(JOB_NAMES.SNAPSHOT_EXPORT_REAP, "0 * * * *"); // hourly on the hour — delete expired snapshot export .cube blobs + mark rows expired
  // Disk overhaul F: when storage tuning is on, move the disk-heavy auto-snapshot
  // scheduler off the :00 boundary (where it collided with SNAPSHOT_EXPORT_REAP and
  // the Sun-04:00 weekly RESTIC_PRUNE) to :10 — fewer simultaneous restic starts on
  // one host's array. Flag-off keeps the original on-the-hour schedule (identical).
  await boss.schedule(
    JOB_NAMES.SNAPSHOT_SCHEDULER,
    DISK_IO_STORAGE_TUNING_ENABLED ? "10 * * * *" : "0 * * * *"
  ); // per-plan auto-snapshot scheduler (decides per cube whether cadence has elapsed)
  await boss.schedule(JOB_NAMES.SNAPSHOT_STALE_CHECK, "45 * * * *"); // hourly at :45 — reap snapshot rows stranded in `creating` (hard worker-kill backstop)
  await boss.schedule(JOB_NAMES.BACKUP_STALE_CHECK, "50 * * * *"); // hourly at :50 — flip cube_backups rows stranded in `creating` (no upload) to `failed`, freeing the burned maxBackups slot
  await boss.schedule(JOB_NAMES.SNAPSHOT_AUTO_PRUNE, "30 3 * * *"); // daily 03:30 UTC — per-cube `restic forget` with the plan's retention buckets
  await boss.schedule(JOB_NAMES.CUBE_ERROR_RECOVERY_SCAN, "*/5 * * * *"); // every 5 min — scan `error` cubes under the attempt cap on reachable hosts + enqueue per-cube recovery

  console.log(
    "[worker] all handlers registered — billing hourly, stale-check 5m, state-sync 2m, reconcile 10m"
  );
}

// Graceful drain budget on SIGTERM: pg-boss immediately stops polling for new
// jobs, then waits up to this long for in-flight handlers (cube.transfer,
// backup.redeploy, snapshot.restore, etc.) to finish before closing the DB
// pool. Must be < Dokploy Swarm `stopGracePeriod` so we exit cleanly before
// Docker sends SIGKILL. Currently Dokploy is set to 45m; we drain for up to
// 40m and leave 5m of headroom.
const WORKER_SHUTDOWN_TIMEOUT_MS = 40 * 60 * 1000;

export async function stopWorker(
  timeoutMs = WORKER_SHUTDOWN_TIMEOUT_MS
): Promise<void> {
  console.log(
    `[worker] shutting down pg-boss (graceful, timeout=${Math.round(timeoutMs / 1000)}s)...`
  );
  await boss.stop({ graceful: true, timeout: timeoutMs, close: true });
  console.log("[worker] pg-boss stopped");
}
