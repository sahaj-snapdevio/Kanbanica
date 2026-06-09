/**
 * Platform Configuration
 *
 * Single source of truth for all non-sensitive platform settings.
 * Edit this file and redeploy to change values.
 *
 * Sensitive config (SMTP, Pusher/Soketi, OAuth, DB) lives in environment variables.
 */

// ── Platform Branding ─────────────────────────────────────────────────

/** Product name displayed in the UI, emails, and page titles. */
export const PRODUCT_NAME = "Krova";

/** Path to the logo image (relative to public/). Used in layouts and emails. */
export const LOGO_PATH = "/logo.png";

/**
 * Brand accent palette (Krova teal). Single source of truth for any surface
 * that CANNOT read the oklch design tokens in `app/globals.css` at runtime —
 * chiefly the email templates (inboxes don't evaluate CSS custom properties).
 * These hex values mirror the `--primary` teal scale in globals.css; keep them
 * in sync if the brand hue ever changes. Errors stay red and warnings stay
 * amber (universal status conventions), so only the brand teal lives here.
 */
export const BRAND_COLORS = {
  /** teal-600 — `--primary`. Buttons, links, accent bars, positive values. */
  teal: "#0d9488",
  /** teal-50 — `--primary-foreground`. Soft tint background for success badges. */
  tealTintBg: "#f0fdfa",
  /** teal-200. Border for success badges / tinted surfaces. */
  tealTintBorder: "#99f6e4",
  /** teal-700. Readable text/icon color on a teal-tint background. */
  tealDark: "#0f766e",
} as const;

// ── Plans & Tiers ─────────────────────────────────────────────────────

// ── Polar (constants only; tunables live in `platform_settings`) ──────

/**
 * Polar event name + meter filter for overage events. This is hard-coded
 * (not in `platform_settings`) because the matching event filter must be
 * configured in the Polar dashboard with this exact string. The meter id
 * itself (`platform_settings.polarOverageMeterId`) is operator-set and may
 * differ between sandbox / production / re-creation.
 */
export const POLAR_OVERAGE_EVENT_NAME = "krova_overage_usd";

// ── Credit Rates (USD per hour) ───────────────────────────────────────

/**
 * Cost per vCPU per hour. Cheap because Firecracker safely oversubscribes
 * CPU on bare-metal (2–4×). RAM and disk are sold honest 1:1 with the
 * host — no overselling.
 */
export const VCPU_RATE = 0.001;

/** Cost per GB of RAM per hour. Sold 1:1 with host RAM — never oversold. */
export const RAM_RATE = 0.0025;

/** Cost per GB of disk per hour. Sold 1:1 with host SSD — never oversold. */
export const DISK_RATE = 0.000_05;

// ── Volume Discount Tiers ─────────────────────────────────────────────

export interface CreditRateTier {
  /** Human-readable tier name. */
  label: string;
  /** Maximum vCPUs (inclusive). Null = unlimited. */
  maxVcpus: number | null;
  /** Minimum vCPUs (inclusive) for this tier. */
  minVcpus: number;
  /** Multiplier applied to base rates (e.g., 0.85 = 15% discount). */
  multiplier: number;
}

/** Volume discount tiers — sorted by vCPU range ascending. */
export const CREDIT_RATE_TIERS: CreditRateTier[] = [
  { minVcpus: 1, maxVcpus: 2, multiplier: 1.0, label: "Standard" },
  { minVcpus: 3, maxVcpus: 4, multiplier: 0.95, label: "Plus" },
  { minVcpus: 5, maxVcpus: 8, multiplier: 0.85, label: "Pro" },
  { minVcpus: 9, maxVcpus: null, multiplier: 0.8, label: "Enterprise" },
];

// ── Cube Resource Options ─────────────────────────────────────────────

export interface RangeConfig {
  max: number;
  min: number;
  step: number;
}

/** vCPU range for cube creation (supports fractional vCPUs). */
export const CPU_OPTIONS: RangeConfig = { min: 1, max: 16, step: 1 };

/** RAM range in MB for cube creation. */
export const RAM_OPTIONS: RangeConfig = { min: 1024, max: 32_768, step: 1024 };

/** Disk range in GB for cube creation. */
export const DISK_OPTIONS: RangeConfig = { min: 10, max: 100, step: 5 };

/**
 * Firecracker virtio-mem hotplug parameters.
 *
 * - VIRTIO_MEM_BOOT_FLOOR_MIB: the locked-at-boot RAM (`mem_size_mib`).
 *   Set to the platform minimum so cubes can scale down to the smallest
 *   tier in future without a cold cycle. Cannot ever shrink below this.
 * - VIRTIO_MEM_TOTAL_SIZE_MIB: the address window of the virtio-mem device.
 *   Must equal (platform-max RAM) − BOOT_FLOOR, and must remain a multiple
 *   of `VIRTIO_MEM_SLOT_SIZE_MIB`.
 *
 * Total guest RAM = BOOT_FLOOR + plugged_size_mib (set per cube via PATCH).
 *
 * NOTE: If `RAM_OPTIONS.max` (currently 32768) ever changes, bump
 * `VIRTIO_MEM_TOTAL_SIZE_MIB` to match: `RAM_OPTIONS.max - VIRTIO_MEM_BOOT_FLOOR_MIB`,
 * keeping the result a multiple of `VIRTIO_MEM_SLOT_SIZE_MIB`.
 */
export const VIRTIO_MEM_BOOT_FLOOR_MIB = 1024;
export const VIRTIO_MEM_TOTAL_SIZE_MIB = 31_744; // 32768 − 1024, multiple of VIRTIO_MEM_SLOT_SIZE_MIB

/**
 * virtio-mem block size — minimum host-side memory plug granularity.
 * 2 MiB is the smallest value that pairs cleanly with x86_64 hugepage alignment.
 */
export const VIRTIO_MEM_BLOCK_SIZE_MIB = 2;

/**
 * virtio-mem slot size — host-side reservation granularity.
 * 128 MiB matches Firecracker's default. `VIRTIO_MEM_TOTAL_SIZE_MIB` must
 * remain a multiple of this value.
 */
export const VIRTIO_MEM_SLOT_SIZE_MIB = 128;

/**
 * Single source of truth for every Cube guest distro the platform supports.
 *
 * Every other file that references "what distros do we have?" derives from
 * this list:
 *   - `IMAGE_OPTIONS` below: `{value, label}` for the cube-create dropdown
 *   - `scripts/build-images.ts`: imports `CUBE_IMAGES`, derives the build /
 *     compress / register pipeline
 *   - `setup/images/build-all-images.sh`: receives a generated bash snippet
 *     written by `scripts/build-images.ts` (env var `KROVA_DISTROS_FILE`)
 *     listing every distro and its build params. The build script then
 *     dispatches generically — no hardcoded `do_ubuntu2404` etc.
 *
 * To add a distro: add ONE entry here. Run `pnpm build:images`. Done.
 * To remove a distro: delete the entry. Run `pnpm build:images`. Done.
 *
 * Removing a distro is destructive for any cubes already provisioned
 * against it — the rootfs file on the host stays usable so existing
 * cubes keep booting, but the dropdown stops offering that distro for
 * new cube creation.
 *
 * Intentionally narrow — the two Ubuntu flavors that cover the dominant
 * customer demand:
 *   - Ubuntu 24.04: most popular default; what Docker / Dokploy / k3s docs assume
 *   - Ubuntu 24.04 + Docker: same Ubuntu base with Docker Engine + Compose
 *     plugin preinstalled from Docker's official apt repo (per
 *     https://docs.docker.com/engine/install/ubuntu/). The platform kernel
 *     already ships every CONFIG_* container runtimes need, so this variant
 *     just spares the customer the install step on first boot.
 */
export interface CubeImage {
  /** Codename — `noble`, `bookworm`, etc. For RHEL family use the
   *  version (no codename concept). Used by debootstrap and apt sources. */
  codename: string;
  /** Docker base image used during the rootfs build. The build script
   *  runs a privileged container of this image and bootstraps the rootfs
   *  inside it via debootstrap (`debian` family) or `dnf --installroot`
   *  (`rhel` family). */
  dockerImage: string;
  /** Distro family — drives which build path runs. Only `debian`
   *  (debootstrap) is supported today. */
  family: "debian";
  /** Stable identifier — used as imageId in DB, filename prefix
   *  (`{id}.ext4.zst`), and the `do_<id>` build target name. */
  id: string;
  /** Human-readable name shown in UI dropdowns. */
  label: string;
  /** When true, the rootfs builder installs Docker Engine + Compose plugin
   *  from Docker's official apt repo and enables docker.service +
   *  containerd.service at boot. Defaults to false. */
  preinstallDocker?: boolean;
  /** Vendor / package source name. Matches the systemd `ID=` field. */
  vendor: "ubuntu";
  /** Version string (e.g. "24.04", "12", "9"). */
  version: string;
}

export const CUBE_IMAGES: CubeImage[] = [
  {
    id: "ubuntu-24.04",
    label: "Ubuntu 24.04",
    family: "debian",
    vendor: "ubuntu",
    version: "24.04",
    codename: "noble",
    dockerImage: "ubuntu:24.04",
  },
  {
    id: "ubuntu-24.04-docker",
    label: "Ubuntu 24.04 + Docker",
    family: "debian",
    vendor: "ubuntu",
    version: "24.04",
    codename: "noble",
    dockerImage: "ubuntu:24.04",
    preinstallDocker: true,
  },
];

/**
 * Derived dropdown options for cube creation. **Do NOT edit this list
 * directly** — add or remove entries in `CUBE_IMAGES` above and this
 * dropdown updates automatically.
 */
export const IMAGE_OPTIONS: { value: string; label: string }[] =
  CUBE_IMAGES.map((img) => ({ value: img.id, label: img.label }));

// ── Image Versioning ──────────────────────────────────────────────────

/**
 * Major version for kernel + rootfs build artifacts. Stored only here, not
 * in the DB — manually bumped (and code shipped) when there is a meaningful
 * compatibility-breaking change in the build pipeline. The minor is the
 * `version` integer in `platform_images`, auto-incremented by
 * `pnpm build:images` whenever the artifact's sha256 changes.
 *
 * Display format: `v${IMAGE_VERSION_MAJOR}.${minor}` (e.g. v1.0, v1.1, v1.10).
 * Use `formatImageVersion(minor)` from `lib/version.ts` for consistent rendering.
 */
export const IMAGE_VERSION_MAJOR = 1;

// Snapshot configuration moved per-plan in the 2026-05-25 overhaul.
// See `plans.auto_snapshot_*` + `plans.max_manual_snapshots_per_cube`.
// The hourly `snapshot.scheduler` cron decides cadence per cube; the
// daily `snapshot.auto-prune` cron enforces retention via `restic forget`.

// ── Error Notifications ──────────────────────────────────────────────

/** Admin email addresses to receive error notifications from background jobs. */
export const ERROR_NOTIFY_EMAILS: string[] = [];

// ── Server Setup ─────────────────────────────────────────────────────

/** Firecracker release tag installed by the server.install setup phase.
 *  Verified against https://github.com/firecracker-microvm/firecracker/releases */
export const FIRECRACKER_VERSION = "v1.15.1";

/**
 * Firecracker jailer hardening — see
 * docs/superpowers/plans/2026-05-29-firecracker-jailer-hardening.md.
 *
 * JAILER_ENABLED is the master kill-switch. When false, cubes launch BARE
 * (legacy `nohup firecracker` as root). When true, NEW launches go through the
 * jailer: per-cube unprivileged uid/gid, chroot, and a new PID namespace (the
 * isolation boundary). No cgroup resource confinement is applied — see
 * `buildJailerArgs` in lib/ssh/jailer.ts for why `--cgroup-version 2` is set
 * but no `--cgroup` limits are passed. Cubes
 * already running in either mode always tear down correctly via
 * `cubes.launch_mode`, independent of this flag — so flipping it back to false
 * is a clean rollback (new cubes go bare again; existing jailed cubes keep
 * working). Enabled fleet-wide on 2026-05-30 after canary validation on banana
 * + mango: jailed boot (SSH + workload), per-cube uid isolation, sleep/wake,
 * snapshot/restore, and cross-host transfer all verified on real cubes.
 */
export const JAILER_ENABLED = true;
/**
 * Per-cube canary allowlist: cube ids that launch JAILED even while
 * `JAILER_ENABLED` is false. Empty now that the jailer is enabled fleet-wide —
 * retained as the mechanism for future targeted canaries (validating a jailer
 * change on one cube before a fleet rollout) without flipping the global flag.
 */
export const JAILER_ENABLED_CUBE_IDS: string[] = [];
/** Jailer binary path on hosts. Installed from the SAME Firecracker release
 *  tarball as the firecracker binary (server.install phase + `pnpm install:jailer`). */
export const JAILER_BIN = "/usr/local/bin/jailer";
/** Base dir under which the jailer builds per-cube chroots, laid out as
 *  `<base>/firecracker/<cubeId>/root/` (jailer v1.15 layout). MUST exist before
 *  launch — the jailer canonicalizes this path and refuses to create it
 *  (confirmed on canary 2026-05-29). */
export const JAILER_CHROOT_BASE = "/var/lib/krova/jail";
/** Per-cube unprivileged uids are allocated from this base upward, unique per
 *  host (see lib/server/jailer-uids.ts). 100000 sits well above all system
 *  uids on Debian/Ubuntu, so it never collides with a real account. */
export const JAILER_UID_BASE = 100_000;

/**
 * Per-cube host cgroup-v2 `cpu.weight` fairness (audit C2 / L1 — see
 * docs/superpowers/specs/2026-06-03-oversold-cpu-fairness-numa-design.md).
 * Default FALSE: with the flag off, `buildJailerArgs` emits NO `--cgroup`, the
 * `CPU_CGROUP_PARENT` cgroup is never created, and every jailed launch is
 * byte-identical to today (the jailer no-ops a missing parent — verified against
 * the v1.15.1 docs + a live canary). Flip true ONLY after `pnpm install:cpu-cgroup`
 * has prepared the parent cgroup on the host AND a canary cube confirms cpu.weight
 * applies + the cube boots + networks (the brick-the-host invariant — see
 * lib/ssh/jailer.ts). Work-conserving (`cpu.weight`, no `cpu.max`) so overselling
 * is preserved; it only arbitrates the share under contention.
 */
export const CPU_CGROUP_ENABLED = true;
/** Dedicated parent cgroup for per-cube cpu.weight confinement — deliberately NOT
 *  the jailer's default `firecracker`, so the new path is fully decoupled from the
 *  legacy no-cgroup launch (a flag-off cube never touches this tree). The jailer
 *  places each cube in the leaf `/sys/fs/cgroup/<CPU_CGROUP_PARENT>/<cubeId>`
 *  (confirmed on canary 2026-06-03; root already delegates `cpu` via systemd, so
 *  only `+cpu` on this parent's subtree_control is needed). */
export const CPU_CGROUP_PARENT = "krova";

/**
 * L2 — NUMA-aware placement (design 2026-06-03). Default FALSE: with the flag
 * off, no cpuset is added to the jailer args — byte-identical to L1-only. The
 * krova parent's cpuset DELEGATION is prepped UNCONDITIONALLY (inert — a leaf
 * with no explicit cpuset inherits the full machine = no pinning), so a host is
 * L2-ready after `pnpm install:cpu-cgroup` regardless of this flag. When ON,
 * `launchJailed` binds each cube to its assigned NUMA node via
 * `--cgroup cpuset.cpus=<node cores − housekeeping> cpuset.mems=<node>` on hosts
 * with detected multi-node topology; single-socket / undetected hosts are an
 * automatic no-op. Fail-safe: missing topology / un-delegated cpuset → launch
 * WITHOUT cpuset (the cube still boots). Flip true ONLY after a dual-socket
 * canary confirms cpuset binds + the cube boots/networks.
 */
export const NUMA_PLACEMENT_ENABLED = true;
/**
 * Logical cores reserved for the host OS / IRQ / Caddy, excluded from every
 * cube's cpuset (the N lowest cpu ids). Firecracker's prod-host-setup recommends
 * a small housekeeping carve-out so cube CPU load can't starve the host.
 */
export const HOUSEKEEPING_CORES_PER_HOST = 2;

// ── Disk I/O Tuning ───────────────────────────────────────────────────
//
// Six independently-gated layers from the disk-I/O overhaul (see
// docs/superpowers/plans/2026-06-05-disk-io-overhaul.md + the matching audit).
// EVERY flag defaults FALSE so a flag-off host/cube is byte-identical to today.
// Flip a flag true ONLY after its `pnpm install:*` retrofit has prepped the
// fleet AND a single-cube canary confirms the knob applied + the cube boots
// (mirrors the L1 CPU_CGROUP_ENABLED / L2 NUMA_PLACEMENT_ENABLED rollout). Every
// per-cube knob is fail-safe: a malformed/un-resolvable value degrades to
// launch-WITHOUT, never bricks the boot.

/**
 * D1 — Firecracker `cache_type=Writeback` on every cube rootfs drive. Default
 * FALSE: flag-off the PUT /drives body omits `cache_type` (FC defaults to
 * `Unsafe`) and `io_engine` (FC defaults to `Sync`) → byte-identical to today.
 * When ON, the drive advertises VIRTIO_BLK_F_FLUSH so a guest `fsync` is durable
 * to the backing .ext4 (no silent data loss on host power-loss). Boot-config
 * field → applies on a cube's NEXT cold boot only; the live cubes stay on
 * Unsafe until they relaunch. Flip true after a canary cube boots + an fsync
 * durability check passes. (Live-validated 2026-06-05: FC v1.15.1 accepts
 * cache_type:"Writeback", the guest boots, a bogus value 400s.)
 */
export const DISK_WRITEBACK_CACHE_ENABLED = true;

/**
 * Per-cube CANARY allowlist for the disk-I/O overhaul (mirrors
 * `JAILER_ENABLED_CUBE_IDS`). A cube whose id is listed here gets the per-cube
 * disk features (currently `cache_type=Writeback`) on its NEXT cold boot EVEN
 * while the global `DISK_*` flags are off — the mechanism for validating the
 * overhaul on ONE real cube before flipping a fleet-wide flag. Every other cube
 * stays byte-identical to today. Operator workflow: add the cube id here →
 * deploy → `pnpm disk:canary <cubeId>` cold-restarts just that cube so it
 * relaunches with the changes → verify (fsync durability + the cube boots/runs).
 * Empty by default. Resolved via `isDiskCanaryCube()` in lib/cubes/disk-canary.ts.
 */
export const DISK_CANARY_CUBE_IDS: string[] = ["cl59y73jyd252ho7i8orf2fh"];

/**
 * Per-cube Firecracker drive `rate_limiter` (customer-facing, live-PATCHable
 * QoS). Default FALSE: no `rate_limiter` in the PUT body → byte-identical. When
 * ON, each cube gets a bandwidth token-bucket sized by its tier (derived from
 * vcpus) so one cube can't saturate the shared SATA SSD at the virtio layer.
 * Sizing finalized from the Task-0 fio measurement; the values below are
 * conservative pre-measurement defaults. Throttles guest submission only — the
 * host page-cache→disk flush is bounded by IO_CGROUP_ENABLED (the two layers
 * compose). Live-updatable via PATCH /drives/{id} {drive_id, rate_limiter}.
 */
export const DISK_QOS_ENABLED = true;

/**
 * Host cgroup-v2 `io.max` per-cube isolation backstop. Default FALSE: the krova
 * parent delegates only `cpu` (+ optional `cpuset`) — adding `+io +memory` is
 * gated so a flag-off host's cgroup hierarchy is byte-identical. When ON, the
 * `install:io-cgroup` retrofit delegates `+io +memory` on the krova parent and
 * the worker writes `io.max` directly to each cube's leaf AFTER the jailer
 * creates it (the jailer REJECTS an io.max --cgroup arg — live-proven), keyed on
 * the dm/LVM device backing the rootfs FILE (an `sd*` member would throttle
 * nothing). io.max is the ONLY thing that bounds buffered writeback. Requires
 * CPU_CGROUP_ENABLED (the leaf only exists when the jailer got a --cgroup arg).
 * Running-cube-safe + live-updatable. (Live-validated 2026-06-05: io.max caps a
 * buffered-write hog to the set rate, with `io` alone — `memory` kept as
 * cross-kernel insurance.)
 */
export const IO_CGROUP_ENABLED = true;

/**
 * D4 — host kernel disk tuning (byte-based dirty-page caps, mq-deadline udev pin
 * for SATA SSD, weekly fstrim.timer, mdadm scrub throttle, serial.log rotation).
 * Default FALSE: the `install:disk-tuning` retrofit writes nothing → kernel
 * defaults retained. Applies host-online (sysctl --system + udevadm trigger, no
 * reboot). Operator-run per Rule 60.
 */
export const DISK_HOST_TUNING_ENABLED = true;

/**
 * Storage-path write-amplification tuning: restic `--sparse`/`--no-scan` +
 * ionice/nice, rclone `--multi-thread-streams 1`/`--s3-upload-concurrency 1`/
 * `--bwlimit`, capped zstd threads, the cube-transfer double-copy collapse, and
 * per-host cron serialization. Default FALSE: every restic/rclone arg string +
 * cron loop is byte-identical to today.
 */
export const DISK_IO_STORAGE_TUNING_ENABLED = true;

/**
 * Host page-cache writeback bounds (bytes / centiseconds), written to
 * `/etc/sysctl.d/98-krova-disk.conf` by the disk-host-tuning step + the
 * `install:disk-tuning` retrofit (gated on DISK_HOST_TUNING_ENABLED).
 *
 * **Sized PER DETECTED DISK CLASS, never per RAM.** The kernel's ratio-based
 * default (`dirty_ratio = 20% of RAM`) is the BUG this fixes — on a big-RAM host
 * it lets a multi-GB dirty pool build that stalls every co-tenant when it flushes
 * to the disk's write ceiling. The correct input is the disk's WRITE SPEED, not
 * RAM, so `diskHostTuningScript` detects the class of the disk backing cube
 * storage ON THE HOST (NVMe / SATA-SSD / HDD) and picks the matching value here.
 * Each ≈ a fraction of a second of that class's sustained write (so a flush
 * drains fast). SATA-SSD keeps the validated 256/64 MiB values; NVMe scales up
 * (drains faster → a bigger pool is safe); HDD scales down (flushes slowly).
 * Keep dirty_writeback_centisecs at the kernel default (500). Operator-tunable.
 */
export type DiskClass = "nvme" | "ssd" | "hdd";
export const DISK_DIRTY_BYTES_BY_CLASS: Record<DiskClass, number> = {
  nvme: 1_073_741_824, // 1 GiB  (~0.5 s of ~2 GB/s NVMe)
  ssd: 268_435_456, //    256 MiB (~0.5 s of ~500 MB/s SATA-SSD — the validated value)
  hdd: 100_663_296, //    96 MiB  (HDDs flush slowly — keep the pool small)
};
export const DISK_DIRTY_BACKGROUND_BYTES_BY_CLASS: Record<DiskClass, number> = {
  nvme: 268_435_456, //   256 MiB (≈ 1/4 of the dirty cap)
  ssd: 67_108_864, //     64 MiB
  hdd: 33_554_432, //     32 MiB
};
export const DISK_DIRTY_EXPIRE_CENTISECS = 1500; // 15 s (time-based — class-independent)

/**
 * mdadm scrub (`check`) throughput cap in KiB/s per disk class, written as
 * `dev.raid.speed_limit_max`. ~10–15 % of that class's sustained write so the
 * monthly read-both-mirrors scrub yields to live cube I/O; speed_limit_min stays
 * at the kernel default (1000) so it still makes progress when idle. Picked on the
 * host from the detected class, same as the dirty-page caps.
 */
export const RAID_SCRUB_MAX_KBPS_BY_CLASS: Record<DiskClass, number> = {
  nvme: 300_000, // 300 MB/s
  ssd: 50_000, //   50 MB/s (the validated SATA value)
  hdd: 30_000, //   30 MB/s
};

/**
 * Disk write-speed benchmark + the tuning DERIVED from a measured result. The
 * benchmark writes `DISK_BENCHMARK_WRITE_MIB` MiB via O_DIRECT (bypasses the page
 * cache → measures the real device) and stores the MB/s as `servers.disk_write_mbps`.
 * It runs ONLY on a CLEAN host (no cubes) — at install time, before any tenant —
 * because a benchmark on a busy disk both under-reports (contention) and disturbs
 * running cubes. A measured server derives its tuning from the real number; a
 * server without a measurement (existing fleet, or a skipped/failed benchmark)
 * falls back to the per-class heuristic above.
 *
 * Derivation (see `deriveDiskTuning`): dirty pool ≈ `DISK_DIRTY_POOL_SECONDS` of
 * the measured write (clamped to [floor, cap]); background = pool / 4; scrub cap ≈
 * `DISK_SCRUB_BANDWIDTH_FRACTION` of the measured write (floored). At ~500 MB/s
 * SATA this reproduces the validated 256 MiB / 50 MB/s values; NVMe scales up.
 */
export const DISK_BENCHMARK_WRITE_MIB = 2048;
export const DISK_DIRTY_POOL_SECONDS = 0.5;
export const DISK_SCRUB_BANDWIDTH_FRACTION = 0.1;
export const DISK_DIRTY_BYTES_FLOOR = 67_108_864; // 64 MiB
export const DISK_DIRTY_BYTES_CAP = 2_147_483_648; // 2 GiB
export const DISK_SCRUB_MIN_KBPS = 10_000; // 10 MB/s — scrub still makes progress

/**
 * rclone `--bwlimit` for .cube blob transfers, in MB/s (0 = unlimited / flag
 * adds no --bwlimit). Bounds a backup/redeploy/export transfer so it can't
 * saturate the host disk + uplink against live cubes. Per-rclone-process.
 */
export const RCLONE_BWLIMIT_MB = 0;

/**
 * zstd worker-thread count for cube backup compression / archive extraction
 * (0 = `-T0` = all cores, today's behavior). Set > 0 to leave cores for
 * co-tenant cubes during a backup. Gated on DISK_IO_STORAGE_TUNING_ENABLED.
 */
export const DISK_ZSTD_THREADS = 0;

/**
 * NVMe headroom multiplier — RESERVED INFRA, NOT WIRED in v1. The per-cube QoS
 * caps are currently LITERAL + GLOBAL: a cap set for a tier applies as the same
 * MB/s / IOPS number to that tier's cubes on EVERY server, regardless of the
 * host's disk class. This is the predictable choice for a heterogeneous fleet
 * (see the multi-server notes in docs/architecture/images-and-guest.md). The
 * per-host disk DIFFERENCE is still honored where it matters: the host `io.max`
 * backstop resolves the actual backing device (sd / nvme / dm-LVM) on each
 * server at runtime. To later let faster (NVMe) hosts offer proportionally
 * larger caps, thread `servers.disk_topology` into `buildDriveRateLimiter` /
 * `cubeIoMax` (they already accept a topology arg + this multiplier); until then
 * the call sites pass `null`, so the effective multiplier is ×1 everywhere.
 */
export const DISK_QOS_NVME_MULTIPLIER = 4;

/**
 * Per-tier disk QoS sizing, bands ALIGNED to CREDIT_RATE_TIERS' vCPU ranges so a
 * cube's QoS tier and billing tier never drift. The tier is DERIVED from
 * `cube.vcpus` (there is no `cubes.tier` column) exactly as the credit
 * multiplier is.
 *
 * **DEFAULT IS UNLIMITED.** Every tier ships with `bandwidthMbps: null` and
 * `iops: null` — `null` on either axis means NO cap on that axis. A tier with
 * both null produces NO `rate_limiter` at all (a customer can use the full disk
 * by default), so turning on `DISK_QOS_ENABLED` is a no-op for customers until
 * an operator sets real caps in Orbit → Platform settings → Disk QoS. When a cap
 * IS set: `burstMultiplier` × the 1-second token size = `one_time_burst` (short
 * spikes burst into idle headroom; sustained stays bounded), and FC binds
 * whichever of the bandwidth / ops buckets fills first.
 *
 * `recommendedBandwidthMbps` / `recommendedIops` are HINTS ONLY (shown in the
 * Orbit form, never enforced) — sized from the Task-0 fio on `apple` (2026-06-05,
 * 2× Samsung MZ7LM1T9 SATA SSD RAID1+LVM): ~480 MiB/s sequential-write ceiling,
 * ~47.7k IOPS / 186 MiB/s random-write at QD32. They suggest a fair single-cube
 * share of a ~480 MiB/s array shared by up to ~30 cubes; adjust per your hardware.
 */
export interface DiskRateLimiterTier {
  /** Sustained read+write bandwidth cap, MB/s. `null` = UNLIMITED (no cap). */
  bandwidthMbps: number | null;
  /** `one_time_burst` = burstMultiplier × the 1-second token size (both buckets). */
  burstMultiplier: number;
  /** Sustained read+write IOPS cap. `null` = UNLIMITED (no cap). */
  iops: number | null;
  /** Human-readable tier name (matches CREDIT_RATE_TIERS). */
  label: string;
  /** Maximum vCPUs (inclusive). Null = unlimited vCPU range (top tier). */
  maxVcpus: number | null;
  /** Minimum vCPUs (inclusive). */
  minVcpus: number;
  /** HINT ONLY — suggested bandwidth cap (MB/s) shown in the Orbit form. */
  recommendedBandwidthMbps: number;
  /** HINT ONLY — suggested IOPS cap shown in the Orbit form. */
  recommendedIops: number;
}

export const DISK_RATE_LIMITER_TIERS: DiskRateLimiterTier[] = [
  {
    minVcpus: 1,
    maxVcpus: 2,
    bandwidthMbps: null,
    iops: null,
    burstMultiplier: 2,
    label: "Standard",
    recommendedBandwidthMbps: 60,
    recommendedIops: 8000,
  },
  {
    minVcpus: 3,
    maxVcpus: 4,
    bandwidthMbps: null,
    iops: null,
    burstMultiplier: 2,
    label: "Plus",
    recommendedBandwidthMbps: 120,
    recommendedIops: 14_000,
  },
  {
    minVcpus: 5,
    maxVcpus: 8,
    bandwidthMbps: null,
    iops: null,
    burstMultiplier: 2,
    label: "Pro",
    recommendedBandwidthMbps: 200,
    recommendedIops: 22_000,
  },
  {
    minVcpus: 9,
    maxVcpus: null,
    bandwidthMbps: null,
    iops: null,
    burstMultiplier: 2,
    label: "Enterprise",
    recommendedBandwidthMbps: 300,
    recommendedIops: 32_000,
  },
];

/**
 * Plausible operator-editable bounds for the disk QoS caps when a cap IS set
 * (leaving a field blank/unlimited is always allowed and bypasses these). They
 * just reject nonsense (negatives, zero, NaN, absurd typos). SINGLE SOURCE so the
 * runtime resolver guard (lib/cubes/disk-qos-tiers.ts), the Orbit save-action
 * Zod schema, and the Orbit form schema can never drift (Rule 14).
 */
export const DISK_QOS_CAP_BOUNDS = {
  bandwidthMbps: { min: 1, max: 100_000 },
  iops: { min: 1, max: 10_000_000 },
  burstMultiplier: { min: 1, max: 100 },
} as const;

/**
 * Attach a Firecracker virtio-rng entropy device (`PUT /entropy {}`, pre-boot)
 * to every cube so the guest has a high-quality RNG source at first boot (sshd
 * host-key + TLS + WireGuard key/handshake generation). The guest kernel
 * carries `CONFIG_HW_RANDOM_VIRTIO=y` (build-all-images.sh) so it binds the
 * device; older rootfs images simply ignore it. The `PUT /entropy` call is
 * FAIL-SAFE (see lib/ssh/firecracker.ts) — a host on a Firecracker that lacks
 * the device logs a warning and boots without it (pre-fix behavior), so this
 * flag can never brick a boot. Applies on a cube's NEXT cold boot only
 * (resume-from-paused does not re-run the boot config).
 *
 * OPERATOR (2026-06-02 audit W5): after enabling, CANARY one freshly-booted
 * cube — confirm the boot succeeded and `cat /proc/sys/kernel/random/entropy_avail`
 * is healthy — before relying on it across the fleet. Without an entropy device
 * an entropy-starved early boot can block getrandom() and stall sshd / WireGuard
 * key + handshake generation right after a (re)start.
 */
export const ENTROPY_DEVICE_ENABLED = true;

/**
 * Host NAT conntrack UDP idle timeouts (seconds), written to
 * `/etc/sysctl.d/98-krova-conntrack.conf` by the host networking phase and the
 * `pnpm install:network-tuning` retrofit. Raised above the kernel defaults
 * (30 unreplied / 120 assured) so an idle UDP overlay — e.g. a WireGuard mesh
 * peer without `PersistentKeepalive` — keeps its MASQUERADE conntrack entry
 * instead of having return traffic silently dropped after ~2 min, which stalls
 * the tunnel until a restart re-handshakes (2026-06-02 audit W2). Operator-tunable.
 */
export const CONNTRACK_UDP_TIMEOUT_SECONDS = 180;
export const CONNTRACK_UDP_STREAM_TIMEOUT_SECONDS = 600;

/** Linux kernel version compiled by `pnpm build:images`. Latest 6.1 LTS.
 *  Source: https://www.kernel.org/releases.json (longterm 6.1 branch).
 *  Single source of truth — exported as `KVER` env var to
 *  setup/images/build-all-images.sh by scripts/build-images.ts. */
export const KERNEL_VERSION = "6.1.174";

/** Firecracker CI baseline kernel config we layer Docker/nftables options
 *  on top of, then forward via `make olddefconfig` to KERNEL_VERSION.
 *  Firecracker only publishes ONE config per release line in their S3
 *  bucket — currently 6.1.155 for v1.15.x. Bump only when Firecracker
 *  ships a new baseline (re-check S3 listing periodically). */
export const KERNEL_CONFIG_VERSION = "6.1.155";

/** Caddy version tested on production servers. The server.install phase pins
 *  the install to this exact version on Debian/Ubuntu (`apt-get install
 *  caddy=<v>`) and holds it with `apt-mark hold`. Existing servers are
 *  upgraded to this version by the operator-triggered `server.update-caddy`
 *  job. Update this constant and validate on a server before rolling to prod.
 *  Source: https://github.com/caddyserver/caddy/releases
 *
 *  Bumped from 2.11.2 → 2.11.3 on 2026-05-18 to close three advisories, all
 *  fixed in 2.11.3 (released 2026-05-12):
 *    - GHSA-m675-2p33-xv9g (HIGH): unsafe Unicode handling in FastCGI splitPos
 *      lets non-PHP files execute.
 *    - GHSA-wwhq-w58m-w29c (HIGH): CVE-2026-30852 fix bypass — remote admin
 *      authorization bypass via array indexing on the admin socket.
 *    - GHSA-gx7w-56w6-g48x (MEDIUM): remote admin authorization bypass on PKI
 *      endpoints via prefix-based path matching.
 */
export const CADDY_VERSION = "2.11.3";

/**
 * Pinned restic version installed on every bare-metal host.
 *
 * Restic ships as a single self-contained Go binary published on GitHub:
 *   https://github.com/restic/restic/releases/download/v<version>/restic_<version>_linux_<arch>.bz2
 *
 * The host install step (`server-install.ts` "restic" step) curl-downloads
 * + bunzip2-decompresses + installs to `/usr/local/bin/restic`. The retrofit
 * script `scripts/install-restic.ts` does the same against the live fleet.
 *
 * Bump this value when restic releases a stable version with fixes we want.
 * Repo format is backwards-compatible across minor versions; major bumps
 * (e.g. v0.x → v1.0) should be tested on a non-production cube first.
 *
 * Pinned to 0.18.1 (verified against
 * https://github.com/restic/restic/releases — latest stable as of
 * 2026-05-23). The first release with `--json` summary message for
 * `restic backup` carrying `snapshot_id` (used by `lib/storage/restic/`
 * to capture the new snapshot id after each backup).
 */
export const RESTIC_VERSION = "0.18.1";

/**
 * Pinned rclone version installed on every bare-metal host.
 *
 * Rclone is the host-side transfer tool for cube backups (.cube archives) and
 * cube import uploads to/from the S3 storage backends. The install step at
 * `server-install.ts` "rclone" and the retrofit at `scripts/install-rclone.ts`
 * both download the matching zip from the upstream GitHub release:
 *   https://github.com/rclone/rclone/releases/download/v<version>/rclone-v<version>-linux-<arch>.zip
 *
 * Previously the install used the upstream `https://rclone.org/install.sh`
 * bash script which always picks the latest stable, causing version drift
 * across the fleet — two servers provisioned weeks apart could end up on
 * different rclone versions with different multipart / chunk-size defaults,
 * producing subtle throughput differences and reproducibility headaches.
 *
 * Bump this value when rclone releases a stable version with fixes we want.
 * Multipart S3 upload flags we depend on (`--multi-thread-streams`,
 * `--s3-upload-concurrency`, `--s3-chunk-size`) have been stable since the
 * 1.50 line, so any bump within 1.x is safe.
 *
 * Pinned to 1.74.2 — latest stable on 2026-05-24 per
 * https://github.com/rclone/rclone/releases/latest.
 */
export const RCLONE_VERSION = "1.74.2";

/**
 * The default port sshd listens on inside every newly-booted cube.
 *
 * Every cube boots with sshd on this port. The platform installs an iptables
 * port-forward from the public host port to the cube's IP at this port, and
 * stores the same value in `tcp_port_mappings.cubePort` so the rest of the
 * codebase can read it back instead of hardcoding 22 everywhere.
 *
 * After boot the customer can move sshd onto a different port inside their
 * cube and tell us about it by calling
 *   PUT /api/spaces/{spaceId}/cubes/{cubeId}/ssh-port
 * with `{ "cubePort": <int> }`. The worker job `tcp-mapping.update-cube-port`
 * then swaps the iptables rule in place (host port + whitelist preserved).
 *
 * The reachability cron and every iptables-rule consumer reads the LIVE
 * `tcp_port_mappings.cubePort` value, NOT this constant — this constant is
 * only the boot-time default. Bumping it would only affect cubes booted
 * AFTER the change; existing cubes carry the old value in their mapping row
 * until the customer changes it.
 */
export const DEFAULT_CUBE_SSH_PORT = 22;

/**
 * IPv6 + globally-unique networking (see
 * docs/superpowers/specs/2026-05-30-cube-ipv6-design.md).
 * `bridge_subnet` S (per server) drives BOTH families:
 *   IPv4 = base 198.18.0.0 + S*256 + octet, IPv6 = fd00:c0be:<S-hex>::<octet>.
 * S=0 is RESERVED for the one pre-existing host left un-re-IP'd, so the
 * allocator starts at 1.
 */
// Cube internal IPv4 base. 198.18.0.0/15 (RFC 2544) — chosen to avoid
// Docker Swarm (10/8), k8s/CNI (10.x), Tailscale (100.64/10), and RFC1918
// LANs. See docs/superpowers/specs/2026-05-31-cube-ipv4-rebase-198-18-design.md.
export const CUBE_IPV4_BASE = "198.18.0.0";
export const CUBE_IPV6_PREFIX = "fd00:c0be";
export const CUBE_BRIDGE_SUBNET_MIN = 1;
// 198.18.0.0/15 holds 512 /24s; S in [1,511] (S=0 reserved) → 511 servers.
export const CUBE_BRIDGE_SUBNET_MAX = 511;

/**
 * Guest /etc/resolv.conf nameservers, **IPv4-FIRST**. DNS resolution must never
 * depend on the cube's IPv6 egress: with a v6 resolver first, a blackholed or
 * flapping host v6 path makes glibc stall ~5s per v6 nameserver before falling
 * through to v4 (the confirmed "DNS timeout" symptom). With 1.1.1.1 first,
 * lookups resolve in ~1ms regardless of v6 state; the v6 resolvers stay as
 * 2nd/3rd for resilience when v6 egress is healthy. The transport family does
 * NOT constrain the record type — a v4 resolver still returns AAAA records — so
 * v4-first loses no IPv6 capability for customer apps. glibc honours only the
 * first MAXNS=3 (systemd-resolved is off), so exactly three entries.
 */
export const CUBE_DNS_SERVERS = [
  "1.1.1.1", // Cloudflare IPv4 (primary — DNS independent of v6 egress)
  "2606:4700:4700::1111", // Cloudflare IPv6 (fallback)
  "2001:4860:4860::8888", // Google IPv6 (fallback)
] as const;

/**
 * glibc resolver `options` line appended to the guest /etc/resolv.conf (consumed
 * ONLY by the resolv.conf builder, never the systemd-networkd `DNS=` lines):
 *   timeout:1             — cap each nameserver wait at 1s (glibc default is 5s),
 *                           so even a fully-blackholed v6 fallback costs ~1s.
 *   attempts:2            — glibc default, kept explicit.
 *   single-request-reopen — send the A and AAAA queries on SEPARATE sockets,
 *                           dodging the NAT/conntrack A+AAAA reply-race that
 *                           intermittently hangs lookups behind MASQUERADE.
 */
export const CUBE_RESOLV_OPTIONS = "timeout:1 attempts:2 single-request-reopen";

/**
 * Maximum automatic error-recovery attempts before the `cube.error-recovery`
 * cron gives up on a cube and notifies admins. The attempt counter
 * (`cubes.error_recovery_attempts`) resets to 0 when the cube next reaches
 * `running`, so a later unrelated error episode gets a fresh budget.
 */
export const MAX_ERROR_RECOVERY_ATTEMPTS = 3;

/**
 * Cloudflare proxy (orange-cloud) IPv4 CIDR ranges.
 * Source: https://www.cloudflare.com/ips-v4/ — check periodically for new ranges.
 *
 * Used by `lib/ssh/caddy.ts` for Caddy's `trusted_proxies` config: Caddy trusts
 * the `X-Forwarded-For` header from these ranges, so the real client IP carries
 * through the Cloudflare edge into Caddy access logs and to cube upstreams.
 */
export const CLOUDFLARE_PROXY_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const;

// ── Cloudflare for SaaS (custom domain routing) ───────────────────────

/** Cloudflare API v4 base URL. */
export const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";

/**
 * The Cloudflare zone every server hostname lives under. Server-facing
 * hostnames are pure functions of this + `servers.hostname`:
 *   - `<hostname>.<base>`         → proxied origin (Cloudflare for SaaS)
 *   - `connect.<hostname>.<base>` → DNS-only SSH + bare landing endpoint
 * See `lib/server/server-hostnames.ts`. Change the zone here, once.
 */
export const PLATFORM_BASE_DOMAIN = "krova.cloud";

/**
 * The fixed hostname every customer CNAMEs their custom domain to.
 * A proxied record in the platform's Cloudflare zone. Same for every
 * customer, forever.
 */
export const CLOUDFLARE_CNAME_TARGET = `dns.${PLATFORM_BASE_DOMAIN}`;

/**
 * Per-domain cooldown (seconds) between customer-initiated Cloudflare edge
 * cache purges. Throttles a single domain to one purge per window so a
 * customer cannot exhaust Cloudflare's zone-wide purge rate limit (Free
 * 5/min, Pro 5/s, …). Enforced atomically in the purge action; the worker
 * also auto-retries a transient Cloudflare 429. See
 * docs/superpowers/specs/2026-06-02-domain-cache-purge-design.md.
 */
export const DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS = 60;

// ── Space domain claims (TXT-verified domain locking) ─────────────────
/**
 * DNS label prefixed to a claimed domain for the ownership-verification TXT
 * record — e.g. a claim on `acme.com` is proven by a TXT at
 * `_krova-verify.acme.com`. See lib/domains/claim-coverage.ts.
 */
export const DOMAIN_CLAIM_TXT_HOST_PREFIX = "_krova-verify";
/**
 * Prefix of the TXT record VALUE; the full value is
 * `krova-domain-verification=<token>` where `<token>` is the claim's secret.
 */
export const DOMAIN_CLAIM_TXT_VALUE_PREFIX = "krova-domain-verification=";
/**
 * Consecutive `domain-claim.recheck` misses (the cron runs daily) after which a
 * `verified` claim auto-releases to `failed` — frees a lock whose TXT record
 * was removed / the domain transferred away. 3 ⇒ ~3 days of tolerance for a
 * transient DNS blip before the lock is released.
 */
export const DOMAIN_CLAIM_MAX_FAILED_CHECKS = 3;

// ── Public-facing email addresses ─────────────────────────────────────

/**
 * Customer-facing inboxes published on legal pages (ToS, Privacy, AUP,
 * Cookies) and the public footer. Routing for each address is configured
 * in the email provider, not here.
 *
 * `hello@` is the general front-door inbox for anything (sales, partnerships,
 * "hey, just curious"). `support@` is for product help — account issues,
 * billing questions, things you need fixed. `legal@` handles ToS, privacy /
 * data-rights requests, abuse reports and any other formal correspondence.
 */
export const PLATFORM_EMAILS = {
  hello: `hello@${PLATFORM_BASE_DOMAIN}`,
  support: `support@${PLATFORM_BASE_DOMAIN}`,
  legal: `legal@${PLATFORM_BASE_DOMAIN}`,
} as const;

// ── Social profiles (SEO: Organization `sameAs` + Twitter card) ───────

/**
 * Social profile handles. Leave any value as "" to omit it everywhere — the
 * SEO layer (lib/seo/social.ts) filters blanks, so filling one in later (and
 * changing nothing else) makes it appear automatically in the Organization
 * `sameAs` structured data and, for `x`, the Twitter card `site` / `creator`.
 *
 * Provide handles WITHOUT a leading "@" or domain:
 *   x:        "krovacloud"     -> https://x.com/krovacloud  (+ @krovacloud card)
 *   github:   "krova-cloud"    -> https://github.com/krova-cloud
 *   linkedin: "company/krova"  -> https://www.linkedin.com/company/krova
 *   youtube:  "@krovacloud"    -> https://www.youtube.com/@krovacloud
 *   instagram:"krova.cloud"    -> https://www.instagram.com/krova.cloud
 *   discord:  "cqfKd5mHR"      -> https://discord.gg/cqfKd5mHR  (invite code only)
 */
export const SOCIAL_HANDLES: {
  x: string;
  github: string;
  linkedin: string;
  youtube: string;
  instagram: string;
  discord: string;
} = {
  x: "krovacloud",
  github: "",
  linkedin: "",
  youtube: "",
  instagram: "krova.cloud",
  discord: "cqfKd5mHR",
};

// ── Legal entity (rendered into ToS / Privacy / AUP / Cookies) ────────

/**
 * Identity of the operating party behind the Service. Rendered on the
 * legal pages and used as the data-controller / contracting party. The
 * legal pages read from here so a single edit propagates everywhere.
 *
 * Each field except `name` is OPTIONAL. The pages degrade gracefully:
 *
 *   - `registeredAddress` empty → the address line is omitted from the
 *     privacy controller block and the contact footers.
 *   - `governingLaw` + `forum` empty → the Terms render a generic
 *     "governed by applicable law" clause instead of a specific
 *     choice-of-law / exclusive-forum clause.
 *   - `arbitrationVenue` empty → the binding-arbitration + class-action-
 *     waiver block in the Terms is omitted entirely.
 *
 * Once an operating entity is incorporated, fill the fields in. Example:
 *
 *   name: "Krova Cloud Inc.",
 *   registeredAddress: "1209 Orange Street, Wilmington, DE 19801, USA",
 *   governingLaw: "the State of Delaware, United States",
 *   forum: "the state and federal courts located in Wilmington, Delaware",
 *   arbitrationVenue: "Wilmington, Delaware",
 */
export const LEGAL_ENTITY: {
  name: string;
  registeredAddress: string;
  governingLaw: string;
  forum: string;
  arbitrationVenue: string;
} = {
  name: "Krova",
  registeredAddress: "",
  governingLaw: "",
  forum: "",
  arbitrationVenue: "",
};

/**
 * Window (in days) within which a customer must dispute a charge before
 * it is deemed accepted. 30 days is the industry default and the standard
 * card-network chargeback timeframe; longer windows expand operator
 * exposure to retroactive disputes.
 */
export const BILLING_DISPUTE_WINDOW_DAYS = 30;

// ── Browser terminal (xterm.js + krova-agent PTY over vsock) ──────────

/**
 * Idle timeout for a browser terminal session. The bridge tracks the
 * latest stdin/stdout activity timestamp; once this many ms have passed
 * with no traffic in either direction, the session is torn down and the
 * customer's tab shows "Disconnected — idle timeout".
 *
 * 15 min mirrors AWS SSM Session Manager's idle default and is long
 * enough to keep a paused customer (reading docs, switching windows)
 * connected without burning host PTYs on truly abandoned tabs.
 */
export const TERMINAL_SESSION_IDLE_MS = 15 * 60 * 1000;

/**
 * Hard ceiling per terminal session — once exceeded the bridge tears
 * down even if there's still active traffic. Prevents a forgotten tab
 * with a `tail -f` from holding a host PTY open indefinitely. The
 * customer re-opens to start a fresh session.
 */
export const TERMINAL_SESSION_HARD_MS = 4 * 60 * 60 * 1000;

/**
 * pg-boss `expireInSeconds` budget for the cube.terminal-bridge job.
 * Must be ≥ TERMINAL_SESSION_HARD_MS or the bridge handler would be
 * killed mid-session by the queue runtime. We add a small safety margin.
 */
export const TERMINAL_BRIDGE_EXPIRE_SECONDS = Math.ceil(
  (TERMINAL_SESSION_HARD_MS + 5 * 60 * 1000) / 1000
);
