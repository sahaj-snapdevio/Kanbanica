/**
 * Cube guest network configuration writer.
 *
 * The platform ships an Ubuntu 24.04 guest rootfs. Earlier code wrote a
 * netplan YAML at `/etc/netplan/99-krova.yaml`; the systemd-networkd
 * config below replaced it because systemd-networkd is the universal
 * renderer (the netplan path was renderer-specific). The helper also
 * wipes any stale netplan file so transfers/redeploys do not carry old
 * IPs forward.
 *
 * We standardize on systemd-networkd because systemd ships on both
 * distros and the rootfs builder enables `systemd-networkd.service` on
 * each one. The same `.network` file applies to both.
 *
 * Priority `10-` so this file beats any distro-provided default that
 * also matches `Name=eth0`. systemd-networkd's lookup order is
 * `/etc` > `/run` > `/usr/lib`, so this `/etc` write also wins over
 * any `/run/systemd/network/*-netplan-*.network` Ubuntu's netplan
 * generator might leave behind.
 *
 * Callers MUST mount the cube rootfs at `mountDir` before calling and
 * are responsible for unmounting afterwards.
 */

import type { Client } from "ssh2";
import { CUBE_DNS_SERVERS, CUBE_RESOLV_OPTIONS } from "@/config/platform";
import {
  cubeIpv4Gateway,
  cubeIpv6Address,
  cubeIpv6Gateway,
  octetOf,
  subnetOf,
} from "@/lib/server/cube-network";
import { execCommand } from "@/lib/ssh/exec";

/**
 * Pure: build the two guest network files Krova owns — the dual-stack
 * systemd-networkd `.network` unit and the static `/etc/resolv.conf` — from a
 * cube's IPv4 internal IP. Derives the per-server subnet S (subnetOf — THROWS
 * on a non-198.18 IPv4) + host octet from the IPv4, so no extra parameter is
 * needed. Single source of truth for the FILE CONTENT (Rule 14) — shared by the
 * host loop-mount writer below AND scripts/install-guest-network-fleet.ts, which
 * writes the SAME bytes into a RUNNING guest over the vsock `exec` channel. The
 * baked rootfs copy in setup/images/build-all-images.sh is held byte-identical
 * by a unit test (lib/ssh/cube-guest-network.test.ts) so the two cannot drift.
 */
export function buildGuestNetworkFiles(internalIp: string): {
  networkUnit: string;
  resolvConf: string;
} {
  const S = subnetOf(internalIp);
  const octet = octetOf(internalIp);
  const networkUnit = [
    "[Match]",
    "Name=eth0",
    "",
    "[Network]",
    `Address=${internalIp}/24`,
    `Gateway=${cubeIpv4Gateway(S)}`, // was hardcoded 10.0.0.1 (H7 fix)
    `Address=${cubeIpv6Address(S, octet)}/64`,
    `Gateway=${cubeIpv6Gateway(S)}`,
    // The cube's v6 address + gateway are STATIC, so the guest never needs
    // Router Advertisements. Left unset, systemd-networkd's default runs an
    // RA-client on eth0 that never receives an RA (the host bridge sends none),
    // times out, and periodically reconfigures the link — which re-arms DAD and
    // drops the static global v6 into a tentative/absent window, then re-adds it
    // minutes later (the observed flap that breaks v6 egress + v6-first DNS).
    // Pinning RA off stops the reconfigure churn so the static config never
    // flaps. (Live cubes pick this up on their next cold restart; the resolv.conf
    // fast-fail below removes the user-visible DNS symptom immediately.)
    "IPv6AcceptRA=no",
    ...CUBE_DNS_SERVERS.map((ns) => `DNS=${ns}`),
    "",
  ].join("\n");
  // IPv4-FIRST nameservers + a glibc `options` line so a flapping/blackholed v6
  // egress can never stall DNS (see CUBE_DNS_SERVERS / CUBE_RESOLV_OPTIONS).
  const resolvConf = `${CUBE_DNS_SERVERS.map((ns) => `nameserver ${ns}`).join("\n")}\noptions ${CUBE_RESOLV_OPTIONS}\n`;
  return { networkUnit, resolvConf };
}

export async function writeCubeGuestNetworkConfig(
  client: Client,
  mountDir: string,
  internalIp: string
): Promise<void> {
  // Derive the per-server subnet S + host octet from the cube's IPv4 so the
  // dual-stack unit needs no extra parameter (every caller passes only
  // internalIp). subnetOf THROWS on a non-198.18 IPv4 — a stray legacy 10.x
  // cube surfaces loudly here rather than booting with a wrong network config.
  const { networkUnit, resolvConf } = buildGuestNetworkFiles(internalIp);
  const b64 = Buffer.from(networkUnit).toString("base64");

  const mkdir = await execCommand(
    client,
    `mkdir -p ${mountDir}/etc/systemd/network`
  );
  if (mkdir.exitCode !== 0) {
    throw new Error(
      `Failed to create /etc/systemd/network in guest rootfs: ${mkdir.stderr}`
    );
  }

  const write = await execCommand(
    client,
    `echo '${b64}' | base64 -d > ${mountDir}/etc/systemd/network/10-eth0.network`
  );
  if (write.exitCode !== 0) {
    throw new Error(`Failed to write systemd-networkd config: ${write.stderr}`);
  }

  // Unconditionally (re)write /etc/resolv.conf from CUBE_DNS_SERVERS. This is
  // the authoritative DNS source — systemd-resolved is deliberately NOT enabled
  // (see the rootfs builder), so glibc reads this file directly. `rm -f` first
  // in case the rootfs ever ships a resolv.conf symlink.
  const resolvB64 = Buffer.from(resolvConf).toString("base64");
  const writeResolv = await execCommand(
    client,
    `rm -f ${mountDir}/etc/resolv.conf && echo '${resolvB64}' | base64 -d > ${mountDir}/etc/resolv.conf`
  );
  if (writeResolv.exitCode !== 0) {
    throw new Error(
      `Failed to write guest /etc/resolv.conf: ${writeResolv.stderr}`
    );
  }

  // Wipe the legacy netplan file from any Ubuntu cube whose rootfs was
  // provisioned before this change. systemd-networkd would still pick our
  // /etc file over netplan's /run-generated one, but removing the stale
  // YAML keeps the rootfs from carrying old IPs forward through transfers
  // and avoids operator confusion later.
  await execCommand(
    client,
    `rm -f ${mountDir}/etc/netplan/99-krova.yaml`
  ).catch(() => {});

  // Defense in depth — make sure systemd-networkd is enabled on every
  // boot path. Newly-built rootfs images enable it from the build script,
  // but a cube booted from an older rootfs (pre-Update-Images) might not
  // have it enabled. The symlink is harmless if systemd-networkd is not
  // installed (the unit just fails silently on boot, and the rootfs
  // builder is the only place that decides which unit ships). Best-effort.
  await execCommand(
    client,
    `mkdir -p ${mountDir}/etc/systemd/system/multi-user.target.wants && ln -sf /usr/lib/systemd/system/systemd-networkd.service ${mountDir}/etc/systemd/system/multi-user.target.wants/systemd-networkd.service 2>/dev/null || true`
  ).catch(() => {});
  await execCommand(
    client,
    `mkdir -p ${mountDir}/etc/systemd/system/sockets.target.wants && ln -sf /usr/lib/systemd/system/systemd-networkd.socket ${mountDir}/etc/systemd/system/sockets.target.wants/systemd-networkd.socket 2>/dev/null || true`
  ).catch(() => {});
}
