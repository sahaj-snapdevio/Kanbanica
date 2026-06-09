# Task 0 — Disk Measurement Bundle (LIVE-host-safe, operator-run)

Prepared per Rule 60: **you** run these on the bare-metal hosts and paste the output back; I size the
per-cube QoS caps (`DISK_RATE_LIMITER_TIERS`) + confirm the audit from real numbers. Goal: the real
write ceiling + the number customers feel, **without disrupting live cubes**.

> **Safety:** Parts A and C are **read-only** (zero impact). Part B is a QD1-durable fio ≈ **~4 MB/s**
> (one outstanding 4 KiB write at a time — negligible bandwidth; it measures *latency*, not throughput).
> Part B-OPT **saturates** the disk for ~30 s — run it **only on a quiet host, off-peak**, or skip it
> (Parts A+B+C are enough to size the caps). Everything writes a scratch file under `/var/lib/krova` and
> `rm`s it; no cube config is touched.

Run on **each distinct host type** (and at least one busy host for Part C). Capture all output.

---

## Part A — host facts (READ-ONLY, anytime, zero impact)

```bash
echo "== block topology =="
lsblk -d -o NAME,ROTA,TRAN,MODEL,SIZE
echo "== per-device scheduler / rotational / numa =="
for d in /sys/block/sd* /sys/block/nvme*n* /sys/block/dm-* /sys/block/md*; do
  [ -e "$d" ] || continue
  echo "$(basename "$d"): sched=$(cat "$d"/queue/scheduler 2>/dev/null) rota=$(cat "$d"/queue/rotational 2>/dev/null) numa=$(cat "$d"/device/numa_node 2>/dev/null)"
done
echo "== RAID state (rule out a scrub as the drag) =="
cat /proc/mdstat
cat /sys/block/md*/md/sync_action 2>/dev/null
cat /proc/sys/dev/raid/speed_limit_max 2>/dev/null
echo "== dirty-page config (expect ratio-based 20/10) =="
cat /proc/sys/vm/dirty_ratio /proc/sys/vm/dirty_background_ratio /proc/sys/vm/dirty_bytes
echo "== which device backs the cube volume + the restic cache (contention check) =="
df -h /var/lib/krova
df --output=source /var/lib/krova/cubes 2>/dev/null | tail -1
df /var/lib/krova/cubes /var/lib/krova/restic-cache 2>/dev/null
```

## Part B — QD1-durable write latency (LOW-IMPACT ~4 MB/s, run off-peak)

This is the **headline number** — the latency of one durable write, i.e. what a DB commit / fsync feels.

```bash
command -v fio >/dev/null || (apt-get install -y fio 2>/dev/null || dnf install -y -q fio)
S=/var/lib/krova/fio.t0
fio --name=qd1-durable --filename="$S" --ioengine=psync --direct=1 --rw=randwrite \
    --bs=4k --iodepth=1 --fdatasync=1 --size=2G --runtime=30 --time_based --ramp_time=5 \
    --group_reporting
rm -f "$S"
```
Report from the output: **`write: IOPS=…`** and **`clat … avg / 99.00th`** (µs).

## Part B-OPT — throughput ceiling (SATURATES disk ~30 s — QUIET host only, else SKIP)

```bash
S=/var/lib/krova/fio.t0
fio --name=qd32-randw --filename="$S" --ioengine=libaio --direct=1 --rw=randwrite \
    --bs=4k --iodepth=32 --size=4G --runtime=30 --time_based --ramp_time=5 --group_reporting
fio --name=seq-write  --filename="$S" --ioengine=libaio --direct=1 --rw=write \
    --bs=1M --iodepth=16 --end_fsync=1 --size=4G --runtime=30 --time_based --group_reporting
rm -f "$S"
```
Report: QD32-randwrite **`IOPS`**, seq-write **`BW` (MB/s)**.

## Part C — contended reality (READ-ONLY; run DURING a real backup/snapshot window)

```bash
# start these, then trigger/await an auto-snapshot or backup on this host:
iostat -xm 1 30        # watch w_await, aqu-sz on sd*/md*/dm-* (ignore %util on SSD)
pidstat -d 1 30        # attribute kB_wr/s to restic vs firecracker vs kworker/flush
grep -E 'Dirty|Writeback' /proc/meminfo   # sampled a few times during the window
```

---

## Paste-back template

```
HOST: <hostname>   (role: prod / spare)
A. disks: <e.g. sda+sdb SATA SSD, md1 RAID1, dm-0 LVM>  rotational=<0/1>  scheduler=<...>  numa=<...>
   RAID sync_action=<idle/check/...>   dirty=<ratio 20/10 or bytes>
   /var/lib/krova backed by: <device>   restic-cache same volume? <yes/no>
B. QD1-durable: IOPS=<...>  clat avg=<...>µs  p99=<...>µs
B-OPT (if run): QD32 randwrite IOPS=<...>   seq-write BW=<...> MB/s
C. during a backup: peak w_await=<...>ms  aqu-sz=<...>  top writer=<restic/fc/kworker>  Dirty peak=<...>MB
```

Once you paste this for one representative host, I'll: (1) confirm/correct the audit's hardware
assumptions, (2) set `DISK_RATE_LIMITER_TIERS` + `RAID_SCRUB_SPEED_LIMIT_MAX_KBPS` + `RCLONE_BWLIMIT_MB`
to your real numbers, and (3) green-light flipping `DISK_QOS_ENABLED`.
