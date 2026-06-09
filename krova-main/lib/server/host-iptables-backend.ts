/**
 * Classify the HOST's default `iptables` backend for the server health check.
 *
 * The bare-metal host deliberately uses the iptables-LEGACY backend for the
 * cube-DNAT + bridge-firewall path. `applyHostNetworking` (the `network` setup
 * phase) runs `update-alternatives --set iptables iptables-legacy` precisely so
 * `netfilter-persistent save` captures those rules and they survive reboot —
 * see lib/server/cube-network-host.ts (step 0) + lib/ssh/network.ts getIptables
 * + lib/worker/cube-boot.ts. So the correct default backend is host-dependent:
 *
 *   - Debian/Ubuntu (the `iptables-legacy` alternative EXISTS): the default
 *     MUST be legacy. An nft default here is the real bug — our legacy rules are
 *     NOT captured by netfilter-persistent and VANISH on reboot (the on-host
 *     E2E verify caught exactly this: post-reboot the IPv6 NAT MASQUERADE +
 *     INPUT default-deny were gone).
 *   - RHEL/AlmaLinux (no `-legacy` alternative): the default is nft and that is
 *     correct — resolveBins/getIptables fall back to the plain `iptables` (nft)
 *     binary there, so the persisted rules match.
 *
 * This is the HOST backend and is UNRELATED to Rule 37, which governs the cube
 * ROOTFS (the guest) using nft. The previous health check expected `nf_tables`
 * on the host and so flagged every correctly-configured host as "Wrong backend:
 * legacy".
 *
 * @param version          trimmed first line of `iptables --version`
 *                         (e.g. "iptables v1.8.10 (legacy)")
 * @param legacyAvailable  whether `iptables-legacy` resolves on the host
 */
export interface HostIptablesBackendResult {
  detail: string;
  status: "ok" | "warn" | "fail";
}

export function classifyHostIptablesBackend(
  version: string,
  legacyAvailable: boolean
): HostIptablesBackendResult {
  const v = version.trim();
  if (!v) {
    return { status: "fail", detail: "Could not detect" };
  }

  const isLegacy = /legacy/i.test(v);
  const isNft = /nf_tables/i.test(v);

  // Host correctly on the legacy backend — the intended state on every Krova
  // cube host (and the only backend whose rules netfilter-persistent will save
  // alongside the cube-DNAT path's legacy rules).
  if (isLegacy) {
    return { status: "ok", detail: v };
  }

  if (isNft) {
    if (legacyAvailable) {
      // Debian/Ubuntu with the legacy alternative present but the default left
      // on nft → our legacy rules won't be persisted and will vanish on reboot.
      // Re-run the Network phase (applyHostNetworking flips the alternative).
      return {
        status: "fail",
        detail: `Default is nft but host rules use legacy: ${v} — re-run the Network phase`,
      };
    }
    // RHEL/AlmaLinux: no legacy alternative, nft is the only backend → correct.
    return { status: "ok", detail: v };
  }

  return { status: "warn", detail: `Unrecognized backend: ${v}` };
}
