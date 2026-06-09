/**
 * Single source of truth for Firecracker-jailer paths + invocation.
 * See docs/superpowers/plans/2026-05-29-firecracker-jailer-hardening.md.
 *
 * Chroot layout (jailer v1.15, CONFIRMED empirically on canary `banana`
 * 2026-05-29):
 *
 *   <JAILER_CHROOT_BASE>/firecracker/<cubeId>/root/   ← chroot root, 0700 <uid>:kvm
 *     ├─ firecracker              hardlinked exec-file, owned by <uid>
 *     ├─ firecracker.pid          host-visible FC pid (root:root), written by
 *     │                           the jailer when --new-pid-ns is used
 *     ├─ run/firecracker.socket   API socket (`-- --api-sock /run/firecracker.socket`)
 *     ├─ fc.log                   `-- --log-path /fc.log`
 *     ├─ vsock.sock               `PUT /vsock { uds_path: "/vsock.sock" }`
 *     └─ dev/{kvm,net/tun,urandom,userfaultfd}   jailer-provisioned, owned by <uid>
 *
 * The four host-visible paths in `CubePaths` are what the WORKER touches over
 * SSH (curl --unix-socket, vsock helper, pid kill, log tail). The chroot-
 * relative `JAILED_INNER` paths are what FIRECRACKER sees (it is chrooted), and
 * are passed to the jailer CLI / Firecracker API. rootfs.ext4 is deliberately
 * NOT here — it stays at its canonical /var/lib/krova/cubes/<id> path and is
 * HARDLINKED (ln -f, same filesystem) into the chroot at launch. There is NO
 * mount, so `rm -rf` of the chroot at teardown is inode-safe (the canonical
 * link survives) and the snapshot/restic/loop-mount code keeps using the
 * original path unchanged. Do NOT reintroduce a bind-mount/umount here.
 */

import { CPU_CGROUP_PARENT, JAILER_CHROOT_BASE } from "@/config/platform";

export type LaunchMode = "bare" | "jailed";

/** The jailer's `--exec-file` name; also the chroot subdir the jailer builds. */
export const EXEC_FILE_NAME = "firecracker";

/** Absolute path to the firecracker binary on hosts (installed by
 *  server.install / `pnpm install:jailer` alongside the jailer). */
export const FIRECRACKER_BIN = "/usr/local/bin/firecracker";

/** Canonical (bare-mode) per-cube directory. */
const CUBE_BASE_DIR = "/var/lib/krova/cubes";

/** Host-visible chroot root for a jailed cube. */
export function jailRoot(cubeId: string): string {
  return `${JAILER_CHROOT_BASE}/${EXEC_FILE_NAME}/${cubeId}/root`;
}

export interface CubePaths {
  /** Host path to the FC API unix socket (worker curls this). */
  apiSock: string;
  /** Host path to the FC log (state-sync tails this for the reboot marker). */
  fcLog: string;
  /** Host path to the FC pid file (kill / liveness). */
  pidFile: string;
  /** Host path to the vsock UDS (browser terminal + guest-exec connect here). */
  vsockPath: string;
}

/**
 * Resolve the four host-visible per-cube paths for the cube's CURRENT launch
 * mode. Every reader/killer in the codebase MUST route through this — never
 * hardcode `/var/lib/krova/cubes/<id>/…` again.
 */
export function cubePaths(cubeId: string, mode: LaunchMode): CubePaths {
  if (mode === "jailed") {
    const r = jailRoot(cubeId);
    return {
      apiSock: `${r}/run/firecracker.socket`,
      vsockPath: `${r}/vsock.sock`,
      fcLog: `${r}/fc.log`,
      pidFile: `${r}/firecracker.pid`,
    };
  }
  const d = `${CUBE_BASE_DIR}/${cubeId}`;
  return {
    apiSock: `${d}/firecracker.sock`,
    vsockPath: `${d}/vsock.sock`,
    fcLog: `${d}/fc.log`,
    pidFile: `${d}/firecracker.pid`,
  };
}

/**
 * Chroot-RELATIVE paths Firecracker itself sees (it is chrooted by the jailer).
 * Passed to the jailer CLI (`-- --api-sock …`) and the Firecracker API
 * (`PUT /vsock uds_path`, `PUT /drives/rootfs path_on_host`).
 */
export const JAILED_INNER = {
  apiSock: "/run/firecracker.socket",
  fcLog: "/fc.log",
  /** Kernel hardlinked to <root>/vmlinux; FC sees it at this chroot path. */
  kernel: "/vmlinux",
  /** Rootfs hardlinked to <root>/rootfs.ext4 (canonical inode stays at the
   *  cube dir, plan D4). FC's `PUT /drives/rootfs path_on_host` uses this. */
  rootfs: "/rootfs.ext4",
  vsockPath: "/vsock.sock",
} as const;

/**
 * Pure: build the jailer argv. Everything after `--` is forwarded to
 * Firecracker and is interpreted RELATIVE TO THE CHROOT. This exact shape was
 * confirmed to boot the API server on canary `banana` 2026-05-29.
 *
 * ISOLATION BOUNDARY (what actually contains a VMM/guest escape): the per-cube
 * dropped **uid/gid** + the **chroot** + the **new PID namespace**. A VMM
 * escape lands as an unprivileged per-cube uid inside a chroot, not root on the
 * host. That trio is the whole security claim.
 *
 * CGROUPS — deliberately NOT used for resource confinement (yet). We pass
 * `--cgroup-version 2` but NO `--cgroup <file>=<value>` limits. Two facts from
 * the v1.15.1 jailer docs drive this exact shape:
 *   1. `--cgroup-version` DEFAULTS TO 1. Omitting it would make the jailer try
 *      to use the cgroup-v1 hierarchy, which our cgroup-v2-only Ubuntu 24.04
 *      hosts do not mount → every jailed launch would fail. So the flag MUST
 *      stay even though we pass no limits.
 *   2. With `--cgroup-version 2` and no `--cgroup` args, the jailer creates no
 *      cgroup and only moves Firecracker into the default `--parent-cgroup`
 *      (`firecracker`) IF that cgroup already exists on the host. We never
 *      create `/sys/fs/cgroup/firecracker`, so today the process is simply not
 *      cgroup-confined — there is NO host-level CPU/memory/pids cap beyond what
 *      the Firecracker VMM itself enforces (vcpu_count + mem_size + virtio-mem
 *      ceiling) and Krova's allocator overcommit accounting.
 * OPERATOR INVARIANT: a host must NEVER pre-create `/sys/fs/cgroup/firecracker`
 * with domain controllers (memory/cpu/…) enabled in its `cgroup.subtree_control`
 * — the jailer would then move FC into it and the move FAILS ("no internal
 * process constraint"), bricking every jailed launch on that host. Real
 * per-cube cgroup confinement is a planned follow-up (needs host-side parent
 * cgroup prep to land first) — see the jailer-hardening plan; do NOT add
 * `--cgroup` limits here until that host prep ships.
 *
 * @param gid the per-cube group the dropped Firecracker runs as. Production
 *            passes gid = uid (a unique per-cube group, per Firecracker's
 *            prod-host-setup recommendation). The jailer creates the in-chroot
 *            device nodes 0600 owned by uid:gid, so /dev/kvm access comes from
 *            the OWNER (uid) bit — the gid does NOT grant device access; a
 *            distinct per-cube gid exists so a VMM escape shares no group with
 *            sibling cubes. Do NOT set this to a shared host group (e.g. kvm).
 */
export function buildJailerArgs(opts: {
  cubeId: string;
  uid: number;
  gid: number;
  /**
   * L1 (audit C2): when present (gated by `CPU_CGROUP_ENABLED` at the call site),
   * place the cube in a `<CPU_CGROUP_PARENT>/<cubeId>` leaf with this `cpu.weight`
   * via the jailer's `--cgroup` flag — the jailer writes the value into the leaf
   * and moves Firecracker there at launch (confirmed on canary 2026-06-03).
   * Omitted (flag off) → legacy behavior: NO `--cgroup`/`--parent-cgroup` args,
   * byte-identical to today. The call site preflights that the parent cgroup is
   * prepped and omits `cgroup` when it isn't, so a missing parent can NEVER brick
   * a boot (the jailer would otherwise error creating the leaf).
   */
  cgroup?: { cpuWeight: number; cpuset?: { cpus: string; mems: string } };
}): string[] {
  const cgroupArgs = opts.cgroup
    ? [
        "--parent-cgroup",
        CPU_CGROUP_PARENT,
        "--cgroup",
        `cpu.weight=${opts.cgroup.cpuWeight}`,
        // L2 (NUMA): bind the cube to one node when a cpuset is supplied.
        ...(opts.cgroup.cpuset
          ? [
              "--cgroup",
              `cpuset.cpus=${opts.cgroup.cpuset.cpus}`,
              "--cgroup",
              `cpuset.mems=${opts.cgroup.cpuset.mems}`,
            ]
          : []),
      ]
    : [];
  return [
    "--id",
    opts.cubeId,
    "--exec-file",
    FIRECRACKER_BIN,
    "--uid",
    String(opts.uid),
    "--gid",
    String(opts.gid),
    "--chroot-base-dir",
    JAILER_CHROOT_BASE,
    "--cgroup-version",
    "2",
    ...cgroupArgs,
    "--new-pid-ns",
    "--",
    "--api-sock",
    JAILED_INNER.apiSock,
    "--log-path",
    JAILED_INNER.fcLog,
    "--level",
    "Info",
  ];
}
