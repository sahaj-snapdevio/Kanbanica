# Disk I/O Overhaul — Implementation Plan (foolproof, zero-downtime, hardware-adaptive)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans`. Every task is strict-TDD (failing test → verify red → implement →
> verify green → commit) and ships independently green. **Run `pnpm test:all` before declaring any task done (Rule 59).**

**Goal:** Eliminate every disk-I/O issue in the audit ([the disk I/O audit](../../audits/2026-06-05-cube-disk-io-audit.md))
— make cube disks **crash-safe**, **fairly isolated per tenant**, and **as fast as the hardware allows**, while
making each VM **use the disk less**. Top performance **with** durability and security, no downtime, safe for the
**30 live cubes** today, and **hardware-adaptive** so it's optimal on SATA-RAID1 now and on NVMe later.

**Architecture:** Six independently-shippable, flag-gated layers over the existing jailer/cgroup/launch path,
**each byte-identical to today when its flag is off** (the L1 cardinal invariant):
`DISK_WRITEBACK_CACHE_ENABLED` (FC `cache_type=Writeback`), `DISK_QOS_ENABLED` (FC drive `rate_limiter`, live-PATCHable),
`IO_CGROUP_ENABLED` (host cgroup `io.max` + `+memory` co-delegation on the existing `krova` parent — the only thing
that bounds buffered writeback), `DISK_HOST_TUNING_ENABLED` (dirty-byte sysctls, `mq-deadline` udev, `fstrim.timer`,
mdadm scrub throttle), `DISK_IO_STORAGE_TUNING_ENABLED` (restic `--sparse`/`--no-scan`/`ionice`, rclone serialize+`bwlimit`,
cron de-confliction + per-host serialization).
Per-host **disk topology** is auto-detected onto the `servers` row (ungated, like `numa_topology`) and **drives every
adaptive choice** (SATA→`mq-deadline`+throttle, NVMe→`none`+higher caps). Golden-rootfs changes (`mkfs … lazy_itable_init=0`,
`noatime`, journald cap, no dup rsyslog, masked apt-daily, docker log caps) ship in the next image; live cubes inherit on redeploy.

**Tech Stack:** Firecracker **v1.15.1** · kernel **6.1.174** · restic **0.18.1** · rclone **1.74.2** · ext4 on mdadm RAID1 + LVM,
Ubuntu 24.04 · cgroup-v2 (`io`+`memory`+`cpu`) · all live-host validation operator-run on a canary (Rule 60); dev host
`107.172.218.189` for agent testing (single-disk VM — cannot prove SATA-vs-NVMe adaptive tuning, only correctness).

**Non-negotiables (owner):** zero breaking changes; **no data loss** (D1 Writeback); never brick a boot; never touch
the 30 live cubes until they cold-boot on their own; agent never touches prod (Rule 60); every change tested + `pnpm test:all` green.

**Decided parameters (locked 2026-06-05):** ① cache_type=**Writeback** all cubes · ② **adaptive** SATA/NVMe ·
③ QoS = FC `rate_limiter` (customer-facing, live) **+** host `io.max`+`memory` (isolation backstop) · ④ `vm.dirty_bytes`=256 MiB /
`dirty_background_bytes`=64 MiB / `dirty_expire`=15 s · ⑤ `mq-deadline` on `rotational==0 sd*`, `none` on NVMe · ⑥ host weekly
`fstrim.timer` (drop guest inline `discard`) · ⑦ mdadm `check` only, `speed_limit_max=50000`, pinned window · ⑧ restic `--sparse`+`--no-scan`+`ionice`,
prune/check **serialized per-cube** (all exclusive-lock in 0.18.1) · ⑨ rclone `--multi-thread-streams 1 --s3-upload-concurrency 1 --bwlimit` ·
⑩ golden rootfs `mkfs -E lazy_itable_init=0,lazy_journal_init=0`, `fallocate`, `noatime` · ⑪ guest diet (journald cap / no dup rsyslog / mask apt-daily / docker log caps). (⑫ NUMA-disk was scoped but dropped — see Phase G.)

---

## Constraints & invariants (must respect)

1. **Never brick a boot (L1 cardinal invariant):** every behavior change lives inside `if (FLAG) { … }` and flag-off produces a **byte-identical** PUT-drives body / jailer argv / cron loop / host file. A malformed `rate_limiter`/`io.max`/`cache_type` must **fail-safe to launch-without**, never abort the boot — validate like the `/cpu-config` and `/entropy` try-catch blocks, **never inside the boot `Promise.all`** ([firecracker.ts:852](../../../lib/ssh/firecracker.ts#L852)) where one rejection aborts all four PUTs.
2. **Boot-config fields apply on NEXT COLD BOOT only:** `cache_type` and drive placement (NOT io.max — see #3). The 30 live cubes keep today's config until they cold-boot — a **planned rolling change, not a hot mutation**. `rate_limiter` changes go through `PATCH /drives/{id}` `{drive_id, rate_limiter}` (never `path_on_host`); `io.max` changes are a leaf re-write (#3) — both **running-cube-safe**. `io_engine` is left **unset** (FC defaults to Sync) so the flag-off drive body stays byte-identical — never add the key.
3. **Host isolation truth (live-validated 2026-06-05):** `io.max` throttles buffered writeback with the **`io` controller alone** on kernel 6.8 (proven); `+memory` is co-delegated as **cross-kernel insurance** (older kernels needed it; prod kernel unverified per Rule 60). `+io`/`+memory` are added to the **`krova` parent only** ([CPU_CGROUP_PARENT](../../../config/platform.ts#L309)); the jailer only creates **leaves**. `io.max` is **written to the leaf by the worker** (the jailer rejects it as an arg — proven), so it is **running-cube-safe + live-updatable**. The leaf (`krova/<cubeId>`) only exists when the jailer was invoked with a `--cgroup` arg, i.e. **`CPU_CGROUP_ENABLED` must be on** for io.max to have a leaf to write to (io.max applies to jailer-launched cubes only, like L1 cpu.weight). **The io.max device is the `dm-N`/LVM logical volume that backs the cube's rootfs FILE** (`/var/lib/krova`), resolved from the file path via `df`/`stat`, **NOT** the physical `sd*` member (a `sd*` maj:min would throttle nothing on the ext4-on-LVM-on-RAID1 layout). Un-delegated/failed write → degrade to launch-without, never brick.
4. **Additive DDL only (Rule 40 / Rule 6):** `servers.disk_topology` is a **nullable jsonb** ADD COLUMN via `pnpm db:generate` (next migration **0074**); never hand-write the journal/snapshot. Agent **generates**, operator **applies**.
5. **Rule 60 — agent never touches prod:** all `fio`, sysctl, udev, mdadm, fleet retrofits, and canary validation are **operator-run**; the agent writes the exact command and interprets pasted output. Dev host only for agent testing.
6. **Adaptive, single-device-safe:** every host knob no-ops cleanly when topology is undetected/single-disk/non-RAID (mirror L2's single-socket no-op). NVMe gets `none`+higher caps; SATA gets `mq-deadline`+throttle.
7. **Rule 14 single-source:** one `buildDriveRateLimiter()` shared by the boot path and the live-PATCH path; one exported host-tuning builder shared by `server-install.ts` and the retrofit script; restic/rclone flags stay centralized in the existing chokepoints (`resticEnv()`/`runResticWithLockRecovery`/`rcloneFlags()`).
8. **Rule 46:** any new host binary (`mdadm`) → base-packages (apt+dnf) **+** verify-host-tools REQUIRED **+** `install-host-tools.ts`. `fstrim`/`udevadm`/`ionice`/`nice`/`lsblk` are util-linux/coreutils/systemd → framework-exempt.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `config/platform.ts` | 6 `DISK_*`/`IO_CGROUP_ENABLED` flags + `DISK_RATE_LIMITER_TIERS` + dirty/raid scalars (new `// ── Disk I/O Tuning ──` banner ~L330) | modify |
| `db/schema/servers.ts` | `disk_topology` nullable jsonb (after `numa_topology` L137) | modify |
| `db/migrations/0074_*.sql` | additive column (via `pnpm db:generate`) | generate |
| `lib/server/disk-topology.ts` (+`.test.ts`) | pure `parseDiskTopology()` (sibling to `lib/server/numa.ts`) | create |
| `lib/cubes/disk-iops.ts` (+`.test.ts`) | pure `buildDriveRateLimiter(cube, topology)` + `cubeIoMax(cube, topology)` → **device-agnostic** `{ wbps, rbps }` (tier derived from `cube.vcpus`) | create |
| `lib/ssh/firecracker.ts` | `cache_type` (static, in `Promise.all`) + `rate_limiter` (pre-validated, own guarded step) on both PUT `/drives`; `truncate`→`fallocate`; io.max leaf-write; teardown gate widen | modify |
| `lib/ssh/cpu-cgroup.ts` (+`.test.ts`) | `+io +memory` delegation lines (gated) + `ioCgroupReadyCommand` + `cubeDiskDeviceCommand(rootfsPath)` (resolves the LVM `dm-N` maj:min) | modify |
| `lib/ssh/jailer.ts` | **unchanged for io** (jailer rejects an `io.max` arg — proven live); `cpu.weight`/`cpuset` only | — |
| `lib/cubes/io-max.ts` (+`.test.ts`) | **sole formatter** of the `<maj:min> wbps= rbps=` leaf line (joins `cubeIoMax` numbers + `cubeDiskDeviceCommand` maj:min); worker writes it to `krova/<id>/io.max` post-launch + on tier change | create |
| `lib/worker/cube-boot.ts` | thread `cubeDriveRateLimiterOpts(cubeId)` into the createCube spread (~L294, provision path) | modify |
| `lib/worker/handlers/server-install.ts` | `diskTuningScript`/`diskUdevScript`/`fstrimTimerScript`/`mdcheckWindowScript` builders + gated STEPS + verify-host-tools + disk-topology probe | modify |
| `lib/worker/handlers/server-bootstrap.ts` | ungated disk-topology probe + persist (beside NUMA, L185/L418) | modify |
| `lib/worker/handlers/server-refresh-hardware.ts` | refresh `disk_topology` | modify |
| `lib/worker/handlers/cube-resize.ts` | live `PATCH /drives` rate-limiter helper (no `path_on_host`) | modify |
| `lib/worker/handlers/cube-transfer.ts` | collapse `cp --reflink`+`rsync` double-copy (flag-gated, device-aware) | modify |
| `lib/storage/restic/commands.ts` | `--no-scan`, `--sparse`, `ionice/nice` prefix (gated) | modify |
| `lib/storage/s3-transfer.ts` | `rcloneFlags()` serialize + `--bwlimit` (gated) | modify |
| `lib/worker/handlers/restic-prune.ts`, `snapshot-auto-prune.ts`, `restic-check.ts` | per-host serialization (gated) | modify |
| `lib/worker/boss.ts` | re-stagger the disk-heavy restic crons (prune vs hourly snapshot crons) | modify |
| `setup/images/build-all-images.sh` | `mkfs -E lazy_itable_init=0,lazy_journal_init=0`, `noatime` (drop `discard`), `fallocate`, journald cap, drop dup rsyslog, mask apt-daily, docker log caps | modify |
| `scripts/install-disk-tuning.ts`, `scripts/install-disk-topology.ts`, `scripts/install-io-cgroup.ts` | operator fleet retrofits (mirror `install-network-tuning.ts`/`install-numa-detect.ts`/`install-cpu-cgroup.ts`) | create |
| `package.json` | `install:disk-tuning` / `install:disk-topology` / `install:io-cgroup` | modify |

---

## Task 0 — BLOCKING empirical measurement (operator-run, Rule 60)

**No code.** The audit's "one missing input" is a real `fio` on a bare host + per-host topology. The agent prepares
[audit §5](../../audits/2026-06-05-cube-disk-io-audit.md#5-operator-measurements-rule-60--agent-prepares--operator-runs);
operator runs A/B/C and pastes output. **Outputs that gate later tasks:**
- [ ] **SATA-vs-NVMe + scheduler + RAID state per host** → sets the adaptive tuning constants + confirms `mq-deadline` target.
- [ ] **QD1-durable IOPS (Unsafe baseline)** + the same on a **canary `Writeback` drive** → the durability/latency trade + the `rate_limiter` bucket sizes per tier.
- [ ] **Contended `iostat`/`pidstat`/`mdstat` during a snapshot window** → confirms the §2 stall mechanism + whether a scrub is implicated.

> Record findings inline here as **`CONFIRMED (date, host, version):`** blocks. Do **not** hard-code cap numbers in `DISK_RATE_LIMITER_TIERS` until Task 0 returns.

---

## Phase A — Foundation: flags + topology detection (ungated data)

### Task A1 — `parseDiskTopology()` pure helper
**Files:** create `lib/server/disk-topology.ts` + `.test.ts` (mirror `lib/server/numa.ts` + its test).
1. **Failing test:** feed sample `lsblk -d -o NAME,ROTA,TRAN,MODEL,SIZE` + `/sys/block/*/queue/{rotational,scheduler}` + `/device/numa_node` output → expect `[{ device:"sda", rotational:false, nvme:false, tran:"sata", scheduler:"mq-deadline", numaNode:-1 }, …]`; assert non-RAID/odd layouts → `[]` (never throw).
2. Verify red → 3. Implement pure parser → 4. Green → 5. `git commit -m "feat(disk): parseDiskTopology pure helper"`.

### Task A2 — `servers.disk_topology` schema (additive, Rule 6/40)
1. Add after [servers.ts:137](../../../db/schema/servers.ts#L137): `diskTopology: jsonb("disk_topology").$type<{ device: string; rotational: boolean; nvme: boolean; tran: string | null; scheduler: string | null; numaNode: number | null }[]>(),` (nullable, no default, JSDoc mirroring `numa_topology`).
2. `pnpm db:generate` → expect `db/migrations/0074_*.sql` adding **one nullable column**; `pnpm test:migrations` green, re-run no-op. **Never hand-edit the journal.**
3. Commit `feat(disk): additive servers.disk_topology column (0074)`.

### Task A3 — Bootstrap + refresh detection + backfill (ungated)
1. In [server-bootstrap.ts](../../../lib/worker/handlers/server-bootstrap.ts) "Detect hardware capacity" (~L185, beside the NUMA probe): read-only `lsblk`+`/sys` probe → `parseDiskTopology()` → persist at the `.set({…})` (~L418) `diskTopology: topo.length ? topo : null`. Best-effort (empty→null, never aborts bootstrap — Rule 58 preflight ordering).
2. Same `diskTopology` into [server-refresh-hardware.ts](../../../lib/worker/handlers/server-refresh-hardware.ts) `.set` (note inline it doesn't re-probe NUMA today — keep surgical).
3. Create `scripts/install-disk-topology.ts` (mirror `scripts/install-numa-detect.ts` line-for-line: active-server loop, read-only probe, idempotent DB write) + `package.json` `"install:disk-topology"`.
4. Commit `feat(disk): auto-detect disk topology onto servers row + backfill retrofit`.

### Task A4 — Flags + tuning constants
Add under a new `// ── Disk I/O Tuning ──` banner (~[platform.ts:330](../../../config/platform.ts#L330)), each flag a 5-part JSDoc mirroring [CPU_CGROUP_ENABLED](../../../config/platform.ts#L302) (spec ref → flag-off byte-identical invariant → named `pnpm install:*` retrofit → canary gate → fail-safe), **declared `= false`**:
`DISK_WRITEBACK_CACHE_ENABLED`, `DISK_QOS_ENABLED`, `IO_CGROUP_ENABLED`, `DISK_HOST_TUNING_ENABLED`, `DISK_IO_STORAGE_TUNING_ENABLED`.
Scalars (mirror [CONNTRACK_UDP_TIMEOUT_SECONDS](../../../config/platform.ts#L360)): `DISK_DIRTY_BYTES=268435456`, `DISK_DIRTY_BACKGROUND_BYTES=67108864`, `DISK_DIRTY_EXPIRE_CENTISECS=1500`, `RAID_SCRUB_SPEED_LIMIT_MAX_KBPS=50000`, `RCLONE_BWLIMIT_MB` (or "off"), `DISK_ZSTD_THREADS` (cap backup/extract zstd; `0`=`-T0` today). Tier table (mirror [CREDIT_RATE_TIERS](../../../config/platform.ts#L79)): `interface DiskRateLimiterTier { minVcpus; maxVcpus; bandwidth; ops }` + `DISK_RATE_LIMITER_TIERS[]`, **bands aligned to CREDIT_RATE_TIERS' vCPU ranges**. **There is NO `cubes.tier` column** ([cubes.ts](../../../db/schema/cubes.ts) has only `vcpus`) — the tier is **derived from `cube.vcpus`** against the `minVcpus/maxVcpus` bands, exactly like `creditRateForVcpus`/`CREDIT_RATE_TIERS` resolves a multiplier today. Buckets: `size`+`refill_time:1000`+`one_time_burst`, `size` **larger than the max single request** (a request over `size` isn't rejected — FC drains the bucket and proceeds, but a too-small bucket needlessly serializes large I/O; values finalized from Task 0). Commit `feat(disk): disk-I/O tuning flags + per-tier rate-limiter constants (default off)`.

---

## Phase B — `cache_type=Writeback` (durability, D1) · flag `DISK_WRITEBACK_CACHE_ENABLED`

### Task B1 — both PUT `/drives/rootfs` bodies
1. **Failing test:** a `buildRootfsDriveBody(opts)` pure builder → flag-off returns exactly `{drive_id, path_on_host, is_root_device, is_read_only}` (byte-identical, **no `io_engine` key** — FC defaults to Sync); flag-on adds `cache_type:"Writeback"` (+ `rate_limiter` only when provided). Assert the flag-off snapshot is unchanged.
2. Implement the builder; use it at [firecracker.ts:852](../../../lib/ssh/firecracker.ts#L852) (createCube) **and** [:1219](../../../lib/ssh/firecracker.ts#L1219) (startCube). **Fail-safe placement (Constraint 1):** `cache_type` is a **static string** → safe to keep in the `Promise.all` at :852. `rate_limiter` is **pre-validated** — `buildDriveRateLimiter()` (Task E1) is the validation boundary and returns `null` on ANY missing/malformed value, so only a well-formed object or nothing ever reaches the body. With that guarantee the spread `...(rl ? { rate_limiter: rl } : {})` is safe inline; **if** the limiter is ever built from un-validated input, hoist its PUT out of the `Promise.all` into its own guarded step. Note :852 is a four-way `Promise.all` (one rejection aborts the boot) while :1219 is a sequential `await` — the builder is shared but the limiter's failure containment differs per site; keep the limiter non-throwing at both.
3. Green → commit `feat(disk): cache_type=Writeback on rootfs drive (gated, fail-safe)`.

> **Validation note (Task 0/B-canary):** Writeback applies on next cold boot; operator confirms a canary cube boots + `fsync` is honored, and re-runs QD1-durable fio to record the latency delta. The 30 live cubes stay on Unsafe until they cold-boot.

---

## Phase C — Image-build write-amp + guest diet (next golden image; no runtime flag)

> All edits inside the single outer `bash -c '…'` block → **Rule 39** (no apostrophes; double-quoted heredoc delimiters); run `bash -n setup/images/build-all-images.sh` after each. `pnpm build:images` + host smoke before shipping.

### Task C1 — ext4 mkfs + fstab + fallocate
1. [L1012](../../../setup/images/build-all-images.sh#L1012): `mkfs.ext4 -F -L rootfs -E lazy_itable_init=0,lazy_journal_init=0 -d $R …` (no first-boot lazy-init storm).
2. [L915](../../../setup/images/build-all-images.sh#L915) fstab: `defaults,noatime,errors=remount-ro` (**drop `discard`** → host `fstrim.timer`).
3. Per-cube backing file [firecracker.ts:621](../../../lib/ssh/firecracker.ts#L621): `fallocate -l ${diskSizeGb}G || truncate -s ${diskSizeGb}G` (real blocks; fail-safe to truncate on ENOTSUP; raise the 30 s timeout for large SATA disks). Gate the swap behind `DISK_HOST_TUNING_ENABLED` so flag-off still truncates.
> **Open input (flag for owner):** `fallocate` at *image-build* (L1011 `dd … seek`) can defeat restic `--sparse` dedup — keep the build image sparse + rely on `lazy_itable_init=0` there; apply `fallocate` only to the **per-cube** backing file. Confirm before C1 ships.

### Task C2 — guest log/update diet
1. journald cap: `printf "[Journal]\nSystemMaxUse=200M\nRuntimeMaxUse=64M\n" > $R/etc/systemd/journald.conf.d/99-krova.conf` (after [L928](../../../setup/images/build-all-images.sh#L928)).
2. Drop the duplicate **rsyslog** from install ([L693](../../../setup/images/build-all-images.sh#L693)) + enable ([L752](../../../setup/images/build-all-images.sh#L752)) — journald is already persistent. *(Owner trade: drop vs cap — dropping is the cleaner I/O win but changes stock-Ubuntu parity; default = drop.)*
3. **Mask `apt-daily.timer` + `apt-daily.service` only** (metadata refresh) — **KEEP `apt-daily-upgrade.timer`** (security patching the build relies on).
4. Docker variant ([L806](../../../setup/images/build-all-images.sh#L806), inside `PREINSTALL_DOCKER`): `cat > /etc/docker/daemon.json <<"DOCKERD"` with `log-driver json-file`, `log-opts.max-size "10m"`, `max-file "3"`.
5. Commit `feat(images): ext4 lazy-init + noatime + guest log/update diet`.

---

## Phase D — Host tuning (adaptive) · flag `DISK_HOST_TUNING_ENABLED`

All builders **exported** from [server-install.ts](../../../lib/worker/handlers/server-install.ts) (Rule 14), gated STEPS via `...(DISK_HOST_TUNING_ENABLED ? [step] : [])` (mirror the CPU-cgroup spread), each base64-piped (Rule 39), each no-op when its precondition is absent.

### Task D1 — sysctl drop-in (`/etc/sysctl.d/98-krova-disk.conf`)
`vm.dirty_bytes=$DISK_DIRTY_BYTES`, `vm.dirty_background_bytes=…`, `vm.dirty_expire_centisecs=1500`, **keep** `vm.dirty_writeback_centisecs=500`, `dev.raid.speed_limit_max=$RAID_SCRUB_SPEED_LIMIT_MAX_KBPS` → `sysctl --system`. Separate file from `99-krova.conf` (clean rollback). Running-cube-safe.

### Task D2 — adaptive scheduler udev rule (`/etc/udev/rules.d/60-krova-io-sched.rules`)
`ACTION=="add|change", KERNEL=="sd[a-z]*", ATTR{queue/rotational}=="0", ATTR{queue/scheduler}="mq-deadline"` → `udevadm control --reload-rules; udevadm trigger --subsystem-match=block`. **Excludes `nvme*` deliberately** (NVMe stays `none`). Persists across reboot; applies live via trigger.

### Task D3 — host `fstrim.timer` + mdadm scrub
- `systemctl list-unit-files fstrim.timer >/dev/null 2>&1 && systemctl enable --now fstrim.timer || true`.
- mdadm: only when `[ -e /proc/mdstat ] && grep -q '^md' /proc/mdstat` → pin `mdcheck_start.timer` window (drop-in, mirror `caddyResumeSystemdScript`) + rely on `dev.raid.speed_limit_max` from D1; branch apt-vs-dnf for the unit names (Debian `cron.d/mdadm`/`checkarray` vs RHEL `mdcheck_*`). Add `mdadm:mdadm` to base-packages (both branches) + verify-host-tools REQUIRED + `install-host-tools.ts` (Rule 46).

### Task D4 — retrofit `scripts/install-disk-tuning.ts`
Mirror `scripts/install-network-tuning.ts` (active-host-safe per-server SSH loop, `steps: [[label,cmd]]`, importing the **exported** builders). `package.json` `"install:disk-tuning"`. Header docstring: ACTIVE-HOST-SAFE, operator-run (Rule 60). Commit per task; `pnpm test:all` green.

---

## Phase E — Per-cube QoS · flags `DISK_QOS_ENABLED` (FC) + `IO_CGROUP_ENABLED` (host)

### Task E1 — `buildDriveRateLimiter()` + `cubeIoMax()` pure helpers
`lib/cubes/disk-iops.ts` (+`.test.ts`, mirror `lib/cubes/cpu-weight.ts`): the **tier is derived from `cube.vcpus`** against `DISK_RATE_LIMITER_TIERS[].minVcpus/maxVcpus` (no `cubes.tier` column exists — same derivation as `creditRateForVcpus`). `buildDriveRateLimiter(cube, topology)` returns the FC `rate_limiter` object (adaptive: NVMe → larger buckets), **as the validation boundary — `null` on ANY missing/malformed value** so the PUT body is never malformed (Constraint 1). `cubeIoMax(cube, topology)` returns ONLY the **device-agnostic numeric `{ wbps, rbps }`** (no device, no string) — a pure value like `cubeCpuWeight`. The `<maj:min>` resolution + line formatting live elsewhere (`cubeDiskDeviceCommand` + `io-max.ts`, Task E3). **Test:** flag-off / missing data → `null`; tier derivation from vcpus; NVMe vs SATA bucket sizing. One source of truth for boot + live-PATCH (Rule 14).

### Task E2 — FC `rate_limiter` at boot + live PATCH
1. Thread a pre-resolved `driveRateLimiter` opt via `cubeDriveRateLimiterOpts(cubeId)` (mirror `lib/cubes/numa-launch-opts.ts` — one DB read, fail-safe null) into **every** launch path: the `createCube` spread in [cube-boot.ts](../../../lib/worker/cube-boot.ts) (~L294, provision) **and every `startCube` relaunch caller** (`grep` the actual callers — cube-wake, cube-cold-restart, cube-from-snapshot, snapshot-restore, cube-auto-relaunch, server-reboot-recovery, cube-state-sync, cube-import-rootfs, cube-error-recovery[-scan], cube-resize, cube-transfer, backup-redeploy; verify the count by grep, don't hard-code "13"). A missed caller silently drops the limiter for that path (fail-safe, not a brick). Spread into the PUT bodies from Task B1.
2. Live throttle/tier-change: a `PATCH /drives/rootfs` `{drive_id, rate_limiter}` **only** (never `path_on_host`) on a **running** cube, sharing `buildDriveRateLimiter()` — co-located with the existing resize PATCH at [cube-resize.ts:344](../../../lib/worker/handlers/cube-resize.ts#L344) but a **separate body** (resize vs throttle never merged).
3. Tests assert flag-off PUT body unchanged + a missed caller fails-safe to no-limiter. Commit.

### Task E3 — host cgroup `io.max` (write to the LEAF, not via the jailer)

> **Live-validated 2026-06-05 (dev host, kernel 6.8, jailer v1.15.1) — two corrections baked in:**
>
> - **The jailer REJECTS `--cgroup io.max=<dev> wbps=N`** → `Error: CgroupFormat("io.max=253:0 wbps=10485760")` (its `file=value` parser refuses the space + second `=`). So `io.max` **must NOT** go through `buildJailerArgs`. **Mechanism: the jailer sets `cpu.weight`/`cpuset` (single-value args, proven OK); the worker writes `io.max` directly to the leaf `/sys/fs/cgroup/krova/<cubeId>/io.max` after the jailer creates it** — proven working AND **live-updatable** (re-write the file on a tier change; no reboot). This makes `io.max` **running-cube-safe**, not next-cold-boot.
> - **`io.max` throttles buffered writeback with `io` ALONE on kernel 6.8** (background-writeback drained at exactly the 10 MB/s cap with the `memory` controller both on and off). The "needs `memory`" rule is older-kernel-only. We still co-delegate `+memory` as **cross-kernel insurance** (prod host kernel is unverified per Rule 60), but the real gap is that Krova delegates **only `cpu`** today — once `+io` is delegated, `io.max` bites buffered writes.

1. [cpu-cgroup.ts](../../../lib/ssh/cpu-cgroup.ts): add `+io`/`+memory` delegation lines (root→`krova`, idempotent `grep -qw … || echo +… || true`) gated on `IO_CGROUP_ENABLED`, mirroring `cpusetLines` (L35). **The whole `+io/+memory` block, the prep-script status echo, AND the systemd unit body must ALL be gated on `IO_CGROUP_ENABLED`** so flag-off yields a byte-identical prep script (Constraint 1) — add a `cpu-cgroup.test.ts` case asserting flag-off has no `+io/+memory`. Add read-only `ioCgroupReadyCommand()` (parent delegates `io`) + `cubeDiskDeviceCommand(rootfsPath)` that resolves the maj:min of the device **backing the rootfs FILE** — i.e. the LVM `dm-N`/logical volume that `/var/lib/krova` lives on, NOT a physical `sd*` member. Resolve from the path: `stat -c '%t:%T'` on the underlying block device (or `df --output=source <cubeDir>` → the `dm-*`/`/dev/mapper/*` device → its `/sys/.../dev`). ⚠️ On the `ext4-on-LVM-on-mdadm-RAID1` layout an `sd*` maj:min would throttle **nothing** — the writeback bios carry the `dm` device number. Assert read-only in the test.
2. **`lib/cubes/io-max.ts` writer (NOT a jailer arg) — jailed cubes only:** after `launchJailed` confirms the cube is running, gated `CPU_CGROUP_ENABLED && IO_CGROUP_ENABLED && limits-resolved` (the `krova/<cubeId>` leaf only exists because the jailer's `cpu.weight --cgroup` arg created it — so io.max requires `CPU_CGROUP_ENABLED`; bare-mode cubes have no leaf and get no host io.max, like L1 cpu.weight). The worker writes the full line built by `io-max.ts` (joins the `cubeDiskDeviceCommand` **dm maj:min** + the `cubeIoMax` `{wbps,rbps}`): `echo "<dm-maj:min> wbps=<n> rbps=<n>" > /sys/fs/cgroup/krova/<cubeId>/io.max` over SSH (full line each write — partial writes merge, so always re-emit both). Fail-safe: any failure → `console.warn("… running without io.max")`, never throw. Reuse the same line for **live tier-change** updates (running-cube-safe). `buildJailerArgs` is **unchanged** for io.
3. Teardown: widen the `if (CPU_CGROUP_ENABLED)` **condition** at [firecracker.ts:344](../../../lib/ssh/firecracker.ts#L344) to `if (CPU_CGROUP_ENABLED || IO_CGROUP_ENABLED)`; the guarded `rmdir /sys/fs/cgroup/${CPU_CGROUP_PARENT}/${cubeId}` at :347 then also runs when only IO is on (io.max lives inside the leaf, so the single rmdir removes it).
4. Extend `cpuCgroupPrepScript()` to emit io/memory delegation; reuse via `scripts/install-io-cgroup.ts` (or fold into `install-disk-tuning.ts`). Tests: flag-off prep has no `+io/+memory`; flag-on does; the leaf-write helper builds the exact `maj:min wbps= rbps=` line; probes read-only. Commit per sub-step.

> **Why two layers:** FC `rate_limiter` shapes **guest submission** (customer-facing, live-PATCHable) but does **not** bound host page-cache writeback; the host `io.max` leaf-write is what caps a buffered-write hog (proven live). Both, together, are the noisy-neighbour fix.

---

## Phase F — Storage-path write-amp · flag `DISK_IO_STORAGE_TUNING_ENABLED`

### Task F1 — restic flags (central chokepoint)
[commands.ts](../../../lib/storage/restic/commands.ts): `backup … --no-scan` ([L375](../../../lib/storage/restic/commands.ts#L375)), `restore … --sparse` ([L441](../../../lib/storage/restic/commands.ts#L441)), and `ionice -c2 -n7 nice -n10 ` prefix on the single `cmd` chokepoint ([L189](../../../lib/storage/restic/commands.ts#L189)) — all conditional, flag-off = byte-identical arg string. (`RESTIC_CACHE_DIR` already off-cube ✓.) Host smoke the restore `--sparse` round-trip (Rule 59). Every snapshot/backup/clone/import handler inherits this for free (no per-handler edits — Rule 14).

### Task F2 — rclone serialize + bwlimit
[s3-transfer.ts `rcloneFlags()`](../../../lib/storage/s3-transfer.ts#L45): flag-on → `--multi-thread-streams 1 --s3-upload-concurrency 1 --bwlimit ${RCLONE_BWLIMIT_MB}M` (cap **both** stream + s3-concurrency — the latter overrides the former when larger; keep cutoff/chunk/retries). Update the module's 4×4-rationale comment (Rule 22). Single chokepoint covers upload + download.

### Task F3 — zstd thread cap + decompress/grow throttle (audit #5, #6, #8)
The zstd backup + the import/redeploy decompress+grow legs all saturate cores / un-throttled reads on the live host. Flag-on (`DISK_IO_STORAGE_TUNING_ENABLED`), at each chokepoint, flag-off = byte-identical command:
1. **Backup zstd (#5):** `host-build.ts:147` — replace bare `zstd -T0` with `zstd -T${DISK_ZSTD_THREADS}` (adaptive: leave host cores for cubes). (Audit §4 #5 wording corrected: the rootfs is read **once** for compression; the cost is `-T0` core-saturation contending with co-tenants, not a triple-read.)
2. **Decompress (#8):** `host-extract.ts:272` — prefix `ionice -c2 -n7 nice -n10 ` on the zstd decompress.
3. **e2fsck/resize2fs grow (#6, #8):** wrap the host-side `e2fsck`/`resize2fs` calls on the import/redeploy/resize paths ([cube-resize.ts](../../../lib/worker/handlers/cube-resize.ts) ~L405, cube-from-snapshot, cube-import-rootfs, backup-redeploy) with `ionice -c2 -n7 nice -n10 `. Note the **lazy-init residue**: `lazy_itable_init=0` at build (Task C1) only covers the golden image's minimized table; growing to the customer's disk size re-creates an uninitialised inode table that the kernel's `ext4lazyinit` zeroes in the background on the live device — the `ionice` wrap bounds it, and it is already throttled background I/O (acceptable; documented, not eliminated).

### Task F4 — cube-transfer double-copy collapse (HIGH-care)
[cube-transfer.ts](../../../lib/worker/handlers/cube-transfer.ts) L273/L298/L385: flag-off keeps `cp --reflink` + `rsync` exactly. Flag-on, key the collapse on **actual filesystem reflink capability** (NOT `disk_topology` transport): a pure unit-tested `transferCopyStrategy(reflinkCapable) → "reflink-clone" | "snapshot-then-rsync"`. On a reflink-incapable FS (ext4 — Krova's case) `rsync --sparse --inplace` directly off the **paused** source and drop `xfer-snapshot.ext4`; on a reflink FS keep the cheap clone. **Preflight the capability + state checks at the top (Rule 58) before the Pause; preserve the `transferState`-gated idempotent re-entry; keep the Pause window minimal.** **Requires `pnpm test:host` + an operator canary transfer.** Commit per task.

### Task F5 — serial.log / fcLog host rotation (audit #14)
Phase D / host area (NOT the guest image): install a host logrotate drop-in (size + rotate, `copytruncate` so Firecracker's open fd stays valid) for `/var/lib/krova/cubes/*/serial.log` + `fcLog`, gated `DISK_HOST_TUNING_ENABLED`. Export the builder; add to `install-disk-tuning.ts`. Bounds the unbounded growth that erodes sellable 1:1 disk.

### Task F6 — cron de-confliction + per-host serialization
1. [boss.ts](../../../lib/worker/boss.ts) L478–506: de-conflict the actually-**disk-heavy** restic crons. `DISPOSABLE_EMAILS_REFRESH` is a DB/HTTP job (no host disk) — **do not** move it. The real overlap is `RESTIC_PRUNE` (Sun 04:00) and the **hourly** `SNAPSHOT_SCHEDULER`/`SNAPSHOT_EXPORT_REAP` (`0 * * * *`, which also fire at Sun 04:00); stagger the hourly ones off `:00`, keep prune 04:00 / check 06:00 apart. Inline minute-offset comments (house style).
2. [restic-prune.ts](../../../lib/worker/handlers/restic-prune.ts) / [snapshot-auto-prune.ts](../../../lib/worker/handlers/snapshot-auto-prune.ts) / [restic-check.ts](../../../lib/worker/handlers/restic-check.ts): group rows by `serverId` (already selected), bounded `Promise.allSettled` **across** host-groups + sequential **within** (mirror `server-measure-disk.ts` BATCH_SIZE). Gate behind the flag → flag-off = today's flat loop. Preserve per-cube try/catch isolation + Rule 47 forget-args guard; verify the `expireInSeconds` budget covers the slowest serialized host group. Add behavior-preserving OFF-path tests (Rule 59). Commit per task.

> **Consciously deferred (audit #13 — restic reads a running cube's rootfs un-frozen):** no fsfreeze/quiesce added. restic content-addresses + the `ionice` (F1) bounds contention; a torn-image risk exists but the existing pre-deletion-backup + redeploy salvage path covers recovery, and fsfreeze on a live customer rootfs has its own hang risk. Revisit only if Task 0 shows it materially hurts.

---

## Phase G — NUMA-disk placement — **DROPPED (2026-06-06)**

Scoped but never shipped to production and **removed**: it was a no-op on the
current single-`/var/lib/krova`-volume hosts (no per-node storage to localize to)
and had **no live caller** in the launch path. The flag, `lib/cubes/disk-numa.ts`,
and its test were deleted. Re-add it on top of `numa-launch-opts.ts` (the live L2
CPU placement) the day per-NUMA-node cube-storage volumes actually exist.

---

## Rollout (operator, AFTER merge — Rule 60). Each phase independent + reversible.

1. **Deploy** all phases flag-off (inert; topology auto-detection is harmless data). `pnpm install:disk-topology` backfills the fleet.
2. **Apply migration 0074** (additive nullable column).
3. **Per phase, in order B → D → E → F → C(image):**
   a. `pnpm install:disk-tuning` / `install:io-cgroup` preps hosts (active-host-safe, no cube impact).
   b. **Canary** on ONE host: cold-boot a cube, confirm the knob applied (`cat /sys/fs/cgroup/krova/<id>/io.max`, `fio` cap holds, a buffered-write hog no longer starves a co-tenant, `cache_type` honored via fsync test, `cat /sys/block/sd*/queue/scheduler`, `sysctl vm.dirty_bytes`), networks + boots.
   c. **Flip the flag, deploy.** Timing split: **running-cube-safe / immediate** — `rate_limiter` PATCH, **io.max leaf-write**, host sysctls, udev, scrub throttle, restic/rclone flags, cron. **Next-cold-boot** — `cache_type`, per-cube `fallocate`. The 30 live cubes get the cold-boot items only when they relaunch.
4. **Image phase (C):** `pnpm build:images`, host smoke, register; new + redeployed cubes get the diet. Existing cubes inherit on their next redeploy. Note C1's per-cube `fallocate` is gated on `DISK_HOST_TUNING_ENABLED` (Phase D), which rolls out **before** C in this order — so the dependency is satisfied.
- **Rollback any layer:** flip its flag false + redeploy → back to today (host drop-ins removed by re-running the retrofit with the flag off, or `rm` the drop-in). Fully reversible.

---

## Self-review

**Spec coverage (12 locked decisions → tasks):** ① Writeback→B1 · ② adaptive→A1–A3+D2+E1 · ③ QoS FC+host→E1–E3 · ④ dirty sysctls→D1 · ⑤ scheduler→D2 · ⑥ fstrim→D3 · ⑦ mdadm→D3 · ⑧ restic→F1+F6 · ⑨ rclone→F2 · ⑩ mkfs/fallocate/noatime→C1 · ⑪ guest diet→C2 · ⑫ NUMA-disk→**dropped (no live caller)**.
**Audit §4 problem-area coverage (all 18):** #1 writeback-stall→B+D+E · #2 no QoS→E · #3 no throttle→F1/F2/F6 · #4 restore `--sparse`→F1 · #5 zstd→F3 · #6 resize2fs grow→F3.3 · #7 transfer double-copy→F4 · #8 import/redeploy triple-write→F3.2+F3.3 · #9 sparse truncate→C1+B(fallocate) · #10 host tuning→D1–D3 · #11 mdadm scrub→D3 · #12 cron pile-up→F6 · #13 un-frozen restic read→**deferred** (noted) · #14 serial.log/swap→F5 (logs) + D1 (swappiness retained) · #15 fstab discard/noatime→C1 · #16 journald+rsyslog→C2 · #17 apt-daily→C2 · #18 docker logs→C2.
**No-breaking-changes guarantee:** every change inside `if (FLAG)`; tests assert flag-off PUT-drives body (incl. **no `io_engine` key**), jailer argv, cron loop, and host files are byte-identical; the 30 live cubes are untouched until they cold-boot themselves.
**Fail-safe:** malformed `rate_limiter`/`io.max`/`cache_type`/un-delegated controller → launch-without (never brick); `fallocate`→`truncate` fallback; every host knob no-ops on single-device/non-RAID.
**Placeholder scan:** pure helpers (`parseDiskTopology`, `buildDriveRateLimiter`, `cubeIoMax` numeric, `io-max.ts` line-builder, `transferCopyStrategy`) fully coded + tested; **only** Task-0-dependent value is `DISK_RATE_LIMITER_TIERS` bucket sizing (explicitly blocked on the fio measurement — not "TBD").
**Test boundary (Rule 59 — honest):** `pnpm test:all` (agent-runnable) proves the **pure builders + flag-off byte-identity + the device-resolution/arg strings** only. The load-bearing *runtime* behaviors — io.max actually throttling, `+io/+memory` delegation, `cache_type=Writeback` fsync durability, `fallocate` fallback, udev/sysctl effects, the transfer collapse — are **host-only** and proven by **operator host-smoke + the per-phase canary**, NOT by `test:all`. Each host task names what its unit test covers vs what only the canary can.
**Ordering:** Task 0 (blocking measurement) → A (foundation) → B/C/D/E/F/G (independent, each green + committed). Migrate before code reads the column (Rule 40).
**Rule 60:** every `fio`/sysctl/udev/mdadm/retrofit/canary is operator-run; agent confined to repo + `pnpm db:generate` (generate, never apply); dev host proved mechanism/API correctness (2026-06-05) but **not** SATA-vs-NVMe adaptivity or hardware numbers (single-disk VM, kernel 6.8) — operator canary on a real host for those.
**L2 cross-link:** the disk-NUMA follow-up L2 deferred remains deferred — Phase G was scoped to fulfill it but was dropped (no live caller; re-add when per-node storage exists).
