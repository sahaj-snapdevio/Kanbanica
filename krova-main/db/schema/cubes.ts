import { createId } from "@paralleldrive/cuid2"
import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  pgEnum,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { servers } from "@/db/schema/servers"
import { spaces } from "@/db/schema/spaces"

/**
 * Reachability observation written by the `cube.reachability` cron (~1 min
 * cadence). Tri-layer health: L1 vsock guest-agent ping, L2 SSH port TCP
 * reachability via the host's iptables DNAT, plus the last-known-good
 * timestamps so the UI can render "Agent down for 3m" without having to
 * scan a separate history table.
 */
export type CubeReachabilitySnapshot = {
  agentOk: boolean
  sshOk: boolean
  /** ISO timestamp of the most recent successful vsock ping. */
  lastAgentSeenAt: string | null
  /** ISO timestamp of the most recent successful host SSH-port probe. */
  lastSshSeenAt: string | null
}

/**
 * Live resource snapshot from the in-guest agent — written by the same
 * `cube.reachability` cron when the agent ping succeeds. Mirrors the
 * `GuestMetrics` shape from `lib/ssh/guest-exec.ts` plus a `collectedAt`
 * ISO timestamp for staleness checks in the UI.
 */
export type CubeMetricsSnapshot = {
  collectedAt: string
  uptime_sec: number
  load_avg_1m: number
  load_avg_5m: number
  load_avg_15m: number
  cpu_user_pct: number
  cpu_system_pct: number
  cpu_idle_pct: number
  mem_total_kb: number
  mem_used_kb: number
  mem_available_kb: number
  disk_total_bytes: number
  disk_used_bytes: number
  disk_avail_bytes: number
}

export const cubeStatus = pgEnum("cube_status", [
  "pending",
  "booting",
  "running",
  "sleeping",
  "stopping",
  "deleted",
  "error",
])

export const cubeTransferState = pgEnum("cube_transfer_state", [
  "idle",
  "snapshotting",
  "restoring",
  "finalizing",
  "completed",
  "failed",
  "cancelling",
])

export const cubeLaunchMode = pgEnum("cube_launch_mode", ["bare", "jailed"])

export const cubes = pgTable(
  "cubes",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id),
    name: text("name").notNull(),
    status: cubeStatus("status").notNull().default("pending"),
    vcpus: real("vcpus").notNull(),
    ramMb: integer("ram_mb").notNull(),
    diskLimitGb: integer("disk_limit_gb").notNull().default(20),
    imageId: text("image_id").notNull().default("ubuntu-24.04"),
    internalIp: text("internal_ip"),
    /**
     * The cube's IPv6 address `fd00:c0be:<S>::<octet>`, derived at write-time
     * from the same freshly-picked host octet as `internal_ip` and the server's
     * `bridge_subnet` (S). Nullable for pre-migration rows.
     */
    internalIpv6: text("internal_ipv6"),
    zeroBalanceSleep: boolean("zero_balance_sleep").notNull().default(false),
    /**
     * Version of the kernel that this Cube last cold-booted with. Recorded
     * by cube-provision (initial boot) and cube-cold-restart (force-reload
     * kernel). NOT updated by cube-wake's resume path (Firecracker resumes
     * from the same in-memory kernel — no new version loaded).
     *
     * Compared against `servers.currentKernelVersion` (the kernel currently
     * on /var/lib/krova/images/vmlinux) to detect drift. If <, the Cube
     * needs a cold-restart to pick up the latest kernel.
     */
    bootedKernelVersion: integer("booted_kernel_version"),
    /**
     * Version of the rootfs the Cube was provisioned from. Cubes copy the
     * rootfs to their own /var/lib/krova/cubes/<id>/rootfs.ext4 at provision
     * time, so this is effectively immutable for the Cube's lifetime —
     * upgrading rootfs requires a recreate.
     */
    provisionedRootfsVersion: integer("provisioned_rootfs_version"),
    /**
     * True if the Cube was cold-booted with the Firecracker virtio-mem device
     * declared, enabling live RAM resize. Cubes provisioned before live-resize
     * support shipped have this set to false and require a cold restart to
     * pick up the device before resize is available.
     */
    hasVirtioMem: boolean("has_virtio_mem").notNull().default(false),
    userData: text("user_data"),
    /**
     * How this cube's Firecracker process is currently launched on the host:
     * `bare` (legacy: `nohup firecracker` as root, paths under
     * /var/lib/krova/cubes/<id>) or `jailed` (Firecracker jailer — per-cube
     * uid, chroot, PID namespace, cgroup, paths under
     * /var/lib/krova/jail/firecracker/<id>/root). Backfilled to `bare` for all
     * pre-existing cubes (Rule 40 additive default); new cubes provision
     * `jailed` when JAILER_ENABLED. Every host-path resolution (socket, vsock,
     * pid, fc.log) + kill/status branches on this — see lib/ssh/jailer.ts.
     */
    launchMode: cubeLaunchMode("launch_mode").notNull().default("bare"),
    /**
     * The per-host unprivileged uid the jailer drops to for this cube
     * (>= JAILER_UID_BASE), allocated per-server like ports. Null for bare
     * cubes. Freed on delete / transfer-out.
     */
    jailerUid: integer("jailer_uid"),
    /**
     * Assigned NUMA node for L2 cpuset placement (least-loaded at allocation,
     * re-assigned on transfer). Null = unpinned: single-socket host, undetected
     * topology, or NUMA_PLACEMENT_ENABLED off. Cleared on delete / transfer-out.
     */
    numaNode: integer("numa_node"),
    /**
     * Count of automatic error-recovery attempts since the cube last ran
     * successfully. The `cube.error-recovery` cron (every 5 min) tries to
     * revive a cube parked in `error` up to `MAX_ERROR_RECOVERY_ATTEMPTS`
     * (config/platform.ts, default 3) times; past the cap it stops and
     * notifies admins. Reset to 0 whenever the cube reaches `running` again
     * (auto-recovery success or a manual wake / `--restart`), so a later,
     * unrelated error episode gets a fresh budget.
     */
    errorRecoveryAttempts: integer("error_recovery_attempts")
      .notNull()
      .default(0),
    lastBilledAt: timestamp("last_billed_at", { withTimezone: true }),
    /**
     * Set whenever the cube transitions to `running` (boot, wake, snapshot
     * restore, transfer). The Phase 3 cancel/downgrade over-limit reconcile
     * orders the running set by this DESC to sleep the most-recently-started
     * Cubes first.
     */
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    /**
     * Timestamp of the most recent successful auto-snapshot for this cube.
     * NULL = no auto-snapshot ever taken. The `snapshot.scheduler` cron
     * reads this column (vs the plan's cadence) to decide whether the next
     * tick is due. Updated by `snapshot-create.ts` on success when the
     * snapshot's `kind = 'auto'`.
     */
    lastAutoSnapshotAt: timestamp("last_auto_snapshot_at", {
      withTimezone: true,
    }),
    /**
     * True iff at least one auto-snapshot has succeeded since the cube
     * most recently entered `sleeping`. Reset to `false` by `cube-sleep.ts`
     * and `cube-power-off.ts` on the sleeping transition. Used by the
     * scheduler to enforce "one snapshot per sleep cycle" — a sleeping
     * cube's rootfs doesn't change, so re-snapshotting it every cadence
     * tick wastes I/O. Default `true` for existing cubes (gate is open
     * until they enter sleep at least once and the sleep handler clears
     * the flag).
     */
    snapshottedSinceSleep: boolean("snapshotted_since_sleep")
      .notNull()
      .default(true),
    transferState: cubeTransferState("transfer_state")
      .notNull()
      .default("idle"),
    transferDestinationServerId: text("transfer_destination_server_id").references(
      () => servers.id,
      { onDelete: "set null" }
    ),
    transferStartedAt: timestamp("transfer_started_at", { withTimezone: true }),
    /**
     * AES-256-GCM-encrypted (via `lib/encrypt.ts`, key = APP_SECRET)
     * password for this cube's restic snapshot repository. The repo
     * lives at `s3:<env-prefix>/snapshot-repos/<cubeId>/` on the
     * platform's active storage backend; this password decrypts the
     * encrypted chunk metadata. Generated lazily on the first
     * `restic init` (`lib/storage/restic/password.ts`) and reused for
     * the lifetime of the cube. Loss of `APP_SECRET` makes all
     * snapshots in all repos unrecoverable — same operational
     * dependency as SSH keys + S3 credentials.
     */
    snapshotRepoPasswordEnc: text("snapshot_repo_password_enc"),
    /**
     * Last time the `cube.reachability` cron ran for this cube. Indexed
     * so admin queries like "show me every cube whose data is stale"
     * stay fast.
     */
    lastReachabilityAt: timestamp("last_reachability_at", {
      withTimezone: true,
    }),
    /** Last observed reachability state from the cube.reachability cron. */
    reachabilityJsonb: jsonb("reachability_jsonb").$type<CubeReachabilitySnapshot>(),
    /** Last live metrics snapshot from the in-guest agent. */
    lastMetricsJsonb: jsonb("last_metrics_jsonb").$type<CubeMetricsSnapshot>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cubes_status_idx").on(t.status),
    index("cubes_server_id_idx").on(t.serverId),
    index("cubes_space_id_idx").on(t.spaceId),
    // Composite index for hourly billing: finds running cubes grouped by space efficiently
    index("cubes_status_space_id_idx").on(t.status, t.spaceId),
    index("cubes_transfer_state_idx").on(t.transferState),
    index("cubes_last_reachability_at_idx").on(t.lastReachabilityAt),
    // Per-server uniqueness of the jailer uid. Postgres treats NULLs as
    // distinct in unique constraints, so every BARE cube (jailer_uid IS NULL)
    // coexists freely; only non-null uids must be unique per server. This backs
    // the allocate-retry-on-conflict loop in lib/server/jailer-uids.ts so two
    // cubes provisioning concurrently on the same host can never share a uid.
    unique("cubes_server_id_jailer_uid_uniq").on(t.serverId, t.jailerUid),
    // Global uniqueness of the IPv6 address across the fleet (every server's S
    // is distinct, so the v6 address is globally unique). Excludes deleted
    // cubes so a freed address can be reused.
    uniqueIndex("cubes_internal_ipv6_unq")
      .on(t.internalIpv6)
      .where(sql`internal_ipv6 IS NOT NULL AND status <> 'deleted'`),
    // Transitional per-server uniqueness of the IPv4 octet. Backs the
    // octet-based allocation under the per-server advisory lock; deleted cubes
    // are excluded so a freed octet can be reused.
    uniqueIndex("cubes_server_id_internal_ip_unq")
      .on(t.serverId, t.internalIp)
      .where(sql`internal_ip IS NOT NULL AND status <> 'deleted'`),
  ]
)

/**
 * Tracks ports currently in use on each server.
 * Only allocated ports exist as rows — no pre-seeding needed.
 * Available ports are derived: any port in 30000–50000 not in this table.
 */
export const allocatedPorts = pgTable(
  "allocated_ports",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    port: integer("port").notNull(),
    cubeId: text("cube_id").references(() => cubes.id, {
      onDelete: "set null",
    }),
    purpose: text("purpose").notNull().default("ssh"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.serverId, t.port)]
)
