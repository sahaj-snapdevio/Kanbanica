/**
 * Server install phase: install Firecracker, Caddy, vhost_vsock, AWS CLI,
 * and create the standard krova directory layout. All commands are
 * idempotent and cross-distro — every step that touches the package manager
 * branches on `apt-get` (Debian/Ubuntu) vs `dnf`/`yum` (RHEL/AlmaLinux/Rocky).
 *
 * Runs over the platform SSH key on port 2822 (set by the bootstrap phase).
 */

import { eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import type { Job } from "pg-boss";
import {
  CADDY_VERSION,
  CPU_CGROUP_ENABLED,
  DISK_DIRTY_BACKGROUND_BYTES_BY_CLASS,
  DISK_DIRTY_BYTES_BY_CLASS,
  DISK_DIRTY_EXPIRE_CENTISECS,
  DISK_HOST_TUNING_ENABLED,
  FIRECRACKER_VERSION,
  RAID_SCRUB_MAX_KBPS_BY_CLASS,
  RCLONE_VERSION,
  RESTIC_VERSION,
} from "@/config/platform";
import { servers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { hmacSign } from "@/lib/encrypt";
import { env } from "@/lib/env";
import { setUpServerCloudflareOrigin } from "@/lib/server/cloudflare-origin";
import {
  deriveDiskTuning,
  diskBenchmarkCommand,
  parseDiskWriteMbps,
} from "@/lib/server/disk-benchmark";
import {
  serverLandingHosts,
  serverOriginHostname,
} from "@/lib/server/server-hostnames";
import {
  claimPhaseRunning,
  completePhase,
  failPhase,
} from "@/lib/server/setup-phase";
import { initializeCaddyServer } from "@/lib/ssh/caddy";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { cpuCgroupPrepScript } from "@/lib/ssh/cpu-cgroup";
import { execCommand } from "@/lib/ssh/exec";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerInstallPayload } from "@/lib/worker/job-types";

// krova-vsock-exec is a Python helper that the worker invokes (via SSH on the
// host) to send commands into a Cube's guest agent through Firecracker's
// vsock Unix domain socket. It IS the platform's only management channel into
// Cubes (no SSH inside the VM). Without it, every Cube provision fails.
//
// We base64-encode the script content so the install step can ship it intact
// through ssh2.exec without any quoting concerns. The read is **lazy and
// defensive**: if the file is missing in some deployment context (e.g. the
// `setup/` directory wasn't copied into the production worker container), we
// log a clear error and skip the deploy step rather than crashing the whole
// worker module on import — which would otherwise kill ALL background jobs,
// not just install.
const VSOCK_EXEC_PATH_REPO = join(
  process.cwd(),
  "setup/server/krova-vsock-exec"
);
let _vsockExecB64Cache: string | null = null;
function getVsockExecB64(): string | null {
  if (_vsockExecB64Cache !== null) {
    return _vsockExecB64Cache;
  }
  try {
    _vsockExecB64Cache = Buffer.from(
      readFileSync(VSOCK_EXEC_PATH_REPO, "utf-8")
    ).toString("base64");
    return _vsockExecB64Cache;
  } catch (err) {
    console.error(
      `[server-install] krova-vsock-exec not found at ${VSOCK_EXEC_PATH_REPO}: ${err instanceof Error ? err.message : String(err)} — Cube provisioning will fail post-install. Make sure setup/server/krova-vsock-exec is copied into the worker container.`
    );
    return null;
  }
}

// krova-vsock-pty is the host-side PTY bridge — Python helper that
// transparently proxies bytes between the SSH stream the worker holds
// and the vsock connection into the guest agent's `pty` verb. Required
// for the browser terminal feature; ABSENCE only fails terminal sessions,
// not other cube operations, so we deploy it best-effort and surface a
// warning rather than failing the install step.
const VSOCK_PTY_PATH_REPO = join(process.cwd(), "setup/server/krova-vsock-pty");
let _vsockPtyB64Cache: string | null = null;
function getVsockPtyB64(): string | null {
  if (_vsockPtyB64Cache !== null) {
    return _vsockPtyB64Cache;
  }
  try {
    _vsockPtyB64Cache = Buffer.from(
      readFileSync(VSOCK_PTY_PATH_REPO, "utf-8")
    ).toString("base64");
    return _vsockPtyB64Cache;
  } catch (err) {
    console.error(
      `[server-install] krova-vsock-pty not found at ${VSOCK_PTY_PATH_REPO}: ${err instanceof Error ? err.message : String(err)} — browser terminal sessions will fail on this server. Copy setup/server/krova-vsock-pty into the worker container to enable.`
    );
    return null;
  }
}

/**
 * Generic retry-with-exponential-backoff wrapper.
 *
 * Use ONLY for operations that are documented idempotent — re-running a
 * non-idempotent operation (e.g. an iptables append, a non-upsert SQL
 * insert) on transient failure can corrupt state.
 *
 * The wrapped function is invoked up to `attempts` times. Between attempts,
 * delay doubles: `baseDelayMs` → `2*baseDelayMs` → `4*baseDelayMs`, etc.
 * With defaults attempts=3, baseDelayMs=2000: backoff is 2s + 4s = 6s
 * maximum total wait between three attempts.
 *
 * Per Cloudflare's documented limits page, the API rate-limits with HTTP 429
 * and a `Retry-After` header, and returns 5xx for backend errors — both
 * classes are documented as retry-safe. We don't parse `Retry-After`; the
 * exponential backoff is conservative enough that a single retry handles
 * the typical case. If a deeper retry storm is needed, the operator's
 * "Retry" of the failed phase from Orbit re-enqueues the whole job.
 *
 * Errors from the FINAL attempt are re-thrown verbatim so the caller's
 * existing error path (audit log, job_log) sees the underlying message.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number;
    baseDelayMs: number;
    label: string;
    log?: { warn: (message: string) => Promise<void> | void };
  }
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = i === opts.attempts - 1;
      if (isLast) {
        break;
      }
      const delay = opts.baseDelayMs * 2 ** i;
      const msg = err instanceof Error ? err.message : String(err);
      await opts.log?.warn?.(
        `${opts.label} attempt ${i + 1}/${opts.attempts} failed: ${msg.slice(0, 200)} — retrying in ${Math.round(delay / 1000)}s`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

/**
 * Configure Caddy's systemd unit to start with `--resume` so admin-API
 * config changes (which are auto-saved to
 * /var/lib/caddy/.config/caddy/autosave.json — verified against Caddy
 * source: caddy.go writes via os.WriteFile on every Load(), and
 * commandfuncs.go reads from `caddy.ConfigAutosavePath` when --resume is
 * passed) survive process restarts and reboots.
 *
 * Without this, every Caddy restart reverts to the empty default Caddyfile
 * and silently drops every Cube domain mapping the admin API has added.
 *
 * Per the Caddy source we just verified: `--resume` falls back gracefully
 * to `--config` when the autosave file doesn't exist, so the very first
 * boot after this drop-in is applied still works.
 */
function caddyResumeSystemdScript(): string {
  const script = `set -e
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/krova-resume.conf <<'OVERRIDE'
[Service]
ExecStart=
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile --resume
OVERRIDE
systemctl daemon-reload
systemctl restart caddy
# Wait up to 30s for the admin API to come back. We'll need it for the
# next install step (Caddy default-route initialization).
for i in $(seq 1 30); do
  if curl -sf http://localhost:2019/config/ >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done
echo 'Caddy admin API not reachable after 30s' >&2
exit 1
`;
  const b64 = Buffer.from(script).toString("base64");
  return `echo '${b64}' | base64 -d | bash`;
}

/**
 * Build the command that installs krova-boot-notify on a host: an env file
 * with the derived per-server token, a notify script, and a systemd oneshot
 * that runs it on every boot. The whole payload is base64-encoded and piped
 * to `bash` so embedded heredocs/quotes survive the outer SSH exec verbatim.
 *
 * Exported so the one-off retrofit script can install it on existing servers.
 */
export function bootNotifyInstallScript(
  serverId: string,
  token: string,
  appUrl: string
): string {
  const script = `set -e
cat > /etc/krova/boot-notify.env <<'ENVEOF'
KROVA_APP_URL=${appUrl}
KROVA_SERVER_ID=${serverId}
KROVA_NOTIFY_TOKEN=${token}
ENVEOF
chmod 600 /etc/krova/boot-notify.env

cat > /usr/local/bin/krova-boot-notify.sh <<'SHEOF'
#!/usr/bin/env bash
set -u
. /etc/krova/boot-notify.env
for i in 1 2 3 4 5; do
  if curl -fsS -m 10 -X POST "$KROVA_APP_URL/api/internal/server-rebooted" \\
       -H 'Content-Type: application/json' \\
       -d "{\\"serverId\\":\\"$KROVA_SERVER_ID\\",\\"token\\":\\"$KROVA_NOTIFY_TOKEN\\"}"; then
    exit 0
  fi
  sleep 5
done
# Exit non-zero so the oneshot systemd unit surfaces as "failed" in
# \`systemctl status krova-boot-notify\` rather than reporting phantom
# success. The cube.state-sync boot-id check is still the <=2min fallback
# (handler-side), so customer cubes recover regardless — but the operator
# now has a visible signal that the control plane was unreachable at boot.
exit 1
SHEOF
chmod 0755 /usr/local/bin/krova-boot-notify.sh

cat > /etc/systemd/system/krova-boot-notify.service <<'UNITEOF'
[Unit]
Description=Krova boot notify - tell the control plane this host rebooted
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/krova-boot-notify.sh

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable krova-boot-notify.service
`;
  const b64 = Buffer.from(script).toString("base64");
  return `echo '${b64}' | base64 -d | bash`;
}

/**
 * Tune the host kernel for dense Firecracker microVM packing:
 *   - vm.overcommit_memory=1: always overcommit. Each Cube reserves its full
 *     RAM range upfront but only faults pages on demand; heuristic mode (0)
 *     refuses large allocations once the running set approaches RAM and
 *     breaks dense packing.
 *   - vm.swappiness=10: keep VM-backing pages resident, only swap under
 *     real pressure. Effective only once `swapfileScript()` actually
 *     creates a swap device — the setting alone is inert without swap.
 *   - KSM (Kernel Same-page Merging): DISABLED. It dedups identical pages
 *     across Cubes, but Firecracker's prod-host-setup flags it as a cross-VM
 *     page-dedup side channel and recommends disabling it for tenant
 *     separation; RAM is allocated 1:1 (servers.max_ram_overcommit default
 *     1.0) so dedup buys no resold density anyway. Forced off via sysfs + a
 *     tmpfiles.d "0" rule that survives reboot, plus disabling any legacy unit.
 *   - kvm nx_huge_pages=never: Firecracker's recommended mitigation for the
 *     Linux 6.1 KVM iTLB-multihit boot/perf regression. Persisted via
 *     modprobe.d; applies on the next kvm load (reboot) — we never reload kvm
 *     on a live host (it is in use by running Firecrackers).
 *   - cgroup v2 favordynmods: the alternative path for that same 6.1
 *     regression; a live-safe remount, harmless alongside nx_huge_pages.
 *
 * Encoded as base64 + piped to bash so the multi-line heredoc survives
 * ssh2's exec verbatim.
 */
function kernelTuningScript(): string {
  const script = `set -e
cat > /etc/sysctl.d/99-krova.conf <<'SYSCTL'
vm.overcommit_memory = 1
vm.swappiness = 10
SYSCTL
sysctl --system >/dev/null

# KSM OFF (multi-tenant isolation). Overwrite any prior enable-rule with an OFF
# rule that persists across reboot, apply now, and disable any legacy KSM unit.
# Tolerate kernels built without KSM (the sysfs path is simply absent).
echo 'w /sys/kernel/mm/ksm/run - - - - 0' > /etc/tmpfiles.d/krova-ksm.conf
echo 0 > /sys/kernel/mm/ksm/run 2>/dev/null || true
systemctl disable --now ksm.service ksmtuned.service 2>/dev/null || true

# kvm nx_huge_pages=never (Linux 6.1 iTLB-multihit regression). Persist only;
# applies on next kvm load. Do NOT reload kvm here — on an active host it is in
# use by running Firecrackers and a reload would fail.
mkdir -p /etc/modprobe.d
grep -qs 'nx_huge_pages=never' /etc/modprobe.d/kvm.conf || echo 'options kvm nx_huge_pages=never' >> /etc/modprobe.d/kvm.conf

# cgroup v2 favordynmods — live-safe remount (Ubuntu 24.04 default is cgroup v2).
mount -o remount,favordynmods /sys/fs/cgroup 2>/dev/null || true
`;
  const b64 = Buffer.from(script).toString("base64");
  return `echo '${b64}' | base64 -d | bash`;
}

/**
 * Pin the CPU to the `performance` governor + allow turbo on every boot, via a
 * oneshot systemd unit (krova-cpu-perf) that re-applies the sysfs knobs each
 * boot. Without this the host inherits the distro default governor (often
 * `powersave`/`schedutil`), which can park cores near base clock under bursty
 * microVM load so cubes never reach turbo even with BIOS turbo enabled
 * (2026-06-02 audit C1). Uses ONLY sysfs + a systemd unit — no extra host binary
 * (no cpupower), so it carries no Rule-46 package obligation. Every write is
 * guarded (`[ -w ]` + `|| true`) so a host without cpufreq, intel_pstate, or the
 * boost knob is a no-op rather than an error. Base64-piped so the heredocs
 * survive ssh2's exec verbatim (Rule 39). Idempotent; persists across reboot.
 * Exported so `pnpm install:cpu-governor` retrofits existing hosts with the SAME
 * bytes (Rule 14).
 */
export function cpuPerformanceScript(): string {
  const script = `set -e
cat > /usr/local/sbin/krova-cpu-perf <<'PERF'
#!/bin/sh
# Krova: pin CPU to the performance governor + allow turbo. Best-effort per node.
for d in /sys/devices/system/cpu/cpu*/cpufreq; do
  [ -w "$d/scaling_governor" ] && echo performance > "$d/scaling_governor" 2>/dev/null || true
  # HWP energy/perf preference — drives the MOST aggressive turbo on Intel HWP
  # hosts (Ice Lake / Sapphire Rapids, etc.); a no-op where the knob is absent.
  [ -w "$d/energy_performance_preference" ] && echo performance > "$d/energy_performance_preference" 2>/dev/null || true
done
# intel_pstate: 0 = turbo allowed
[ -w /sys/devices/system/cpu/intel_pstate/no_turbo ] && echo 0 > /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null || true
# acpi-cpufreq / amd_pstate global boost toggle (if present)
[ -w /sys/devices/system/cpu/cpufreq/boost ] && echo 1 > /sys/devices/system/cpu/cpufreq/boost 2>/dev/null || true
exit 0
PERF
chmod +x /usr/local/sbin/krova-cpu-perf
cat > /etc/systemd/system/krova-cpu-perf.service <<'UNIT'
[Unit]
Description=Krova CPU performance governor + turbo
After=multi-user.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/krova-cpu-perf
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable krova-cpu-perf.service
/usr/local/sbin/krova-cpu-perf
`;
  const b64 = Buffer.from(script).toString("base64");
  return `echo '${b64}' | base64 -d | bash`;
}

/**
 * Create a host swapfile sized as a function of total RAM:
 *   25% of detected RAM, clamped to [4 GB, 32 GB].
 *
 * Examples:
 *   -  32 GB RAM →  8 GB swap
 *   -  64 GB RAM → 16 GB swap
 *   - 128 GB RAM → 32 GB swap (cap)
 *   - 256 GB RAM → 32 GB swap (cap)
 *
 * Swap is a HOST safety net (Krova worker + per-cube Firecracker overhead +
 * PBS client during backups + kernel page cache spikes), NOT a memory
 * extension for customer cubes — cube RAM is allocated upfront via
 * mem_size_mib / virtio-mem and never spills to host swap. The 32 GB cap
 * keeps the swapfile from eating sellable disk on big-RAM hosts where more
 * swap gives no further benefit. The 4 GB floor protects small hosts.
 *
 * Idempotent: if /swapfile is already active at the target size, exits 0
 * without touching it. If active at a different size (RAM resized, formula
 * changed), swapoffs and recreates. If a residual /swapfile exists but is
 * not active, removes it before recreating so mkswap doesn't refuse on a
 * pre-formatted file.
 *
 * Swappiness is configured by `kernelTuningScript()` — don't duplicate it
 * here. /etc/fstab entry is added idempotently so the swap activates on
 * every boot.
 *
 * Encoded as base64 + piped to bash so the multi-line script survives
 * ssh2's exec verbatim.
 */
function swapfileScript(): string {
  const script = `set -e
SWAP_FILE=/swapfile

# Sizing: 25% of RAM, clamped to [4 GB, 32 GB]
TOTAL_KB=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
TOTAL_GB=$((TOTAL_KB / 1024 / 1024))
SWAP_GB=$((TOTAL_GB / 4))
if [ "$SWAP_GB" -lt 4 ]; then SWAP_GB=4; fi
if [ "$SWAP_GB" -gt 32 ]; then SWAP_GB=32; fi

NEEDS_CREATE=1
if swapon --show=NAME --noheadings 2>/dev/null | grep -qFx "$SWAP_FILE"; then
  CURRENT_BYTES=$(stat -c "%s" "$SWAP_FILE" 2>/dev/null || echo 0)
  CURRENT_GB=$((CURRENT_BYTES / 1024 / 1024 / 1024))
  if [ "$CURRENT_GB" = "$SWAP_GB" ]; then
    echo "swap already $CURRENT_GB GB at $SWAP_FILE (RAM: $TOTAL_GB GB) — keeping in place"
    NEEDS_CREATE=0
  else
    echo "swap currently $CURRENT_GB GB; resizing to $SWAP_GB GB (RAM: $TOTAL_GB GB)"
    swapoff "$SWAP_FILE"
    rm -f "$SWAP_FILE"
  fi
fi

if [ "$NEEDS_CREATE" = "1" ]; then
  # Residual file from an interrupted prior run — mkswap refuses on a
  # pre-formatted file, so remove before recreating.
  if [ -e "$SWAP_FILE" ]; then
    echo "removing residual $SWAP_FILE (not currently active)"
    rm -f "$SWAP_FILE"
  fi

  echo "creating $SWAP_GB GB swapfile at $SWAP_FILE (RAM: $TOTAL_GB GB)"
  fallocate -l "\${SWAP_GB}G" "$SWAP_FILE"
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE" >/dev/null
  swapon "$SWAP_FILE"
fi

# Persist across reboots — idempotent insert into /etc/fstab. ALWAYS runs,
# not just on create, so a prior partial install (swap active but fstab
# unwritten — e.g., previous run died between swapon and fstab append) is
# healed on re-run. Without this, the swap works until the next reboot and
# then silently disappears.
if ! grep -qE "^/swapfile[[:space:]]" /etc/fstab; then
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
  echo "added /swapfile to /etc/fstab"
fi

echo "swap active: $(swapon --show=NAME,SIZE,USED --noheadings | head -1)"
`;
  const b64 = Buffer.from(script).toString("base64");
  return `echo '${b64}' | base64 -d | bash`;
}

/**
 * Cross-distro Caddy install script. Encoded as base64 + piped to bash so
 * the multi-line if/elif/fi survives ssh2's exec verbatim (joining shell
 * keywords with `;` produces "syntax error near unexpected token `then`").
 */
function caddyInstallScript(): string {
  // CADDY_VERSION is documented in config/platform.ts. On Debian/Ubuntu we pin
  // the install to that exact version (apt-get install caddy=<v>) and hold it
  // with apt-mark hold, so the platform-tested version is authoritative and
  // unattended-upgrades / manual `apt upgrade` cannot move it. On RHEL the
  // `@caddy/caddy` COPR retains only the latest build, so an exact-version pin
  // is not reliable there — the RHEL branch installs COPR-latest and the
  // version-check probe (lib/security/server-versions.ts) is the drift backstop.
  const script = `set -e
echo "Caddy install — platform-tested version: ${CADDY_VERSION}"
if systemctl is-active --quiet caddy; then exit 0; fi
if command -v apt-get >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy=${CADDY_VERSION}
  apt-mark hold caddy
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y 'dnf-command(copr)'
  dnf copr enable -y @caddy/caddy
  dnf install -y caddy
elif command -v yum >/dev/null 2>&1; then
  yum install -y yum-plugin-copr
  yum copr enable -y @caddy/caddy
  yum install -y caddy
else
  echo 'Unsupported distro: no apt-get/dnf/yum found' >&2
  exit 1
fi
systemctl enable --now caddy
`;
  const b64 = Buffer.from(script).toString("base64");
  return `echo '${b64}' | base64 -d | bash`;
}

/**
 * Host disk-I/O tuning (disk-I/O overhaul D4), gated by DISK_HOST_TUNING_ENABLED.
 * Hardware-ADAPTIVE + active-host-safe (sysctl + udev apply live, no reboot, no
 * cube restart). EXPORTED so the `pnpm install:disk-tuning` retrofit reuses the
 * identical bytes (Rule 14). All knobs are best-effort (`|| true`) so a host that
 * lacks a piece (no md array, no fstrim.timer) is a clean no-op.
 *
 *  - Byte-based dirty-page caps bound the writeback stall train on a one-SATA-SSD
 *    write ceiling (auto-zero the kernel ratio defaults).
 *  - dev.raid.speed_limit_max throttles the mdadm `check` scrub under load.
 *  - mq-deadline pinned ONLY on SATA-SSD members (rotational==0 sd*); NVMe keeps
 *    its default (none); md/dm are passthrough (target the physical members).
 *  - weekly host fstrim.timer (replaces the guest inline `discard`).
 */
export function diskHostTuningScript(measuredMbps?: number | null): string {
  const derived = measuredMbps ? deriveDiskTuning(measuredMbps) : null;
  const d = DISK_DIRTY_BYTES_BY_CLASS;
  const bg = DISK_DIRTY_BACKGROUND_BYTES_BY_CLASS;
  const s = RAID_SCRUB_MAX_KBPS_BY_CLASS;
  // MEASURED host → write the literal derived values (no detection needed).
  // Otherwise detect the disk class ON THE HOST and pick the per-class heuristic.
  const sysctlSection = derived
    ? `# Krova disk tuning - derived from a measured ${measuredMbps} MB/s write
cat > /etc/sysctl.d/98-krova-disk.conf <<'SYSCTL'
vm.dirty_bytes = ${derived.dirtyBytes}
vm.dirty_background_bytes = ${derived.backgroundBytes}
vm.dirty_expire_centisecs = ${DISK_DIRTY_EXPIRE_CENTISECS}
dev.raid.speed_limit_max = ${derived.scrubKbps}
SYSCTL`
    : `# Detect the class of the disk backing cube storage from the host's OWN
# hardware (no DB). A partition resolves to its parent whole-disk; an nvme name is
# nvme; otherwise the rotational flag splits ssd vs hdd. LVM/dm on nvme reads as
# ssd (conservative, safe). Virtio/cloud disks report rotational=1 -> hdd.
STORE=/var/lib/krova; [ -d "$STORE" ] || STORE=/
SRC=$(df --output=source "$STORE" 2>/dev/null | tail -1)
KN=$(lsblk -no KNAME "$SRC" 2>/dev/null | head -1)
if [ -f /sys/class/block/$KN/partition ]; then
  DISK=$(lsblk -no PKNAME "$SRC" 2>/dev/null | head -1)
fi
DISK=\${DISK:-$KN}
case "$DISK" in
  nvme*) CLASS=nvme ;;
  *) [ "$(cat /sys/block/$DISK/queue/rotational 2>/dev/null)" = "0" ] && CLASS=ssd || CLASS=hdd ;;
esac
case "$CLASS" in
  nvme) DB=${d.nvme}; DBG=${bg.nvme}; SCRUB=${s.nvme} ;;
  ssd)  DB=${d.ssd}; DBG=${bg.ssd}; SCRUB=${s.ssd} ;;
  *)    DB=${d.hdd}; DBG=${bg.hdd}; SCRUB=${s.hdd} ;;
esac
cat > /etc/sysctl.d/98-krova-disk.conf <<SYSCTL
# Krova disk tuning - sized for the detected disk class: $CLASS ($DISK)
vm.dirty_bytes = $DB
vm.dirty_background_bytes = $DBG
vm.dirty_expire_centisecs = ${DISK_DIRTY_EXPIRE_CENTISECS}
dev.raid.speed_limit_max = $SCRUB
SYSCTL`;
  return `set -e
${sysctlSection}
sysctl --system >/dev/null 2>&1 || true

cat > /etc/udev/rules.d/60-krova-io-sched.rules <<'UDEV'
ACTION=="add|change", KERNEL=="sd[a-z]*", ATTR{queue/rotational}=="0", ATTR{queue/scheduler}="mq-deadline"
UDEV
udevadm control --reload-rules >/dev/null 2>&1 || true
udevadm trigger --subsystem-match=block >/dev/null 2>&1 || true

systemctl list-unit-files fstrim.timer >/dev/null 2>&1 && systemctl enable --now fstrim.timer >/dev/null 2>&1 || true

cat > /etc/logrotate.d/krova-cube-logs <<'LOGR'
/var/lib/krova/cubes/*/serial.log /var/lib/krova/cubes/*/*.log {
  size 50M
  rotate 3
  missingok
  notifempty
  copytruncate
  compress
  delaycompress
}
LOGR
`;
}

const STEPS: Array<{ name: string; cmd: string; timeoutMs: number }> = [
  {
    // Self-heal from any partial state left by a prior failed install run.
    // Specifically: if a previous attempt wrote /etc/apt/sources.list.d/caddy-stable.list
    // but its signed-by keyring file is missing (e.g. earlier krova-cloud
    // versions saved the keyring under the wrong filename), `apt-get update`
    // will fail with NO_PUBKEY before we ever reach the Caddy install step
    // that would correct the keyring. Without this self-heal, retries lock up.
    //
    // Idempotent: removing files that don't exist is fine. Removing only the
    // stale `.list` (not the keyring) preserves a working Caddy repo if one
    // exists.
    name: "self-heal: clear broken third-party repo state",
    cmd:
      "if [ -f /etc/apt/sources.list.d/caddy-stable.list ] && [ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then " +
      "  echo 'cleaning broken Caddy sources.list (keyring missing)'; " +
      "  rm -f /etc/apt/sources.list.d/caddy-stable.list; " +
      "fi; " +
      // Earlier versions of this codebase saved the keyring under the wrong
      // filename (`caddy-archive-keyring.gpg` instead of `caddy-stable-archive-keyring.gpg`).
      // Remove that orphan if it's lying around — the Caddy step will write
      // the correctly-named one fresh.
      "rm -f /usr/share/keyrings/caddy-archive-keyring.gpg; " +
      "true",
    timeoutMs: 10_000,
  },
  {
    name: "package cache refresh",
    cmd:
      "if command -v apt-get >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive apt-get update -qq; " +
      "elif command -v dnf >/dev/null 2>&1; then dnf -q makecache; " +
      "elif command -v yum >/dev/null 2>&1; then yum -q makecache; " +
      "else echo 'Unsupported distro: no apt-get/dnf/yum found' >&2; exit 1; fi",
    timeoutMs: 180_000,
  },
  {
    // Base packages, cross-distro. EVERY tool the worker shell-outs to on a
    // bare-metal host must appear in this list. Confirmed by grep across
    // `lib/ssh/` and `lib/worker/handlers/` — any addition here demands a
    // corresponding addition to `pnpm install:host-tools` (so the live
    // fleet picks it up).
    //
    //   - curl: every HTTP download
    //   - tar: Firecracker .tgz extraction
    //   - zstd: backup compression, rootfs decompression in pull-images
    //   - bzip2: provides `bunzip2`, used by the restic install step to
    //     decompress the upstream restic release tarball
    //     (`restic_X.Y.Z_linux_amd64.bz2`). Not present in minimal
    //     Ubuntu Server / AlmaLinux 9 installs by default.
    //   - unzip: required by the rclone install step to extract the
    //     upstream zip release (`rclone-vX.Y.Z-linux-amd64.zip`). Not in
    //     minimal Ubuntu / AlmaLinux 9 by default.
    //   - rsync: snapshot file transfers
    //   - net-tools: bootstrap step 5 falls back to `netstat -ltn` if `ss` is absent
    //   - ca-certificates: HTTPS validation
    //   - gnupg / gnupg2: GPG key dearmor for Caddy install
    //   - iptables-persistent (Debian) / iptables-services (RHEL): network
    //     phase rules persistence across reboots
    //   - python3: needed to run the krova-vsock-exec helper (deployed below).
    //     Pre-installed on Ubuntu 24.04 / AlmaLinux 9 but pinning explicitly
    //     for safety.
    //   - netcat-openbsd (Debian) / nmap-ncat (RHEL): historical L2 SSH
    //     reachability probe and ad-hoc TCP debugging. The reachability
    //     probe itself now uses bash's built-in `/dev/tcp` so this is no
    //     longer load-bearing, but `nc` remains useful in handler shell
    //     pipelines and operator triage so we install it on every host.
    //   - file: ext4 magic-byte sanity check after `.cube` extraction
    //     (`lib/storage/cube-archive/host-extract.ts` runs `file -b <rootfs>`
    //     and refuses anything that doesn't start with "Linux rev 1.0 ext4").
    //     NOT installed by default on RHEL / AlmaLinux 9 minimal.
    //   - e2fsprogs: `e2fsck`, `resize2fs`, `mkfs.ext4` — used by cube
    //     boot, import, redeploy, transfer, and the firecracker disk-grow
    //     path. Usually present transitively (the host root fs is ext4),
    //     but pinning explicitly so a base-image change can never break
    //     cube provisioning silently.
    //
    // Removed (verified zero runtime usage on the bare-metal box):
    //   wget, jq, uuid-runtime, util-linux, awscli
    //
    // Every binary listed here is re-asserted at the end of the install
    // phase by the `verify host tools` step — if any of these somehow
    // failed to land (apt mirror lag, package rename, etc.), the install
    // phase fails with a precise error rather than silently shipping a
    // broken host.
    name: "base packages",
    cmd:
      "if command -v apt-get >/dev/null 2>&1; then " +
      "  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl tar zstd bzip2 unzip rsync iptables-persistent net-tools conntrack ca-certificates gnupg python3 netcat-openbsd file e2fsprogs; " +
      "elif command -v dnf >/dev/null 2>&1; then " +
      "  dnf install -y curl tar zstd bzip2 unzip rsync iptables-services net-tools conntrack-tools ca-certificates gnupg2 python3 nmap-ncat file e2fsprogs; " +
      "elif command -v yum >/dev/null 2>&1; then " +
      "  yum install -y curl tar zstd bzip2 unzip rsync iptables-services net-tools conntrack-tools ca-certificates gnupg2 python3 nmap-ncat file e2fsprogs; " +
      "else echo 'Unsupported distro: no apt-get/dnf/yum found' >&2; exit 1; fi",
    timeoutMs: 300_000,
  },
  {
    // rclone is the per-host transfer tool that streams cube
    // backups/imports to and from the S3 storage backends. Distro
    // repositories ship laggy versions (AlmaLinux 9 EPEL still on 1.53,
    // which lacks the S3 multipart performance flags we depend on), so
    // we install from the upstream GitHub release tarball at a PINNED
    // version. Previously this used the upstream `rclone.org/install.sh`
    // script which always picks the latest stable — that produced fleet
    // drift across servers provisioned weeks apart and made multipart
    // throughput non-reproducible. The pin lives in
    // `config/platform.ts` as `RCLONE_VERSION`.
    //
    // Idempotency: skip the install when the pinned version is already
    // present. `rclone version` prints e.g.
    //   rclone v1.74.2
    //   - os/version: ubuntu 24.04 (64 bit)
    //   ...
    // a substring match on `rclone v<version>` short-circuits.
    name: "rclone",
    // Self-contained, verify-then-install pattern matching the restic
    // step below. Prerequisite tools (curl + unzip) are check-then-
    // install-if-missing so the step is self-sufficient and the retrofit
    // script can target older servers that pre-date `unzip` in base
    // packages. Every shell step is its own `;`-terminated command, NOT
    // `&&`-chained — see the long-form rationale on the restic step.
    cmd:
      "set -e; " +
      `EXPECTED="rclone v${RCLONE_VERSION}"; ` +
      "ensure_pkg() { " +
      `  local cmd="$1"; ` +
      `  local pkg="$2"; ` +
      `  if command -v "$cmd" >/dev/null 2>&1; then ` +
      "    return 0; " +
      "  fi; " +
      `  echo "Installing missing package: $pkg (provides $cmd)"; ` +
      "  if command -v apt-get >/dev/null 2>&1; then " +
      "    DEBIAN_FRONTEND=noninteractive apt-get update -qq; " +
      `    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg"; ` +
      "  elif command -v dnf >/dev/null 2>&1; then " +
      `    dnf install -y "$pkg"; ` +
      "  elif command -v yum >/dev/null 2>&1; then " +
      `    yum install -y "$pkg"; ` +
      "  else " +
      `    echo "ERROR: no apt-get/dnf/yum and $cmd is missing" >&2; ` +
      "    exit 1; " +
      "  fi; " +
      `  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $pkg install completed but $cmd still missing" >&2; exit 1; }; ` +
      "}; " +
      "ensure_pkg curl curl; " +
      "ensure_pkg unzip unzip; " +
      // Idempotency gate
      `if command -v rclone >/dev/null 2>&1 && rclone version 2>/dev/null | head -1 | grep -qF "$EXPECTED"; then ` +
      `  echo "rclone ${RCLONE_VERSION} already installed"; ` +
      "else " +
      `  ARCH=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/'); ` +
      "  cd /tmp; " +
      "  rm -rf rclone.zip rclone-extracted; " +
      "  mkdir -p rclone-extracted; " +
      `  curl -fsSL -o rclone.zip "https://github.com/rclone/rclone/releases/download/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-$\{ARCH}.zip"; ` +
      "  unzip -q rclone.zip -d rclone-extracted; " +
      `  install -m 0755 rclone-extracted/rclone-v${RCLONE_VERSION}-linux-$\{ARCH}/rclone /usr/local/bin/rclone; ` +
      "  rm -rf rclone.zip rclone-extracted; " +
      `  echo "rclone installed: $(rclone version | head -1)"; ` +
      "fi; " +
      // Ground-truth verification
      `command -v rclone >/dev/null 2>&1 || { echo "ERROR: rclone not on PATH after install" >&2; exit 1; }; ` +
      `rclone version 2>&1 | head -1 | grep -qF "$EXPECTED" || { echo "ERROR: rclone version mismatch — expected $EXPECTED, got: $(rclone version 2>&1 | head -1)" >&2; exit 1; }; ` +
      `echo "rclone verified at $(command -v rclone): $(rclone version | head -1)"`,
    timeoutMs: 300_000,
  },
  {
    // restic is the per-cube snapshot tool — content-addressed
    // chunked dedup against the same S3 backend rclone uses for
    // full-blob backups (see lib/storage/restic/ and CLAUDE.md
    // "Snapshots & Backups"). Single self-contained Go binary
    // published by upstream on GitHub; we pin to RESTIC_VERSION in
    // config/platform.ts. Distro repos lag badly (AlmaLinux 9 EPEL
    // is several majors behind), so we always install from the
    // upstream release artifact.
    //
    // Idempotency: skip the install when the pinned version is
    // already present. `restic version` prints e.g. "restic 0.18.1
    // compiled with ..." — a substring match catches the pinned
    // version and short-circuits.
    name: "restic",
    // Self-contained, verify-then-install pattern. Every prerequisite
    // is checked at runtime and installed if missing — we do NOT
    // assume the base-packages step ran first, because this same
    // command is reused by `pnpm install:restic` against existing
    // servers that may pre-date the bzip2-in-base-packages change.
    //
    // CRITICAL: every step is a simple command on its own line
    // separated by `;` — NEVER `&&`. With `set -e` enabled, a failing
    // command in the MIDDLE of an `&&` chain does NOT trigger the
    // exit (only the FINAL command in the chain does, per the bash
    // -e man page). A previous version chained curl && bunzip2 &&
    // install && rm && echo: when curl silently failed (network,
    // DNS, GitHub rate limit), the chain broke but the script
    // continued to the trailing mkdir and exited 0, reporting a
    // phantom success. Semicolons preserve set -e's per-command
    // exit.
    //
    // The final `command -v restic && restic version | grep -qF`
    // gate is the ground-truth verification: if the binary isn't
    // callable from a fresh shell at exactly the pinned version, the
    // step fails with a clear error rather than reporting a phantom
    // success.
    cmd:
      "set -e; " +
      `EXPECTED="restic ${RESTIC_VERSION} "; ` +
      // ── Step 1: ensure prerequisite tools exist (curl + bunzip2). ──
      // Both come from packages that aren't guaranteed on a minimal
      // Ubuntu / AlmaLinux install. We check-then-install per-distro
      // so the restic step is self-sufficient and can run against any
      // existing server without depending on base-packages.
      "ensure_pkg() { " +
      `  local cmd="$1"; ` +
      `  local pkg="$2"; ` +
      `  if command -v "$cmd" >/dev/null 2>&1; then ` +
      "    return 0; " +
      "  fi; " +
      `  echo "Installing missing package: $pkg (provides $cmd)"; ` +
      "  if command -v apt-get >/dev/null 2>&1; then " +
      // Refresh apt cache first — a server that hasn't seen
      // `apt-get update` in months may point at packages that are
      // no longer downloadable from the mirror.
      "    DEBIAN_FRONTEND=noninteractive apt-get update -qq; " +
      `    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg"; ` +
      "  elif command -v dnf >/dev/null 2>&1; then " +
      `    dnf install -y "$pkg"; ` +
      "  elif command -v yum >/dev/null 2>&1; then " +
      `    yum install -y "$pkg"; ` +
      "  else " +
      `    echo "ERROR: no apt-get/dnf/yum and $cmd is missing" >&2; ` +
      "    exit 1; " +
      "  fi; " +
      `  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $pkg install completed but $cmd still missing" >&2; exit 1; }; ` +
      "}; " +
      "ensure_pkg curl curl; " +
      "ensure_pkg bunzip2 bzip2; " +
      // ── Step 2: install restic itself (idempotent on pinned version) ──
      `if command -v restic >/dev/null 2>&1 && restic version 2>/dev/null | grep -qF "$EXPECTED"; then ` +
      `  echo "restic ${RESTIC_VERSION} already installed"; ` +
      "else " +
      `  ARCH=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/'); ` +
      "  cd /tmp; " +
      "  rm -f restic.bz2 restic; " +
      `  curl -fsSL -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_$\{ARCH}.bz2"; ` +
      "  bunzip2 -f restic.bz2; " +
      "  install -m 0755 restic /usr/local/bin/restic; " +
      "  rm -f /tmp/restic; " +
      `  echo "restic installed: $(restic version | head -1)"; ` +
      "fi; " +
      // ── Step 3: restic cache dir ──
      // Pre-create the cache dir restic uses for repo metadata
      // between runs. Without it, the first invocation creates
      // ~/.cache/restic (which on root-over-SSH ends up at
      // /root/.cache/restic — usable but inconsistent across boots).
      // Pin to a known path under /var/lib/krova so backups + the
      // restic-prune cron all share the same warm cache.
      "mkdir -p /var/lib/krova/restic-cache; " +
      "chmod 700 /var/lib/krova/restic-cache; " +
      // ── Step 4: ground-truth verification ──
      // Fail loudly if the binary still isn't callable at the pinned
      // version. Without this gate, an unforeseen failure mode could
      // exit 0 while restic is actually broken on the host.
      `command -v restic >/dev/null 2>&1 || { echo "ERROR: restic not on PATH after install" >&2; exit 1; }; ` +
      `restic version 2>&1 | grep -qF "$EXPECTED" || { echo "ERROR: restic version mismatch — expected $EXPECTED, got: $(restic version 2>&1 | head -1)" >&2; exit 1; }; ` +
      `echo "restic verified at $(command -v restic): $(restic version | head -1)"`,
    timeoutMs: 300_000,
  },
  {
    name: "directories",
    // /etc/krova holds the boot-notify env file with the per-server HMAC
    // token — chmod 700 (root-only) is defense-in-depth in case umask drift
    // ever made the inner file (`chmod 600 /etc/krova/boot-notify.env` in
    // bootNotifyInstallScript) less restrictive than intended. A 700 parent
    // dir prevents directory listing even if the inner file's perm leaks.
    // /var/lib/krova stays 750 (root-owned, group-readable for future
    // operator tooling).
    cmd: "mkdir -p /var/lib/krova/cubes /var/lib/krova/images /var/lib/krova/jail /var/lib/krova/logs /etc/krova && chmod 750 /var/lib/krova && chmod 700 /etc/krova",
    timeoutMs: 5000,
  },
  {
    name: "Firecracker + jailer",
    // The release tarball ships BOTH the firecracker and jailer binaries; we
    // install both (the jailer runs each cube under a per-cube uid + chroot +
    // new PID ns — see lib/ssh/jailer.ts; no cgroup confinement). VERSION-GATED like restic/rclone:
    // the short-circuit fires only when BOTH binaries exist AND report the
    // pinned FIRECRACKER_VERSION, so a re-run UPGRADES a host stuck on an old
    // firecracker/jailer (and still backfills the jailer onto a pre-jailer
    // host). The trailing ground-truth check fails the phase loudly on mismatch
    // rather than exit 0 with a wrong-version binary.
    cmd: `set -e; \
VER=${FIRECRACKER_VERSION}; \
ARCH=$(uname -m); \
if test -x /usr/local/bin/firecracker && test -x /usr/local/bin/jailer && /usr/local/bin/firecracker --version 2>/dev/null | grep -qF "$\{VER}" && /usr/local/bin/jailer --version 2>/dev/null | grep -qF "$\{VER}"; then \
  echo "firecracker + jailer $\{VER} already installed"; \
else \
  cd /tmp && curl -fsSL -o fc.tgz "https://github.com/firecracker-microvm/firecracker/releases/download/$\{VER}/firecracker-$\{VER}-$\{ARCH}.tgz" && \
  tar xzf fc.tgz && \
  install -m 0755 release-$\{VER}-$\{ARCH}/firecracker-$\{VER}-$\{ARCH} /usr/local/bin/firecracker && \
  install -m 0755 release-$\{VER}-$\{ARCH}/jailer-$\{VER}-$\{ARCH} /usr/local/bin/jailer && \
  rm -rf fc.tgz release-$\{VER}-$\{ARCH}; \
fi; \
/usr/local/bin/firecracker --version 2>/dev/null | grep -qF "$\{VER}" || { echo "ERROR: firecracker version mismatch — expected $\{VER}, got: $(/usr/local/bin/firecracker --version 2>&1 | head -1)" >&2; exit 1; }; \
/usr/local/bin/jailer --version 2>/dev/null | grep -qF "$\{VER}" || { echo "ERROR: jailer version mismatch — expected $\{VER}, got: $(/usr/local/bin/jailer --version 2>&1 | head -1)" >&2; exit 1; }; \
echo "firecracker + jailer verified at $\{VER}"`.replace(/\\\n\s*/g, " "),
    timeoutMs: 300_000,
  },
  {
    // Caddy install:
    //  - Debian/Ubuntu: official Cloudsmith deb repo per https://caddyserver.com/docs/install
    //    Keyring MUST be named `caddy-stable-archive-keyring.gpg` because
    //    Cloudsmith's debian.deb.txt embeds `signed-by=` pointing at that path.
    //    `chmod o+r` is required on Debian/Ubuntu 22+ where _apt runs as `nobody`.
    //  - RHEL family: official COPR via `dnf copr enable @caddy/caddy` per
    //    the same docs page. dnf-command(copr) provides the copr subcommand.
    //
    // Multi-line script + branching is shipped as a base64-encoded payload to
    // remote bash so embedded if/elif/fi survives ssh2's exec verbatim
    // (joining with `;` after `then` produces a syntax error).
    name: "Caddy",
    cmd: caddyInstallScript(),
    timeoutMs: 300_000,
  },
  {
    name: "Caddy: enable --resume so admin-API changes persist across restarts",
    cmd: caddyResumeSystemdScript(),
    timeoutMs: 60_000,
  },
  {
    name: "vhost_vsock module",
    cmd: "modprobe vhost_vsock && (grep -q '^vhost_vsock$' /etc/modules-load.d/krova.conf 2>/dev/null || echo vhost_vsock > /etc/modules-load.d/krova.conf)",
    timeoutMs: 5000,
  },
  {
    name: "kernel tuning (overcommit, KSM, swappiness)",
    cmd: kernelTuningScript(),
    timeoutMs: 10_000,
  },
  {
    // Pin the CPU to the performance governor + allow turbo on every boot via a
    // oneshot systemd unit. Without this the host inherits the distro default
    // governor (often powersave/schedutil), which can park cores near base clock
    // under bursty microVM load so cubes never reach turbo even with BIOS turbo
    // enabled (2026-06-02 audit C1). sysfs-only, no extra package. Idempotent;
    // retrofit existing hosts with `pnpm install:cpu-governor`.
    name: "cpu performance governor",
    cmd: cpuPerformanceScript(),
    timeoutMs: 10_000,
  },
  // Per-cube cpu.weight fairness parent cgroup (audit C2 / L1). Installs the
  // krova-cgroup-prep oneshot that (re)creates /sys/fs/cgroup/krova + delegates
  // cpu on every boot, so the jailer can place each cube in a weighted leaf.
  // GATED by CPU_CGROUP_ENABLED (default false) — the step is ABSENT until enabled,
  // so it is inert on production. Retrofit existing hosts: pnpm install:cpu-cgroup.
  ...(CPU_CGROUP_ENABLED
    ? [
        {
          name: "cpu cgroup prep (krova parent + cpu delegation)",
          cmd: cpuCgroupPrepScript(),
          timeoutMs: 10_000,
        },
      ]
    : []),
  // Host disk-I/O tuning (disk overhaul D4) is NOT a static step — it runs as a
  // dynamic step in executeInstallSteps (benchmarkAndTuneDisk) so it can BENCHMARK
  // the clean host first + size the tuning from the measured write speed. GATED by
  // DISK_HOST_TUNING_ENABLED. Retrofit existing hosts: pnpm install:disk-tuning.
  {
    // Host swapfile sized as a function of RAM (25%, clamped 4-32 GB) — see
    // swapfileScript() docstring for the rationale. Without an active swap
    // device the swappiness=10 setting from kernel tuning is a no-op, so this
    // step lands the actual safety net. fallocate on a 32 GB file takes a few
    // seconds on SSD; the 3-minute budget covers slower spinning disks too.
    name: "host swapfile",
    cmd: swapfileScript(),
    timeoutMs: 180_000,
  },
  {
    name: "timezone UTC",
    cmd: "timedatectl set-timezone UTC",
    timeoutMs: 5000,
  },
  {
    // Ground-truth verification that every binary the worker shells out
    // to on a bare-metal host is actually callable. Runs at the END of
    // install so a base-packages step that succeeded but somehow didn't
    // land a binary (mirror lag, package rename, a future distro that
    // dropped one) turns into a loud install-phase failure instead of a
    // silent runtime breakage months later.
    //
    // Keep this list in lockstep with the binaries actually referenced
    // under `lib/ssh/` and `lib/worker/handlers/`. Adding a new tool to
    // the codebase WITHOUT adding it here is the bug class this step
    // exists to catch — every new dependency MUST be added to base
    // packages AND to this verify list AND to `pnpm install:host-tools`
    // (the live-fleet retrofit).
    //
    // We deliberately list ONLY tools that aren't trivially present on
    // every supported distro (Ubuntu 24.04, Debian 12, AlmaLinux 9).
    // Coreutils (cat, rm, mv, mkdir, etc.) and util-linux (mount, umount)
    // are framework-level guarantees, not worth verifying.
    name: "verify host tools",
    cmd:
      "set -e; " +
      // Each REQUIRED entry is `<binary>:<distro-pkg>` so the error
      // message can tell the operator exactly what to install if a
      // miss ever happens. Use `command -v` so we accept binaries on
      // any PATH location (not just /usr/bin).
      "REQUIRED=" +
      '"curl:curl ' +
      "tar:tar " +
      "rsync:rsync " +
      "zstd:zstd " +
      "bunzip2:bzip2 " +
      "unzip:unzip " +
      "iptables:iptables " +
      // ip6tables ships with the iptables package; the host networking phase
      // installs dual-stack NAT66 + a v6 default-deny INPUT through it (Rule 46).
      "ip6tables:iptables " +
      "ip:iproute2 " +
      "ss:iproute2 " +
      "netstat:net-tools " +
      "python3:python3 " +
      "gpg:gnupg " +
      "nc:netcat-openbsd|nmap-ncat " +
      // conntrack flushes stale NAT flows when a freed host port is reused
      // (addTcpPortForward flush-on-reuse) so a reused port never misroutes to
      // a deleted cube. Debian pkg `conntrack`, RHEL pkg `conntrack-tools`.
      "conntrack:conntrack|conntrack-tools " +
      "file:file " +
      "e2fsck:e2fsprogs " +
      "resize2fs:e2fsprogs " +
      "sha256sum:coreutils " +
      "bash:bash " +
      "timedatectl:systemd " +
      "systemctl:systemd " +
      "rclone:rclone " +
      "firecracker:firecracker-release " +
      "jailer:firecracker-release " +
      "restic:restic " +
      // ionice/nice prefix EVERY host-side restic + zstd op when
      // DISK_IO_STORAGE_TUNING_ENABLED is on (disk overhaul F). `nice` is coreutils,
      // `ionice` is util-linux (both base on Debian; util-linux is @core on RHEL).
      // Verified here so a missing `ionice` on a minimal image surfaces at SETUP,
      // not at the first backup (the 2026-06-06 storage-tuning incident class — Rule 46).
      "ionice:util-linux " +
      'nice:coreutils"; ' +
      "MISSING=; " +
      "for entry in $REQUIRED; do " +
      `  bin=$(printf '%s' "$entry" | cut -d: -f1); ` +
      `  pkg=$(printf '%s' "$entry" | cut -d: -f2-); ` +
      `  if ! command -v "$bin" >/dev/null 2>&1; then ` +
      `    MISSING="$MISSING|$bin (install $pkg)"; ` +
      "  fi; " +
      "done; " +
      'if [ -n "$MISSING" ]; then ' +
      `  echo "ERROR: required host tools missing — $(printf '%s' "$MISSING" | tr '|' '\\n  ')" >&2; ` +
      "  exit 1; " +
      "fi; " +
      // RHEL only: the v6 persist path (applyHostNetworking step 6) runs
      // `systemctl enable iptables ip6tables`, so the separate ip6tables.service
      // unit (ships with iptables-services) MUST exist to be enableable (H2).
      // Debian/Ubuntu persist v6 via netfilter-persistent / rules.v6 — no unit.
      "if command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then " +
      '  systemctl list-unit-files ip6tables.service >/dev/null 2>&1 && systemctl cat ip6tables.service >/dev/null 2>&1 || { echo "ERROR: ip6tables.service unit not present (install iptables-services) — v6 rules will not persist across reboot" >&2; exit 1; }; ' +
      "fi; " +
      // Swap activation gate. The host swapfile step earlier in this phase
      // creates /swapfile, runs swapon, and adds to /etc/fstab. Re-verify
      // both here so a silent failure (e.g., kernel without swap support, a
      // future filesystem that fallocate can't reserve on, or someone
      // manually swapoff'd) surfaces at install time rather than reboot.
      'swapon --show=NAME --noheadings 2>/dev/null | grep -qFx /swapfile || { echo "ERROR: /swapfile is not active (swapon shows no /swapfile entry)" >&2; exit 1; }; ' +
      'grep -qE "^/swapfile[[:space:]]" /etc/fstab || { echo "ERROR: /swapfile not persisted in /etc/fstab — will not survive reboot" >&2; exit 1; }; ' +
      'echo "All required host tools present, swap active + persisted"',
    timeoutMs: 30_000,
  },
];

/**
 * Run the actual install work — package installs, kernel tuning, helper
 * deploy, hostname set, Caddy init. Pure idempotent steps; does NOT touch
 * setupPhase or setupStatus.
 *
 * Called by the first-run install handler (`runHandler` below).
 *
 * Every step is idempotent and safe to re-run at any time.
 */
export async function executeInstallSteps(
  client: NonNullable<Awaited<ReturnType<typeof connectToServer>>["client"]>,
  log: JobLogger,
  conn: Awaited<ReturnType<typeof connectToServer>>
): Promise<void> {
  for (const step of STEPS) {
    await log.step(step.name, async () => {
      const result = await execCommand(client, step.cmd, step.timeoutMs);
      if (result.exitCode !== 0) {
        throw new Error(
          `exit ${result.exitCode}: ${result.stderr.slice(-500) || result.stdout.slice(-500)}`
        );
      }
    });
  }

  // Disk benchmark (CLEAN host only) + host I/O tuning (disk overhaul D4). GATED
  // by DISK_HOST_TUNING_ENABLED. The benchmark self-skips if the host already has
  // cubes; on a clean host (install time) it measures the real write speed via
  // O_DIRECT and we store it + size the tuning from it, else the per-class
  // heuristic. A benchmark failure is non-fatal — the tuning falls back.
  if (DISK_HOST_TUNING_ENABLED) {
    await log.step("disk benchmark + I/O tuning", async () => {
      let measured: number | null = null;
      try {
        const bench = await execCommand(
          client,
          diskBenchmarkCommand(),
          180_000
        );
        measured = parseDiskWriteMbps(`${bench.stdout}\n${bench.stderr}`);
        if (measured) {
          await db
            .update(servers)
            .set({ diskWriteMbps: measured })
            .where(eq(servers.id, conn.server.id));
        }
      } catch (err) {
        console.warn(
          `[server-install] ${conn.server.id}: disk benchmark failed, falling back to per-class tuning`,
          err
        );
      }
      const result = await execCommand(
        client,
        diskHostTuningScript(measured),
        15_000
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `disk tuning exit ${result.exitCode}: ${result.stderr.slice(-300)}`
        );
      }
    });
  }

  // Deploy the krova-vsock-exec helper. Resolved lazily at runtime via
  // getVsockExecB64() — if the source file is missing in the deploy
  // environment, we fail the step (rather than crashing the entire worker
  // module on import, which would block every background job).
  await log.step("deploy krova-vsock-exec helper", async () => {
    const b64 = getVsockExecB64();
    if (!b64) {
      throw new Error(
        `krova-vsock-exec source not found at ${VSOCK_EXEC_PATH_REPO}. Cube provisioning requires this helper. Make sure setup/server/krova-vsock-exec is included in the worker container's filesystem.`
      );
    }
    const result = await execCommand(
      client,
      `echo '${b64}' | base64 -d > /usr/local/bin/krova-vsock-exec && chmod 0755 /usr/local/bin/krova-vsock-exec`,
      10_000
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `exit ${result.exitCode}: ${result.stderr.slice(-500) || result.stdout.slice(-500)}`
      );
    }
  });

  // Deploy the krova-vsock-pty helper. Best-effort — its absence only
  // breaks the browser-terminal feature, not core cube operations, so we
  // log a warning instead of throwing.
  await log.step("deploy krova-vsock-pty helper", async () => {
    const b64 = getVsockPtyB64();
    if (!b64) {
      log.warn(
        "krova-vsock-pty source missing from worker container — browser terminal sessions will fail on this server until it is copied into setup/server/."
      );
      return;
    }
    const result = await execCommand(
      client,
      `echo '${b64}' | base64 -d > /usr/local/bin/krova-vsock-pty && chmod 0755 /usr/local/bin/krova-vsock-pty`,
      10_000
    );
    if (result.exitCode !== 0) {
      log.warn(
        `krova-vsock-pty install failed (exit ${result.exitCode}): ${result.stderr.slice(-300) || result.stdout.slice(-300)} — browser terminal sessions will fail on this server.`
      );
    }
  });

  // Set the bare-metal OS hostname to the server's origin FQDN so the shell
  // prompt's short hostname (`\h`) is the operator-chosen server name, not
  // "connect" (the first label of the connect domain).
  const fqdn = serverOriginHostname(conn.server.hostname);
  const escapedFqdn = fqdn.replace(/'/g, "'\\''");
  await log.step(`set hostname to FQDN (${fqdn})`, async () => {
    const hostnameRes = await execCommand(
      client,
      `hostnamectl set-hostname '${escapedFqdn}'`,
      10_000
    );
    if (hostnameRes.exitCode !== 0) {
      throw new Error(
        `exit ${hostnameRes.exitCode}: ${hostnameRes.stderr.slice(-500) || hostnameRes.stdout.slice(-500)}`
      );
    }
  });

  // Initialize Caddy with :80/:443 listeners + the host-matched branded
  // landing route for BOTH of the server's own hostnames (proxied origin +
  // grey-cloud connect domain). Idempotent merge — preserves existing
  // custom-domain routes added by addCustomDomainRoute.
  const landingHosts = serverLandingHosts(conn.server.hostname);
  await log.step(
    `Caddy: landing page for ${landingHosts.originHostname} + ${landingHosts.connectDomain}`,
    async () => {
      await initializeCaddyServer(client, landingHosts);
    }
  );

  // Cloudflare for SaaS origin setup — MANDATORY in production. Cloudflare for
  // SaaS is fundamental to the platform: a server with no origin cannot host
  // customer custom domains, so a server without it is not "installed".
  // Env validation already happened at the top of `runHandler` (fail-fast),
  // so we don't re-check here. Retry on transient API failures (Cloudflare
  // documents HTTP 429 with Retry-After for rate-limit; 5xx for backend
  // errors). The wrapped function is documented idempotent so retries are
  // safe.
  //
  // TEST-ONLY: `pnpm test:e2e` sets KROVA_E2E_SKIP_CLOUDFLARE=true so a
  // throwaway dev server can be set up without prod Cloudflare creds / DNS
  // pollution. Skips ONLY this sub-step; everything else above ran unchanged.
  if (env.KROVA_E2E_SKIP_CLOUDFLARE === "true") {
    await log.step(
      "Cloudflare for SaaS origin setup — SKIPPED (KROVA_E2E_SKIP_CLOUDFLARE)",
      async () => {
        log.warn(
          "Skipping Cloudflare origin setup — E2E test mode. Custom-domain routing is NOT configured on this server."
        );
      }
    );
  } else {
    await log.step(
      `Cloudflare for SaaS: origin + connect DNS records + Origin CA cert for ${conn.server.hostname}`,
      async () => {
        await withRetry(
          () => setUpServerCloudflareOrigin(client, conn.server, log),
          {
            attempts: 3,
            baseDelayMs: 2000,
            label: "Cloudflare for SaaS origin setup",
            log,
          }
        );
      }
    );
  }

  // Install the boot-notify systemd oneshot. On every host boot it POSTs
  // /api/internal/server-rebooted so the worker recovers this host's cubes
  // immediately. The host stores only a derived per-server HMAC token.
  await log.step("install krova-boot-notify service", async () => {
    const token = hmacSign(conn.server.id);
    let result;
    try {
      result = await execCommand(
        client,
        bootNotifyInstallScript(conn.server.id, token, env.NEXT_PUBLIC_APP_URL),
        30_000
      );
    } catch {
      // The install command embeds the per-server HMAC token. A raw
      // execCommand error (e.g. a timeout) echoes the full command — and
      // therefore the token — into job_logs. Throw a scrubbed message so the
      // secret never reaches the logs.
      throw new Error(
        "krova-boot-notify install command failed (timeout or SSH error)"
      );
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `exit ${result.exitCode}: ${result.stderr.slice(-500) || result.stdout.slice(-500)}`
      );
    }
  });
}

async function runHandler(job: Job<ServerInstallPayload>): Promise<void> {
  const { serverId } = job.data;
  const phase = "install" as const;

  // FAIL-FAST: validate Cloudflare for SaaS env BEFORE claiming the phase or
  // doing any work. Cloudflare for SaaS is fundamental to the platform — a
  // server with no origin cannot host customer custom domains, so a server
  // without it is not "installed". Catching a missing env here saves ~2 min
  // of wasted apt installs on a misconfigured deploy.
  if (
    env.KROVA_E2E_SKIP_CLOUDFLARE !== "true" &&
    (!env.CLOUDFLARE_API_TOKEN ||
      !env.CLOUDFLARE_ZONE_ID ||
      !env.CLOUDFLARE_ORIGIN_CERT ||
      !env.CLOUDFLARE_ORIGIN_KEY)
  ) {
    const msg =
      "Cloudflare for SaaS env is not configured (CLOUDFLARE_API_TOKEN / " +
      "CLOUDFLARE_ZONE_ID / CLOUDFLARE_ORIGIN_CERT / CLOUDFLARE_ORIGIN_KEY) " +
      "— cannot complete server install";
    console.error(`[server-install] ${serverId}: ${msg}`);
    await failPhase(serverId, phase, msg);
    audit({
      action: "server.setup.install_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server install phase failed: ${msg}`,
      metadata: { error: msg },
      source: "worker",
    });
    return;
  }

  // RE-RUN GUARD (three layers — see audit 2026-05-29):
  //   1. API route (app/api/orbit/servers/[serverId]/setup/route.ts) refuses
  //      with HTTP 409 if setupPhase === "ready".
  //   2. UI (app/(orbit)/orbit/servers/[serverId]/page.tsx) hides the
  //      ServerSetupCard once setupPhase === "ready" — no Run button.
  //   3. claimPhaseRunning() below atomically requires setupPhase === "install"
  //      via a conditional UPDATE. Returns false silently on a non-install
  //      phase, and we short-circuit.
  // Together these make it impossible to re-run install on a ready server,
  // by any path — UI, API, or replay of a pg-boss job from earlier history.
  const claimed = await claimPhaseRunning(serverId, phase);
  if (!claimed) {
    return;
  }

  const log = new JobLogger(job.id, "server.install", "server", serverId);
  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;
  try {
    audit({
      action: "server.setup.install_started",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: "Server install phase started",
      source: "worker",
    });
    await log.info("Install phase started");
    const conn = await connectToServer(serverId);
    client = conn.client;

    await executeInstallSteps(client, log, conn);

    await log.info("Install phase complete");
    await completePhase(serverId, phase);
    audit({
      action: "server.setup.install_complete",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server ${conn.server.hostname} install phase complete`,
      source: "worker",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server-install] failed for ${serverId}:`, err);
    await log.error(`Install phase failed: ${msg}`);
    await failPhase(serverId, phase, msg);
    audit({
      action: "server.setup.install_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server install phase failed: ${msg.slice(0, 200)}`,
      metadata: { error: msg.slice(0, 1000) },
      source: "worker",
    });
  } finally {
    if (client) {
      try {
        client.end();
      } catch {
        /* noop */
      }
    }
  }
}

export async function handleServerInstall(
  jobs: Job<ServerInstallPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
