/**
 * Server verify phase: run a comprehensive readiness check via SSH against the
 * POST-reboot host and only advance to "ready" if every critical check passes.
 * Reaching "ready" no longer auto-activates the server — the operator activates
 * it manually from Orbit once it is ready (a not-yet-vetted host stays out of
 * the allocation pool until a human opts it in).
 */
import type { Job } from "pg-boss";
import { CPU_CGROUP_ENABLED, NUMA_PLACEMENT_ENABLED } from "@/config/platform";
import { audit } from "@/lib/audit";
import {
  claimPhaseRunning,
  completePhase,
  failPhase,
} from "@/lib/server/setup-phase";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { execCommand } from "@/lib/ssh/exec";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerVerifyPayload } from "@/lib/worker/job-types";

interface Check {
  cmd: string;
  critical: boolean;
  expect: (stdout: string, exitCode: number) => boolean;
  name: string;
}

const CHECKS: Check[] = [
  {
    name: "Firecracker binary",
    cmd: "test -x /usr/local/bin/firecracker && /usr/local/bin/firecracker --version",
    expect: (_, exit) => exit === 0,
    critical: true,
  },
  {
    // JAILER_ENABLED is true fleet-wide, so every cube launches under the
    // jailer — a host missing it would reach "ready" and then fail every cube
    // launch (the cube errors). Critical, mirroring the Firecracker-binary gate.
    name: "jailer binary",
    cmd: "test -x /usr/local/bin/jailer && /usr/local/bin/jailer --version",
    expect: (_, exit) => exit === 0,
    critical: true,
  },
  {
    name: "/dev/kvm",
    cmd: "test -c /dev/kvm && echo ok",
    expect: (out) => out.trim() === "ok",
    critical: true,
  },
  {
    name: "br0 bridge",
    cmd: "ip link show br0",
    expect: (_, exit) => exit === 0,
    critical: true,
  },
  {
    name: "Caddy active",
    cmd: "systemctl is-active caddy",
    expect: (out) => out.trim() === "active",
    critical: true,
  },
  {
    name: "vhost_vsock module",
    cmd: "lsmod | grep -q '^vhost_vsock' && echo ok",
    expect: (out) => out.trim() === "ok",
    critical: true,
  },
  {
    // Required: every Cube provisioning calls into this helper via SSH-to-host
    // → vsock UDS → guest agent. Missing it = no Cube can be managed.
    name: "krova-vsock-exec helper",
    cmd: "test -x /usr/local/bin/krova-vsock-exec && echo ok",
    expect: (out) => out.trim() === "ok",
    critical: true,
  },
  {
    // Browser-terminal PTY helper. The install phase deploys it best-effort
    // (warns rather than fails), so a host can reach "ready" without it and
    // every terminal session then fails "command not found". Non-critical —
    // a missing helper only breaks the terminal feature; the operator
    // backfills with `pnpm install:vsock-pty`.
    name: "krova-vsock-pty helper",
    cmd: "test -x /usr/local/bin/krova-vsock-pty && echo ok",
    expect: (out) => out.trim() === "ok",
    critical: false,
  },
  {
    name: "kernel image",
    cmd: "test -f /var/lib/krova/images/vmlinux && echo ok",
    expect: (out) => out.trim() === "ok",
    critical: true,
  },
  {
    name: "rootfs images present",
    cmd: "ls /var/lib/krova/images/*.ext4 2>/dev/null | wc -l",
    expect: (out) => Number(out.trim()) > 0,
    critical: true,
  },
  {
    name: "ip forwarding",
    cmd: "sysctl -n net.ipv4.ip_forward",
    expect: (out) => out.trim() === "1",
    critical: true,
  },
  {
    // Host IPv6 egress — cube NAT66 only reaches the internet if the HOST itself
    // has a v6 default route. Non-critical: a v4-only host is still a valid cube
    // host (cubes fall back to IPv4 egress), so a missing v6 route is a warning
    // to chase, not an activation blocker.
    name: "host IPv6 default route",
    cmd: "ip -6 route show default",
    expect: (out) => out.trim().length > 0,
    critical: false,
  },
  {
    // Required for dense Cube packing — Firecracker reserves full RAM but
    // pages are demand-faulted. Set by install phase; treat as critical so
    // operator catches a misconfigured /etc/sysctl.d.
    name: "vm.overcommit_memory = 1",
    cmd: "sysctl -n vm.overcommit_memory",
    expect: (out) => out.trim() === "1",
    critical: true,
  },
  {
    // KSM (Kernel Same-page Merging) is DISABLED on cube hosts — it is a
    // cross-VM page-dedup side channel (Firecracker prod-host-setup) and RAM is
    // allocated 1:1, so dedup buys no density. Non-critical: a stray "on" is a
    // warning to chase, not a reason to block activation. Any non-zero value
    // ("1" full, "2" merging-but-unmerge-on-stop) counts as on.
    name: "KSM disabled",
    cmd: "cat /sys/kernel/mm/ksm/run 2>/dev/null || echo 0",
    expect: (out) => out.trim() === "0",
    critical: false,
  },
  {
    // kvm nx_huge_pages=never — Firecracker's recommended mitigation for the
    // Linux 6.1 KVM iTLB-multihit boot/perf regression, persisted in the install
    // phase via modprobe.d and activated by the reboot phase. Should read
    // "never" here (post-reboot). Non-critical: a kernel without the param
    // reads "unknown" → a warning to chase, not an activation blocker.
    name: "kvm nx_huge_pages=never",
    cmd: "cat /sys/module/kvm/parameters/nx_huge_pages 2>/dev/null || echo unknown",
    expect: (out) => out.trim() === "never",
    critical: false,
  },
  {
    // CPU governor pinned to performance by the install phase (krova-cpu-perf
    // oneshot) so cubes reach turbo instead of being parked near base clock
    // (2026-06-02 audit C1). Non-critical: a host without cpufreq (some
    // virtualized nodes) reads "none" and is still a valid cube host; a stray
    // "powersave"/"schedutil" surfaces as a warning to chase, not a blocker.
    name: "CPU performance governor",
    cmd: "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo none",
    expect: (out) => out.trim() === "performance" || out.trim() === "none",
    critical: false,
  },
  // L1 (audit C2): the krova parent cgroup must delegate `cpu` so per-cube
  // cpu.weight applies. Non-critical: a host where prep hasn't run reads "none"
  // and still boots cubes (the launch preflight falls back to no weight). GATED —
  // only present (and meaningful) when CPU_CGROUP_ENABLED.
  ...(CPU_CGROUP_ENABLED
    ? [
        {
          name: "krova cgroup delegates cpu",
          cmd: "grep -qw cpu /sys/fs/cgroup/krova/cgroup.subtree_control 2>/dev/null && echo ok || echo none",
          expect: (out: string) => out.trim() === "ok" || out.trim() === "none",
          critical: false,
        },
      ]
    : []),
  // L2 (audit): the krova parent must also delegate `cpuset` so per-cube leaves
  // can set cpuset.cpus/mems for NUMA binding. Non-critical: a host where the
  // (cpuset-delegating) prep hasn't run reads "none" and still boots cubes (the
  // launch preflight falls back to unpinned). GATED on NUMA_PLACEMENT_ENABLED.
  ...(NUMA_PLACEMENT_ENABLED
    ? [
        {
          name: "krova cgroup delegates cpuset",
          cmd: "grep -qw cpuset /sys/fs/cgroup/krova/cgroup.subtree_control 2>/dev/null && echo ok || echo none",
          expect: (out: string) => out.trim() === "ok" || out.trim() === "none",
          critical: false,
        },
      ]
    : []),
  {
    name: "timezone UTC",
    cmd: "timedatectl | grep -i 'time zone' | awk '{print $3}'",
    expect: (out) => out.trim() === "UTC",
    critical: false,
  },
  {
    name: "disk space (>20GB free)",
    cmd: 'df -BG /var/lib/krova | tail -1 | awk \'{gsub("G","",$4); print $4}\'',
    expect: (out) => Number(out.trim()) > 20,
    critical: true,
  },
  {
    name: "IPv6 forwarding",
    cmd: "sysctl -n net.ipv6.conf.all.forwarding",
    expect: (out) => out.trim() === "1",
    critical: true,
  },
  {
    name: "br0 IPv6 address",
    cmd: "ip -6 addr show br0",
    expect: (out) => out.includes("fd00:c0be:"),
    critical: true,
  },
  {
    name: "IPv6 NAT MASQUERADE",
    cmd: "ip6tables -t nat -S POSTROUTING",
    expect: (out) => /MASQUERADE/.test(out) && out.includes("fd00:c0be:"),
    critical: true,
  },
  {
    name: "IPv6 INPUT default-deny",
    cmd: "ip6tables -S INPUT",
    expect: (out) => /-P INPUT DROP/.test(out),
    critical: true,
  },
  {
    name: "ip6tables present",
    cmd: "command -v ip6tables && echo ok",
    expect: (out) => out.trim().endsWith("ok"),
    critical: true,
  },
  {
    name: "QUIC UDP 443 listener",
    cmd: "ss -lun 'sport = :443' | grep -q ':443' && echo ok || echo none",
    expect: (out) => out.trim() === "ok" || out.trim() === "none", // non-critical: HTTP/3 best-effort
    critical: false,
  },
];

async function runHandler(job: Job<ServerVerifyPayload>): Promise<void> {
  const { serverId } = job.data;
  const phase = "verify" as const;
  const claimed = await claimPhaseRunning(serverId, phase);
  if (!claimed) {
    return;
  }

  const log = new JobLogger(job.id, "server.verify", "server", serverId);
  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    await log.info("Verify phase started");
    const conn = await connectToServer(serverId);
    client = conn.client;

    const failures: string[] = [];
    for (const check of CHECKS) {
      const result = await execCommand(client, check.cmd, 10_000);
      const ok = check.expect(result.stdout, result.exitCode);
      const detail = `exit=${result.exitCode}, out="${result.stdout.trim().slice(0, 100)}"`;
      if (ok) {
        await log.info(`✓ ${check.name}`);
      } else if (check.critical) {
        await log.error(`✗ ${check.name} (critical) — ${detail}`, {
          stdout: result.stdout,
          stderr: result.stderr,
        });
        failures.push(`${check.name}: ${detail}`);
      } else {
        await log.warn(`✗ ${check.name} (non-critical) — ${detail}`, {
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} critical check(s) failed:\n${failures.join("\n")}`
      );
    }

    await log.info(
      "Verify phase complete — server is ready (activate it manually from Orbit)"
    );
    await completePhase(serverId, phase); // → setupPhase=ready (status stays inactive; operator activates)

    audit({
      action: "server.setup.verify_complete",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server ${conn.server.hostname} verified — ready, awaiting manual activation`,
      source: "worker",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server-verify] failed for ${serverId}:`, err);
    await log.error(`Verify phase failed: ${msg}`);
    await failPhase(serverId, phase, msg);
    audit({
      action: "server.setup.verify_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server verify phase failed: ${msg.slice(0, 200)}`,
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

export async function handleServerVerify(
  jobs: Job<ServerVerifyPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
