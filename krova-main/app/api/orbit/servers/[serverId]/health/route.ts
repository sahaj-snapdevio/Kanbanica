import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  probeServerVersions,
  type VersionRow,
} from "@/lib/security/server-versions";
import { classifyHostIptablesBackend } from "@/lib/server/host-iptables-backend";
import { createSshConnection, decryptPrivateKey, execCommand } from "@/lib/ssh";
import { jailRoot } from "@/lib/ssh/jailer";

interface HealthCheck {
  detail: string;
  name: string;
  status: "ok" | "warn" | "fail";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    await requireAdmin(request);
    const { serverId } = await params;

    const server = await db.query.servers.findFirst({
      where: eq(schema.servers.id, serverId),
    });
    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    const sshKey = await db.query.sshKeys.findFirst({
      where: eq(schema.sshKeys.id, server.sshKeyId),
    });
    if (!sshKey) {
      return Response.json({ error: "SSH key not found" }, { status: 500 });
    }

    const checks: HealthCheck[] = [];
    let versions: VersionRow[] = [];

    // Try SSH connection
    let client;
    try {
      const decryptedKey = decryptPrivateKey(
        sshKey.encryptedPrivateKey,
        env.APP_SECRET
      );
      client = await createSshConnection(
        server.publicIp,
        server.sshPort,
        decryptedKey
      );
      checks.push({
        name: "SSH Connection",
        status: "ok",
        detail: `Connected to ${server.publicIp}:${server.sshPort}`,
      });
    } catch (err) {
      checks.push({
        name: "SSH Connection",
        status: "fail",
        detail: err instanceof Error ? err.message : "Connection failed",
      });
      return Response.json({ checks, versions });
    }

    try {
      // Firecracker binary
      const fc = await execCommand(
        client,
        "firecracker --version 2>&1 | head -1",
        5000
      );
      checks.push(
        fc.exitCode === 0
          ? { name: "Firecracker", status: "ok", detail: fc.stdout.trim() }
          : { name: "Firecracker", status: "fail", detail: "Not installed" }
      );

      // /dev/kvm
      const kvm = await execCommand(
        client,
        "test -r /dev/kvm && test -w /dev/kvm && echo ok || echo fail",
        5000
      );
      checks.push(
        kvm.stdout.trim() === "ok"
          ? { name: "/dev/kvm", status: "ok", detail: "Accessible" }
          : { name: "/dev/kvm", status: "fail", detail: "Not accessible" }
      );

      // Bridge br0
      const br = await execCommand(
        client,
        "ip link show br0 2>/dev/null && echo ok || echo fail",
        5000
      );
      checks.push(
        br.stdout.includes("ok")
          ? { name: "Bridge br0", status: "ok", detail: "Up" }
          : { name: "Bridge br0", status: "fail", detail: "Not found" }
      );

      // Caddy
      const caddy = await execCommand(
        client,
        "systemctl is-active caddy 2>/dev/null",
        5000
      );
      checks.push(
        caddy.stdout.trim() === "active"
          ? { name: "Caddy", status: "ok", detail: "Running" }
          : {
              name: "Caddy",
              status: "fail",
              detail: caddy.stdout.trim() || "Not running",
            }
      );

      // vsock module
      const vsock = await execCommand(
        client,
        "lsmod | grep -q vhost_vsock && echo ok || echo fail",
        5000
      );
      checks.push(
        vsock.stdout.trim() === "ok"
          ? { name: "vhost_vsock", status: "ok", detail: "Loaded" }
          : { name: "vhost_vsock", status: "warn", detail: "Not loaded" }
      );

      // krova-vsock-exec
      const vsockExec = await execCommand(
        client,
        "command -v krova-vsock-exec >/dev/null 2>&1 && echo ok || echo fail",
        5000
      );
      checks.push(
        vsockExec.stdout.trim() === "ok"
          ? { name: "krova-vsock-exec", status: "ok", detail: "Installed" }
          : { name: "krova-vsock-exec", status: "fail", detail: "Not found" }
      );

      // Kernel image
      const kernel = await execCommand(
        client,
        "test -s /var/lib/krova/images/vmlinux && echo ok || echo fail",
        5000
      );
      checks.push(
        kernel.stdout.trim() === "ok"
          ? { name: "Kernel (vmlinux)", status: "ok", detail: "Present" }
          : { name: "Kernel (vmlinux)", status: "fail", detail: "Missing" }
      );

      // Rootfs images
      const images = await execCommand(
        client,
        "ls -1 /var/lib/krova/images/*.ext4 2>/dev/null | wc -l",
        5000
      );
      const imageCount = Number.parseInt(images.stdout.trim(), 10) || 0;
      checks.push(
        imageCount > 0
          ? {
              name: "Rootfs images",
              status: "ok",
              detail: `${imageCount} image(s) found`,
            }
          : {
              name: "Rootfs images",
              status: "fail",
              detail: "No .ext4 images found",
            }
      );

      // Disk space
      const disk = await execCommand(
        client,
        "df -BG --output=avail /var/lib/krova 2>/dev/null | tail -1 | tr -d ' G'",
        5000
      );
      const availGb = Number.parseInt(disk.stdout.trim(), 10);
      if (!isNaN(availGb)) {
        checks.push(
          availGb > 20
            ? {
                name: "Disk space",
                status: "ok",
                detail: `${availGb} GB available`,
              }
            : availGb > 5
              ? {
                  name: "Disk space",
                  status: "warn",
                  detail: `${availGb} GB available (low)`,
                }
              : {
                  name: "Disk space",
                  status: "fail",
                  detail: `${availGb} GB available (critical)`,
                }
        );
      }

      // Running cubes. Mode-agnostic diagnostic count: this is a filesystem
      // glob with no per-cube DB context, so it may encounter both bare cubes
      // (/var/lib/krova/cubes/<id>/firecracker.pid) and jailed cubes
      // (<jailRoot>/firecracker.pid). Probe BOTH locations (Pattern C). With
      // JAILER_ENABLED false no jailed pid files exist, so the jailed glob
      // matches nothing and the count is byte-identical to the legacy behavior.
      const cubes = await execCommand(
        client,
        `ls -1d /var/lib/krova/cubes/*/firecracker.pid ${jailRoot("*")}/firecracker.pid 2>/dev/null | wc -l`,
        5000
      );
      const cubeCount = Number.parseInt(cubes.stdout.trim(), 10) || 0;
      checks.push({
        name: "Running cubes",
        status: "ok",
        detail: `${cubeCount} cube(s) on disk`,
      });

      // Timezone
      const tz = await execCommand(
        client,
        "timedatectl show --property=Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null",
        5000
      );
      const timezone = tz.stdout.trim();
      checks.push(
        timezone === "UTC"
          ? { name: "Timezone", status: "ok", detail: "UTC" }
          : { name: "Timezone", status: "warn", detail: timezone || "Unknown" }
      );

      // KSM
      const ksm = await execCommand(
        client,
        "cat /sys/kernel/mm/ksm/run 2>/dev/null || echo 0",
        5000
      );
      checks.push(
        ksm.stdout.trim() === "1"
          ? { name: "KSM", status: "ok", detail: "Enabled" }
          : { name: "KSM", status: "warn", detail: "Not enabled" }
      );

      // Swap
      const swap = await execCommand(
        client,
        "swapon --show=SIZE --noheadings --raw 2>/dev/null | head -1",
        5000
      );
      const swapSize = swap.stdout.trim();
      checks.push(
        swapSize
          ? { name: "Swap", status: "ok", detail: swapSize }
          : { name: "Swap", status: "warn", detail: "Not active" }
      );

      // Overcommit
      const oc = await execCommand(
        client,
        "sysctl -n vm.overcommit_memory 2>/dev/null",
        5000
      );
      checks.push(
        oc.stdout.trim() === "1"
          ? { name: "Memory overcommit", status: "ok", detail: "Enabled" }
          : {
              name: "Memory overcommit",
              status: "warn",
              detail: `vm.overcommit_memory=${oc.stdout.trim()}`,
            }
      );

      // Swappiness
      const sw = await execCommand(
        client,
        "sysctl -n vm.swappiness 2>/dev/null",
        5000
      );
      checks.push({
        name: "Swappiness",
        status: "ok",
        detail: sw.stdout.trim(),
      });

      // ── Post-storage-migration / reboot-recovery / restic audit checks ──
      // Every probe below corresponds to something installed during the
      // `install` setup phase. A `fail` here means an operator-triggered
      // admin action (or a customer-facing flow) will silently break.

      // krova-boot-notify systemd oneshot — fast reboot-recovery trigger.
      // If missing/disabled, cube auto-restart falls back to the <=2-min
      // cube.state-sync boot-id probe, which is operationally invisible.
      const bootNotify = await execCommand(
        client,
        "if systemctl is-enabled krova-boot-notify.service >/dev/null 2>&1 && test -f /etc/krova/boot-notify.env; then echo ok; else echo fail; fi",
        5000
      );
      checks.push(
        bootNotify.stdout.trim() === "ok"
          ? {
              name: "krova-boot-notify",
              status: "ok",
              detail: "Enabled (fast reboot recovery)",
            }
          : {
              name: "krova-boot-notify",
              status: "fail",
              detail: "Service or env file missing",
            }
      );

      // Caddy --resume systemd override — without it, every Caddy restart
      // reverts to the empty Caddyfile and silently drops every Cube domain
      // mapping the admin API has added.
      const caddyResume = await execCommand(
        client,
        "test -f /etc/systemd/system/caddy.service.d/krova-resume.conf && grep -q -- '--resume' /etc/systemd/system/caddy.service.d/krova-resume.conf && echo ok || echo fail",
        5000
      );
      checks.push(
        caddyResume.stdout.trim() === "ok"
          ? {
              name: "Caddy --resume override",
              status: "ok",
              detail: "Installed",
            }
          : {
              name: "Caddy --resume override",
              status: "fail",
              detail: "Missing — restart would drop all customer routes",
            }
      );

      // Caddy admin API reachability — systemctl can report active while the
      // admin API is unreachable (e.g. config load loop), which breaks every
      // domain.add / refresh-caddy / update-caddy job.
      const caddyAdmin = await execCommand(
        client,
        "curl -sf -o /dev/null -m 5 http://localhost:2019/config/ && echo ok || echo fail",
        10_000
      );
      checks.push(
        caddyAdmin.stdout.trim() === "ok"
          ? {
              name: "Caddy admin API",
              status: "ok",
              detail: "localhost:2019 reachable",
            }
          : {
              name: "Caddy admin API",
              status: "fail",
              detail: "localhost:2019 not responding",
            }
      );

      // Cloudflare Origin CA cert on disk — required to serve customer
      // domains over the proxied origin hostname. Install phase makes this
      // mandatory; this re-verifies the files survive (caddy package
      // upgrades have been known to chown /var/lib/caddy).
      const originCert = await execCommand(
        client,
        "test -f /var/lib/caddy/origin-ca/origin.crt && test -f /var/lib/caddy/origin-ca/origin.key && echo ok || echo fail",
        5000
      );
      checks.push(
        originCert.stdout.trim() === "ok"
          ? {
              name: "Cloudflare Origin CA cert",
              status: "ok",
              detail: "Installed",
            }
          : {
              name: "Cloudflare Origin CA cert",
              status: "fail",
              detail: "Missing — customer domains break",
            }
      );

      // rclone — required for every snapshot/backup transfer to S3.
      // Presence-only (no pin; installed via upstream installer).
      const rclone = await execCommand(
        client,
        "rclone version 2>/dev/null | head -1",
        5000
      );
      checks.push(
        rclone.exitCode === 0 && rclone.stdout.trim()
          ? { name: "rclone", status: "ok", detail: rclone.stdout.trim() }
          : { name: "rclone", status: "fail", detail: "Not installed" }
      );

      // bzip2 / bunzip2 — prerequisite for the restic install path.
      // Restic install will self-heal if missing, so warn rather than fail.
      const bunzip = await execCommand(
        client,
        "command -v bunzip2 >/dev/null 2>&1 && echo ok || echo fail",
        5000
      );
      checks.push(
        bunzip.stdout.trim() === "ok"
          ? { name: "bunzip2", status: "ok", detail: "Installed" }
          : {
              name: "bunzip2",
              status: "warn",
              detail: "Missing — restic retrofit will install on-demand",
            }
      );

      // KSM persistence — the live KSM check above inspects /sys/.../ksm/run.
      // Without the tmpfiles.d entry, KSM resets to 0 on reboot and the dense
      // packing win is lost until the next install step is re-run.
      const ksmPersist = await execCommand(
        client,
        "test -f /etc/tmpfiles.d/krova-ksm.conf && echo ok || echo fail",
        5000
      );
      checks.push(
        ksmPersist.stdout.trim() === "ok"
          ? {
              name: "KSM persistence",
              status: "ok",
              detail: "tmpfiles.d entry present",
            }
          : {
              name: "KSM persistence",
              status: "warn",
              detail: "Missing — KSM resets on reboot",
            }
      );

      // iptables backend — the HOST deliberately uses the iptables-LEGACY
      // backend for the cube-DNAT + bridge-firewall path: applyHostNetworking
      // (the `network` phase) runs `update-alternatives --set iptables
      // iptables-legacy` so netfilter-persistent saves those rules and they
      // survive reboot (lib/server/cube-network-host.ts + lib/ssh/network.ts).
      // So on Debian/Ubuntu the default MUST be legacy; on RHEL (no -legacy
      // alternative) nft is correct. This is the HOST backend — NOT Rule 37,
      // which governs the cube ROOTFS (guest) using nft. Decision logic is the
      // single source of truth in classifyHostIptablesBackend (unit-tested).
      const iptBackend = await execCommand(
        client,
        "command -v iptables-legacy >/dev/null 2>&1 && echo legacy-available || echo no-legacy; iptables --version 2>&1 | head -1",
        5000
      );
      const iptLines = iptBackend.stdout
        .trim()
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const legacyAvailable = iptLines.some((l) => l === "legacy-available");
      const iptVersion = iptLines.find((l) => /iptables\s+v/i.test(l)) ?? "";
      checks.push({
        name: "iptables backend",
        ...classifyHostIptablesBackend(iptVersion, legacyAvailable),
      });

      // iptables rules persistence — Debian uses netfilter-persistent
      // (provided by iptables-persistent), RHEL uses the `iptables` service
      // from iptables-services. Without this, every customer TCP-mapping
      // and whitelist rule is wiped on reboot.
      const iptPersist = await execCommand(
        client,
        "if command -v apt-get >/dev/null 2>&1; then systemctl is-enabled netfilter-persistent 2>/dev/null || echo missing; elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then systemctl is-enabled iptables 2>/dev/null || echo missing; else echo unknown; fi",
        5000
      );
      const iptPersistOut = iptPersist.stdout.trim();
      checks.push(
        iptPersistOut === "enabled" || iptPersistOut === "static"
          ? {
              name: "iptables persistence",
              status: "ok",
              detail: `Service ${iptPersistOut}`,
            }
          : {
              name: "iptables persistence",
              status: "fail",
              detail:
                iptPersistOut === "missing"
                  ? "Service not installed — TCP-mapping rules lost on reboot"
                  : `Service ${iptPersistOut || "unknown"}`,
            }
      );

      // Pinned-component versions: kernel, Firecracker, Caddy, restic.
      // Compares what the host actually reports against what
      // config/platform.ts pins. Same probe set as
      // `pnpm check:server-versions` so the two surfaces agree.
      versions = await probeServerVersions(client);
    } finally {
      client.end();
    }

    return Response.json({ checks, versions });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("Server health check error:", error);
    return Response.json({ error: "Health check failed" }, { status: 500 });
  }
}
