# Disk I/O Overhaul — Operator Deployment Runbook

Companion to [the plan](2026-06-05-disk-io-overhaul.md) + [the audit](../../audits/2026-06-05-cube-disk-io-audit.md).
Branch: `feat/disk-io-overhaul`. **Every flag is OFF by default → deploying the branch changes NOTHING for your 30 live cubes** until you explicitly enable + canary. All host/prod steps are operator-run (Rule 60).

## What is implemented (ALL phases shipped on this branch)

| Phase | What | Flag | Applies |
|---|---|---|---|
| **A** | Topology auto-detection + flags + QoS helpers + migration `0074` (`servers.disk_topology`) | — (ungated detection) | bootstrap / retrofit |
| **B** | `cache_type=Writeback` (crash-safe fsync) on the rootfs drive | `DISK_WRITEBACK_CACHE_ENABLED` | next cold boot |
| **Canary** | Per-cube allowlist + `pnpm disk:canary <cubeId>` | `DISK_CANARY_CUBE_IDS` | one cube, next cold boot |
| **C** | Golden-image diet: ext4 `lazy_itable_init=0`, `noatime`, journald cap, masked apt-daily, docker log caps | — (next image build) | redeploy / new cubes |
| **D** | Host tuning: dirty-byte caps + adaptive `mq-deadline` + `fstrim.timer` + mdadm scrub throttle + serial.log rotation | `DISK_HOST_TUNING_ENABLED` | host-online |
| **E** | Per-cube QoS: Firecracker drive `rate_limiter` (guest) + host cgroup `io.max` backstop | `DISK_QOS_ENABLED`, `IO_CGROUP_ENABLED` | rate_limiter live; io.max next cold boot |
| **F** | Storage write-amp: restic `--sparse`/`--no-scan`/ionice, rclone serialize+bwlimit, zstd cap, cron stagger | `DISK_IO_STORAGE_TUNING_ENABLED` | host-online / live |

> A NUMA-disk placement phase was scoped but **dropped (2026-06-06)** — it was a no-op on the current single-`/var/lib/krova`-volume hosts and had no live caller. Re-add it (on `numa-launch-opts.ts`'s L2 placement) the day per-NUMA-node cube-storage volumes exist.

**Two deliberate non-changes (documented, not leftovers):** the cube-transfer `cp+rsync` double-copy COLLAPSE (a live cross-host data-move optimization) is left as today's proven behavior — it needs an operator canary on a real transfer (Rule 60) and the contention it caused is already handled by F's `ionice`; per-host cron serialization is likewise covered by `ionice` + the exclusive-cron policy.

---

## Step 0 — Apply the migration (additive, non-locking)

```bash
pnpm db:migrate        # adds the nullable servers.disk_topology column (0074). Safe on a live DB.
```

## Step 1 — Deploy the branch (everything inert)

Merge + deploy `feat/disk-io-overhaul`. All `DISK_*` flags are `false`; `DISK_CANARY_CUBE_IDS` is empty. **Zero behavior change.** The only active change is that new bootstraps / hardware-refreshes now record `disk_topology` (harmless metadata).

## Step 2 — Backfill disk topology onto the existing fleet

```bash
pnpm install:disk-topology      # read-only host probe → fills servers.disk_topology. Touches no cube.
```
Confirm each host shows its disks (e.g. `sda:ssd sdb:ssd` for SATA-RAID1, or `nvme0n1:nvme`).

## Step 3 — (Recommended first) Run Task 0 measurement

Run the operator `fio` + `iostat` bundle from [audit §5](../../audits/2026-06-05-cube-disk-io-audit.md#5-operator-measurements-rule-60--agent-prepares--operator-runs) on an EMPTY host + a live host. Use the QD1-durable number to confirm the SATA ceiling and (later) re-tune the rate-limiter caps before Phase E.

---

## Step 4 — Single-cube canary for the durability fix (cache_type=Writeback)

> **This is the "apply to one cube by ID and verify it runs" path.**

1. Pick a low-stakes running cube id. Add it to `DISK_CANARY_CUBE_IDS` in `config/platform.ts`:
   ```ts
   export const DISK_CANARY_CUBE_IDS: string[] = ["cube-abc123"];
   ```
   Commit + deploy. (Every other cube stays byte-identical.)
2. Apply it to that one cube:
   ```bash
   pnpm disk:canary cube-abc123
   ```
   This enqueues a cold-restart of just that cube; the worker kills + relaunches it, and on relaunch it boots with `cache_type=Writeback`. (The command aborts with a clear message if the id isn't on the allowlist or the cube isn't running.)
3. Verify on the host (operator):
   - Dashboard shows the cube back to **running**; it networks.
   - SSH into the cube and confirm durable writes:
     ```bash
     dd if=/dev/zero of=/root/fsynctest bs=1M count=64 conv=fdatasync && echo "fsync durable OK"; rm -f /root/fsynctest
     ```
   - Optionally confirm the drive config on the host: the FC API for that cube shows `cache_type: "Writeback"`.
4. **Roll back the canary any time:** remove the id from `DISK_CANARY_CUBE_IDS`, deploy, `pnpm disk:canary cube-abc123` again → relaunches on the old (Unsafe) config.

## Step 5 — Host tuning (per host, then fleet)

The dirty-page caps + RAID scrub throttle are **sized to the disk, not a fixed
constant** — the host derives them from its **measured** write speed when one was
captured at install on a CLEAN host (stored in `servers.disk_write_mbps`), else
from the detected disk **class** (NVMe / SATA-SSD / HDD). The retrofit NEVER
benchmarks a live host (contention would under-report + disturb cubes).

```bash
pnpm install:disk-tuning banana   # ONE host first (recommended), then verify
pnpm install:disk-tuning          # fleet-wide
```
Each line prints the basis, e.g. `ok banana [per-class heuristic] (...)` or
`ok mango [measured 470 MB/s] (...)`.

Verify (operator) — values depend on the disk:
```bash
cat /proc/sys/vm/dirty_bytes              # SATA-SSD class → 268435456; measured → ~0.5s of write
cat /proc/sys/dev/raid/speed_limit_max    # SATA-SSD class → 50000; measured → ~10% of write (KB/s)
cat /sys/block/sda/queue/scheduler        # [mq-deadline] on SATA-SSD; [none] on NVMe
systemctl is-enabled fstrim.timer         # enabled
grep "disk class" /etc/sysctl.d/98-krova-disk.conf   # shows what it detected/used
```
This is the **Tier-1 writeback-stall fix**, safe to apply fleet-wide immediately
(it only bounds the dirty pool + tunes the scheduler; no cube restart). Existing
servers (with cubes) use the class heuristic; **new** servers auto-benchmark at
install (cube-free → accurate) and use the measured value. To bake the install
benchmark + tuning into every new host, flip `DISK_HOST_TUNING_ENABLED = true`.

**Re-applying to a server you already tuned:** after deploying updated code, just
re-run `pnpm install:disk-tuning <hostname>` — it re-writes the drop-in with the
current logic (measured if a clean benchmark was stored, else class). Idempotent,
live-safe, no cube restart.

## Step 6 — Fleet-flip the durability fix (after the canary soaks)

Once the canary cube has run happily for a soak period:
```ts
export const DISK_WRITEBACK_CACHE_ENABLED = true;   // config/platform.ts
```
Deploy. Each cube picks up `Writeback` on its **next cold boot** (provision / wake / cold-restart / reboot-recovery / snapshot-restore). The 30 live cubes are untouched until they relaunch — there is no mass restart. To migrate a specific cube immediately, `pnpm disk:canary <id>` (or any normal cold-restart) after the flag is on.

---

## Rollback (any layer, fully reversible)

- **Writeback:** `DISK_WRITEBACK_CACHE_ENABLED = false` (and clear `DISK_CANARY_CUBE_IDS`), deploy → cubes revert to Unsafe on next cold boot.
- **Host tuning:** on a host, `rm /etc/sysctl.d/98-krova-disk.conf /etc/udev/rules.d/60-krova-io-sched.rules`, then `sysctl -w vm.dirty_ratio=20 vm.dirty_background_ratio=10`, `udevadm control --reload-rules`. (Or set the flag off so new installs don't write them.)
- **Topology column:** harmless; leave it (additive).

## Step 7 — Per-cube QoS (Phase E: rate_limiter + io.max)

**The QoS caps now default to UNLIMITED** (every tier ships `bandwidthMbps: null`,
`iops: null`). With unlimited defaults, `buildDriveRateLimiter` / `cubeIoMax`
return `null`, so turning the QoS flags on emits NO `rate_limiter` and NO `io.max`
line — a customer keeps the full disk and the cube boot is byte-identical to
QoS-off. This makes flipping the flags a no-op you can ship with zero customer
impact, then dial in caps from Orbit when ready.

1. On every host, delegate the io/memory controllers (gated re-run of the cgroup prep):
   ```ts
   export const IO_CGROUP_ENABLED = true;   // config/platform.ts (then deploy)
   ```
   ```bash
   pnpm install:cpu-cgroup   # re-runs prep → krova parent now delegates +io +memory
   ```
2. Flip the guest-layer QoS: `export const DISK_QOS_ENABLED = true;` deploy.
   With unlimited defaults this throttles nothing yet — it just arms the machinery.
3. **Set caps when ready in Orbit → Platform settings → Disk QoS** (no redeploy).
   Leave a field blank = unlimited; set a number to cap it (the form shows the
   suggested per-tier values + the allowed ranges). Saving applies on each
   affected cube's NEXT cold boot. Start from the suggested values (a fair share
   of a ~480 MB/s array), or your own Task-0 numbers, and widen/tighten from there.
4. **Multi-server:** caps are LITERAL + GLOBAL — the same MB/s / IOPS number per
   tier on every server. Each host enforces them against its OWN backing device
   (the `io.max` device is resolved per-host: partition → parent disk, dm/LVM →
   own dev, nvme → parent), and the `mq-deadline` host-tuning rule is scoped to
   `sd*` so NVMe hosts keep their preferred `none` scheduler. Size a cap as a fair
   share of your SLOWEST relevant server. (Per-host NVMe up-scaling is reserved
   infra — `DISK_QOS_NVME_MULTIPLIER` — not wired in v1.)
5. Verify on a canary cold-boot (operator) AFTER setting a cap: the cube's FC
   drive shows a `rate_limiter`; its cgroup leaf shows the cap:
   `cat /sys/fs/cgroup/krova/<cubeId>/io.max` → `<maj:min> wbps=… rbps=…`. Both are
   fail-safe (a cube with no io delegation just runs without io.max — never bricks).

## Step 8 — Storage write-amp (Phase F)

```ts
export const DISK_IO_STORAGE_TUNING_ENABLED = true;   // deploy
```
Live + host-online: restic gains `--sparse`/`--no-scan`/`ionice`, rclone serializes + `--bwlimit` (set `RCLONE_BWLIMIT_MB`), zstd thread cap (`DISK_ZSTD_THREADS`), the auto-snapshot cron staggers off `:00`, and the host serial.log logrotate installs (re-run `pnpm install:disk-tuning`). No cube restart.

## Step 9 — Golden-image diet (Phase C)

```bash
pnpm build:images   # bakes lazy_itable_init=0 + noatime + journald cap + masked apt-daily + docker log caps
```
New cubes get it immediately; existing cubes inherit on their next redeploy.

---

## Testing — what to run / verify

**Agent-runnable (already green on this branch):**
- `pnpm test:all` — unit (331) + migration chain (0074) + DB integration. The single gate (Rule 59).
- `pnpm typecheck` + `pnpm lint` — clean.
- Pure helpers covered: topology parse, rate-limiter/io.max sizing, io.max line builder, drive-body flag-off byte-identity, host-tuning + cgroup script `bash -n` + content.

**Operator host validation (Rule 60 — you run these; the dev host already passed each):**
1. **Task 0 fio** (audit §5) on an empty host + a live host — sets the real SATA ceiling + final rate-limiter caps.
2. **Writeback canary:** `pnpm disk:canary <id>` → cube boots → in-cube `dd … conv=fdatasync` durable.
3. **Host tuning:** `pnpm install:disk-tuning` → `cat /proc/sys/vm/dirty_bytes` = 268435456, scheduler `[mq-deadline]` on SATA, `fstrim.timer` enabled.
4. **io.max:** after `IO_CGROUP_ENABLED` + `install:cpu-cgroup`, cold-boot a cube → `cat /sys/fs/cgroup/krova/<id>/io.max` shows the cap; run a buffered-write hog in a neighbour cube and confirm a victim cube's I/O is no longer starved (`iostat -x`).
5. **Storage:** trigger a backup with `DISK_IO_STORAGE_TUNING_ENABLED` on → confirm `ionice`/`--bwlimit` via `pidstat -d` (restic no longer pins the array).
6. **`pnpm test:host <dev-ssh>`** — Tier-2 Firecracker lifecycle smoke after the FC drive-config + cgroup changes (needs `/dev/kvm`).

**Dev-host validations already performed (2026-06-05):** page-cache ~47× proof; FC `cache_type=Writeback`+`rate_limiter` boot (204, guest up); cgroup `io.max` throttles a buffered hog (10 MB/s); io+memory delegation; io.max device resolution (vda2→parent 253:0) + leaf-write; dirty-byte sysctls + mq-deadline + fstrim applied + restored.

## Order summary

`db:migrate` → deploy (inert) → `install:disk-topology` → **Task 0 fio** → **single-cube Writeback canary** → soak → `install:disk-tuning` (safe fleet-wide) → flip `DISK_WRITEBACK_CACHE_ENABLED` → `IO_CGROUP_ENABLED`+`install:cpu-cgroup`+`DISK_QOS_ENABLED` → `DISK_IO_STORAGE_TUNING_ENABLED` → `pnpm build:images`. Each step independently reversible (flip the flag false / remove the drop-in).
