/**
 * Server-side version probes — what's actually installed on a bare-metal
 * host right now, compared against what `config/platform.ts` says we
 * pinned. Used by both the CLI script (`pnpm check:server-versions`)
 * and the Orbit health-check API endpoint, so the two surfaces always
 * report the same thing.
 *
 * Adds the runtime "is reality matching code?" check that the weekly
 * Phase A scanner can't do — Phase A only knows about the constants;
 * this knows about the host. The pair gives full coverage for our
 * pinned components.
 */
import type { Client } from "ssh2";
import {
  CADDY_VERSION,
  FIRECRACKER_VERSION,
  KERNEL_VERSION,
  RESTIC_VERSION,
} from "@/config/platform";
import { compareVersions, normalizeVersion } from "@/lib/security/semver";
import { execCommand } from "@/lib/ssh/exec";

export type VersionStatus =
  | "match" // installed == pinned
  | "behind" // installed < pinned (server needs an upgrade)
  | "ahead" // installed > pinned (constant in code is stale)
  | "drift" // both present but unparseable / not orderable
  | "missing" // not installed or probe failed
  | "info"; // no pin to compare against (informational only)

export type VersionRow = {
  name: string;
  installed: string | null;
  pinned: string | null;
  status: VersionStatus;
  /** Where the pin lives, so the operator knows what to edit. Null for info rows. */
  pinnedAt: string | null;
};

/**
 * Strip a leading "v" so display + comparison are consistent. Both Caddy
 * and Firecracker print a leading-v version (e.g. `v2.x.y`), but our pinned
 * platform constants are inconsistent — `FIRECRACKER_VERSION` keeps the
 * `v` prefix, `CADDY_VERSION` does not. Normalizing on the output side
 * means the UI always shows a clean numeric version regardless of source.
 */
function stripV(v: string | null): string | null {
  return v ? v.replace(/^v/, "") : v;
}

const PROBES: Array<{
  name: string;
  command: string;
  parse: (stdout: string) => string | null;
  pinned: string | null;
  pinnedAt: string | null;
}> = [
  {
    // Host kernel = whatever the distro shipped (e.g. Ubuntu 24.04's
    // 6.8.0-NN-generic). Informational only — KERNEL_VERSION pins the
    // GUEST kernel built for Cubes, not the host. The two are independent.
    name: "Host kernel",
    command: "uname -r",
    parse: (s) => s.trim() || null,
    pinned: null,
    pinnedAt: null,
  },
  {
    // Guest kernel = the vmlinux Firecracker loads into every Cube. Built
    // from source by `pnpm build:images` and SFTPed to /var/lib/krova/images
    // by the pull-images / update-images jobs. THIS is what KERNEL_VERSION
    // pins. "Behind" here means: rebuild images and click Update Images on
    // the server detail page.
    //
    // Why grep -a instead of `strings`: the install setup phase doesn't
    // pull in `binutils` (which provides `strings`), so on a freshly-set-up
    // server the strings binary is missing and the probe returns empty.
    // `grep -a` (treat binary as text) is in coreutils and always present;
    // the kernel version banner is a plain-ASCII string embedded in the
    // ELF, so grep -ao finds it on any vmlinux Firecracker can boot.
    name: "Guest kernel (vmlinux)",
    command:
      "grep -aoE 'Linux version [0-9.]+' /var/lib/krova/images/vmlinux 2>/dev/null | head -1 | awk '{print $3}'",
    parse: (s) => stripV(s.trim()) || null,
    pinned: KERNEL_VERSION,
    pinnedAt: "config/platform.ts → KERNEL_VERSION",
  },
  {
    name: "Firecracker",
    command: "/usr/local/bin/firecracker --version 2>&1 | head -1",
    parse: (s) => {
      const t = s.trim();
      if (!t) {
        return null;
      }
      const m = t.match(/v?[\d.]+/);
      return m ? stripV(m[0]) : null;
    },
    pinned: stripV(FIRECRACKER_VERSION),
    pinnedAt: "config/platform.ts → FIRECRACKER_VERSION",
  },
  {
    name: "Caddy",
    command: "caddy version 2>&1 | head -1",
    parse: (s) => {
      const t = s.trim();
      if (!t) {
        return null;
      }
      // Caddy prints "v2.11.2 h1:abc..."
      const m = t.match(/v?[\d.]+/);
      return m ? stripV(m[0]) : null;
    },
    pinned: stripV(CADDY_VERSION),
    pinnedAt: "config/platform.ts → CADDY_VERSION",
  },
  {
    // restic: per-cube content-addressed snapshot tool. Pinned in
    // config/platform.ts and installed by the `restic` step in
    // server-install.ts (or `pnpm install:restic` for retrofit). Drift
    // here means snapshot/restore jobs may fail or behave inconsistently.
    name: "restic",
    command: "restic version 2>&1 | head -1",
    parse: (s) => {
      const t = s.trim();
      if (!t) {
        return null;
      }
      // restic prints "restic 0.18.1 compiled with go..."
      const m = t.match(/restic\s+v?[\d.]+/i);
      if (!m) {
        return null;
      }
      return stripV(m[0].replace(/^restic\s+/i, ""));
    },
    pinned: stripV(RESTIC_VERSION),
    pinnedAt: "config/platform.ts → RESTIC_VERSION",
  },
];

function classify(
  installed: string | null,
  pinned: string | null
): VersionStatus {
  if (pinned === null) {
    return "info";
  }
  if (installed === null) {
    return "missing";
  }
  const i = normalizeVersion(installed);
  const p = normalizeVersion(pinned);
  if (!i || !p) {
    return installed === pinned ? "match" : "drift";
  }
  const cmp = compareVersions(i, p);
  if (cmp === 0) {
    return "match";
  }
  if (cmp < 0) {
    return "behind";
  }
  return "ahead";
}

/**
 * Run all version probes against a connected SSH client and return the
 * comparison rows. Each probe runs with a 10s timeout and falls back to
 * `installed: null` on failure rather than throwing — so a failed
 * Caddy probe never masks the kernel result.
 */
export async function probeServerVersions(
  client: Client
): Promise<VersionRow[]> {
  const rows: VersionRow[] = [];
  for (const probe of PROBES) {
    let installed: string | null = null;
    try {
      const r = await execCommand(client, probe.command, 10_000);
      if (r.exitCode === 0) {
        installed = probe.parse(r.stdout);
      }
    } catch {
      installed = null;
    }
    rows.push({
      name: probe.name,
      installed,
      pinned: probe.pinned,
      status: classify(installed, probe.pinned),
      pinnedAt: probe.pinnedAt,
    });
  }
  return rows;
}

/**
 * Optional broader probe — captures versions of select distro packages
 * (curl, openssh-server, sudo, openssl, iptables, nftables) for diagnostic
 * use. Branches on apt-vs-dnf via /etc/os-release. Returns informational
 * rows only — no pin comparisons since these are distro-managed.
 */
export async function probeDistroPackages(
  client: Client
): Promise<VersionRow[]> {
  const distroFamily = await detectDistroFamily(client);
  if (distroFamily === "unknown") {
    return [];
  }

  const debianPackages = [
    "openssh-server",
    "openssl",
    "curl",
    "sudo",
    "iptables",
    "nftables",
    "iptables-persistent",
  ];
  const rhelPackages = [
    "openssh-server",
    "openssl",
    "curl",
    "sudo",
    "iptables",
    "nftables",
    "iptables-services",
  ];
  const list = distroFamily === "debian" ? debianPackages : rhelPackages;

  const rows: VersionRow[] = [];
  for (const pkg of list) {
    const cmd =
      distroFamily === "debian"
        ? `dpkg-query -W -f='\${Version}' ${pkg} 2>/dev/null || echo MISSING`
        : `rpm -q --qf '%{VERSION}-%{RELEASE}' ${pkg} 2>/dev/null || echo MISSING`;
    let installed: string | null = null;
    try {
      const r = await execCommand(client, cmd, 10_000);
      const t = r.stdout.trim();
      installed =
        !t || t === "MISSING" || t.startsWith("not installed") ? null : t;
    } catch {
      installed = null;
    }
    rows.push({
      name: `pkg: ${pkg}`,
      installed,
      pinned: null,
      status: installed === null ? "missing" : "info",
      pinnedAt: null,
    });
  }
  return rows;
}

async function detectDistroFamily(
  client: Client
): Promise<"debian" | "rhel" | "unknown"> {
  try {
    const r = await execCommand(
      client,
      "cat /etc/os-release 2>/dev/null | grep -E '^(ID|ID_LIKE)='",
      5000
    );
    const text = r.stdout;
    if (/(debian|ubuntu)/i.test(text)) {
      return "debian";
    }
    if (/(rhel|fedora|almalinux|rocky|centos)/i.test(text)) {
      return "rhel";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
