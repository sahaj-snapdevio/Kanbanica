/**
 * Firecracker microVM lifecycle management.
 *
 * Replaces libvirt.ts — all VM operations now go through Firecracker's
 * REST API over Unix domain sockets instead of virsh commands.
 *
 * Each Cube runs as a separate Firecracker process with its own:
 *   - API socket:  /var/lib/krova/cubes/{cubeId}/firecracker.sock
 *   - Rootfs:      /var/lib/krova/cubes/{cubeId}/rootfs.ext4
 *   - Serial log:  /var/lib/krova/cubes/{cubeId}/serial.log
 *   - Vsock UDS:   /var/lib/krova/cubes/{cubeId}/vsock.sock
 *   - PID file:    /var/lib/krova/cubes/{cubeId}/firecracker.pid
 *   - IP file:     /var/lib/krova/cubes/{cubeId}/ip.txt
 *
 * Networking uses TAP devices attached to br0 (same bridge as before).
 * Guest agent communication uses virtio-vsock instead of QEMU Guest Agent.
 */

import type { Client } from "ssh2";
import {
  CPU_CGROUP_ENABLED,
  CPU_CGROUP_PARENT,
  DISK_QOS_ENABLED,
  DISK_WRITEBACK_CACHE_ENABLED,
  ENTROPY_DEVICE_ENABLED,
  HOUSEKEEPING_CORES_PER_HOST,
  IO_CGROUP_ENABLED,
  JAILER_BIN,
  JAILER_CHROOT_BASE,
  JAILER_UID_BASE,
  NUMA_PLACEMENT_ENABLED,
  VIRTIO_MEM_BLOCK_SIZE_MIB,
  VIRTIO_MEM_BOOT_FLOOR_MIB,
  VIRTIO_MEM_SLOT_SIZE_MIB,
  VIRTIO_MEM_TOTAL_SIZE_MIB,
} from "@/config/platform";
import { cubeCpuWeight } from "@/lib/cubes/cpu-weight";
import { isDiskCanaryCube } from "@/lib/cubes/disk-canary";
import { buildDriveRateLimiter, cubeIoMax } from "@/lib/cubes/disk-iops";
import { getDiskQosTiers } from "@/lib/cubes/disk-qos-tiers";
import { buildIoMaxLine } from "@/lib/cubes/io-max";
import { ioNicePrefix } from "@/lib/io-nice";
import {
  type NumaTopology,
  nodeCpusetCpus,
  shouldBindCpuset,
} from "@/lib/server/numa";
import {
  cpuCgroupReadyCommand,
  cpusetPreflightCommand,
  cubeDiskDeviceCommand,
  ioCgroupReadyCommand,
} from "@/lib/ssh/cpu-cgroup";
import { avx512MaskCpuidModifiers } from "@/lib/ssh/cpuid-template";
import { writeCubeGuestNetworkConfig } from "@/lib/ssh/cube-guest-network";
import { buildRootfsDriveBody } from "@/lib/ssh/drive-config";
import { execCommand } from "@/lib/ssh/exec";
import {
  buildJailerArgs,
  cubePaths,
  JAILED_INNER,
  jailRoot,
  type LaunchMode,
} from "@/lib/ssh/jailer";
import { sleep, slugifyHostname } from "@/lib/utils";

const CUBE_BASE_DIR = "/var/lib/krova/cubes";
const IMAGE_DIR = "/var/lib/krova/images";
const KERNEL_PATH = `${IMAGE_DIR}/vmlinux`;

const BOOT_ARGS =
  "console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw net.ifnames=0 " +
  "memhp_default_state=online_movable memory_hotplug.memmap_on_memory=1";

/** Derive a TAP device name from the Cube's internal IP (max 15 chars). */
export function tapName(internalIp: string): string {
  const lastOctet = internalIp.split(".").pop();
  return `fc${lastOctet}`;
}

/** Derive a unique vsock CID from the internal IP. CIDs 0-2 are reserved. */
export function vsockCid(internalIp: string): number {
  const lastOctet = Number.parseInt(internalIp.split(".").pop()!, 10);
  return lastOctet + 3;
}

/** Run a command via SSH; throw on non-zero exit code. */
async function execOrFail(
  client: Client,
  cmd: string,
  timeout?: number
): Promise<string> {
  const result = await execCommand(client, cmd, timeout);
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (exit ${result.exitCode}): ${result.stderr}`
    );
  }
  return result.stdout;
}

/**
 * Call the Firecracker REST API via curl over the Unix socket.
 * Throws on non-2xx responses.
 *
 * Pass `body: undefined` for GET (or any method that takes no body) — the
 * `-d @-` branch and JSON content-type header are skipped in that case.
 */
export async function firecrackerApi(
  client: Client,
  socketPath: string,
  method: string,
  endpoint: string,
  body: unknown
): Promise<string> {
  let cmd: string;
  if (body === undefined) {
    cmd = `curl -s -w '\\nHTTP_STATUS:%{http_code}' --unix-socket ${socketPath} -X ${method} http://localhost${endpoint}`;
  } else {
    const json = JSON.stringify(body);
    const b64 = Buffer.from(json).toString("base64");
    cmd = `echo '${b64}' | base64 -d | curl -s -w '\\nHTTP_STATUS:%{http_code}' --unix-socket ${socketPath} -X ${method} http://localhost${endpoint} -H 'Content-Type: application/json' -d @-`;
  }
  const result = await execCommand(client, cmd, 15_000);
  if (result.exitCode !== 0) {
    throw new Error(
      `Firecracker API ${method} ${endpoint} failed: ${result.stderr}`
    );
  }

  const output = result.stdout;
  const statusMatch = output.match(/HTTP_STATUS:(\d+)/);
  const statusCode = statusMatch?.[1] ?? "unknown";
  const responseBody = output.replace(/\nHTTP_STATUS:\d+/, "").trim();

  if (!statusCode.startsWith("2")) {
    throw new Error(
      `Firecracker API ${method} ${endpoint} returned ${statusCode}: ${responseBody}`
    );
  }

  return responseBody;
}

/**
 * After `InstanceStart`, bring the guest up to its configured RAM by
 * driving the virtio-mem device.
 *
 * Two cases:
 *   1. `ramMb > BOOT_FLOOR` — hot-plug the difference; this exercises the
 *      driver on every boot.
 *   2. `ramMb === BOOT_FLOOR` — the guest already has all the RAM it needs,
 *      but we still PROBE the driver (plug one slot, then unplug) so the
 *      caller can tell whether virtio-mem actually works on this kernel.
 *      Without this probe the boot path silently returns and the caller
 *      writes `hasVirtioMem=true` even on a broken kernel, which then
 *      misleads the resize UI and trips up the first resize attempt at
 *      runtime instead of failing here.
 *
 * Any plug/timeout error propagates to the caller's catch block, where the
 * same `Device is not active` / `virtio-mem plug timed out` fallback that
 * already covers large cubes also covers the boot-floor probe — the cube
 * retries the boot with virtio-mem disabled and `hasVirtioMem=false` is
 * written, accurately.
 */
async function plugInitialMemory(
  client: Client,
  apiSock: string,
  ramMb: number
): Promise<void> {
  const targetPluggedMib = Math.max(0, ramMb - VIRTIO_MEM_BOOT_FLOOR_MIB);

  if (targetPluggedMib === 0) {
    // Probe path. Plug one slot, wait briefly for the guest to confirm,
    // then unplug back to 0 so the cube finishes boot at the configured
    // RAM (= boot floor). Failure of either operation throws and triggers
    // the no-virtio-mem fallback in the caller — same path large cubes
    // take when their plug fails.
    await plugAndWait(client, apiSock, VIRTIO_MEM_SLOT_SIZE_MIB, 10_000);
    // Unplug back to the boot floor. Reuse `plugAndWait` for the retry
    // path on `Device is not active` — even though the device just plugged
    // successfully, going through the helper keeps a single code path for
    // every virtio-mem mutation. The completion poll is trivially
    // satisfied on the first GET (any plugged_size_mib >= 0).
    await plugAndWait(client, apiSock, 0, 5000);
    return;
  }

  await plugAndWait(client, apiSock, targetPluggedMib, 30_000);
}

/**
 * PATCH `/hotplug/memory` to request `targetPluggedMib`, then poll
 * `GET /hotplug/memory` until the guest confirms the requested amount is
 * plugged in. Throws on timeout with a message the caller's catch block
 * recognises as a virtio-mem failure (so the no-virtio-mem fallback fires).
 *
 * The first PATCH is retried on `Device is not active` because there's an
 * inherent race between `InstanceStart` returning (instant) and the guest
 * kernel's virtio-mem driver probing the device (~1.5s into kernel boot on
 * a typical microVM). Without the retry, PATCH almost always fired before
 * the driver was active and Firecracker rejected it — which we then
 * mis-classified as "kernel lacks virtio-mem support" and fell back to a
 * no-virtio-mem boot for life. We share the timeout budget between the
 * retry phase and the plug-completion poll phase below.
 */
export async function plugAndWait(
  client: Client,
  apiSock: string,
  targetPluggedMib: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  // Phase 1: retry the PATCH until the guest driver has activated the
  // device. `Device is not active` is the expected transient — anything
  // else (parameter rejection, internal error) surfaces immediately.
  let patched = false;
  while (Date.now() < deadline) {
    try {
      await firecrackerApi(client, apiSock, "PATCH", "/hotplug/memory", {
        requested_size_mib: targetPluggedMib,
      });
      patched = true;
      break;
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("Device is not active")
      ) {
        await sleep(500);
        continue;
      }
      throw err;
    }
  }

  if (!patched) {
    // Stays within the family of messages the bootCubeVm / startCube catch
    // block matches on, so the no-virtio-mem fallback still triggers when
    // the kernel genuinely lacks the driver.
    throw new Error(
      `virtio-mem plug timed out: guest driver never activated after ${Math.round(timeoutMs / 1000)}s — guest kernel may lack CONFIG_VIRTIO_MEM or the driver is unresponsive`
    );
  }

  // Phase 2: poll for the plug to complete. The device may take a moment
  // to physically online the memory blocks after accepting the request.
  let lastPlugged = 0;
  while (Date.now() < deadline) {
    const stateJson = await firecrackerApi(
      client,
      apiSock,
      "GET",
      "/hotplug/memory",
      undefined
    );
    try {
      const state = JSON.parse(stateJson) as { plugged_size_mib?: number };
      lastPlugged = state.plugged_size_mib ?? lastPlugged;
      if (lastPlugged >= targetPluggedMib) {
        return;
      }
    } catch {
      // Continue polling; transient parse errors during boot are tolerated.
    }
    await sleep(500);
  }

  throw new Error(
    `virtio-mem plug timed out: guest plugged ${lastPlugged}/${targetPluggedMib} MiB after ${Math.round(timeoutMs / 1000)}s — guest kernel may lack CONFIG_VIRTIO_MEM or the driver is unresponsive`
  );
}

// ── Jailer (Firecracker hardening) ──────────────────────────────────────────
// Pure paths/args live in lib/ssh/jailer.ts; these are the SSH-side ops. A
// jailed cube runs Firecracker under the jailer: per-cube unprivileged uid/gid,
// chroot, new PID namespace (no cgroup resource confinement — see
// buildJailerArgs). Bare-mode launches are byte-identical to before
// (cubePaths(id,"bare") returns the legacy /var/lib/krova/cubes paths).
// See docs/superpowers/plans/2026-05-29-firecracker-jailer-hardening.md.

/** True if a jail chroot currently exists for this cube (→ it is jailed). */
async function isJailed(client: Client, cubeId: string): Promise<boolean> {
  const r = await execCommand(
    client,
    `test -d ${jailRoot(cubeId)} && echo y || echo n`,
    5000
  ).catch(() => ({ stdout: "n", stderr: "", exitCode: 1 }));
  return r.stdout.trim() === "y";
}

/**
 * Resolve a cube's launch mode. Prefer the caller-provided value — the
 * AUTHORITATIVE cubes.launch_mode from the DB — and fall back to the `isJailed`
 * host probe only when a caller doesn't have the row. Threading the DB value
 * avoids the probe's failure mode (a transient SSH error making a jailed cube
 * look bare) and its per-call round-trip; the probe stays as a safety net.
 */
async function resolveMode(
  client: Client,
  cubeId: string,
  launchMode?: LaunchMode
): Promise<LaunchMode> {
  if (launchMode) {
    return launchMode;
  }
  return (await isJailed(client, cubeId)) ? "jailed" : "bare";
}

/**
 * Tear down a cube's jail: kill the jailed FC process, then remove the chroot
 * tree. Idempotent and a safe no-op when the cube is not jailed.
 *
 * The rootfs + kernel are HARDLINKED into the chroot (same filesystem — see
 * launchJailed), NOT bind-mounted, so `rm -rf` of the chroot removes only the
 * extra links: the canonical inodes at the cube dir / image dir survive. There
 * is no mount to leak, which sidesteps the (deleted)-inode failure class.
 */
async function teardownJail(client: Client, cubeId: string): Promise<void> {
  const { pidFile } = cubePaths(cubeId, "jailed");
  // Self-safe pkill fallback: bracketing the first char stops the pattern from
  // matching the shell that runs pkill. cubeId is globally-unique CUID2, so it
  // matches only this cube's jailer + firecracker (both carry it in argv).
  const selfSafe = `[${cubeId.charAt(0)}]${cubeId.slice(1)}`;
  await execCommand(
    client,
    `PID=$(cat ${pidFile} 2>/dev/null); [ -n "$PID" ] && kill "$PID" 2>/dev/null; sleep 1; PID=$(cat ${pidFile} 2>/dev/null); [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null; pkill -9 -f "${selfSafe}" 2>/dev/null || true`,
    15_000
  ).catch(() => {});
  // Surface a chroot-removal failure (a transient SSH error or a perms error)
  // as a warning instead of swallowing it — a stranded chroot is otherwise
  // invisible (server.reconcile's orphan scan now also lists the jail path, so
  // it still gets flagged). Stays NON-throwing: deleteCube must run its
  // remaining cleanup, and the transfer source-teardown call site relies on
  // teardownJail never throwing. (rootfs/kernel are hardlinks, so a residual
  // chroot is near-zero extra disk — this is observability, not reclamation.)
  const chrootRm = await execCommand(
    client,
    `rm -rf ${JAILER_CHROOT_BASE}/firecracker/${cubeId}`,
    10_000
  ).catch((err) => ({ stdout: "", stderr: String(err), exitCode: 1 }));
  if (chrootRm.exitCode !== 0) {
    console.warn(
      `[teardownJail] chroot rm failed for ${cubeId} (non-fatal): ${chrootRm.stderr.trim()}`
    );
  }
  // L1: remove the per-cube cgroup leaf — the jailer creates it but the chroot
  // rm -rf above does NOT touch /sys/fs/cgroup, so it would leak. The leaf only
  // ever exists when CPU_CGROUP_ENABLED was set at the cube's launch, so gate the
  // cleanup on the flag: a flag-OFF teardown then issues NO extra SSH op and is
  // byte-identical to the pre-L1 path (the cardinal flag-off-inertness invariant).
  // Idempotent rmdir; non-fatal (a leaked empty leaf is harmless — negligible
  // resource, recreated empty on the next boot by krova-cgroup-prep).
  if (CPU_CGROUP_ENABLED) {
    await execCommand(
      client,
      `rmdir /sys/fs/cgroup/${CPU_CGROUP_PARENT}/${cubeId} 2>/dev/null || true`,
      5000
    ).catch(() => {});
  }
}

/**
 * Write the per-cube cgroup `io.max` (disk overhaul E — the host buffered-write
 * isolation backstop). Called AFTER the cube is launched, JAILED cubes only (the
 * jailer creates the `<parent>/<cubeId>` leaf only when CPU_CGROUP_ENABLED). The
 * jailer REJECTS an io.max arg, so the worker writes it directly to the leaf
 * (live-validated 2026-06-05), keyed on the dm/LVM device backing the rootfs FILE
 * (cubeDiskDeviceCommand). FULLY FAIL-SAFE: any missing piece (io not delegated,
 * device unresolved, invalid limits) → warn + skip, NEVER throw — a cube must run
 * even without its io.max cap. Re-running re-writes the leaf (live tier change).
 * Base SATA sizing (topology null); NVMe scaling wires in when topology is threaded.
 */
async function writeCubeIoMax(
  client: Client,
  cubeId: string,
  vcpus: number,
  diskPath: string
): Promise<void> {
  if (!(CPU_CGROUP_ENABLED && IO_CGROUP_ENABLED)) {
    return;
  }
  try {
    const limits = cubeIoMax({ vcpus }, null, await getDiskQosTiers());
    if (!limits) {
      return;
    }
    const ready = await execCommand(client, ioCgroupReadyCommand(), 5000).catch(
      () => ({ exitCode: 1, stdout: "", stderr: "" })
    );
    if (ready.exitCode !== 0) {
      console.warn(
        `[firecracker] cube ${cubeId}: io controller not delegated — launching without io.max`
      );
      return;
    }
    const devRes = await execCommand(
      client,
      cubeDiskDeviceCommand(diskPath),
      5000
    ).catch(() => ({ stdout: "", exitCode: 1, stderr: "" }));
    const line = buildIoMaxLine(devRes.stdout.trim(), limits);
    if (!line) {
      console.warn(
        `[firecracker] cube ${cubeId}: io.max device unresolved ("${devRes.stdout.trim()}") — launching without io.max`
      );
      return;
    }
    const leaf = `/sys/fs/cgroup/${CPU_CGROUP_PARENT}/${cubeId}/io.max`;
    await execCommand(
      client,
      `echo "${line}" > ${leaf} 2>/dev/null || true`,
      5000
    ).catch(() => {});
  } catch (err) {
    console.warn(
      `[firecracker] cube ${cubeId}: io.max write failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Launch a cube's Firecracker inside the jailer. Idempotent (tears down any
 * prior jail first, so it is safe inside the virtio-mem retry loop). After it
 * returns, the FC API server is up on the host-visible socket and the rootfs +
 * kernel are present in the chroot, ready for the standard /machine-config…
 * InstanceStart sequence using the chroot-relative JAILED_INNER paths.
 */
async function launchJailed(
  client: Client,
  opts: {
    cubeId: string;
    uid: number;
    vcpus: number;
    diskPath: string;
    kernelPath: string;
    serialLog: string;
    /** L2 (NUMA): the cube's assigned node (cubes.numa_node) + the host's
     *  per-node topology (servers.numa_topology). When both are present AND
     *  NUMA_PLACEMENT_ENABLED AND the host delegates cpuset, the cube is bound to
     *  that node. Absent / null → unpinned (fail-safe, today's behavior). */
    numaNode?: number | null;
    numaTopology?: NumaTopology | null;
  }
): Promise<void> {
  const root = jailRoot(opts.cubeId);
  const { apiSock } = cubePaths(opts.cubeId, "jailed");

  // Preflight (Rule 58): a bad uid would otherwise reach `jailer --uid` and
  // `chown <uid> <rootfs>` only AFTER the jailer is spawned. Fail read-only,
  // before any side effect. (createCube/startCube also guard at their entry;
  // this is the authoritative check at the point of use.)
  if (!Number.isInteger(opts.uid) || opts.uid < JAILER_UID_BASE) {
    throw new Error(
      `launchJailed: invalid jailer uid ${opts.uid} for cube ${opts.cubeId}`
    );
  }

  // Clean slate — handles the retry loop + any crashed prior attempt.
  await teardownJail(client, opts.cubeId);

  // gid = uid: a UNIQUE per-cube group, per Firecracker's production-host
  // recommendation ("each [microVM] runs with its unique uid and gid",
  // prod-host-setup.md). The jailer runs as root, mknods /dev/{kvm,net/tun,…}
  // INSIDE the chroot and chowns them to uid:gid, then drops privileges — so
  // the dropped Firecracker (uid:gid) owns those nodes and the host's kvm group
  // is irrelevant (no host-group dependency). A distinct gid per cube means a
  // VMM escape as one cube's uid:gid shares no group with any sibling.
  const gid = opts.uid;

  // The jailer canonicalizes --chroot-base-dir and refuses to create it.
  await execOrFail(client, `mkdir -p ${JAILER_CHROOT_BASE}`);

  // Hardlinks require the cube dir + jail base to share one filesystem (the
  // platform keeps /var/lib/krova/{cubes,images,jail} on one fs). Verify up
  // front so a misconfigured host fails with a clear message instead of an
  // opaque cross-device `ln` error mid-launch.
  const devRes = await execCommand(
    client,
    `[ "$(stat -c %d ${opts.diskPath})" = "$(stat -c %d ${JAILER_CHROOT_BASE})" ] && echo same || echo diff`,
    5000
  ).catch(() => ({ stdout: "diff", stderr: "", exitCode: 1 }));
  if (devRes.stdout.trim() !== "same") {
    throw new Error(
      `launchJailed: ${opts.diskPath} and ${JAILER_CHROOT_BASE} must be on the same filesystem for hardlinks — cube ${opts.cubeId}`
    );
  }

  // Launch. The jailer builds <base>/firecracker/<id>/root, provisions
  // /dev/{kvm,net/tun,urandom,userfaultfd} (owned uid:gid), drops privileges,
  // chroots, and execs firecracker; --new-pid-ns writes the host FC pid to
  // <root>/firecracker.pid. The jailer's stdout → the host serial log.
  // L1 (audit C2): per-cube cpu.weight fairness — gated + fail-safe. Pass
  // --cgroup ONLY when CPU_CGROUP_ENABLED *and* the krova parent is actually
  // prepped on this host; otherwise launch WITHOUT it (the cube boots, just with
  // no weight) so a missing/half-prepped parent can never brick a boot.
  let cgroup:
    | { cpuWeight: number; cpuset?: { cpus: string; mems: string } }
    | undefined;
  if (CPU_CGROUP_ENABLED) {
    const ready = await execCommand(
      client,
      cpuCgroupReadyCommand(),
      5000
    ).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
    if (ready.exitCode === 0) {
      cgroup = { cpuWeight: cubeCpuWeight(opts.vcpus) };
    } else {
      console.warn(
        `[launchJailed] cube ${opts.cubeId}: krova cgroup not ready — launching without cpu.weight`
      );
    }
  }
  // L2 (NUMA): bind the cube to its assigned node when the host is L2-ready.
  // Gated + fail-safe. `shouldBindCpuset` is the single, unit-tested decision:
  // it requires cpuset delegation, a VALUE-AWARE subset check vs the parent's
  // LIVE cpuset.{cpus,mems}.effective (review H1 — a non-subset write EINVALs in
  // the jailer and BRICKS the boot), AND the OVERSELL guard (a cube with more
  // vCPUs than the node has usable cores launches UNPINNED so it is never
  // throttled below its sold vCPUs while the other socket sits idle). Any failure
  // → launch WITHOUT cpuset (the cube still boots, just unpinned).
  if (
    NUMA_PLACEMENT_ENABLED &&
    cgroup &&
    opts.numaNode != null &&
    opts.numaTopology
  ) {
    const cpus = nodeCpusetCpus(
      opts.numaTopology,
      opts.numaNode,
      HOUSEKEEPING_CORES_PER_HOST
    );
    const pre = await execCommand(client, cpusetPreflightCommand(), 5000).catch(
      () => ({ exitCode: 1, stdout: "", stderr: "" })
    );
    const lines = pre.stdout.split("\n").map((l) => l.trim());
    const delegated = lines[0] === "DELEGATED";
    const effCpus = (lines.find((l) => l.startsWith("CPUS:")) ?? "").slice(5);
    const effMems = (lines.find((l) => l.startsWith("MEMS:")) ?? "").slice(5);
    if (
      pre.exitCode === 0 &&
      shouldBindCpuset({
        cpus,
        vcpus: opts.vcpus,
        node: opts.numaNode,
        delegated,
        effCpus,
        effMems,
      })
    ) {
      cgroup.cpuset = { cpus, mems: String(opts.numaNode) };
    } else {
      console.warn(
        `[launchJailed] cube ${opts.cubeId}: cpuset not applied (cpus="${cpus}" vcpus=${opts.vcpus} delegated=${delegated} effCpus="${effCpus}" effMems="${effMems}") — launching unpinned`
      );
    }
  }
  const args = buildJailerArgs({
    cubeId: opts.cubeId,
    uid: opts.uid,
    gid,
    cgroup,
  }).join(" ");
  await execOrFail(
    client,
    `nohup ${JAILER_BIN} ${args} > ${opts.serialLog} 2>&1 &`,
    10_000
  );

  // Wait for the jailer to create the chroot root, then HARDLINK the rootfs +
  // kernel in at the paths FC will open. Hardlinks require the same filesystem
  // (the platform layout keeps /var/lib/krova/{cubes,images,jail} on one fs).
  // The rootfs inode is chowned to the cube uid so the dropped FC can open it
  // read-write; root keeps full access (it ignores file perms) for
  // restic/loop-mount. The shared kernel is world-readable, so FC reads it via
  // the hardlink with no chown.
  await execOrFail(
    client,
    `for i in $(seq 1 100); do test -d ${root} && break; sleep 0.1; done; test -d ${root}`,
    15_000
  );
  await execOrFail(client, `chown ${opts.uid}:${gid} ${opts.diskPath}`);
  await execOrFail(
    client,
    `ln -f ${opts.diskPath} ${root}${JAILED_INNER.rootfs}`
  );
  await execOrFail(
    client,
    `ln -f ${opts.kernelPath} ${root}${JAILED_INNER.kernel}`
  );

  // Wait for the API socket (FC is up inside the chroot).
  await execOrFail(
    client,
    `for i in $(seq 1 50); do test -S ${apiSock} && break; sleep 0.1; done; test -S ${apiSock}`,
    10_000
  );
}

/**
 * Provision and boot a Firecracker microVM.
 *
 * Steps:
 *   1. Create cube directory
 *   2. Copy base rootfs image (CoW) and resize
 *   3. Mount rootfs and configure guest (networking, SSH, agent)
 *   4. Create TAP device and attach to br0
 *   5. Start Firecracker process
 *   6. Configure VM via API (machine, boot, drive, network, vsock)
 *   7. Boot the instance
 */
export async function createCube(
  client: Client,
  opts: {
    cubeId: string;
    vcpus: number;
    ramMb: number;
    diskPath: string;
    diskSizeGb: number;
    baseimagePath: string;
    imageId: string;
    internalIp: string;
    sshPublicKey: string;
    /** Cube display name — written as the guest hostname (slugified). */
    cubeName?: string | null;
    /** If set, write cloud-init nocloud seed files into the guest rootfs. */
    userData?: string | null;
    /** Launch mode. "jailed" runs Firecracker under the jailer (per-cube
     *  uid/gid, chroot, new PID namespace; no cgroup confinement — see
     *  buildJailerArgs); requires jailerUid. Defaults to "bare" (legacy
     *  `nohup firecracker` as root). */
    launchMode?: LaunchMode;
    /** Pre-allocated unprivileged uid for jailed mode (lib/server/jailer-uids). */
    jailerUid?: number;
    /** L2 (NUMA): the cube's assigned node + the host's topology, threaded to
     *  launchJailed for cpuset binding. Optional/null → unpinned (fail-safe). */
    numaNode?: number | null;
    numaTopology?: NumaTopology | null;
  }
): Promise<{ hasVirtioMem: boolean }> {
  const mode: LaunchMode = opts.launchMode ?? "bare";
  // Preflight (Rule 58): reject a jailed launch with no/invalid uid BEFORE any
  // host mutation, so a Phase-3 wiring slip can never reach `jailer --uid` or
  // `chown <uid> <rootfs>` with a garbage value.
  if (mode === "jailed" && !Number.isInteger(opts.jailerUid)) {
    throw new Error(
      `createCube: jailed mode requires a valid jailerUid (got ${opts.jailerUid}) for cube ${opts.cubeId}`
    );
  }
  const cubeDir = `${CUBE_BASE_DIR}/${opts.cubeId}`;
  const { apiSock, vsockPath, fcLog, pidFile } = cubePaths(opts.cubeId, mode);
  const serialLog = `${cubeDir}/serial.log`;
  const ipFile = `${cubeDir}/ip.txt`;
  const tap = tapName(opts.internalIp);
  const cid = vsockCid(opts.internalIp);
  // For jailed cubes Firecracker is chrooted, so the kernel/rootfs/vsock paths
  // it sees are chroot-relative (JAILED_INNER); for bare they are host paths.
  const kernelApiPath = mode === "jailed" ? JAILED_INNER.kernel : KERNEL_PATH;
  const rootfsApiPath = mode === "jailed" ? JAILED_INNER.rootfs : opts.diskPath;
  const vsockApiPath = mode === "jailed" ? JAILED_INNER.vsockPath : vsockPath;

  // 1. Pre-flight: check available disk space on the server
  const dfResult = await execOrFail(
    client,
    `df -BG --output=avail /var/lib/krova/cubes | tail -1 | tr -d ' G'`,
    10_000
  );
  const availableGb = Number.parseInt(dfResult.trim(), 10);
  if (!isNaN(availableGb) && availableGb < opts.diskSizeGb + 2) {
    throw new Error(
      `Insufficient disk space: ${availableGb}GB available, ${opts.diskSizeGb + 2}GB needed`
    );
  }

  // 2. Create cube directory
  await execOrFail(client, `mkdir -p ${cubeDir}`);

  // Save internal IP for later cleanup
  await execOrFail(client, `echo '${opts.internalIp}' > ${ipFile}`);

  // 3. Copy base rootfs image (copy-on-write where supported)
  await execOrFail(
    client,
    `cp --reflink=auto ${opts.baseimagePath} ${opts.diskPath}`
  );

  // Resize rootfs to requested disk size
  await execOrFail(
    client,
    `truncate -s ${opts.diskSizeGb}G ${opts.diskPath}`,
    30_000
  );
  await execOrFail(
    client,
    `${ioNicePrefix()}e2fsck -fp ${opts.diskPath} 2>/dev/null || true`,
    60_000
  );
  await execOrFail(
    client,
    `${ioNicePrefix()}resize2fs ${opts.diskPath}`,
    60_000
  );

  // 3. Mount rootfs and configure the guest
  const mntDir = `/tmp/krova-mount-${opts.cubeId}`;
  await execOrFail(client, `mkdir -p ${mntDir}`);
  await execOrFail(client, `mount -o loop ${opts.diskPath} ${mntDir}`);

  try {
    // Configure networking via systemd-networkd. systemd-networkd works on
    // every supported cube distro (Ubuntu / Debian) — netplan is Ubuntu-only
    // and silently no-ops on Debian, leaving the cube with no IP. See
    // lib/ssh/cube-guest-network.ts for the full rationale. The helper also
    // wipes the legacy netplan YAML so a cube rootfs that pre-dates this
    // change doesn't carry stale IPs forward.
    await writeCubeGuestNetworkConfig(client, mntDir, opts.internalIp);

    // Disable cloud-init network config so it doesn't overwrite ours
    await execOrFail(client, `mkdir -p ${mntDir}/etc/cloud/cloud.cfg.d`);
    await execOrFail(
      client,
      `echo 'network: {config: disabled}' > ${mntDir}/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg`
    );

    // Configure SSH — root login with customer's public key
    await execOrFail(
      client,
      `mkdir -p ${mntDir}/root/.ssh && chmod 700 ${mntDir}/root/.ssh`
    );
    if (opts.sshPublicKey) {
      const keyB64 = Buffer.from(opts.sshPublicKey + "\n").toString("base64");
      await execOrFail(
        client,
        `echo '${keyB64}' | base64 -d > ${mntDir}/root/.ssh/authorized_keys && chmod 600 ${mntDir}/root/.ssh/authorized_keys`
      );
    } else {
      await execOrFail(
        client,
        `touch ${mntDir}/root/.ssh/authorized_keys && chmod 600 ${mntDir}/root/.ssh/authorized_keys`
      );
    }

    // Ensure root login is allowed
    await execOrFail(
      client,
      `sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' ${mntDir}/etc/ssh/sshd_config 2>/dev/null || true`
    );

    // Ensure krova-agent (vsock guest agent) is enabled
    // The agent is pre-installed in the base image by the setup script.
    // The watchdog timer keeps it running even if the customer tries to stop it.
    await execOrFail(
      client,
      `chroot ${mntDir} systemctl enable krova-agent 2>/dev/null || true`
    );
    await execOrFail(
      client,
      `chroot ${mntDir} systemctl enable krova-agent-watchdog.timer 2>/dev/null || true`
    );

    // Set the guest hostname from the cube's name (slugified to a valid
    // RFC-1123 label). This overrides the `krova` default baked into every
    // rootfs so the customer sees `root@<cube-name>` and per-cube logs /
    // monitoring are distinguishable. /etc/hosts is rewritten to match.
    // Applies to every cube — no cloud-init dependency.
    const guestHostname = slugifyHostname(opts.cubeName ?? "", opts.cubeId);
    const hostnameB64 = Buffer.from(`${guestHostname}\n`).toString("base64");
    await execOrFail(
      client,
      `echo '${hostnameB64}' | base64 -d > ${mntDir}/etc/hostname`
    );
    const hostsB64 = Buffer.from(
      `127.0.0.1 localhost\n127.0.1.1 ${guestHostname}\n::1 localhost ip6-localhost ip6-loopback\n`
    ).toString("base64");
    await execOrFail(
      client,
      `echo '${hostsB64}' | base64 -d > ${mntDir}/etc/hosts`
    );

    // Write cloud-init NoCloud seed files if user_data was provided.
    // cloud-init is installed in every guest rootfs but kept DISABLED by
    // default (the build script bakes /etc/cloud/cloud-init.disabled). We
    // enable it ONLY for cubes that pass user_data: remove the disable flag,
    // pin the NoCloud datasource, and drop the seed files. Cubes without
    // user_data keep cloud-init fully inert — identical boot to before.
    if (opts.userData) {
      // Enable cloud-init for this cube only (no-op if the flag is absent).
      await execOrFail(client, `rm -f ${mntDir}/etc/cloud/cloud-init.disabled`);

      // Suppress cloud-init's default distro user (ubuntu / debian / etc.):
      // rewrite the `- default` users entry in the base cloud.cfg to `- root`.
      // cloud-init merges config lists by APPEND, so a `users: []` override in
      // cloud.cfg.d would NOT take effect — editing the base file is the
      // reliable fix. The customer logs in as root; no extra account is made.
      // Guarded on cloud.cfg existing so a user_data cube provisioned on a
      // pre-cloud-init rootfs (transition window before images are rebuilt)
      // still boots cleanly instead of failing here.
      await execOrFail(
        client,
        `if [ -f ${mntDir}/etc/cloud/cloud.cfg ]; then sed -i 's/^\\([[:space:]]*-[[:space:]]*\\)default[[:space:]]*$/\\1root/' ${mntDir}/etc/cloud/cloud.cfg; fi`
      );

      // Krova cloud-init policy. These are scalar keys, which override the
      // base cloud.cfg cleanly (only list keys append): keep root SSH enabled,
      // never let cloud-init regenerate SSH host keys, and let a customer
      // `hostname:` directive win over the default hostname set above.
      const cloudCfg = [
        "datasource_list: [ NoCloud, None ]",
        "disable_root: false",
        "preserve_hostname: false",
        "ssh_deletekeys: false",
        "",
      ].join("\n");
      const cloudCfgB64 = Buffer.from(cloudCfg).toString("base64");
      await execOrFail(
        client,
        `echo '${cloudCfgB64}' | base64 -d > ${mntDir}/etc/cloud/cloud.cfg.d/99-krova-cloud-init.cfg`
      );

      // meta-data: instance-id keys cloud-init's run-once tracking;
      // local-hostname matches the hostname written directly above.
      await execOrFail(client, `mkdir -p ${mntDir}/var/lib/cloud/seed/nocloud`);
      const metaDataB64 = Buffer.from(
        `instance-id: ${opts.cubeId}\nlocal-hostname: ${guestHostname}\n`
      ).toString("base64");
      await execOrFail(
        client,
        `echo '${metaDataB64}' | base64 -d > ${mntDir}/var/lib/cloud/seed/nocloud/meta-data`
      );

      // user-data: the customer's cloud-init script, run once on first boot.
      const userDataB64 = Buffer.from(opts.userData).toString("base64");
      await execOrFail(
        client,
        `echo '${userDataB64}' | base64 -d > ${mntDir}/var/lib/cloud/seed/nocloud/user-data`
      );
    }
  } finally {
    // Unmount with lazy fallback so a busy mount doesn't leave the directory orphaned
    await execCommand(
      client,
      `umount ${mntDir} 2>/dev/null || umount -l ${mntDir} 2>/dev/null || true; rmdir ${mntDir} 2>/dev/null || true`
    );
  }

  // 4. Create TAP device, start Firecracker, configure, and boot.
  // TAP is created once. Firecracker is restarted if the first attempt fails
  // because the guest kernel lacks CONFIG_VIRTIO_MEM — in that case the VM
  // was already booted at the 1 GiB floor, so we kill it and retry with
  // mem_size_mib=ramMb and no virtio-mem device so the guest gets full RAM.
  let hasVirtioMem = false;
  try {
    await execOrFail(client, `ip tuntap add dev ${tap} mode tap`);
    await execOrFail(client, `ip link set ${tap} master br0`);
    await execOrFail(client, `ip link set ${tap} up`);

    for (const useVirtioMem of [true, false] as const) {
      // 5. Start Firecracker process (jailed under the jailer, or bare).
      if (mode === "jailed") {
        // launchJailed is idempotent (tears down any prior jail) and waits for
        // the API socket itself.
        await launchJailed(client, {
          cubeId: opts.cubeId,
          uid: opts.jailerUid as number,
          vcpus: opts.vcpus,
          diskPath: opts.diskPath,
          kernelPath: KERNEL_PATH,
          serialLog,
          numaNode: opts.numaNode,
          numaTopology: opts.numaTopology,
        });
      } else {
        // Clean up socket files from any prior attempt before starting.
        await execCommand(client, `rm -f ${apiSock} ${vsockPath}`);
        await execOrFail(
          client,
          `nohup firecracker --api-sock ${apiSock} --log-path ${fcLog} --level Info > ${serialLog} 2>&1 & echo $! > ${pidFile}`,
          10_000
        );
        // Wait for API socket to become available
        await execOrFail(
          client,
          `for i in $(seq 1 50); do test -S ${apiSock} && break; sleep 0.1; done; test -S ${apiSock}`,
          10_000
        );
      }

      try {
        // 6. Configure Firecracker via REST API.
        await firecrackerApi(client, apiSock, "PUT", "/machine-config", {
          vcpu_count: opts.vcpus,
          mem_size_mib: useVirtioMem ? VIRTIO_MEM_BOOT_FLOOR_MIB : opts.ramMb,
        });

        // Mask AVX-512 via a custom CPU template (pre-boot) so guest software
        // doesn't SIGILL on AVX-512 instructions the microVM's XSAVE state can't
        // back. Custom (not static T2/T2A) so it never bricks a boot on a
        // non-allowlisted host — see lib/ssh/cpuid-template.ts. Fail-safe: a
        // failure here (e.g. a host on a Firecracker older than /cpu-config)
        // must NOT brick the boot — log and continue (worst case = no mask,
        // i.e. pre-fix behavior), since /cpu-config is a pure pre-boot step.
        try {
          await firecrackerApi(client, apiSock, "PUT", "/cpu-config", {
            cpuid_modifiers: avx512MaskCpuidModifiers(),
          });
        } catch (cpuCfgErr) {
          console.warn(
            `[firecracker] cube ${opts.cubeId}: AVX-512 mask (/cpu-config) failed, booting without it: ${cpuCfgErr instanceof Error ? cpuCfgErr.message : String(cpuCfgErr)}`
          );
        }

        if (useVirtioMem) {
          await firecrackerApi(client, apiSock, "PUT", "/hotplug/memory", {
            total_size_mib: VIRTIO_MEM_TOTAL_SIZE_MIB,
            block_size_mib: VIRTIO_MEM_BLOCK_SIZE_MIB,
            slot_size_mib: VIRTIO_MEM_SLOT_SIZE_MIB,
          });
        }

        // Per-cube QoS bandwidth+ops buckets (base SATA sizing — topology null
        // here; NVMe scaling wires in when topology is threaded). The settings
        // read is GATED so the flag-off boot path does ZERO extra work; resolved
        // BEFORE Promise.all so the three boot PUTs still issue in parallel.
        // builder returns null on invalid vcpus so the body stays valid.
        const rootfsRateLimiter =
          DISK_QOS_ENABLED || isDiskCanaryCube(opts.cubeId)
            ? buildDriveRateLimiter(
                { vcpus: opts.vcpus },
                null,
                await getDiskQosTiers()
              )
            : null;
        await Promise.all([
          firecrackerApi(client, apiSock, "PUT", "/boot-source", {
            kernel_image_path: kernelApiPath,
            boot_args: BOOT_ARGS,
          }),
          firecrackerApi(
            client,
            apiSock,
            "PUT",
            "/drives/rootfs",
            buildRootfsDriveBody({
              pathOnHost: rootfsApiPath,
              cacheWriteback:
                DISK_WRITEBACK_CACHE_ENABLED || isDiskCanaryCube(opts.cubeId),
              rateLimiter: rootfsRateLimiter,
            })
          ),
          firecrackerApi(client, apiSock, "PUT", "/network-interfaces/eth0", {
            iface_id: "eth0",
            host_dev_name: tap,
          }),
          firecrackerApi(client, apiSock, "PUT", "/vsock", {
            guest_cid: cid,
            uds_path: vsockApiPath,
          }),
        ]);

        // virtio-rng entropy device — pre-boot (before InstanceStart). Gated by
        // ENTROPY_DEVICE_ENABLED. FAIL-SAFE (mirrors /cpu-config below): a host
        // on a Firecracker without the /entropy device must still boot — worst
        // case is no virtio-rng (pre-fix behavior), never a bricked boot. Pure
        // pre-boot step, so it can never leave a half-started VM.
        if (ENTROPY_DEVICE_ENABLED) {
          try {
            await firecrackerApi(client, apiSock, "PUT", "/entropy", {});
          } catch (entropyErr) {
            console.warn(
              `[firecracker] cube ${opts.cubeId}: virtio-rng (/entropy) failed, booting without it: ${entropyErr instanceof Error ? entropyErr.message : String(entropyErr)}`
            );
          }
        }

        // 7. Boot the instance (must be after all config is set)
        await firecrackerApi(client, apiSock, "PUT", "/actions", {
          action_type: "InstanceStart",
        });

        // 8. Hot-plug RAM above the boot floor (virtio-mem path only).
        // On kernels without CONFIG_VIRTIO_MEM the PATCH returns HTTP 500
        // "Device is not active" — caught below to trigger the fallback.
        if (useVirtioMem) {
          await plugInitialMemory(client, apiSock, opts.ramMb);
        }

        hasVirtioMem = useVirtioMem;
        break;
      } catch (innerErr) {
        if (mode === "jailed") {
          await teardownJail(client, opts.cubeId).catch(() => {});
        } else {
          await execCommand(
            client,
            `PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`
          ).catch(() => {});
        }
        // Verify the killed FC has actually exited before the next iteration
        // re-opens the same-named TAP. A SIGKILL'd jailed FC (PID 1 of its
        // --new-pid-ns) briefly lingers as a not-yet-reaped zombie holding the
        // TAP, so a naive retry hits "Open tap device failed: Resource busy"
        // and the cube errors. Cheap when already dead (returns immediately on
        // a gone/zombie PID).
        await assertFirecrackerExited(client, pidFile, opts.cubeId).catch(
          () => {}
        );
        if (
          useVirtioMem &&
          innerErr instanceof Error &&
          (innerErr.message.includes("Device is not active") ||
            innerErr.message.includes("virtio-mem plug timed out"))
        ) {
          console.warn(
            `[firecracker:${opts.cubeId}] virtio-mem not available on this kernel — retrying without it`
          );
          continue;
        }
        throw innerErr;
      }
    }
  } catch (err) {
    if (mode === "jailed") {
      await teardownJail(client, opts.cubeId).catch(() => {});
    }
    await execCommand(client, `ip link del ${tap} 2>/dev/null || true`).catch(
      () => {}
    );
    throw err;
  }

  // Per-cube io.max backstop (disk overhaul E) — jailed cubes only, fail-safe.
  if (mode === "jailed") {
    await writeCubeIoMax(client, opts.cubeId, opts.vcpus, opts.diskPath);
  }
  return { hasVirtioMem };
}

/**
 * Delete a Firecracker microVM and clean up all resources.
 *
 * Steps: kill process → delete TAP device → remove cube directory.
 */
export async function deleteCube(
  client: Client,
  cubeId: string,
  internalIp?: string,
  launchMode?: LaunchMode
): Promise<void> {
  const cubeDir = `${CUBE_BASE_DIR}/${cubeId}`;
  const ipFile = `${cubeDir}/ip.txt`;

  // Kill the Firecracker process. For a jailed cube, teardownJail kills the
  // jailed pid + removes the chroot (its rootfs/kernel hardlinks); the
  // canonical rootfs under cubeDir survives until the rm -rf at the end.
  if ((await resolveMode(client, cubeId, launchMode)) === "jailed") {
    await teardownJail(client, cubeId);
  } else {
    const { pidFile } = cubePaths(cubeId, "bare");
    await execCommand(
      client,
      `PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill "$PID" 2>/dev/null; sleep 1; PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`,
      10_000
    ).catch(() => {});
  }

  // Determine IP for TAP cleanup
  let ip = internalIp;
  if (!ip) {
    const ipResult = await execCommand(
      client,
      `cat ${ipFile} 2>/dev/null || true`
    ).catch(() => ({ stdout: "", stderr: "", exitCode: 1 }));
    ip = ipResult.stdout.trim();
  }

  // Delete TAP device (only if IP looks valid — prevents deleting wrong device)
  if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const tap = tapName(ip);
    await execCommand(client, `ip link del ${tap} 2>/dev/null || true`).catch(
      () => {}
    );
  }

  // Defensive: release any leftover loop-mount of this cube's rootfs before
  // removing the workspace. createCube() / snapshot-restore / backup-redeploy
  // all mount the rootfs at /tmp/krova-mount-<id> and unmount in a finally
  // block, but a worker crash between the mount and the finally leaves the
  // loop device pinning the rootfs file. If we then `rm -rf` the workspace
  // here, the inode stays alive as "(deleted)" — invisible to du/df cleanup
  // but still holding disk blocks until reboot.
  const mntDir = `/tmp/krova-mount-${cubeId}`;
  await execCommand(
    client,
    `umount ${mntDir} 2>/dev/null || umount -l ${mntDir} 2>/dev/null || true; rmdir ${mntDir} 2>/dev/null || true`,
    15_000
  ).catch(() => {});

  // Remove cube directory (rootfs, socket files, logs, PID file)
  const rmResult = await execCommand(client, `rm -rf ${cubeDir}`);
  if (rmResult.exitCode !== 0) {
    throw new Error(`Failed to remove Cube directory: ${rmResult.stderr}`);
  }
}

/**
 * Pause (suspend) a running Firecracker VM.
 * Uses PATCH /vm with state "Paused".
 */
export async function sleepCube(
  client: Client,
  cubeId: string,
  launchMode?: LaunchMode
): Promise<void> {
  const { apiSock } = cubePaths(
    cubeId,
    await resolveMode(client, cubeId, launchMode)
  );
  await firecrackerApi(client, apiSock, "PATCH", "/vm", {
    state: "Paused",
  });
}

/**
 * Resume a paused Firecracker VM.
 * Uses PATCH /vm with state "Resumed".
 */
export async function wakeCube(
  client: Client,
  cubeId: string,
  launchMode?: LaunchMode
): Promise<void> {
  const { apiSock } = cubePaths(
    cubeId,
    await resolveMode(client, cubeId, launchMode)
  );
  await firecrackerApi(client, apiSock, "PATCH", "/vm", {
    state: "Resumed",
  });
}

/**
 * Power off a Firecracker VM by killing the process.
 * Firecracker has no graceful ACPI shutdown — process termination is the mechanism.
 *
 * Returns only AFTER verifying the process has exited and removing the stale
 * pid/socket files. Callers that immediately spawn a new Firecracker for the
 * same cube (cube-resize cold path, future caller's like cube-transfer) rely
 * on this — without the wait+verify, the new process can race the kernel's
 * reap of the dying process and hit `EBUSY` on the TAP device the old
 * process was holding.
 */
export async function powerOffCube(
  client: Client,
  cubeId: string,
  launchMode?: LaunchMode
): Promise<void> {
  const mode = await resolveMode(client, cubeId, launchMode);
  const jailed = mode === "jailed";
  const { pidFile, apiSock, vsockPath } = cubePaths(cubeId, mode);

  // SIGTERM, give Firecracker 2s to shut down its API + vCPU threads
  // cleanly, then SIGKILL anything left. Mirrors the pattern in
  // cube-cold-restart.ts that has been battle-tested.
  await execCommand(
    client,
    `PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill "$PID" 2>/dev/null; sleep 2; PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`,
    15_000
  );

  // Verify the process is actually gone. Without this, a subsequent
  // startCube can race the kernel's reap and fail with `Open tap device
  // failed: Resource busy` (EBUSY) because the dying process still has
  // the TAP fd open.
  await assertFirecrackerExited(client, pidFile, cubeId);

  // Remove stale pid + socket files so the next startCube has a clean
  // slate. Sockets in particular: Firecracker creates them with O_EXCL
  // semantics on bind, so a leftover socket file would reject the new
  // process's bind attempt. (startCube does `rm -f` these too, but
  // belt-and-suspenders — also lets `powerOffCube` be safely used as a
  // teardown helper from contexts that DON'T immediately call startCube.)
  // For a jailed cube the pid/socket/vsock live inside the chroot, so tearing
  // the chroot down is the equivalent clean-slate (it also frees the rootfs +
  // kernel hardlinks; the canonical inodes survive).
  if (jailed) {
    await teardownJail(client, cubeId);
  } else {
    await execCommand(client, `rm -f ${pidFile} ${apiSock} ${vsockPath}`, 5000);
  }
}

/**
 * Start (restart) a stopped Firecracker VM.
 *
 * Unlike libvirt where domain definitions persist after shutdown,
 * a stopped Firecracker VM means the process has exited. Restarting
 * requires launching a new Firecracker process with the existing rootfs.
 *
 * Requires the Cube's config since Firecracker has no persistent domain state.
 */
export async function startCube(
  client: Client,
  cubeId: string,
  opts?: {
    vcpus: number;
    ramMb: number;
    internalIp: string;
    /** Launch mode — "jailed" requires jailerUid. Defaults to "bare". */
    launchMode?: LaunchMode;
    /** Pre-allocated unprivileged uid for jailed mode. */
    jailerUid?: number;
    /** L2 (NUMA): the cube's assigned node + the host's topology, threaded to
     *  launchJailed for cpuset binding. Optional/null → unpinned (fail-safe). */
    numaNode?: number | null;
    numaTopology?: NumaTopology | null;
  }
): Promise<{ hasVirtioMem: boolean }> {
  if (!opts) {
    throw new Error(
      `Cannot start a stopped Firecracker VM ${cubeId} without config — pass vcpus, ramMb, and internalIp`
    );
  }

  const mode: LaunchMode = opts.launchMode ?? "bare";
  // Preflight (Rule 58): reject a jailed launch with no/invalid uid up front.
  if (mode === "jailed" && !Number.isInteger(opts.jailerUid)) {
    throw new Error(
      `startCube: jailed mode requires a valid jailerUid (got ${opts.jailerUid}) for cube ${cubeId}`
    );
  }
  const cubeDir = `${CUBE_BASE_DIR}/${cubeId}`;
  const { apiSock, vsockPath, fcLog, pidFile } = cubePaths(cubeId, mode);
  const diskPath = `${cubeDir}/rootfs.ext4`;
  const serialLog = `${cubeDir}/serial.log`;
  const tap = tapName(opts.internalIp);
  const cid = vsockCid(opts.internalIp);
  const kernelApiPath = mode === "jailed" ? JAILED_INNER.kernel : KERNEL_PATH;
  const rootfsApiPath = mode === "jailed" ? JAILED_INNER.rootfs : diskPath;
  const vsockApiPath = mode === "jailed" ? JAILED_INNER.vsockPath : vsockPath;

  // Ensure TAP device exists and is UP (may still be around from previous run)
  await execCommand(
    client,
    `ip link show ${tap} 2>/dev/null || (ip tuntap add dev ${tap} mode tap && ip link set ${tap} master br0); ip link set ${tap} up`
  );

  // Try booting with virtio-mem first; fall back to plain boot if the kernel
  // lacks CONFIG_VIRTIO_MEM (PATCH /hotplug/memory returns "Device is not active").
  let hasVirtioMem = false;
  for (const useVirtioMem of [true, false] as const) {
    // Start Firecracker (jailed under the jailer, or bare).
    if (mode === "jailed") {
      await launchJailed(client, {
        cubeId,
        uid: opts.jailerUid as number,
        vcpus: opts.vcpus,
        diskPath,
        kernelPath: KERNEL_PATH,
        serialLog,
        numaNode: opts.numaNode,
        numaTopology: opts.numaTopology,
      });
    } else {
      // Clean up socket files from any prior attempt before starting.
      await execCommand(client, `rm -f ${apiSock} ${vsockPath}`);
      await execOrFail(
        client,
        `nohup firecracker --api-sock ${apiSock} --log-path ${fcLog} --level Info >> ${serialLog} 2>&1 & echo $! > ${pidFile}`,
        10_000
      );
      // Wait for socket
      await execOrFail(
        client,
        `for i in $(seq 1 50); do test -S ${apiSock} && break; sleep 0.1; done; test -S ${apiSock}`,
        10_000
      );
    }

    try {
      await firecrackerApi(client, apiSock, "PUT", "/machine-config", {
        vcpu_count: opts.vcpus,
        mem_size_mib: useVirtioMem ? VIRTIO_MEM_BOOT_FLOOR_MIB : opts.ramMb,
      });

      // Mask AVX-512 via a custom CPU template (pre-boot) so guest software
      // doesn't SIGILL on AVX-512 instructions the microVM's XSAVE state can't
      // back. Custom (not static T2/T2A) so it never bricks a boot on a
      // non-allowlisted host — see lib/ssh/cpuid-template.ts. Fail-safe: a
      // failure here (e.g. a host on a Firecracker older than /cpu-config)
      // must NOT brick the boot — log and continue (worst case = no mask,
      // i.e. pre-fix behavior), since /cpu-config is a pure pre-boot step.
      try {
        await firecrackerApi(client, apiSock, "PUT", "/cpu-config", {
          cpuid_modifiers: avx512MaskCpuidModifiers(),
        });
      } catch (cpuCfgErr) {
        console.warn(
          `[firecracker] cube ${cubeId}: AVX-512 mask (/cpu-config) failed, booting without it: ${cpuCfgErr instanceof Error ? cpuCfgErr.message : String(cpuCfgErr)}`
        );
      }

      if (useVirtioMem) {
        await firecrackerApi(client, apiSock, "PUT", "/hotplug/memory", {
          total_size_mib: VIRTIO_MEM_TOTAL_SIZE_MIB,
          block_size_mib: VIRTIO_MEM_BLOCK_SIZE_MIB,
          slot_size_mib: VIRTIO_MEM_SLOT_SIZE_MIB,
        });
      }

      await firecrackerApi(client, apiSock, "PUT", "/boot-source", {
        kernel_image_path: kernelApiPath,
        boot_args: BOOT_ARGS,
      });

      await firecrackerApi(
        client,
        apiSock,
        "PUT",
        "/drives/rootfs",
        buildRootfsDriveBody({
          pathOnHost: rootfsApiPath,
          cacheWriteback:
            DISK_WRITEBACK_CACHE_ENABLED || isDiskCanaryCube(cubeId),
          rateLimiter:
            DISK_QOS_ENABLED || isDiskCanaryCube(cubeId)
              ? buildDriveRateLimiter(
                  { vcpus: opts.vcpus },
                  null,
                  await getDiskQosTiers()
                )
              : null,
        })
      );

      await firecrackerApi(client, apiSock, "PUT", "/network-interfaces/eth0", {
        iface_id: "eth0",
        host_dev_name: tap,
      });

      await firecrackerApi(client, apiSock, "PUT", "/vsock", {
        guest_cid: cid,
        uds_path: vsockApiPath,
      });

      // virtio-rng entropy device — pre-boot, gated (see ENTROPY_DEVICE_ENABLED).
      // FAIL-SAFE (mirrors /cpu-config): never let a missing /entropy brick boot.
      if (ENTROPY_DEVICE_ENABLED) {
        try {
          await firecrackerApi(client, apiSock, "PUT", "/entropy", {});
        } catch (entropyErr) {
          console.warn(
            `[firecracker] cube ${cubeId}: virtio-rng (/entropy) failed, booting without it: ${entropyErr instanceof Error ? entropyErr.message : String(entropyErr)}`
          );
        }
      }

      await firecrackerApi(client, apiSock, "PUT", "/actions", {
        action_type: "InstanceStart",
      });

      // Hot-plug RAM above the boot floor (virtio-mem path only).
      // On kernels without CONFIG_VIRTIO_MEM the PATCH returns HTTP 500
      // "Device is not active" — caught below to trigger the fallback.
      if (useVirtioMem) {
        await plugInitialMemory(client, apiSock, opts.ramMb);
      }

      hasVirtioMem = useVirtioMem;
      break;
    } catch (err) {
      if (mode === "jailed") {
        await teardownJail(client, cubeId).catch(() => {});
      } else {
        await execCommand(
          client,
          `PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`,
          5000
        ).catch(() => {});
      }
      // Confirm the killed FC exited before the next iteration re-opens the
      // same TAP — a SIGKILL'd jailed FC briefly lingers as a zombie holding
      // the TAP, so a naive retry hits "Resource busy". Cheap when already dead.
      await assertFirecrackerExited(client, pidFile, cubeId).catch(() => {});
      if (
        useVirtioMem &&
        err instanceof Error &&
        (err.message.includes("Device is not active") ||
          err.message.includes("virtio-mem plug timed out"))
      ) {
        console.warn(
          `[firecracker:${cubeId}] virtio-mem not available on this kernel — retrying without it`
        );
        continue;
      }
      throw err;
    }
  }

  // Per-cube io.max backstop (disk overhaul E) — jailed cubes only, fail-safe.
  if (mode === "jailed") {
    await writeCubeIoMax(client, cubeId, opts.vcpus, diskPath);
  }
  return { hasVirtioMem };
}

/**
 * Get the current state of a Firecracker VM.
 *
 * Returns lowercase state strings matching the convention from the old libvirt code:
 *   "running"   — VM is running
 *   "paused"    — VM is paused (Firecracker "Paused" state)
 *   "shut off"  — Firecracker process is not running (VM was powered off or crashed)
 *   "not_found" — No cube directory or PID file
 */
export async function getCubeStatus(
  client: Client,
  cubeId: string,
  launchMode?: LaunchMode
): Promise<string> {
  const cubeDir = `${CUBE_BASE_DIR}/${cubeId}`;
  const { pidFile, apiSock } = cubePaths(
    cubeId,
    await resolveMode(client, cubeId, launchMode)
  );

  // Check if the process is alive
  const pidResult = await execCommand(
    client,
    `PID=$(cat ${pidFile} 2>/dev/null) && [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && echo "alive" || echo "dead"`,
    5000
  );

  if (pidResult.stdout.trim() !== "alive") {
    // Check if the cube directory even exists
    const dirResult = await execCommand(
      client,
      `test -d ${cubeDir} && echo "exists" || echo "missing"`,
      5000
    );
    return dirResult.stdout.trim() === "exists" ? "shut off" : "not_found";
  }

  // Process is alive — query the API for VM state. Instance state lives at
  // GET "/" (InstanceInfo). The "/vm" path only supports PATCH (pause/resume)
  // — a GET there 404s and never returns a state, which made every paused VM
  // read back as "running" and caused the cube-sleep / state-sync re-sleep loop.
  const result = await execCommand(
    client,
    `curl -s --unix-socket ${apiSock} http://localhost/`,
    10_000
  );

  if (result.exitCode !== 0) {
    return "running"; // Process alive but API unresponsive — assume running
  }

  try {
    const vm = JSON.parse(result.stdout);
    const state = typeof vm.state === "string" ? vm.state.toLowerCase() : "";
    if (state === "paused") {
      return "paused";
    }
    return "running"; // Process alive + API responsive = running (or unknown state)
  } catch {
    return "running"; // Can't parse — process is alive, assume running
  }
}

/**
 * Verify a Firecracker process has actually exited after a kill. A process
 * just SIGKILL'd — especially a JAILED FC running as PID 1 of its
 * `--new-pid-ns`, whose host-side parent hasn't `wait()`ed it yet — lingers as
 * a ZOMBIE for a moment. The old single-shot `kill -0 <pid>` counted a zombie
 * as alive and raised a false "still alive after SIGKILL", stranding the cube
 * in `error` (jailed cubes hit this intermittently on cold-restart/power-off/
 * resize; bare cubes are reaped by init instantly so they almost never did).
 * A zombie holds NO resources — its TAP, API socket, and vsock fds are already
 * released by the kernel — so it is effectively dead. This polls `ps` state for
 * up to ~5s and treats a zombie (Z), dead (X/x), or already-gone PID as exited;
 * only a still-LIVE state (R/S/D/T) after the grace window counts as alive.
 */
export async function assertFirecrackerExited(
  client: Client,
  pidFile: string,
  cubeId: string
): Promise<void> {
  const probe = await execCommand(
    client,
    `PID=$(cat ${pidFile} 2>/dev/null); [ -z "$PID" ] && { echo stopped; exit 0; }; for i in 1 2 3 4 5; do ST=$(ps -o stat= -p "$PID" 2>/dev/null | tr -d ' ' | cut -c1); case "$ST" in ""|Z|X|x) echo stopped; exit 0 ;; esac; sleep 1; done; echo running`,
    12_000
  );
  if (probe.stdout.trim() === "running") {
    throw new Error(
      `Firecracker process for cube ${cubeId} still alive after SIGKILL — refusing to leave the host in an inconsistent state`
    );
  }
}
