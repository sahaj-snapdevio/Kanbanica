/**
 * Host cgroup-v2 prep for per-cube `cpu.weight` fairness (L1, audit C2 — see
 * docs/superpowers/specs/2026-06-03-oversold-cpu-fairness-numa-design.md).
 *
 * Installs a `krova-cgroup-prep` systemd oneshot that, on EVERY boot, (re)creates
 * the dedicated `CPU_CGROUP_PARENT` parent cgroup and delegates the `cpu`
 * controller into it so the jailer's per-cube leaves can set `cpu.weight`. A
 * oneshot (not a one-time mkdir) because cgroupfs is recreated EMPTY on every
 * boot — mirrors the `krova-cpu-perf` governor unit.
 *
 * Confirmed on canary 2026-06-03 (real jailer v1.15.1): the jailer creates the
 * leaf ONE level under the parent (`<parent>/<cubeId>`), root already delegates
 * `cpu` via systemd, and `cpu.weight` applies in the leaf. The parent holds NO
 * processes directly (the jailer puts Firecracker in leaves), satisfying
 * cgroup-v2's no-internal-process rule. Idempotent + fail-safe; never touches the
 * jailer's default `firecracker` parent, so a flag-off launch is unaffected.
 * Base64-piped so the heredocs survive ssh2's exec verbatim (Rule 39).
 */
import {
  CPU_CGROUP_PARENT,
  IO_CGROUP_ENABLED,
  NUMA_PLACEMENT_ENABLED,
} from "@/config/platform";

const PARENT = `/sys/fs/cgroup/${CPU_CGROUP_PARENT}`;

export function cpuCgroupPrepScript(opts?: {
  numa?: boolean;
  io?: boolean;
}): string {
  // `numa`/`io` default to the live flags; callers pass them explicitly only in
  // tests so every shape is asserted deterministically regardless of the flag's
  // current value. Production callers omit them → use the flags.
  const numa = opts?.numa ?? NUMA_PLACEMENT_ENABLED;
  const io = opts?.io ?? IO_CGROUP_ENABLED;
  // Disk QoS backstop (disk overhaul E): delegate `io` + `memory` (root→krova→
  // leaves) so the worker can write per-cube `io.max` into a leaf AND buffered
  // writeback is attributed to the cube. GATED on IO_CGROUP_ENABLED so a flag-OFF
  // host's cgroup hierarchy stays byte-identical. `memory` is co-delegated as
  // cross-kernel insurance (on 6.8 `io` alone throttles buffered writeback, but
  // older kernels need memory for attribution — live-validated 2026-06-05).
  // Re-run `pnpm install:cpu-cgroup` after flipping the flag.
  const ioLines = io
    ? [
        "grep -qw io /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || echo +io > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true",
        "grep -qw memory /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || echo +memory > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true",
        `grep -qw io ${PARENT}/cgroup.subtree_control 2>/dev/null || echo +io > ${PARENT}/cgroup.subtree_control 2>/dev/null || true`,
        `grep -qw memory ${PARENT}/cgroup.subtree_control 2>/dev/null || echo +memory > ${PARENT}/cgroup.subtree_control 2>/dev/null || true`,
        // SELF-HEAL: the `io` write into root `subtree_control` can lose a one-off
        // race with a concurrent systemd cgroup reconfigure (observed on a host
        // whose systemd default omits `io`), leaving the host's io.max backstop
        // un-delegated until the next boot. Verify io reached the krova parent and,
        // if not, re-assert root→krova up to 5× with a 1s settle (the write itself
        // is accepted — it just needs to land after systemd settles). No-op the
        // common case (io already present → loop body never runs).
        `i=0; while [ $i -lt 5 ] && ! grep -qw io ${PARENT}/cgroup.subtree_control 2>/dev/null; do sleep 1; echo +io > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true; echo +io > ${PARENT}/cgroup.subtree_control 2>/dev/null || true; i=$((i+1)); done`,
      ]
    : [];
  // L2 (NUMA): delegate `cpuset` (root→krova→leaves) + seed the parent's cpuset
  // to the whole machine so per-cube leaves can subset a NUMA node. GATED on
  // NUMA_PLACEMENT_ENABLED so a flag-OFF host's cgroup hierarchy stays
  // byte-identical to L1-only — no host-wide root `subtree_control` change for a
  // disabled feature. Re-run `pnpm install:cpu-cgroup` after flipping the flag
  // (it is a step in the L2 rollout). Order matters: root delegates cpuset →
  // krova's cpuset.* files appear → seed them → krova delegates cpuset to leaves.
  const cpusetLines = numa
    ? [
        "grep -qw cpuset /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || echo +cpuset > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true",
        `[ -e ${PARENT}/cpuset.cpus ] && cat /sys/fs/cgroup/cpuset.cpus.effective > ${PARENT}/cpuset.cpus 2>/dev/null || true`,
        `[ -e ${PARENT}/cpuset.mems ] && cat /sys/fs/cgroup/cpuset.mems.effective > ${PARENT}/cpuset.mems 2>/dev/null || true`,
        `grep -qw cpuset ${PARENT}/cgroup.subtree_control 2>/dev/null || echo +cpuset > ${PARENT}/cgroup.subtree_control 2>/dev/null || true`,
      ]
    : [];
  const prep = [
    "#!/bin/sh",
    "# Krova: (re)create the per-cube parent cgroup + delegate cpu (L1)" +
      (numa ? " + cpuset (L2)." : "."),
    `mkdir -p ${PARENT}`,
    // root already delegates cpu (systemd default); guard + tolerate either way.
    "grep -qw cpu /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || echo +cpu > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true",
    `grep -qw cpu ${PARENT}/cgroup.subtree_control 2>/dev/null || echo +cpu > ${PARENT}/cgroup.subtree_control 2>/dev/null || true`,
    ...cpusetLines,
    ...ioLines,
    "exit 0",
  ].join("\n");
  const script = `set -e
cat > /usr/local/sbin/krova-cgroup-prep <<'PREP'
${prep}
PREP
chmod +x /usr/local/sbin/krova-cgroup-prep
cat > /etc/systemd/system/krova-cgroup-prep.service <<'UNIT'
[Unit]
Description=Krova per-cube cpu.weight parent cgroup (${CPU_CGROUP_PARENT}) + cpu delegation
After=local-fs.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/krova-cgroup-prep
[Install]
WantedBy=multi-user.target
UNIT
# The trailing-true on these mirrors the sibling krova-cpu-perf / KSM install
# steps: a systemd or cgroupfs hiccup on a degenerate host must NOT hard-fail the
# whole install phase (the step is gated on CPU_CGROUP_ENABLED and the prep run
# below already exits 0). The file-writes above keep set -e — those MUST succeed
# (installing a broken unit is worse than skipping it).
systemctl daemon-reload || true
systemctl enable krova-cgroup-prep.service || true
/usr/local/sbin/krova-cgroup-prep || true
echo "krova cpu delegated: $(cat ${PARENT}/cgroup.subtree_control 2>/dev/null)"
exit 0
`;
  const b64 = Buffer.from(script).toString("base64");
  return `echo '${b64}' | base64 -d | bash`;
}

/**
 * Read-only probe: exits 0 iff the parent cgroup exists AND delegates `cpu`.
 * The launch preflight (lib/ssh/firecracker.ts) uses this to fall back to a
 * no-weight launch when prep hasn't run on a host — so a missing parent can
 * NEVER brick a boot (the jailer would otherwise error creating the leaf).
 */
export function cpuCgroupReadyCommand(): string {
  return `test -d ${PARENT} && grep -qw cpu ${PARENT}/cgroup.subtree_control`;
}

/**
 * Read-only probe: exits 0 iff the parent cgroup delegates `cpuset` (L2). The
 * launchJailed cpuset preflight uses this to fall back to an UN-pinned launch
 * when a host hasn't re-run the (cpuset-delegating) prep — so missing cpuset
 * delegation can NEVER brick a boot (the jailer would otherwise error writing
 * cpuset.cpus into the leaf).
 */
export function cpusetReadyCommand(): string {
  return `test -d ${PARENT} && grep -qw cpuset ${PARENT}/cgroup.subtree_control`;
}

/**
 * VALUE-AWARE cpuset preflight for launchJailed (review H1). Emits three lines —
 * delegation status + the parent's LIVE effective cpus/mems — so the caller can
 * confirm the computed leaf cpuset is a subset BEFORE binding. A cpuset.cpus/mems
 * write that isn't a subset of the parent's effective set makes the jailer EINVAL
 * and brick the boot; this lets launchJailed fall back to an UNPINNED launch when
 * the bootstrap-cached topology has drifted from the host's current effective set
 * (a CPU offlined after bootstrap, a memoryless node, an unseeded parent).
 *   line 1: "DELEGATED" | "NO"   (krova delegates cpuset to leaves)
 *   line 2: "CPUS:<parent cpuset.cpus.effective>"
 *   line 3: "MEMS:<parent cpuset.mems.effective>"
 */
export function cpusetPreflightCommand(): string {
  return [
    `grep -qw cpuset ${PARENT}/cgroup.subtree_control 2>/dev/null && echo DELEGATED || echo NO`,
    `echo "CPUS:$(cat ${PARENT}/cpuset.cpus.effective 2>/dev/null)"`,
    `echo "MEMS:$(cat ${PARENT}/cpuset.mems.effective 2>/dev/null)"`,
  ].join("; ");
}

/**
 * Read-only probe: exits 0 iff the parent cgroup delegates `io` (disk overhaul
 * E). The launch io.max write uses this to fall back to a NO-io.max launch when a
 * host hasn't re-run the (io-delegating) prep — so missing io delegation can
 * NEVER brick a boot (a leaf io.max write would otherwise fail).
 */
export function ioCgroupReadyCommand(): string {
  return `test -d ${PARENT} && grep -qw io ${PARENT}/cgroup.subtree_control`;
}

/**
 * Resolve the `<maj:min>` of the block device that `io.max` must key on for a
 * cube whose rootfs FILE lives at `rootfsPath` — the device backing that file's
 * filesystem, NOT a physical RAID member. `io.max` (blk-throttle) is per
 * request-queue / gendisk, so:
 *   - ext4-on-LVM (prod): the dm/LVM logical volume's own maj:min (a gendisk).
 *   - ext4-on-partition (e.g. /dev/vda1): the PARENT whole-disk gendisk (vda) —
 *     blk-throttle attributes a partition's bios to its parent disk.
 *   - ext4-on-whole-disk: that disk's maj:min.
 * Read-only; emits a single `maj:min` line (or nothing → caller skips io.max).
 */
export function cubeDiskDeviceCommand(rootfsPath: string): string {
  return [
    `src=$(df --output=source ${rootfsPath} 2>/dev/null | tail -1)`,
    '[ -n "$src" ] || exit 0',
    'kname=$(lsblk -no KNAME "$src" 2>/dev/null | head -1)',
    '[ -n "$kname" ] || exit 0',
    // A partition has /sys/class/block/<kname>/partition → use the parent gendisk
    // (../dev); a dm/whole-disk uses its own dev.
    "if [ -f /sys/class/block/$kname/partition ]; then cat /sys/class/block/$kname/../dev 2>/dev/null; else cat /sys/class/block/$kname/dev 2>/dev/null; fi",
  ].join("; ");
}
