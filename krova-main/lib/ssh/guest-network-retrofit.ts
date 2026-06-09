/**
 * Per-cube guest-network retrofit applied over the vsock `exec` channel by
 * scripts/install-guest-network-fleet.ts. Extracted from the script (which can't
 * be imported in a test without running its `main()`) so the load-bearing safety
 * guarantee is mechanically enforced by a unit test (Rule 59), not just a
 * comment: it writes exactly TWO files and issues NOTHING that re-applies config
 * to the live link (no `networkctl reload`, no `systemctl restart`, no `ip link`),
 * so it can never drop eth0 or kill an active SSH / TCP / browser-terminal
 * session on a running customer cube.
 */
import type { Client } from "ssh2";
import { buildGuestNetworkFiles } from "@/lib/ssh/cube-guest-network";

/** The subset of `guestExec` this module needs — injected so a test can capture
 *  every command without an SSH connection. Matches `@/lib/ssh` guestExec. */
export type GuestExecFn = (
  client: Client,
  cubeId: string,
  command: string,
  timeoutMs?: number
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export type RetrofitOutcome = "skipped" | "updated";

export interface RetrofitTimeouts {
  probeMs: number;
  writeMs: number;
}

const DEFAULT_TIMEOUTS: RetrofitTimeouts = { probeMs: 10_000, writeMs: 10_000 };

/**
 * Push the v4-first / fast-fail `/etc/resolv.conf` (LIVE — glibc re-reads it on
 * the next lookup, so the DNS fix applies immediately) and the `IPv6AcceptRA=no`
 * `10-eth0.network` unit (to DISK only — applies on the cube's next cold restart)
 * into ONE running cube. Issues no command that re-applies config to the live
 * link, so a running cube's network and all its sessions are never disturbed.
 *
 * Returns "skipped" when the cube has no IPv4, or (unless `force`) when its live
 * `/etc/resolv.conf` already matches the target. THROWS on a legacy non-198.18
 * IPv4 (`buildGuestNetworkFiles` → `subnetOf`) — the caller surfaces it as a
 * per-cube failure rather than writing a guessed config.
 */
export async function retrofitCubeGuestNetwork(
  client: Client,
  cube: { id: string; internalIp: string | null },
  force: boolean,
  guestExec: GuestExecFn,
  timeouts: RetrofitTimeouts = DEFAULT_TIMEOUTS
): Promise<RetrofitOutcome> {
  if (!cube.internalIp) {
    return "skipped";
  }

  const { networkUnit, resolvConf } = buildGuestNetworkFiles(cube.internalIp);

  if (!force) {
    const probe = await guestExec(
      client,
      cube.id,
      "cat /etc/resolv.conf 2>/dev/null || true",
      timeouts.probeMs
    );
    if (probe.stdout.trim() === resolvConf.trim()) {
      return "skipped";
    }
  }

  // (1) /etc/resolv.conf — LIVE (glibc re-reads per lookup; no daemon, no link).
  const resolvB64 = Buffer.from(resolvConf).toString("base64");
  await guestExec(
    client,
    cube.id,
    `rm -f /etc/resolv.conf && echo '${resolvB64}' | base64 -d > /etc/resolv.conf`,
    timeouts.writeMs
  );

  // (2) /etc/systemd/network/10-eth0.network — written to disk ONLY. No reload,
  //     no restart, no ip-link: the IPv6AcceptRA=no flap fix applies on the next
  //     cold restart so the live link (and its sessions) is never disturbed.
  const unitB64 = Buffer.from(networkUnit).toString("base64");
  await guestExec(
    client,
    cube.id,
    `mkdir -p /etc/systemd/network && echo '${unitB64}' | base64 -d > /etc/systemd/network/10-eth0.network`,
    timeouts.writeMs
  );

  return "updated";
}
