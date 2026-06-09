export type CubeProvisionPayload = {
  cubeId: string;
  spaceId: string;
  serverId: string;
  vcpus: number;
  ramMb: number;
  diskLimitGb: number;
  imageId: string;
  sshPublicKey: string;
  userData?: string | null;
};

export type CubeDeletePayload = {
  cubeId: string;
  spaceId: string;
  serverId: string;
};

/**
 * Admin-initiated full space deletion. The job waits for every cube's
 * `cube.delete` job to finish (cube row → status='deleted') before removing
 * the space row, since deleting the space cascade-removes cube rows and would
 * otherwise make in-flight `cube.delete` jobs no-op. `attempt` bounds the wait.
 */
export type SpaceDeletePayload = {
  spaceId: string;
  attempt?: number;
  /**
   * Pre-collected deletion summary, captured by the Orbit endpoint BEFORE the
   * row + cubes were torn down. The worker augments it with the orphan-user
   * emails it deletes and ships it to admins via the deletion notify helper
   * after the cascade commits. Optional — older jobs without it run as
   * before but admins won't receive the email.
   */
  summary?: SpaceDeletionSummaryPayload;
};

/**
 * Snapshot of what was deleted with the space. Matches `SpaceDeletionSummary`
 * from `lib/orbit/deletion-summaries.ts` but serialized as plain JSON since
 * pg-boss persists job payloads (Date → ISO string).
 */
export type SpaceDeletionSummaryPayload = {
  spaceId: string;
  spaceName: string;
  createdAt: string;
  owner: { userId: string | null; email: string | null; name: string | null };
  planId: string;
  planName: string | null;
  subscriptionStatus: string | null;
  creditBalanceUsd: string;
  cubes: {
    count: number;
    totalVcpus: number;
    totalRamMb: number;
    totalDiskGb: number;
    names: string[];
  };
  snapshots: { count: number; totalGb: number };
  backups: { count: number; totalGb: number };
  domains: { count: number; hostnames: string[] };
  members: { count: number; emails: string[] };
  initiator: {
    type: "admin" | "owner" | "system";
    userId: string | null;
    email: string | null;
  };
};

export type CubeSleepPayload = {
  cubeId: string;
  spaceId: string;
  serverId: string;
};

/**
 * Power off a Cube. Distinct from sleep: this KILLS the Firecracker process
 * (Firecracker has no graceful ACPI shutdown — process termination is the
 * mechanism). The cube ends in `status="sleeping"` because the existing
 * "sleeping" state covers both paused-VM and shut-off-process cases — the
 * wake handler already detects which one and cold-restarts when the process
 * is gone. The user-visible difference is wake time: resume-from-paused is
 * instant, cold restart re-loads the kernel from disk.
 *
 * Side benefit: cold restart picks up the platform's latest kernel + the
 * `virtio-mem` device, so a cube provisioned before live-resize support
 * becomes resize-eligible after a power-off + start cycle.
 */
export type CubePowerOffPayload = {
  cubeId: string;
  spaceId: string;
  serverId: string;
};

export type CubeWakePayload = {
  cubeId: string;
  spaceId: string;
  serverId: string;
};

/**
 * Force a cold-restart of a Cube: kill the Firecracker process, then
 * relaunch via startCube — which re-reads the kernel from disk. Used to
 * pick up a refreshed kernel after `server.update-images` on the host.
 * Resumes from the existing rootfs.ext4 so customer state is preserved.
 */
export type CubeColdRestartPayload = {
  cubeId: string;
  spaceId: string;
  serverId: string;
  /** Optional actor info for audit trail. */
  actorId?: string | null;
  actorEmail?: string | null;
};

/**
 * Auto-relaunch a Cube whose Firecracker process exited cleanly because
 * the guest issued a reboot (Firecracker doesn't support guest-initiated
 * reboot — it exits with `exit_code=0` instead). Enqueued by
 * `cube.state-sync` after it detects the dead Firecracker AND scrapes
 * `fc.log` for "Firecracker exiting successfully. exit_code=0".
 *
 * Same machine config + same rootfs as before; the cube row is already
 * `running` when state-sync triggers this, so the handler claims it
 * (running|booting → booting) and calls startCube exactly like
 * cube-cold-restart but without the prior kill step.
 *
 * Rate-limited at the enqueue site by counting recent "Cube auto-restarted"
 * lifecycle log entries — beyond the cap, state-sync marks the cube as
 * error instead of enqueuing this job. Prevents a reboot-looping guest
 * from burning fleet resources indefinitely.
 */
export type CubeAutoRelaunchPayload = {
  cubeId: string;
  spaceId: string;
  serverId: string;
  /** Free-form reason for the audit trail (e.g. "guest-issued reboot"). */
  reason?: string | null;
};

/**
 * cube.error-recovery — try to revive ONE cube parked in `status='error'`.
 *
 * Enqueued by the `cube.error-recovery-scan` cron (every 5 min) only for
 * cubes whose host is reachable AND whose `error_recovery_attempts` is below
 * `MAX_ERROR_RECOVERY_ATTEMPTS`. Atomically claims `error → booting`, calls
 * startCube (same rootfs/config — customer state preserved), and on success
 * resets the attempt counter to 0. On failure it increments the counter and
 * leaves the cube in `error`; once the counter hits the cap the cron stops
 * enqueuing and the handler notifies admins. retryLimit=0 — the cron + the
 * DB counter own retries, not pg-boss (mixing the two would double-count).
 */
export type CubeErrorRecoveryPayload = {
  cubeId: string;
  spaceId: string;
  serverId: string;
};

export type CubeTransferPayload = {
  cubeId: string;
  spaceId: string;
  sourceServerId: string;
  destinationServerId: string;
  /** Admin who initiated the transfer, for audit trail. */
  actorId: string;
  actorEmail: string;
};

export type CubeTransferCancelPayload = {
  cubeId: string;
  spaceId: string;
  sourceServerId: string;
  /** Destination server at time of cancel — may be null if transfer never claimed one. */
  destinationServerId: string | null;
  /**
   * `transferState` AS READ INSIDE THE SAME TRANSACTION that flipped it to
   * `cancelling`. The handler uses this to decide whether the source was
   * slept for cutover (only happens when state was `finalizing` at cancel
   * time). Without this, the handler would have to read `cubes.transferState`
   * after the flip and would always see `cancelling`, losing the signal.
   * Optional for backwards compat with jobs enqueued before this field
   * existed — the handler falls back to the old heuristic.
   */
  previousTransferState?: "snapshotting" | "restoring" | "finalizing" | null;
  /**
   * `cubes.status` AS READ INSIDE THE SAME TRANSACTION that flipped
   * `transferState` to `cancelling`. Combined with `previousTransferState`,
   * this lets the handler distinguish "source was running pre-transfer and
   * got slept at cutover" (must wake) from "source was already sleeping
   * pre-transfer" (must NOT wake — would violate customer's intentional
   * sleep). See audit H4 (2026-05-24).
   */
  cubeStatusAtCancel?: string | null;
  actorId: string;
  actorEmail: string;
};

/**
 * Apply a resize to a running or sleeping cube. Live for RAM/disk grow only;
 * cold restart for any vCPU change. The handler re-validates server capacity
 * before applying — server state may have changed between enqueue and run.
 */
export type CubeResizePayload = {
  cubeId: string;
  spaceId: string;
  serverId: string;
  newVcpus: number;
  newRamMb: number;
  newDiskLimitGb: number;
  /** Whether the resize can be applied live (no Firecracker restart). */
  isLive: boolean;
  actorId: string;
  actorType: "user" | "admin";
};

export type DomainAddPayload = {
  mappingId: string;
  cubeId: string;
  serverId: string;
  domain: string;
  /** Routing port on the Cube — always known when the domain is added. */
  port: number;
};

export type DomainRemovePayload = {
  mappingId: string;
  cubeId: string;
  serverId: string;
  domain: string;
};

export type DomainPurgeCachePayload = {
  mappingId: string;
  cubeId: string;
  spaceId: string;
  domain: string;
};

export type TcpMappingAddPayload = {
  mappingId: string;
  cubeId: string;
  serverId: string;
  cubePort: number;
  hostPort: number;
  cubeInternalIp: string;
  whitelistedCidrs: string[];
};

export type TcpMappingRemovePayload = {
  mappingId: string;
  cubeId: string;
  serverId: string;
  hostPort: number;
  cubeInternalIp: string;
};

export type TcpMappingUpdateWhitelistPayload = {
  mappingId: string;
  cubeId: string;
  serverId: string;
  hostPort: number;
  cubePort: number;
  cubeInternalIp: string;
  whitelistedCidrs: string[];
};

export type TcpMappingDisablePayload = {
  mappingId: string;
  cubeId: string;
  spaceId: string;
  serverId: string;
  hostPort: number;
  cubePort: number;
  cubeInternalIp: string;
  actorId?: string | null;
  actorEmail?: string | null;
};

export type TcpMappingEnablePayload = {
  mappingId: string;
  cubeId: string;
  spaceId: string;
  serverId: string;
  hostPort: number;
  cubePort: number;
  cubeInternalIp: string;
  actorId?: string | null;
  actorEmail?: string | null;
};

/**
 * Payload for atomically migrating the SSH mapping's `cubePort` from
 * `oldCubePort` → `newCubePort`. Both values travel on the payload so the
 * handler can replay the iptables DNAT (delete old → add new) without
 * needing to read DB state — the row itself is not mutated until the
 * iptables swap succeeds, so a retry of this job always knows which rule
 * to delete and which to add. See `lib/worker/handlers/tcp-mapping-update-cube-port.ts`.
 */
export type TcpMappingUpdateCubePortPayload = {
  mappingId: string;
  cubeId: string;
  spaceId: string;
  serverId: string;
  hostPort: number;
  cubeInternalIp: string;
  oldCubePort: number;
  newCubePort: number;
  whitelistedCidrs: string[];
  actorId?: string | null;
  actorEmail?: string | null;
};

export type SnapshotCreatePayload = {
  snapshotId: string;
  cubeId: string;
  spaceId: string;
  serverId: string;
};

export type SnapshotRestorePayload = {
  snapshotId: string;
  cubeId: string;
  spaceId: string;
  serverId: string;
  /** True if the cube was RUNNING (not sleeping) before the restore. Captured by
   *  the restore action BEFORE it flips cubes.status to "stopping" — the handler
   *  can no longer read the true pre-restore status off the row. Drives whether
   *  the cube is left running or re-slept after restore. Optional for backward
   *  compat with jobs enqueued before this field existed. */
  wasRunning?: boolean;
};

export type SnapshotDeletePayload = {
  snapshotId: string;
  cubeId: string;
  spaceId: string;
};

/**
 * Customer-initiated `.cube` export of a snapshot. The handler restic-dumps
 * the rootfs from the cube's repo, zstd-compresses, wraps in a `.cube` tar,
 * uploads to `<env>/exports/{spaceId}/{exportId}.cube`, emails a 24h
 * presigned download link, and writes back the URL + expiresAt on the
 * `snapshot_exports` row.
 */
export type SnapshotExportPayload = {
  exportId: string;
  snapshotId: string;
  cubeId: string;
  spaceId: string;
  serverId: string;
};

/**
 * Promote a snapshot to a backup. The handler restic-dumps the source
 * snapshot's rootfs, builds a `.cube`, uploads under the backups prefix,
 * and flips the pre-inserted `cube_backups` row (status='pending' →
 * 'creating' → 'complete').
 */
export type SnapshotPromoteToBackupPayload = {
  snapshotId: string;
  cubeId: string;
  spaceId: string;
  serverId: string;
  backupId: string;
  backupName: string;
};

/**
 * Clone a snapshot into a brand-new cube. The new cube row is pre-created
 * (status='pending', allocated to a server) before enqueue. The handler
 * restic-dumps the source snapshot directly onto the destination server's
 * rootfs (no S3 round-trip through a `.cube` archive), injects the
 * customer's new SSH key, rewrites the guest network config for the new
 * IP, and boots via `startCube`.
 */
export type CubeFromSnapshotPayload = {
  /** Pre-created destination cube row id (status='pending'). */
  cubeId: string;
  spaceId: string;
  /** Destination server the new cube is allocated on. */
  serverId: string;
  sourceSnapshotId: string;
  /** Source cube id — needed to resolve the source restic repo password. */
  sourceCubeId: string;
  /** SSH public key the new cube boots with. */
  sshPublicKey: string;
};

export type BackupCreatePayload = {
  backupId: string;
  cubeId: string;
  spaceId: string;
  serverId: string;
  /**
   * Deletion of the source cube is **opt-in** — defaults to `false` so a
   * forgotten flag can never accidentally destroy a running cube.
   *
   * - `true` — handler enqueues `cube.delete` in its `finally` block
   *   after the backup completes (success OR failure). This is the
   *   "preserve backup before deletion" flow driven by
   *   `deleteCube({ preserveBackup: true })` and the `cube.stale-check`
   *   auto-salvage path.
   * - `false` / omitted — source cube is left untouched. Used by the
   *   "Save as backup" flow that captures a redeployable snapshot of a
   *   running cube without disturbing it.
   */
  deleteCubeAfter?: boolean;
};

export type BackupDeletePayload = {
  backupId: string;
  spaceId: string;
};

export type BackupRedeployPayload = {
  backupId: string;
  spaceId: string;
  newCubeId: string;
  serverId: string;
  /**
   *   - "replace" (default for backwards compat): worker mounts the
   *     rootfs and overwrites /root/.ssh/authorized_keys with
   *     `sshPublicKey`.
   *   - "keep": worker leaves the rootfs's authorized_keys untouched;
   *     `sshPublicKey` may be null.
   */
  sshKeyMode?: "replace" | "keep";
  sshPublicKey: string | null;
  /**
   * The cube's `diskLimitGb` on the new row may be LARGER than the
   * backup's saved disk size (customer chose to grow at redeploy time).
   * Passing the original here lets the worker decide whether to run
   * resize2fs upward on the offline rootfs before booting. Shrinking
   * is rejected upstream (would corrupt ext4).
   */
  originalDiskLimitGb?: number;
};

/**
 * `cube.import-rootfs` finalizes a customer-initiated `.cube` upload
 * into a running cube. The handler reads the `cube_imports` row (which
 * already has the upload metadata + ssh-key config + plan-tier
 * overrides) and orchestrates: download archive from S3, extract,
 * decompress, ssh-key inject (if mode=replace), boot.
 *
 * The cube row is created by the `/imports/{id}/complete` endpoint
 * before the job is enqueued — the handler claims it (pending →
 * booting) and either runs to completion or marks it errored.
 */
export type CubeImportRootfsPayload = {
  importId: string;
};

/**
 * `storage.cleanup` operates in one of two modes per job:
 *
 *  - **explicit keys**: `storagePaths` is set → bulk-delete just those
 *    keys via `s3DeleteObjects`. Used by space-delete and pre-deletion
 *    backup cleanup, where the caller already knows every object key.
 *
 *  - **prefix sweep**: `storagePrefix` is set → list every object under
 *    that prefix (paginated) and delete them all. Used by `cube.delete`
 *    to wipe the cube's restic snapshot repository
 *    (`<env>/snapshot-repos/<cubeId>/`), where the per-chunk object
 *    keys are restic-managed and the caller can't enumerate them.
 *
 * Exactly one of `storagePaths` / `storagePrefix` MUST be set; the
 * handler errors clearly if neither (or both) is provided.
 */
export type StorageCleanupPayload = {
  storagePaths?: string[];
  storagePrefix?: string;
  storageBackendId: string;
  reason: string;
};

/**
 * Email-send job points at an `email_outbox` row by id; the row holds
 * the actual payload + status machine. The worker (`email-send.ts`)
 * atomically transitions `queued → sending`, calls EmailIt, then marks
 * `sent` or routes back to `queued`/`failed`. The outbox row — not the
 * pg-boss retry — is what makes the external send effectively
 * exactly-once.
 */
export type EmailSendPayload = {
  outboxId: string;
};

/** Sync a single user to the EmailIt marketing audience. */
export type EmailitSyncContactPayload = {
  userId: string;
};

/**
 * Permanently remove a contact from the EmailIt marketing audience. Enqueued
 * just before the corresponding `user` row is deleted so we still have the
 * `emailitContactId` to target. Falls back to `email` when no contact id was
 * ever synced.
 */
export type EmailitDeleteContactPayload = {
  /** EmailIt contact id (`con_xxx`) — preferred. */
  contactId?: string | null;
  /** Fallback identifier when no contact id is stored on the user row. */
  email?: string | null;
};

/**
 * Phased server setup. Each phase is a separate idempotent job that
 * advances the server's setupPhase column on success and marks
 * setupStatus=failed (with setupError set) on failure.
 *
 * The bootstrap phase carries an encrypted `bootstrapCreds` blob with the
 * operator-supplied initial SSH credentials (port 22, password OR private
 * key). After this phase completes successfully, the server is reachable on
 * port 2822 with the platform key and no further phase needs the original
 * creds.
 */
export type ServerBootstrapPayload = {
  serverId: string;
  /** AES-256-GCM encrypted JSON: { initialPort, initialUser, password?, privateKey? } */
  encryptedCreds: string;
};

export type ServerInstallPayload = {
  serverId: string;
};

export type ServerPullImagesPayload = {
  serverId: string;
};

export type ServerNetworkPayload = {
  serverId: string;
};

export type ServerVerifyPayload = {
  serverId: string;
};

export type ServerRebootPayload = {
  serverId: string;
};

/**
 * Operator-initiated image refresh on an active server. Re-runs the
 * pull-images core (SFTP + sha256 + decompress) without touching the phase
 * lifecycle or rebooting. Used after `pnpm build:images` produces new
 * artifacts (e.g. a kernel rebuild) to push them to already-active servers
 * without disrupting customer Cubes.
 */
export type ServerUpdateImagesPayload = {
  serverId: string;
};

/**
 * Operator-initiated Caddy reconcile on an active server. Atomically
 * rebuilds the server's `srv0` routes array (landing route + every customer
 * custom-domain route from `domain_mappings`) and the ACME automation
 * policy. Used to re-push routing config after a server hostname change and
 * to self-heal Caddy route drift.
 */
export type ServerRefreshCaddyPayload = {
  serverId: string;
};

/**
 * Operator-initiated Caddy package upgrade on an active server. Upgrades the
 * Caddy package to the platform-pinned CADDY_VERSION and restarts the
 * service. Does NOT touch the phase lifecycle, reboot the box, or change
 * Caddy routes — the `--resume` systemd override reloads autosave.json so all
 * routes survive the restart.
 */
export type ServerUpdateCaddyPayload = {
  serverId: string;
};

/**
 * Operator-initiated hardware-totals refresh on an active server. Re-runs
 * the same `nproc` / `/proc/meminfo` / `df -B1G /` probes the `bootstrap`
 * phase used to populate `servers.totalCpus` / `totalRamMb` / `totalDiskGb`,
 * then writes the fresh values. Read-only on the host. Used after an
 * operator physically upgrades RAM, adds disk, or changes the CPU on the
 * server — the bootstrap-time numbers go stale on first hardware change.
 */
export type ServerRefreshHardwarePayload = {
  serverId: string;
};

/**
 * Restart cubes after a bare-metal host reboot. Enqueued by cube.state-sync
 * (boot-id change) or POST /api/internal/server-rebooted. Restarts every cube
 * the database says is `running` on this server. Idempotent — keyed on the
 * host boot-id; a second run for the same boot-id no-ops.
 */
export type ServerRebootRecoveryPayload = {
  serverId: string;
};

export type OutboundWebhookDeliverPayload = {
  deliveryId: string;
};

/**
 * `cube.terminal-bridge` runs the long-lived vsock-PTY ↔ Soketi proxy
 * for one browser terminal session. The pg-boss job stays alive for
 * up to the platform's hard-timeout ceiling (currently 4h + 5min
 * safety margin); the handler tears down early on idle timeout, cube
 * state change, customer explicit close, or SSH/vsock error.
 */
export type CubeTerminalBridgePayload = {
  sessionId: string;
};

export const JOB_NAMES = {
  CUBE_PROVISION: "cube.provision",
  CUBE_DELETE: "cube.delete",
  CUBE_SLEEP: "cube.sleep",
  CUBE_POWER_OFF: "cube.power-off",
  CUBE_WAKE: "cube.wake",
  CUBE_COLD_RESTART: "cube.cold-restart",
  CUBE_AUTO_RELAUNCH: "cube.auto-relaunch",
  CUBE_ERROR_RECOVERY_SCAN: "cube.error-recovery-scan",
  CUBE_ERROR_RECOVERY: "cube.error-recovery",
  CUBE_TRANSFER: "cube.transfer",
  CUBE_TRANSFER_CANCEL: "cube.transfer-cancel",
  CUBE_RESIZE: "cube.resize",
  DOMAIN_ADD: "domain.add",
  DOMAIN_REMOVE: "domain.remove",
  DOMAIN_PURGE_CACHE: "domain.purge-cache",
  DOMAIN_CLAIM_RECHECK: "domain-claim.recheck",
  CLOUDFLARE_HOSTNAME_POLL: "cloudflare.hostname-poll",
  TCP_MAPPING_ADD: "tcp-mapping.add",
  TCP_MAPPING_REMOVE: "tcp-mapping.remove",
  TCP_MAPPING_UPDATE_WHITELIST: "tcp-mapping.update-whitelist",
  TCP_MAPPING_UPDATE_CUBE_PORT: "tcp-mapping.update-cube-port",
  TCP_MAPPING_DISABLE: "tcp-mapping.disable",
  TCP_MAPPING_ENABLE: "tcp-mapping.enable",
  SNAPSHOT_CREATE: "snapshot.create",
  SNAPSHOT_RESTORE: "snapshot.restore",
  SNAPSHOT_DELETE: "snapshot.delete",
  SNAPSHOT_SCHEDULER: "snapshot.scheduler",
  SNAPSHOT_STALE_CHECK: "snapshot.stale-check",
  SNAPSHOT_AUTO_PRUNE: "snapshot.auto-prune",
  SNAPSHOT_EXPORT: "snapshot.export",
  SNAPSHOT_EXPORT_REAP: "snapshot.export-reap",
  SNAPSHOT_PROMOTE_TO_BACKUP: "snapshot.promote-to-backup",
  CUBE_FROM_SNAPSHOT: "cube.from-snapshot",
  BACKUP_CREATE: "backup.create",
  BACKUP_DELETE: "backup.delete",
  BACKUP_STALE_CHECK: "backup.stale-check",
  BACKUP_REDEPLOY: "backup.redeploy",
  CUBE_IMPORT_ROOTFS: "cube.import-rootfs",
  CUBE_IMPORTS_REAPER: "cube-imports.reaper",
  BILLING_HOURLY: "billing.hourly",
  BILLING_TOPUP_RECONCILE: "billing.topup-reconcile",
  SUBSCRIPTION_RECONCILE: "subscription.reconcile",
  POLAR_METER_RECONCILE: "polar.meter-reconcile",
  STORAGE_CLEANUP: "storage.cleanup",
  STORAGE_HEALTH_CHECK: "storage.health-check",
  SPACE_DELETE: "space.delete",
  EMAIL_SEND: "email.send",
  EMAIL_OUTBOX_REAP: "email.outbox-reap",
  RESTIC_PRUNE: "restic.prune",
  RESTIC_CHECK: "restic.check",
  CUBE_STALE_CHECK: "cube.stale-check",
  CUBE_STATE_SYNC: "cube.state-sync",
  CUBE_REACHABILITY: "cube.reachability",
  CUBE_TERMINAL_BRIDGE: "cube.terminal-bridge",
  TERMINAL_SESSION_REAPER: "cube.terminal-session-reaper",
  SERVER_RECONCILE: "server.reconcile",
  SERVER_BOOTSTRAP: "server.bootstrap",
  SERVER_INSTALL: "server.install",
  SERVER_PULL_IMAGES: "server.pull-images",
  SERVER_NETWORK: "server.network",
  SERVER_REBOOT: "server.reboot",
  SERVER_VERIFY: "server.verify",
  SERVER_UPDATE_IMAGES: "server.update-images",
  SERVER_REFRESH_CADDY: "server.refresh-caddy",
  SERVER_UPDATE_CADDY: "server.update-caddy",
  SERVER_REFRESH_HARDWARE: "server.refresh-hardware",
  SERVER_MEASURE_DISK: "server.measure-disk",
  SERVER_REBOOT_RECOVERY: "server.reboot-recovery",
  SETUP_REAPER: "server.setup-reaper",
  HOST_MOUNT_REAPER: "host.mount-reaper",
  JOB_LOGS_PRUNE: "job-logs.prune",
  EMAIL_EVENTS_PRUNE_CRON: "email.events-prune-cron",
  EMAILIT_SYNC_CONTACT: "emailit.sync-contact",
  EMAILIT_DELETE_CONTACT: "emailit.delete-contact",
  OUTBOUND_WEBHOOK_DELIVER: "outbound-webhook.deliver",
  SECURITY_WEEKLY_SCAN: "security.weekly-scan",
  DISPOSABLE_EMAILS_REFRESH: "disposable-emails.refresh",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
