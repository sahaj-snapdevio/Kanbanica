import { createId } from "@paralleldrive/cuid2"
import { sql } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { regions } from "@/db/schema/regions"
import { sshKeys } from "@/db/schema/ssh-keys"

export const serverStatus = pgEnum("server_status", [
  "active",
  "inactive",
  "draining",
  "offline",
  "provisioning",
])

export const serverSetupPhase = pgEnum("server_setup_phase", [
  "bootstrap",
  "install",
  "pull_images",
  "network",
  "reboot",
  "verify",
  "ready",
])

export const serverSetupStatus = pgEnum("server_setup_status", [
  "idle",
  "running",
  "failed",
])

export const servers = pgTable(
  "servers",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    /**
     * The single DNS label for this server. Every server-facing hostname is
     * derived from it (never stored, never operator-edited, so they cannot
     * drift): `lib/server/server-hostnames.ts` produces the proxied origin
     * `<hostname>.krova.cloud` and the DNS-only `connect.<hostname>.krova.cloud`.
     * Immutable after creation. The old `server_domain` / `cf_origin_hostname`
     * columns were dropped — see the 2026-05-17 hostname-derivation migration.
     */
    hostname: text("hostname").notNull(),
    publicIp: text("public_ip").notNull(),
    regionId: text("region_id")
      .notNull()
      .references(() => regions.id),
    sshPort: integer("ssh_port").notNull().default(2822),
    sshKeyId: text("ssh_key_id")
      .notNull()
      .references(() => sshKeys.id),
    status: serverStatus("status").notNull().default("active"),
    setupPhase: serverSetupPhase("setup_phase").notNull().default("ready"),
    setupStatus: serverSetupStatus("setup_status").notNull().default("idle"),
    setupError: text("setup_error"),
    setupStartedAt: timestamp("setup_started_at", { withTimezone: true }),
    totalCpus: integer("total_cpus").notNull().default(0),
    totalRamMb: integer("total_ram_mb").notNull().default(0),
    totalDiskGb: integer("total_disk_gb").notNull().default(0),
    allocatedCpus: real("allocated_cpus").notNull().default(0),
    allocatedRamMb: integer("allocated_ram_mb").notNull().default(0),
    allocatedDiskGb: integer("allocated_disk_gb").notNull().default(0),
    /**
     * Measured non-cube disk footprint on the host (GB), refreshed hourly by
     * the `server.measure-disk` cron: `df_used − du(/var/lib/krova/cubes)` —
     * the OS, swap file, kernel/rootfs images, restic cache, /tmp staging, and
     * logs. The allocator places cube reservations against the EFFECTIVE
     * capacity (`totalDiskGb − overheadDiskGb`), so reservations + measured
     * overhead can never overflow the real disk. Defaults to 0 (behaves
     * exactly like the pre-measurement model — `totalDiskGb` ceiling — until
     * the first cron tick populates it). Single source of truth for the
     * effective-capacity math: `lib/server/disk-capacity.ts`.
     */
    overheadDiskGb: integer("overhead_disk_gb").notNull().default(0),
    /** UTC timestamp of the last `server.measure-disk` run. Null until first measured. */
    diskMeasuredAt: timestamp("disk_measured_at", { withTimezone: true }),
    maxCpuOvercommit: numeric("max_cpu_overcommit", { precision: 4, scale: 2 })
      .notNull()
      .default("2"),
    maxRamOvercommit: numeric("max_ram_overcommit", { precision: 4, scale: 2 })
      .notNull()
      .default("1"),
    /**
     * Versions of the kernel + rootfs images currently sitting on
     * /var/lib/krova/images/ on this server. Updated by:
     *   - `server.pull-images` setup phase (initial sync)
     *   - `server.update-images` admin action (refresh on active server)
     *
     * Compared against `platform_images.version` to know if a server is
     * "behind" — operator should click Update Images.
     *
     * `currentRootfsVersions` is keyed by image name (e.g. "ubuntu-24.04",
     * "ubuntu-24.04-docker") because each server has multiple rootfs images on disk,
     * one per supported flavor.
     */
    currentKernelVersion: integer("current_kernel_version").notNull().default(0),
    currentRootfsVersions: jsonb("current_rootfs_versions")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    /**
     * The host's kernel boot identity (/proc/sys/kernel/random/boot_id),
     * recorded by cube.state-sync / server.reboot-recovery. A change means the
     * bare-metal host rebooted — the trigger for cube auto-recovery. Nullable:
     * null until the worker first observes this server.
     */
    lastBootId: text("last_boot_id"),
    /**
     * Per-server 16-bit subnet (S) — globally unique across the fleet so both
     * cube address families (`10.<S>.<octet>` IPv4 + `fd00:c0be:<S>::<octet>`
     * IPv6) derive globally-unique addresses. Allocated at server create under
     * advisory lock seed 3 (`allocateBridgeSubnet`). Nullable for pre-migration
     * rows; 0 is reserved for the legacy host (never auto-issued — MIN=1).
     */
    bridgeSubnet: integer("bridge_subnet"),
    /**
     * NUMA topology for L2 placement. `numaNodeCount` is the socket/NUMA-node
     * count (1 = single-socket → L2 is a no-op); `numaTopology` is the per-node
     * CPU-id list from /sys/devices/system/node/node*\/cpulist, detected at
     * bootstrap (or `pnpm install:numa-detect`). Null topology + count 1 until
     * detected → the no-op path (no cpuset emitted).
     */
    numaNodeCount: integer("numa_node_count").notNull().default(1),
    numaTopology:
      jsonb("numa_topology").$type<{ cpus: number[]; node: number }[]>(),
    /**
     * Per-physical-disk topology for the hardware-ADAPTIVE disk-I/O overhaul
     * (SATA-SSD vs NVMe vs virtio, rotational, current scheduler, device NUMA
     * node), auto-detected at bootstrap (or `pnpm install:disk-topology`) — Rule
     * 35 (auto-detected, never entered). Null until detected → the disk-tuning
     * paths fall back to base/no-op behavior. The `device` NUMA node feeds
     * NUMA-local backing placement; `nvme` selects the adaptive scheduler + QoS
     * caps. Shape matches `DiskTopology` in lib/server/disk-topology.ts.
     */
    diskTopology:
      jsonb("disk_topology").$type<
        {
          device: string;
          rotational: boolean;
          nvme: boolean;
          tran: string | null;
          scheduler: string | null;
          numaNode: number;
        }[]
      >(),
    /**
     * Measured sustained write speed (MB/s) from the clean-host disk benchmark
     * (install time, before any cube). Drives the disk-I/O host tuning when
     * present; null = never measured (existing fleet / skipped) → the tuning
     * falls back to the per-class heuristic. Never measured on a host with cubes
     * (contention under-reports + disturbs tenants).
     */
    diskWriteMbps: integer("disk_write_mbps"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("servers_status_idx").on(t.status),
    index("servers_region_id_idx").on(t.regionId),
    index("servers_status_region_id_idx").on(t.status, t.regionId),
    uniqueIndex("servers_bridge_subnet_unq")
      .on(t.bridgeSubnet)
      .where(sql`bridge_subnet IS NOT NULL`),
  ]
)
