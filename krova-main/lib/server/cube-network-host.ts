/**
 * Single source of truth for a host's cube networking: br0 dual-stack address,
 * IPv4+IPv6 forwarding (in a DEDICATED sysctl.d file — never 99-krova.conf, C2),
 * NAT66 + egress-only FORWARD, a stateful default-deny INPUT on BOTH families,
 * and persistence. Called by the `network` setup phase (new servers) and the
 * Phase-6 migration (existing servers). Idempotent.
 *
 * See docs/superpowers/specs/2026-05-30-cube-ipv6-design.md (Host networking §,
 * Host firewall posture §) for the full command rationale.
 */
import type { Client } from "ssh2";
import {
  CONNTRACK_UDP_STREAM_TIMEOUT_SECONDS,
  CONNTRACK_UDP_TIMEOUT_SECONDS,
} from "@/config/platform";
import {
  cubeIpv4Gateway,
  cubeIpv4Subnet,
  cubeIpv6Gateway,
  cubeIpv6Subnet,
} from "@/lib/server/cube-network";
import { execCommand } from "@/lib/ssh/exec";

const FORWARD_SYSCTL = "/etc/sysctl.d/98-krova-forwarding.conf";
const CONNTRACK_SYSCTL = "/etc/sysctl.d/98-krova-conntrack.conf";

/**
 * Pure: raise host NAT conntrack UDP idle timeouts so an idle UDP overlay (a
 * WireGuard mesh peer without PersistentKeepalive) keeps its MASQUERADE
 * conntrack entry instead of having return traffic dropped after the ~120s
 * kernel default — which silently stalls the tunnel until a restart re-handshakes
 * (2026-06-02 audit W2). Loads nf_conntrack at boot (modules-load.d) so the
 * sysctl.d keys exist when applied, persists the timeouts, and applies them now.
 * Idempotent + active-host-safe (a sysctl change never drops live connections).
 * Exported so both applyHostNetworking (new servers) and the
 * `pnpm install:network-tuning` retrofit (existing servers) emit the SAME bytes.
 */
export function conntrackTuneCommand(): string {
  const t = CONNTRACK_UDP_TIMEOUT_SECONDS;
  const s = CONNTRACK_UDP_STREAM_TIMEOUT_SECONDS;
  return (
    "modprobe nf_conntrack 2>/dev/null || true; " +
    "grep -qxs nf_conntrack /etc/modules-load.d/krova-conntrack.conf 2>/dev/null || " +
    "echo nf_conntrack > /etc/modules-load.d/krova-conntrack.conf; " +
    `printf 'net.netfilter.nf_conntrack_udp_timeout=%s\\nnet.netfilter.nf_conntrack_udp_timeout_stream=%s\\n' ${t} ${s} > ${CONNTRACK_SYSCTL}; ` +
    `sysctl -w net.netfilter.nf_conntrack_udp_timeout=${t} net.netfilter.nf_conntrack_udp_timeout_stream=${s} >/dev/null 2>&1 || true`
  );
}

/**
 * Pure: clamp the MSS of forwarded TCP SYN/SYN-ACK to the path MTU so in-cube
 * overlays and port-mapped TCP services don't black-hole large segments when
 * PMTUD is filtered on the path (2026-06-02 audit W3). Idempotent (-C then -A).
 *
 * MANGLE table, NOT filter — this is load-bearing: the filter FORWARD chain's
 * egress rule (`-i br0 ! -o br0 -j ACCEPT`) is a TERMINATING ACCEPT, so a clamp
 * appended to filter FORWARD is never reached for cube-outbound traffic. mangle
 * FORWARD is traversed BEFORE filter FORWARD, so the clamp always fires. No
 * interface match → clamps forwarded handshakes in BOTH directions (the host
 * only forwards cube traffic, so no collateral). The clamp REDUCES the advertised
 * MSS (never blocks) and is TCP-only, so DNS/ICMP/WireGuard-UDP are untouched.
 * NOTE: this fixes TCP the host can see; the encrypted WireGuard *UDP* tunnel's
 * inner MTU is set in-guest (wg MTU = eth0 MTU − 80), not here. `bin` is the
 * resolved iptables/ip6tables binary.
 */
export function mssClampCommand(bin: string): string {
  const spec =
    "FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu";
  return `${bin} -t mangle -C ${spec} 2>/dev/null || ${bin} -t mangle -A ${spec}`;
}

/**
 * Pure: the bash that PRINTS the forwarding sysctl lines to stdout (the caller
 * redirects them into FORWARD_SYSCTL). Exported for the unit test, since the
 * WAN-iface derivation only resolves at runtime on the host.
 *
 * WAN detection: every distinct iface carrying a default route — IPv6 OR IPv4 —
 * gets `accept_ra=2`; br0 gets `accept_ra=0`. Including the (always-present)
 * IPv4 default's iface is the fix for the "host silently lands in a v6 NONE
 * state" root cause: with `forwarding=1` the kernel IGNORES Router
 * Advertisements unless `accept_ra=2` is set on the WAN. The prior code derived
 * the WAN list from `ip -6 route show default` ALONE — so a host with no v6
 * default route at setup time (RA not yet processed) got an EMPTY list, NO
 * `accept_ra=2` line, and `forwarding=1` then made it ignore every future RA →
 * a permanent v6 blackhole for every cube on that host. Deriving the WAN from
 * the v4 default (which always exists on a reachable host) guarantees the
 * `accept_ra=2` line is emitted, so a forwarding host WILL honor RAs and learn
 * its v6 default. Harmless on a genuinely v4-only host — no RAs arrive, so no v6
 * default is ever learned. NEW-SETUP ONLY: applyHostNetworking runs in the
 * `network` setup phase, never against an active host with running cubes.
 */
export function buildForwardingSysctlScript(): string {
  return (
    "WANS=$( { ip -6 route show default 2>/dev/null; ip -4 route show default 2>/dev/null; } " +
    // POSIX awk (not `grep -oP 'dev \K...'`) extracts the iface after "dev" on
    // every default-route line. Portable across GNU + BSD awk, so the unit test
    // that proves this derivation runs on every dev machine, not only GNU-grep hosts.
    "| awk '{for(i=1;i<=NF;i++)if($i==\"dev\")print $(i+1)}' | sort -u ); " +
    "{ echo 'net.ipv4.ip_forward=1'; " +
    "echo 'net.ipv6.conf.all.forwarding=1'; " +
    "echo 'net.ipv6.conf.br0.accept_ra=0'; " +
    'for w in $WANS; do echo "net.ipv6.conf.$w.accept_ra=2"; done; }'
  );
}

/**
 * Pure: persist BOTH iptables families to disk so the rules survive reboot
 * (Debian netfilter-persistent / rules.v{4,6}, RHEL /etc/sysconfig + service).
 * Extracted so the `pnpm install:network-tuning` retrofit persists the MSS-clamp
 * + any other added rules with the EXACT command applyHostNetworking uses (Rule 14).
 */
export function persistIptablesCommand(): string {
  return [
    "if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save;",
    "elif [ -d /etc/iptables ]; then mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4 && ip6tables-save > /etc/iptables/rules.v6;",
    "elif [ -d /etc/sysconfig ]; then iptables-save > /etc/sysconfig/iptables && ip6tables-save > /etc/sysconfig/ip6tables && systemctl enable iptables ip6tables >/dev/null 2>&1 || true;",
    `else echo 'unsupported distro for iptables persistence' >&2; exit 1; fi`,
  ].join(" ");
}

/**
 * Resolve the iptables/ip6tables binaries on-host, preferring the *-legacy
 * backend (H1) — exactly like lib/ssh/network.ts getIptables. The cube-DNAT
 * path (network.ts) already prefers iptables-legacy on Ubuntu 24.04+ where
 * nftables is the default; v4 + v6 here MUST share that backend or the v6
 * rules land in a different table and don't persist alongside the v4 ones.
 * Falls back to the plain binary when no -legacy variant exists.
 */
export async function resolveBins(
  client: Client
): Promise<{ ipt: string; ip6t: string }> {
  const v4 = await execCommand(
    client,
    "command -v iptables-legacy 2>/dev/null || echo iptables"
  );
  const v6 = await execCommand(
    client,
    "command -v ip6tables-legacy 2>/dev/null || echo ip6tables"
  );
  return {
    ipt: v4.stdout.trim() || "iptables",
    ip6t: v6.stdout.trim() || "ip6tables",
  };
}

export interface ApplyHostNetworkingOpts {
  /** true on the existing-fleet retrofit → install the cancel-on-success INPUT rollback net. */
  retrofit?: boolean;
}

export async function applyHostNetworking(
  client: Client,
  S: number,
  opts: ApplyHostNetworkingOpts = {}
): Promise<void> {
  const v4subnet = cubeIpv4Subnet(S); // 198.18.0.0/15 → S-th /24
  const v4gw = cubeIpv4Gateway(S); // .1 of that /24
  const v6subnet = cubeIpv6Subnet(S); // fd00:c0be:<hex>::/64
  const v6gw = cubeIpv6Gateway(S); // fd00:c0be:<hex>::1
  const { ipt, ip6t } = await resolveBins(client);

  const run = async (label: string, cmd: string, timeoutMs = 15_000) => {
    const r = await execCommand(client, cmd, timeoutMs);
    if (r.exitCode !== 0) {
      throw new Error(
        `applyHostNetworking[${label}] exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(-400)}`
      );
    }
  };

  // 0. Align the host's iptables/ip6tables ALTERNATIVES to the SAME backend we
  //    add rules with (legacy). On Ubuntu 24.04 the distro default is nft, but
  //    our rules + the cube-DNAT path use the *-legacy binaries. `netfilter-
  //    persistent save` (and the boot-time restore) use whatever the alternative
  //    points at — so with the default left on nft, the legacy rules are NOT
  //    captured into /etc/iptables/rules.v{4,6} and VANISH on reboot. The
  //    on-host E2E verify phase caught exactly this: post-reboot the IPv6
  //    NAT MASQUERADE + INPUT default-deny were gone. `iptables` and `ip6tables`
  //    are SEPARATE alternative groups (setting one does NOT switch the other —
  //    that asymmetry is why only v6 broke), so set BOTH. Best-effort +
  //    Debian-only (RHEL has no update-alternatives entry for these); the
  //    alternative state lives in /var/lib/dpkg/alternatives and survives reboot.
  if (ipt.endsWith("-legacy") || ip6t.endsWith("-legacy")) {
    await execCommand(
      client,
      "if command -v update-alternatives >/dev/null 2>&1; then " +
        "update-alternatives --set iptables /usr/sbin/iptables-legacy >/dev/null 2>&1 || true; " +
        "update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy >/dev/null 2>&1 || true; " +
        "fi",
      15_000
    );
  }

  // 1. Forwarding sysctls in a DEDICATED file (C2 — never touch 99-krova.conf).
  //    WAN iface detection (H4): every iface on a default route (v6 OR v4) gets
  //    accept_ra=2; br0 gets accept_ra=0 (L6). Including the always-present v4
  //    WAN guarantees accept_ra=2 is emitted even when no v6 default exists yet,
  //    so a forwarding host can LEARN its v6 default from RAs — see
  //    buildForwardingSysctlScript for the full root-cause rationale.
  await run(
    "sysctl",
    `${buildForwardingSysctlScript()} > ${FORWARD_SYSCTL} && sysctl --system >/dev/null`
  );

  // 2. br0 dual-stack addresses — each guarded INDEPENDENTLY (M9), not behind
  //    `ip link show br0`. (The bridge itself is created by the existing STEP /
  //    legacy path; here we only ensure addresses.)
  await run(
    "br0-v4",
    `ip addr show dev br0 | grep -qF '${v4gw}/24' || ip addr add ${v4gw}/24 dev br0`
  );
  await run(
    "br0-v6",
    `ip -6 addr show dev br0 | grep -qF '${v6gw}/64' || ip -6 addr add ${v6gw}/64 dev br0`
  );

  // 3. NAT66 + IPv4 MASQUERADE (idempotent via -C).
  await run(
    "nat-v4",
    `${ipt} -t nat -C POSTROUTING -s ${v4subnet} ! -o br0 -j MASQUERADE 2>/dev/null || ${ipt} -t nat -A POSTROUTING -s ${v4subnet} ! -o br0 -j MASQUERADE`
  );
  await run(
    "nat-v6",
    `${ip6t} -t nat -C POSTROUTING -s ${v6subnet} ! -o br0 -j MASQUERADE 2>/dev/null || ${ip6t} -t nat -A POSTROUTING -s ${v6subnet} ! -o br0 -j MASQUERADE`
  );

  // 4. Egress-only FORWARD for BOTH families (NOT a blanket -o br0 ACCEPT,
  //    which would open unsolicited inbound v6 to cube ports).
  for (const [fam, bin] of [
    ["v4", ipt],
    ["v6", ip6t],
  ] as const) {
    await run(
      `fwd-out-${fam}`,
      `${bin} -C FORWARD -i br0 ! -o br0 -j ACCEPT 2>/dev/null || ${bin} -A FORWARD -i br0 ! -o br0 -j ACCEPT`
    );
    await run(
      `fwd-ret-${fam}`,
      `${bin} -C FORWARD -o br0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || ${bin} -A FORWARD -o br0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`
    );
  }

  // 4b. Raise conntrack UDP timeouts so an idle UDP overlay (a WireGuard mesh
  //     peer without PersistentKeepalive) keeps its NAT mapping past the ~120s
  //     kernel default instead of stalling until a restart (audit W2). nf_conntrack
  //     was just loaded by the MASQUERADE rules above; this also loads it at boot.
  await run("conntrack-tune", conntrackTuneCommand());

  // 4c. Clamp forwarded-TCP MSS to PMTU so in-cube overlays + port-mapped TCP
  //     services don't black-hole large segments when PMTUD is filtered (audit
  //     W3). Goes in the MANGLE FORWARD chain (traversed BEFORE filter FORWARD,
  //     whose egress ACCEPT would otherwise short-circuit it). iptables-save
  //     persists all tables incl. mangle, so step 6 below covers it. Both families.
  for (const bin of [ipt, ip6t]) {
    await run("mss-clamp", mssClampCommand(bin));
  }

  // 5. Stateful default-deny INPUT on BOTH families (C1/H5).
  //    ALLOW-LIST FIRST, then -P DROP. Retrofit: schedule a cancel-on-success
  //    rollback BEFORE flipping policy so a mistake auto-reverts in 60s. The
  //    rollback uses the RESOLVED binaries so it reverts the same backend.
  if (opts.retrofit) {
    await run(
      "fw-rollback-arm",
      `(sleep 60 && ${ipt} -P INPUT ACCEPT && ${ip6t} -P INPUT ACCEPT) >/dev/null 2>&1 & echo $! > /run/krova-fw-rollback.pid`
    );
  }
  for (const [fam, bin, icmp] of [
    ["v4", ipt, "icmp"],
    ["v6", ip6t, "ipv6-icmp"],
  ] as const) {
    const add = (spec: string) =>
      run(`in-${fam}`, `${bin} -C ${spec} 2>/dev/null || ${bin} -A ${spec}`);
    await add("INPUT -i lo -j ACCEPT");
    await add("INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT");
    await add(`INPUT -p ${icmp} -j ACCEPT`); // ICMPv6 mandatory for NDP/PMTUD
    await add("INPUT -p tcp --dport 2822 -j ACCEPT"); // host SSH
    await add("INPUT -p tcp --dport 80 -j ACCEPT");
    await add("INPUT -p tcp --dport 443 -j ACCEPT");
    await add("INPUT -p udp --dport 443 -j ACCEPT"); // QUIC (N-H1)
    await run(`policy-${fam}`, `${bin} -P INPUT DROP`);
  }
  if (opts.retrofit) {
    // Success → cancel the rollback net.
    await run(
      "fw-rollback-cancel",
      `kill "$(cat /run/krova-fw-rollback.pid 2>/dev/null)" 2>/dev/null; rm -f /run/krova-fw-rollback.pid; true`
    );
  }

  // 6. Persist BOTH families + br0 addresses (Debian + RHEL). See spec step 9.
  await run("persist", persistIptablesCommand(), 60_000);
  // br0.network: ensure BOTH Address= lines persist (idempotent rewrite).
  await run(
    "br0-networkd",
    `printf '[NetDev]\\nName=br0\\nKind=bridge\\n' > /etc/systemd/network/br0.netdev && ` +
      `printf '[Match]\\nName=br0\\n[Network]\\nAddress=${v4gw}/24\\nAddress=${v6gw}/64\\nConfigureWithoutCarrier=yes\\n' > /etc/systemd/network/br0.network && ` +
      "systemctl enable --now systemd-networkd >/dev/null 2>&1 || true"
  );
}
