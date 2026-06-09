# Cube Disk I/O — Audit & Best-Setup (2026-06-05)

Implementation plan: **[docs/superpowers/plans/2026-06-05-disk-io-overhaul.md](../superpowers/plans/2026-06-05-disk-io-overhaul.md)**.

**Owner decisions (locked 2026-06-05):**
- **D1 — `cache_type=Writeback` for ALL cubes.** Crash-safe persistent data is non-negotiable; the
  write-latency cost is bought back with host tuning + per-cube QoS (and optionally NVMe).
- **D2 — Hardware-ADAPTIVE.** Auto-detect each host's disk topology (SATA-SSD vs NVMe, rotational,
  `numa_node`) and tune per device. Runs optimally on SATA-RAID1 today and lights up NVMe headroom
  automatically. No forced procurement.

Versions in scope: Firecracker **v1.15.1** · **guest (microVM) kernel 6.1.174** (the **host** kernel is operator-verified at Task 0 — the 2026-06-05 dev host was 6.8) · restic **0.18.1** · rclone **1.74.2** · ext4 on mdadm RAID1 + LVM hosts, Ubuntu 24.04.

> **Live-validation host caveat:** the 2026-06-05 dev host is a **single-disk VM on kernel 6.8** (not SATA-RAID1/NVMe, not the guest's 6.1.174). The "Live-validated" notes below prove topology-**independent** correctness (cgroup throttling, the jailer io.max rejection, FC API acceptance, the page-cache effect) — they do **not** prove the SATA-vs-NVMe hardware numbers or adaptivity, which need an operator run on a real host (§5).

---

## 0. The one-paragraph answer

The "IO too low" instinct is real, but it has **two ceilings a naive benchmark hides**, plus a fleet of
self-inflicted write-amplifiers. (1) Every cube runs Firecracker's **`cache_type=Unsafe` default** — writes
are acked from host RAM, so an `fio` without `--direct` measures page cache, *and* a host power-loss silently
loses customer data. (2) The hosts are **SATA-SSD in mdadm RAID1**: a mirror writes every block to both disks,
so sustained write throughput **equals one SATA SSD (~550 MB/s, ~70–90k IOPS) — RAID1 buys redundancy and
read-scaling, never write speed.** (3) On top of that hard ceiling, the platform stacks **un-throttled,
un-serialized maintenance** (restic backup/prune/check, zstd -T0, rclone 4×4, full-image restores without
`--sparse`, a transfer double-copy, lazy ext4 inode-zeroing, guest log/atime/discard waste) that all collide
on that one shared device. The fix is layered: **Writeback** for durability, **host dirty-page + scheduler +
scrub tuning** to stop the flush-stall train, **per-cube QoS** (Firecracker `rate_limiter` + cgroup `io.max`)
so one tenant can't starve neighbours, and **write-amplification removal** across the snapshot/transfer/boot
paths — all flag-gated, hardware-adaptive, and rolled out the same way L1/L2 were.

---

## 1. Findings

| # | Finding | Severity | Evidence / note |
|---|---|---|---|
| F1 | The naive `fio` measures **host page cache**, not the SSD (Unsafe default + no `--direct` + a cache-resident working set). | informational | `cache_type` is unset at [firecracker.ts:852](../../lib/ssh/firecracker.ts#L852) & [:1219](../../lib/ssh/firecracker.ts#L1219) → Unsafe on every cube. Mechanism: Unsafe **never advertises `VIRTIO_BLK_F_FLUSH`**, so the guest never issues a flush and FC never `fsync`s the backing file — the guest `fsync` returns success with data only in host RAM. **Live-validated (2026-06-05, dev host):** same disk, buffered QD1 = **49,000 IOPS @ 12µs** vs `--direct+fdatasync` QD1 = **1,049 IOPS @ 234µs** — the cache inflated IOPS **~47×** and hid latency **~19×**. |
| F2 | Hosts are **SATA-SSD mdadm RAID1 + LVM**; sustained write ceiling ≈ one SATA SSD; the mirror gives **no write-bandwidth gain**. | medium | No code records disk topology today ([server-bootstrap.ts](../../lib/worker/handlers/server-bootstrap.ts), [servers.ts](../../db/schema/servers.ts) carry only `numa_topology`). Per-host SATA-vs-NVMe is confirmed by the operator probe in §5. |
| F3 | Keep `io_engine=Sync`; do **not** enable Async/io_uring. | informational | Async is **developer-preview / "not suitable for production"** in v1.15.1; it spawns up to `1 + NUMA·min(128, 4·nCPU)` io_uring workers *per drive* (PID-exhaustion at 30+ cubes); and on kernel 6.1.x io-wq workers ignore the cgroup **cpuset**, breaking L2 NUMA pinning. (The often-cited "workers escape to the root cgroup" is 5.10 behavior, fixed in 5.12 — not the reason here.) No upside on SATA. |
| F4 | `cache_type=Unsafe` is a **durability** decision — false `fsync` durability → data loss on host power-loss. Krova runs *persistent* customer cubes. | **HIGH** | RAID1+LVM do **not** protect against unflushed page-cache loss (they guard disk failure, not RAM loss). **D1 resolves it: `Writeback`.** Loss requires an *abrupt host-level* failure (power/panic/hard-reset) after a durable ack — clean reboots/sleep flush normally. |
| F5 | **No per-cube disk QoS** → noisy-neighbour; the backing file is sparse `truncate`. | medium | No `rate_limiter` anywhere; sparse `truncate -s` at [firecracker.ts:621](../../lib/ssh/firecracker.ts#L621). `cpu.weight` does **not** isolate disk I/O — the `krova` cgroup delegates only `cpu`, so a buffered-write hog escapes (see §3.2). |

---

## 2. The decisive mechanism — why it feels slow (the compounding HIGH)

The most important systemic issue is that four "small" gaps **multiply** into one failure mode:

- `cache_type=Unsafe` routes **all** guest writes into the host page cache as buffered writeback.
- With no `vm.dirty_bytes`/`dirty_background_bytes` ([server-install.ts:282](../../lib/worker/handlers/server-install.ts#L282) sets only `overcommit`+`swappiness`), the dirty pool grows to the **ratio default (~10–20 % of RAM = many GB)**.
- The kernel flusher then drains that multi-GB pool as **one stall train** through the default scheduler to a device with the write bandwidth of **one** SATA SSD.
- Every cube's I/O stalls behind that flush → the **57→684 MiB/s swing** observed in benchmarking.

That is the noisy-neighbour / "inconsistent, sometimes-slow disk" customers feel. It is fixed by Writeback
(durability) + dirty-byte caps + `mq-deadline` + per-cube QoS acting **together**, not individually.

---

## 3. Best settings (pinned versions)

`Note:` = a counter-intuitive point worth flagging.

### 3.1 Firecracker v1.15.1
- **`cache_type=Writeback`** advertises `VIRTIO_BLK_F_FLUSH`; each guest flush → real `fsync` on the backing `.ext4`; contract: *"once a flush is acknowledged, the data is committed to backing storage."* Neither mode uses `O_DIRECT`; the only difference is whether `fsync` is honored. `Note:` FC "Writeback" is the **SAFE** mode (inverse of QEMU's `cache=writeback`). Boot-config only → applies on **next cold boot**. **Live-validated (2026-06-05):** `PUT /drives` with `cache_type:"Writeback"` + a `rate_limiter` → **204**, the guest **booted** (`Linux 6.1.174`, systemd up), and a bogus `cache_type` → **400** (fails loud).
- **`io_engine=Sync`** — keep (F3). `Note:` it is currently **unset** in code (FC defaults to Sync); leave it unset so the drive body stays byte-identical — do not add the key. Pre-boot only.
- **Drive `rate_limiter`** = `{ bandwidth?: TokenBucket, ops?: TokenBucket }`; `TokenBucket = { size (tokens — bytes for bandwidth, ops for ops), refill_time (`Note:` **milliseconds**), one_time_burst? }`; sustained = `size / refill_time`. Reads + writes **share** the bucket. Throttles guest virtqueue submission **before** host I/O (covers guest buffered writes) but `Note:` does **NOT** bound the host page-cache→disk flush (that's the cgroup layer). Settable at `PUT /drives` **and live via `PATCH /drives/{id}` with `{drive_id, rate_limiter}` ONLY** — never include `path_on_host` (that's the resize path, [cube-resize.ts:344](../../lib/worker/handlers/cube-resize.ts#L344)); **live `PATCH` proven 204 on a running instance (2026-06-05)**. `Note:` a single request **larger than `size`** is NOT rejected/blocked-forever — FC empties the bucket and proceeds (the over-consumption path); but an undersized bucket needlessly serializes large I/O, so size the bucket above the max single request. `PATCH /drives` rejects on a non-started instance.

### 3.2 Linux cgroup-v2 (the host isolation boundary)
- **Live-validated (2026-06-05, kernel 6.8):** `io.max wbps` throttles async **buffered** writeback to the cap **with the `io` controller alone** — a 300 MB buffered burst drained at exactly the 10 MB/s cap with the `memory` controller both on **and** off. The classic "buffered writeback needs the `memory` controller for attribution" rule is **older-kernel behavior**, not universal. Krova's real gap is that the `krova` cgroup delegates **only `cpu`** today ([cpu-cgroup.ts](../../lib/ssh/cpu-cgroup.ts)) — `io` isn't delegated at all, so `io.max` doesn't even exist. Once `+io` is delegated, `io.max` bites buffered writes. We still co-delegate `+memory` as **cross-kernel insurance** (prod host kernel unverified per Rule 60).
- `io.max` (hard cap) needs **no** special scheduler (works on any blk-mq). `io.weight` (proportional) needs **iocost** or **BFQ**.
- **Live-validated:** the **jailer (`v1.15.1`) rejects an `io.max` `--cgroup` arg** (`Error: CgroupFormat` — its `file=value` parser refuses the embedded space + second `=`). So `io.max` is **written directly to the leaf by the worker** after the jailer creates it (`cpu.weight`/`cpuset` still go via the jailer); this is **live-updatable** without a reboot.
- `Note:` **device-resolution (correctness-critical):** `io.max` keys on the device backing the cube's rootfs **FILE** — the LVM `dm-N`/logical volume `/var/lib/krova` lives on — **NOT** a physical `sd*` member. On the `ext4-on-LVM-on-RAID1` layout the writeback bios carry the `dm` device number, so an `sd*` maj:min would throttle **nothing**. Resolve from the path (`df --output=source`/`stat`).
- **Decision:** FC `rate_limiter` = customer-facing live-tunable QoS; **host `io.max` (leaf-written, keyed on the `dm` device) = the true multi-tenant isolation backstop**, since only it bounds host writeback.

### 3.3 Host kernel sysctls (page-cache bounding)
- `vm.dirty_bytes`/`dirty_ratio` are mutually exclusive (setting one zeroes the other). `Note:` `dirty_bytes` is not a hard wall — the dirtying writer is *enlisted into synchronous writeback* (foreground-throttled). 2-page minimum; read back after setting.
- **Targets:** `vm.dirty_bytes=268435456` (256 MiB), `vm.dirty_background_bytes=67108864` (64 MiB), `vm.dirty_expire_centisecs=1500` (15 s); **keep** `vm.dirty_writeback_centisecs=500` (never 0). Size `dirty_bytes` to ~0.5–1 s of the device's actual sustained write (adaptive). All runtime sysctls.

### 3.4 I/O scheduler (adaptive, D2)
- These knobs run on the **HOST** (kernel operator-verified at Task 0; dev host was 6.8). Modern Linux (5.x/6.x) has exactly `none / mq-deadline / kyber / bfq` (`Note:` `cfq/noop/deadline` are gone — a rule setting them is a silent no-op). Kernel default: **`mq-deadline` for single-HW-queue SATA SSD**, **`none` for NVMe**.
- **Targets:** udev rule `KERNEL=="sd[a-z]*", ATTR{queue/rotational}=="0" → mq-deadline` (= kernel default, zero-risk); **leave NVMe on `none`**. `Note:` `md`/`dm` devices have **no** real scheduler — target the physical `sd*` members. Keep `nr_requests`/`read_ahead_kb` default (random workload).

### 3.5 mdadm RAID1
- Mirror writes to all members → write bandwidth = one member. Monthly scrub (`check`) reads **both** disks fully; on Ubuntu 24.04 driven by `mdcheck_start.timer` (1st Sun 01:00, 6 h cap) + `mdcheck_continue.timer` (daily 01:05) — a "monthly" scrub can drag across nights. Throttle: `dev.raid.speed_limit_max` (KiB/s, per-device; `=50000` ≈ 10 % of SATA write); leave `speed_limit_min=1000` so it yields under load. Per-array sysfs override doesn't persist a reboot — use the sysctl. **Keep `check`, never `repair`.**

### 3.6 restic 0.18.1
- `restore --sparse` writes zero-runs as ext4 holes — cuts restore write-amp. `backup --no-scan` skips the size-estimation read pass. `--read-concurrency` default 2 parallelizes **across files** → irrelevant for a single-rootfs blob (leave 2). `Note:` `--keep-id` does **NOT** exist (rustic-only) — keep the repeated-`--tag` scoping.
- `Note:` in 0.18.1 **`check` takes an EXCLUSIVE lock** (not shared). `prune`, `forget`, **and `check`** are all exclusive; only `backup`(append) + `restore/find/ls`(read) are not → serialize prune/check per-cube against that cube's backup. `prune` is a download-then-reupload **data shuffle**; bound with `--max-repack-size 2G --max-unused 20%`. No native local-disk throttle → wrap host restic in `ionice -c2 -n7 nice`. Cache already off-cube at [commands.ts:54](../../lib/storage/restic/commands.ts#L54) ✓.

### 3.7 rclone 1.74.2
- For one large `.cube` blob, `--transfers`/`--checkers` are irrelevant; **multi-thread** is decisive. S3→host **download** multi-threads the **disk-write** path. `Note:` for uploads, `--s3-upload-concurrency` (default 4) **overrides** `--multi-thread-streams` when larger → cap **both**. `--bwlimit` is **bytes/s**, per-process. **Targets:** `--multi-thread-streams 1` + `--s3-upload-concurrency 1` + `--bwlimit <X>M`; keep preallocation on; land the blob on the destination cube volume.

### 3.8 ext4 (golden rootfs + host volume)
- `mkfs.ext4 -E lazy_itable_init=0,lazy_journal_init=0` forces **synchronous** inode-table+journal zeroing at build (effective because Ubuntu 24.04 e2fsprogs enables `uninit_bg`/`metadata_csum`). `Note:` this only covers the **golden image's own minimized table** — growing the image to the customer's disk size (`resize2fs` on the per-cube path) re-creates an uninitialised inode table that the kernel's `ext4lazyinit` zeroes in the **background** on the live device; that residue is bounded by `ionice` on the grow path (plan F3), not eliminated. `Note:` `mount -o init_itable=0` is **NOT** the runtime equivalent (it only sets the background thread's throttle multiplier; nothing blocks until zeroed). `noatime` kills atime write-amp (×2 on RAID1). Keep `data=ordered,barrier=1` — never `nobarrier`/`writeback` on a mirror. `fallocate -l` (real blocks) not sparse `truncate` for fixed 1:1 images. `Note:` **no** `stride/stripe-width` on RAID1 (a mirror has no stripe geometry). Inline `discard` OFF → weekly **host** `fstrim.timer`.

### 3.9 Hardware ceiling + NUMA disk locality (D2)
- SATA III electrical ceiling **~550 MB/s, ~70–90k random-write IOPS**, shared across all cubes; **no software raises it** (io_uring only helps approach it). Enterprise NVMe ≈ 10× IOPS, 8–13× bandwidth, ~10× lower latency — the only lever past the wall.
- **Task-0 MEASURED (`apple`, 2026-06-05 — 2× Samsung MZ7LM1T9 SATA SSD, mdadm RAID1, LVM `vg0-root`):** sequential write **480 MiB/s (504 MB/s)**, random-write QD32 **47.7k IOPS / 186 MiB/s**, QD1-durable **2843 IOPS @ ~292µs fsync** (healthy — the drive has power-loss-protected DRAM). Scheduler already `[mq-deadline]`; dirty config ratio-based (20/10); RAID scrub idle (`speed_limit_max`=200000 default). **This sizes `DISK_RATE_LIMITER_TIERS` (bandwidth vs the 480 ceiling, iops vs the 47.7k random ceiling) + `RAID_SCRUB_SPEED_LIMIT_MAX_KBPS`=50000 (~10% of 480) + `DISK_DIRTY_BYTES`=256 MiB (~0.5 s of 480).** The ceiling estimate is confirmed; the per-cube QoS now caps BOTH bandwidth AND iops because the 47.7k random IOPS is the resource a bandwidth-only cap leaves ungoverned for the larger tiers.
- NUMA disk locality matters **only on multi-socket** hosts (cross-socket I/O completion crosses UPI). Read `/sys/block/<dev>/device/numa_node` (`Note:` `-1` = unknown; **never write it** — taints the kernel). Feed a valid node into placement as a **tie-breaker**, extending L2. — **Scoped as Phase G but DROPPED (2026-06-06): a no-op on single-`/var/lib/krova`-volume hosts with no live caller; re-add when per-node storage volumes exist.**

---

## 4. Problem areas (ranked)

`↓guest` = fixing it makes the VM use the disk less.

### Tier 1 — systemic (fix first)
1. **Writeback-stall stack (HIGH compounding)** — §2. `cache_type=Unsafe` × no dirty caps × no scheduler × RAID1 ceiling.
2. **No per-cube disk QoS** — one buffered-write hog starves every co-tenant; `cpu.weight` does **not** isolate disk (the `krova` cgroup delegates only `cpu` — `io` isn't delegated at all). `↓guest`
3. **Independent queues, zero throttle** — disk-heavy jobs run on separate pg-boss queues with **no** `ionice`/`nice`/`--bwlimit` anywhere; cron snapshot + restore + transfer + weekly prune/check can hit one host's RAID1 at once.

### Tier 2 — write-amplification factory (`↓guest` host disk)
4. **`restic restore` without `--sparse`** — materializes the full disk-sized image incl. zeros.
5. **`zstd -T0` backup** — saturates **all** host cores (contending with co-tenant cubes); the rootfs is read **once** for compression (sha256/tar then operate on the smaller `.zst`). The cost is core-saturation, not a triple-read.
6. **`resize2fs` grow without `lazy_itable_init=0`** — `ext4lazyinit` trickles inode-table zeroing to the live RAID1 for minutes after boot.
7. **`cube-transfer` double-copy** — `cp --reflink=auto` (falls back to full copy on ext4) **then** `rsync` of the same bytes.
8. **import/redeploy triple-write** — rclone blob → zstd decompress → e2fsck/resize2fs, all on the cube volume; rclone 4 streams, no `--bwlimit`.
9. **Sparse `truncate` rootfs** — fragmentation over time on RAID1+LVM; risks in-guest ENOSPC.

### Tier 3 — host background pressure
10. **No host disk tuning** — no scheduler udev rule, no dirty-byte caps, no `noatime`, no `fstrim.timer`.
11. **mdadm scrub unmanaged** — distro default reads both disks fully, can collide with peak customer I/O.
12. **restic cron pile-up** — `forget --prune` (daily), `prune`+`check` (weekly, both **exclusive**) iterate every cube serially, un-throttled; cron collisions (snapshot+export-reap at `:00`; prune+disposable-emails both Sun 04:00).
13. **restic reads a *running* cube's rootfs** un-frozen — contends with live writes.
14. **Host swap on the same RAID1 volume**; `serial.log`/`fcLog` grow unbounded (erodes sellable 1:1 disk).

### Tier 4 — guest-side diet (`↓guest`, one-line image changes)
15. **fstab `discard` + no `noatime`** — per-write TRIM (×2 RAID1) + atime writes.
16. **journald (no `SystemMaxUse`) + rsyslog both on** — every log line written **twice**, unbounded.
17. **apt-daily** downloads `.debs` daily in every cube.
18. **Docker default `json-file`** log driver — unbounded container logs + overlay2 writes.

---

## 5. Operator measurements (Rule 60 — agent prepares / operator runs)

Idle `fio` cannot reproduce a multi-tenant complaint. Required:

```bash
# --- A. Topology + scheduler + RAID state (per host) ---
lsblk -d -o NAME,ROTA,TRAN,MODEL,SIZE
for d in /sys/block/sd*; do echo "$d: sched=$(cat $d/queue/scheduler) rota=$(cat $d/queue/rotational) numa=$(cat $d/device/numa_node 2>/dev/null)"; done
cat /proc/mdstat; cat /sys/block/md*/md/sync_action 2>/dev/null
cat /proc/sys/vm/dirty_ratio /proc/sys/vm/dirty_background_ratio /proc/sys/vm/dirty_bytes

# --- B. Bare ceiling on an EMPTY host (no cubes) ---
S=/var/lib/krova/fio.scratch
fio --name=qd1-durable --filename=$S --ioengine=psync --direct=1 --rw=randwrite --bs=4k --iodepth=1 --fdatasync=1 --size=8G --runtime=60 --time_based --ramp_time=10 --group_reporting   # the number customers FEEL
fio --name=qd32-write  --filename=$S --ioengine=libaio --direct=1 --rw=randwrite --bs=4k --iodepth=32 --size=8G --runtime=60 --time_based --ramp_time=10 --group_reporting
fio --name=qd32-read   --filename=$S --ioengine=libaio --direct=1 --rw=randread  --bs=4k --iodepth=32 --size=8G --runtime=60 --time_based --ramp_time=10 --group_reporting
fio --name=seq-write   --filename=$S --ioengine=libaio --direct=1 --rw=write     --bs=1M --iodepth=16 --end_fsync=1 --size=8G --runtime=60 --time_based --group_reporting
rm -f $S

# --- C. Contended reality on a LIVE host during a snapshot window ---
iostat -xm 1 30 md1 sda sdb dm-0   # watch w_await / aqu-sz (ignore %util on SSD/RAID)
pidstat -d 1 30                     # attribute writes to restic vs firecracker vs kworker/flush
grep -E 'Dirty|Writeback' /proc/meminfo   # sampled during a buffered burst
```

The QD1-durable number under `Unsafe` vs a canary `Writeback` drive is the exact durability-for-speed trade.
These numbers **size** the adaptive `rate_limiter` buckets and confirm SATA-vs-NVMe per host.

---

## 6. Sources

Firecracker v1.15.1 (`docs/api_requests/block-caching.md`, `block-io-engine.md`, `design.md`, `jailer.md`,
swagger `firecracker.yaml`); kernel.org `admin-guide/cgroup-v2.rst`, `admin-guide/sysctl/vm.rst`,
`admin-guide/md.rst`, `filesystems/ext4/`; restic 0.18.1 docs + `cmd_forget`/`cmd_restore`/`cmd_check` source;
rclone 1.74.2 docs; `man mke2fs`/`mount`/`fstrim`; fio docs.
