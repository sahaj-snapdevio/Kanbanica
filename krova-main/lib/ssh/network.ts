import type { Client } from "ssh2";
import { execCommand } from "@/lib/ssh/exec";

/**
 * Resolve the iptables binary — prefer iptables-legacy on Ubuntu 24.04+
 * where nftables is the default backend. Using iptables-legacy ensures
 * our NAT rules are compatible with UFW and netfilter-persistent.
 */
async function getIptables(client: Client): Promise<string> {
  const result = await execCommand(
    client,
    "command -v iptables-legacy 2>/dev/null || echo iptables"
  );
  return result.stdout.trim() || "iptables";
}

/** Save iptables rules so they persist across reboots */
async function persistIptables(client: Client): Promise<void> {
  await execCommand(client, "netfilter-persistent save 2>/dev/null || true");
}

/**
 * Run a single iptables rule add IDEMPOTENTLY: check first via
 * `iptables -C`, only `-A` if the rule does not already exist.
 * Without this guard, a worker retry (or any other re-invocation
 * of the same call site) appends a duplicate rule — iptables `-A`
 * does not deduplicate. The double-rule then prevents clean
 * `-D` removal later (only one of the two gets removed).
 *
 * `tableFlag` should be the empty string for filter-table rules
 * (no `-t` needed) or `-t nat`/`-t mangle` for those tables. It is
 * emitted BEFORE the `-A`/`-C` command, which is iptables' canonical
 * option order (table flag precedes the command flag).
 */
async function idempotentIptablesAdd(
  client: Client,
  ipt: string,
  tableFlag: string,
  ruleSpec: string,
  description: string
): Promise<void> {
  const t = tableFlag ? `${tableFlag} ` : "";
  // `2>/dev/null` swallows the "Bad rule (does a matching rule exist…)"
  // line iptables prints to stderr when -C misses. Exit 1 = rule not
  // present → fall through to -A. Exit 0 = rule present → skip.
  const cmd =
    `${ipt} ${t}-C ${ruleSpec} 2>/dev/null` + ` || ${ipt} ${t}-A ${ruleSpec}`;
  const result = await execCommand(client, cmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to add ${description}: ${result.stderr}`);
  }
}

/**
 * Run a single iptables rule delete IDEMPOTENTLY: check first via
 * `iptables -C`, only `-D` if the rule is actually present. Without
 * this guard, a retry of removeTcpPortForward (or cube-delete's
 * cleanup) throws because `iptables -D` on a missing rule exits
 * non-zero — the caller can't tell the difference between "removed
 * cleanly" and "actually broken".
 */
async function idempotentIptablesDelete(
  client: Client,
  ipt: string,
  tableFlag: string,
  ruleSpec: string,
  description: string
): Promise<void> {
  const t = tableFlag ? `${tableFlag} ` : "";
  const cmd =
    `${ipt} ${t}-C ${ruleSpec} 2>/dev/null` +
    ` && ${ipt} ${t}-D ${ruleSpec} || true`;
  const result = await execCommand(client, cmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to delete ${description}: ${result.stderr}`);
  }
}

/**
 * Given the output of `iptables -t nat -S PREROUTING`, return the `-D` delete
 * specs for EVERY DNAT rule that forwards `hostPort` (any `--to-destination`).
 *
 * Used by `addTcpPortForward`'s flush-on-reuse: a freed host port can be
 * reallocated to a new cube, and if the previous cube's DNAT rule was never
 * removed (host unreachable at delete time, or an error-swallowed cleanup), the
 * stale rule still matches this `--dport`. PREROUTING is first-match-wins, so a
 * stale rule appended before ours would hijack the new cube's traffic to the
 * OLD internal IP. We must delete every such rule.
 *
 * Pure + exact-match so it can be unit-tested: matches `--dport <hostPort>` only
 * on a whole-token boundary (`30002` must not match `300020`, and the digits of
 * a `--to-destination …:<port>` must never be mistaken for the dport), and only
 * on `-j DNAT` rules. Each returned spec is the original `-A …` line rewritten
 * to `-D …`, so it deletes that exact rule when replayed.
 */
export function dnatDeleteSpecsForHostPort(
  preroutingDump: string,
  hostPort: number
): string[] {
  const portRe = new RegExp(`(^|\\s)--dport ${hostPort}(\\s|$)`);
  const dnatRe = /(^|\s)-j DNAT(\s|$)/;
  const specs: string[] = [];
  for (const raw of preroutingDump.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("-A PREROUTING")) {
      continue;
    }
    if (!dnatRe.test(line) || !portRe.test(line)) {
      continue;
    }
    specs.push(line.replace(/^-A /, "-D "));
  }
  return specs;
}

/**
 * Add a TCP port forward from hostPort to cubeInternalIp:cubePort.
 * If whitelistedCidrs is non-empty, only those source CIDRs can reach the port;
 * all other traffic is dropped via a final DROP rule for that port.
 *
 * FLUSH-ON-REUSE: rather than a plain `-C || -A` (which would APPEND a second
 * DNAT below a leftover stale rule and lose the first-match race), this deletes
 * every existing DNAT for `hostPort`, INSERTS ours at the TOP of PREROUTING, and
 * flushes conntrack for the port. That guarantees a reused host port routes to
 * the CURRENT cube even if a prior cube's rule/conntrack state was never cleaned
 * up. Still idempotent — re-running with the same args lands the same single
 * top rule.
 */
export async function addTcpPortForward(
  client: Client,
  hostPort: number,
  cubeInternalIp: string,
  cubePort: number,
  whitelistedCidrs: string[]
): Promise<void> {
  const ipt = await getIptables(client);

  // 1. Delete any pre-existing DNAT(s) for this host port — any destination.
  //    Best-effort per rule: even if a delete races a concurrent change, the
  //    insert-at-top below still wins first-match; deleting is hygiene that
  //    stops rules accumulating across reuses.
  const prerouting = await execCommand(client, `${ipt} -t nat -S PREROUTING`);
  for (const delSpec of dnatDeleteSpecsForHostPort(
    prerouting.stdout,
    hostPort
  )) {
    await execCommand(client, `${ipt} -t nat ${delSpec}`).catch(() => {});
  }

  // 2. Insert OUR DNAT at the TOP so it always wins evaluation, regardless of
  //    any stale rule a delete above may have missed.
  const dnatInsert = await execCommand(
    client,
    `${ipt} -t nat -I PREROUTING 1 -p tcp --dport ${hostPort} -j DNAT --to-destination ${cubeInternalIp}:${cubePort}`
  );
  if (dnatInsert.exitCode !== 0) {
    throw new Error(`Failed to add TCP DNAT rule: ${dnatInsert.stderr}`);
  }

  // 3. Flush conntrack for this host port so any flow pinned (by an established
  //    conntrack entry) to a prior cube's destination is dropped and the next
  //    packet re-evaluates the new DNAT. Best-effort: `conntrack` is installed
  //    by server-install + the host-tools retrofit, but tolerate its absence on
  //    a not-yet-retrofitted host — the insert-at-top already fixes NEW flows.
  //    `|| true` swallows conntrack's non-zero exit when no entry matched.
  await execCommand(
    client,
    `conntrack -D -p tcp --dport ${hostPort} >/dev/null 2>&1 || true`
  ).catch(() => {});

  // MASQUERADE for return traffic. Keyed on the destination cube IP, so a
  // leftover one for an old cube is harmless (nothing targets a deleted IP) —
  // a plain idempotent add is sufficient here.
  await idempotentIptablesAdd(
    client,
    ipt,
    "-t nat",
    `POSTROUTING -p tcp -d ${cubeInternalIp} --dport ${cubePort} -j MASQUERADE`,
    "TCP MASQUERADE rule"
  );

  // Apply IP whitelist if specified
  if (whitelistedCidrs.length > 0) {
    await applyTcpWhitelist(
      client,
      hostPort,
      cubeInternalIp,
      cubePort,
      whitelistedCidrs
    );
  }

  await persistIptables(client);
}

/**
 * Remove a TCP port forward and any associated whitelist rules.
 *
 * Idempotent — re-running with the same args is a no-op for any rule
 * that was already removed (each `-D` is gated by an `-C` check).
 * This matters for pg-boss at-least-once delivery: tcp-mapping-remove
 * and cube-delete's cleanup can both fire for the same mapping if a
 * prior run died mid-flight.
 */
export async function removeTcpPortForward(
  client: Client,
  hostPort: number,
  cubeInternalIp: string,
  cubePort: number
): Promise<void> {
  const ipt = await getIptables(client);

  // Remove any whitelist rules first (filter table)
  await clearTcpWhitelist(client, hostPort);

  // Remove DNAT rule
  await idempotentIptablesDelete(
    client,
    ipt,
    "-t nat",
    `PREROUTING -p tcp --dport ${hostPort} -j DNAT --to-destination ${cubeInternalIp}:${cubePort}`,
    "TCP DNAT rule"
  );

  // Remove MASQUERADE rule
  await idempotentIptablesDelete(
    client,
    ipt,
    "-t nat",
    `POSTROUTING -p tcp -d ${cubeInternalIp} --dport ${cubePort} -j MASQUERADE`,
    "TCP MASQUERADE rule"
  );

  await persistIptables(client);
}

/**
 * Replace the whitelist for a given mapping. Clears existing rules, then
 * applies new ones. Needs `cubeInternalIp` + `cubePort` because the FORWARD
 * rules match the POST-DNAT packet (see applyTcpWhitelist).
 */
export async function updateTcpWhitelist(
  client: Client,
  hostPort: number,
  cubeInternalIp: string,
  cubePort: number,
  whitelistedCidrs: string[]
): Promise<void> {
  await clearTcpWhitelist(client, hostPort);

  if (whitelistedCidrs.length > 0) {
    await applyTcpWhitelist(
      client,
      hostPort,
      cubeInternalIp,
      cubePort,
      whitelistedCidrs
    );
  }

  await persistIptables(client);
}

/**
 * Apply whitelist rules: ACCEPT each CIDR, then DROP all other inbound traffic
 * to the cube's port. Uses a comment marker so we can identify and remove
 * these rules later.
 *
 * CRITICAL — the FORWARD rules MUST match the cube's address + port, NOT the
 * host port. The DNAT in PREROUTING (nat table) rewrites `host:hostPort` to
 * `cubeInternalIp:cubePort` BEFORE the packet reaches the FORWARD chain (filter
 * table). A rule matching `--dport hostPort` in FORWARD therefore never matches
 * the post-DNAT packet, so the whitelist silently never fires and the port is
 * open to the world (the 2026-05-31 audit BLOCKER). We scope by `-d
 * cubeInternalIp` too, because two co-located cubes can share a cube port (e.g.
 * both sshd on 22) — without it, one cube's whitelist would apply to the other.
 * The comment tag stays keyed on `hostPort` (unique per host) so
 * `clearTcpWhitelist` still finds these rules by tag.
 *
 * The host FORWARD chain (cube-network-host.ts) only ACCEPTs `-i br0` (egress)
 * and `-o br0 ESTABLISHED,RELATED` — neither matches an inbound NEW packet — so
 * these appended ACCEPT/DROP rules are reached before the default-ACCEPT policy.
 */
async function applyTcpWhitelist(
  client: Client,
  hostPort: number,
  cubeInternalIp: string,
  cubePort: number,
  cidrs: string[]
): Promise<void> {
  const ipt = await getIptables(client);
  const match = `-d ${cubeInternalIp} --dport ${cubePort}`;

  for (const cidr of cidrs) {
    await idempotentIptablesAdd(
      client,
      ipt,
      "",
      `FORWARD -p tcp ${match} -s ${cidr} -m comment --comment "tcp-wl-${hostPort}" -j ACCEPT`,
      `whitelist ACCEPT rule for ${cidr}`
    );
  }

  // Final DROP rule for all other inbound traffic to this cube port
  await idempotentIptablesAdd(
    client,
    ipt,
    "",
    `FORWARD -p tcp ${match} -m comment --comment "tcp-wl-${hostPort}" -j DROP`,
    "whitelist DROP rule"
  );
}

/**
 * Remove all FORWARD rules tagged with the comment marker for a given hostPort.
 */
async function clearTcpWhitelist(
  client: Client,
  hostPort: number
): Promise<void> {
  const ipt = await getIptables(client);

  // Loop-delete: keep removing rule #1 that matches the comment until none remain
  // iptables -D doesn't support --comment matching, so we use line numbers
  const tag = `tcp-wl-${hostPort}`;
  while (true) {
    const listResult = await execCommand(
      client,
      `${ipt} -L FORWARD --line-numbers -n | grep '${tag}' | head -1 | awk '{print $1}'`
    );
    const lineNum = listResult.stdout.trim();
    if (!lineNum || isNaN(Number.parseInt(lineNum, 10))) {
      break;
    }

    const delResult = await execCommand(client, `${ipt} -D FORWARD ${lineNum}`);
    if (delResult.exitCode !== 0) {
      break;
    }
  }
}

/**
 * Allocate the lowest free host octet (2..254) for a server, given the octets
 * already in use on that server. Callers compose the full address via
 * cubeIpv4Address(S, octet) / cubeIpv6Address(S, octet) — see lib/server/cube-network.ts.
 * (Renamed from allocateInternalIp, which returned a hardcoded 10.0.0.<octet>.)
 */
export function allocateInternalOctet(existingOctets: number[]): number {
  const used = new Set(existingOctets);
  for (let i = 2; i <= 254; i++) {
    if (!used.has(i)) {
      return i;
    }
  }
  throw new Error("Internal IP subnet exhausted: no free host octet in 2..254");
}
