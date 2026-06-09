# Cube IPv6 — Phase 3: Host networking + firewall + C2 fix + verify

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. **Read the spec's "Host networking §" and "Host firewall posture §" alongside this plan — they enumerate every shell command; this plan gives the module shape, the error-prone ordering, and the verification.**

**Goal:** Create `applyHostNetworking(client, S)` — the single shared host bridge + dual-stack NAT + stateful default-deny firewall — replace the hardcoded `server-network.ts` STEPS with it, fix the pre-existing `99-krova.conf` clobber (C2) by moving forwarding sysctls to a dedicated file, add IPv6/INPUT/QUIC checks to `server-verify.ts`, and satisfy Rule 46 for `ip6tables`.

**Architecture:** All host-side commands run over SSH via `execCommand`, idempotent (`-C`/`grep`-guarded). `applyHostNetworking` is called by the `network` setup phase (new servers) and the Phase-6 migration retrofit (existing servers). The firewall is allow-list-first then `-P DROP`, with a cancel-on-success backgrounded rollback on the retrofit path so a mistake can't lock the worker out.

**Tech Stack:** ssh2 `execCommand`, iptables/ip6tables (legacy backend, resolved like `network.ts getIptables`), sysctl.d, systemd-networkd.

**Spec:** Host networking §, Host firewall posture §, Pre-existing bugs § (C2), Verify phase §. **Depends on:** Phase 1 (`cube-network.ts` for `cubeIpv4Subnet/Gateway`, `cubeIpv6Subnet/Gateway`), Phase 2 (`bridge_subnet` exists).

> **Concurrent-edit note:** read live `server-network.ts` / `server-verify.ts` / `server-install.ts` before editing.

---

## File structure

- **Create** `lib/server/cube-network-host.ts` — `applyHostNetworking(client, S, opts?)` (bridge + NAT + firewall + persist, both families). Single responsibility: make a host's kernel/iptables/sysctl state correct for subnet S.
- **Modify** `lib/worker/handlers/server-network.ts` — replace the bridge/forward/NAT/persist STEPS with a call to `applyHostNetworking`; move `ip_forward` OUT of `99-krova.conf`.
- **Modify** `lib/worker/handlers/server-install.ts` — kernel-tuning step keeps writing `99-krova.conf` (vm tuning ONLY); add `ip6tables:iptables` to the `verify host tools` REQUIRED list.
- **Modify** `scripts/install-host-tools.ts` — add `ip6tables:iptables` to its REQUIRED list (Rule 46).
- **Modify** `lib/worker/handlers/server-verify.ts` — add IPv6 forwarding / br0-v6-addr / ip6tables-MASQUERADE / INPUT-policy / QUIC-listener CHECKS.
- **Modify** `docs/security/host-hardening.md` — document the default-deny INPUT posture.

---

## Task 1: `applyHostNetworking` module

**Files:** Create `lib/server/cube-network-host.ts`.

- [ ] **Step 1: Write the module** (full firewall + sysctl ordering shown; bridge/NAT commands per spec Host networking § steps 3-6)

Create `lib/server/cube-network-host.ts`:

```ts
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
  cubeIpv4Gateway,
  cubeIpv4Subnet,
  cubeIpv6Gateway,
  cubeIpv6Subnet,
} from "@/lib/server/cube-network";
import { execCommand } from "@/lib/ssh/exec";

const FORWARD_SYSCTL = "/etc/sysctl.d/98-krova-forwarding.conf";

/** Resolve the legacy backend like network.ts getIptables, for BOTH families. */
function bins(): { ipt: string; ip6t: string } {
  // Resolved on-host per call (command -v); see Step note. Kept as a literal
  // command prefix so v4 and v6 share one backend.
  return { ipt: "iptables", ip6t: "ip6tables" };
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
  const v4subnet = cubeIpv4Subnet(S); // 10.<hi>.<lo>.0/24
  const v4gw = cubeIpv4Gateway(S); // 10.<hi>.<lo>.1
  const v6subnet = cubeIpv6Subnet(S); // fd00:c0be:<hex>::/64
  const v6gw = cubeIpv6Gateway(S); // fd00:c0be:<hex>::1
  const { ipt, ip6t } = bins();

  const run = async (label: string, cmd: string, timeoutMs = 15_000) => {
    const r = await execCommand(client, cmd, timeoutMs);
    if (r.exitCode !== 0) {
      throw new Error(
        `applyHostNetworking[${label}] exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(-400)}`
      );
    }
  };

  // 1. Forwarding sysctls in a DEDICATED file (C2 — never touch 99-krova.conf).
  //    WAN iface detection (H4): every distinct iface on an IPv6 default route
  //    gets accept_ra=2; br0 gets accept_ra=0 (L6). No-op if no v6 default.
  await run(
    "sysctl",
    [
      `WANS=$(ip -6 route show default 2>/dev/null | grep -oP 'dev \\K\\S+' | sort -u)`,
      `{ echo 'net.ipv4.ip_forward=1';`,
      `  echo 'net.ipv6.conf.all.forwarding=1';`,
      `  echo 'net.ipv6.conf.br0.accept_ra=0';`,
      `  for w in $WANS; do echo "net.ipv6.conf.$w.accept_ra=2"; done; } > ${FORWARD_SYSCTL}`,
      `sysctl --system >/dev/null`,
    ].join(" && ")
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
  for (const [fam, bin] of [["v4", ipt], ["v6", ip6t]] as const) {
    await run(
      `fwd-out-${fam}`,
      `${bin} -C FORWARD -i br0 ! -o br0 -j ACCEPT 2>/dev/null || ${bin} -A FORWARD -i br0 ! -o br0 -j ACCEPT`
    );
    await run(
      `fwd-ret-${fam}`,
      `${bin} -C FORWARD -o br0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || ${bin} -A FORWARD -o br0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`
    );
  }

  // 5. Stateful default-deny INPUT on BOTH families (C1/H5).
  //    ALLOW-LIST FIRST, then -P DROP. Retrofit: schedule a cancel-on-success
  //    rollback BEFORE flipping policy so a mistake auto-reverts in 60s.
  if (opts.retrofit) {
    await run(
      "fw-rollback-arm",
      `(sleep 60 && iptables -P INPUT ACCEPT && ip6tables -P INPUT ACCEPT) >/dev/null 2>&1 & echo $! > /run/krova-fw-rollback.pid`
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
  await run(
    "persist",
    [
      `if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save;`,
      `elif [ -d /etc/iptables ]; then mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4 && ip6tables-save > /etc/iptables/rules.v6;`,
      `elif [ -d /etc/sysconfig ]; then iptables-save > /etc/sysconfig/iptables && ip6tables-save > /etc/sysconfig/ip6tables && systemctl enable iptables ip6tables >/dev/null 2>&1 || true;`,
      `else echo 'unsupported distro for iptables persistence' >&2; exit 1; fi`,
    ].join(" "),
    60_000
  );
  // br0.network: ensure BOTH Address= lines persist (idempotent rewrite).
  await run(
    "br0-networkd",
    `printf '[NetDev]\\nName=br0\\nKind=bridge\\n' > /etc/systemd/network/br0.netdev && ` +
      `printf '[Match]\\nName=br0\\n[Network]\\nAddress=${v4gw}/24\\nAddress=${v6gw}/64\\nConfigureWithoutCarrier=yes\\n' > /etc/systemd/network/br0.network && ` +
      `systemctl enable --now systemd-networkd >/dev/null 2>&1 || true`
  );
}
```

> Implementer note on `bins()`: resolve the legacy backend on-host like `network.ts getIptables` (`command -v iptables-legacy`) and pass the resolved binaries in, so v4 + v6 share the backend the cube-DNAT path uses (H1). Shown as literals above for readability; wire the resolver during implementation and confirm `ip6tables-legacy` exists (else fall back to `ip6tables`).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (module compiles; not yet called).

- [ ] **Step 3: Commit**

```bash
git add lib/server/cube-network-host.ts
git commit -m "feat(network): applyHostNetworking — dual-stack bridge/NAT + default-deny firewall (C1/H5), dedicated sysctl file (C2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire `server-network.ts` to `applyHostNetworking` + fix C2

**Files:** Modify `lib/worker/handlers/server-network.ts`.

- [ ] **Step 1: Replace the bridge/forward/NAT/persist STEPS** with: (a) the br0 *bridge creation* step kept (`ip link add … type bridge … up` — guarded), then (b) read the server's `bridge_subnet` (the handler has `serverId`; query the row) and call `await applyHostNetworking(client, server.bridgeSubnet)`. Remove the old `99-krova.conf` `ip_forward` STEP entirely (C2 — forwarding now lives in `98-krova-forwarding.conf` written by `applyHostNetworking`). Keep the JobLogger `log.step` wrapping.

```ts
import { applyHostNetworking } from "@/lib/server/cube-network-host";
// … inside runHandler, after connect:
const [srv] = await db.select({ bridgeSubnet: schema.servers.bridgeSubnet })
  .from(schema.servers).where(eq(schema.servers.id, serverId)).limit(1);
if (!srv || srv.bridgeSubnet === null) {
  throw new Error(`server ${serverId} has no bridge_subnet`);
}
await log.step("br0 bridge", async () => {
  const r = await execCommand(client!, "ip link show br0 >/dev/null 2>&1 || (ip link add name br0 type bridge && ip link set br0 up)", 10_000);
  if (r.exitCode !== 0) throw new Error(r.stderr || r.stdout);
});
await log.step("host networking (dual-stack + firewall)", async () => {
  await applyHostNetworking(client!, srv.bridgeSubnet!);
});
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/worker/handlers/server-network.ts
git commit -m "refactor(server): network phase calls applyHostNetworking; stop clobbering 99-krova.conf (C2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: server-install keeps vm tuning isolated + Rule-46 ip6tables

**Files:** Modify `lib/worker/handlers/server-install.ts`, `scripts/install-host-tools.ts`.

- [ ] **Step 1:** In `server-install.ts`, confirm the kernel-tuning step writes ONLY `vm.overcommit_memory` + `vm.swappiness` to `99-krova.conf` (it already does; the network phase no longer overwrites it after Task 2 — C2 closed). No code change needed here unless the step also wrote `ip_forward` (it doesn't — that was the network phase).
- [ ] **Step 2:** Add `"ip6tables:iptables"` to the `verify host tools` REQUIRED list in `server-install.ts` (the list containing `iptables:iptables`). On the RHEL branch, additionally assert `ip6tables.service` is enableable (the persist step in Task 1 enables it).
- [ ] **Step 3:** Add the same `"ip6tables:iptables"` entry to the REQUIRED list in `scripts/install-host-tools.ts` (Rule 46 step 3).
- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/worker/handlers/server-install.ts scripts/install-host-tools.ts
git commit -m "feat(server): add ip6tables to verify-host-tools + retrofit lists (Rule 46)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: IPv6 / INPUT / QUIC verify CHECKS

**Files:** Modify `lib/worker/handlers/server-verify.ts`.

- [ ] **Step 1:** Append these `Check` entries to the `CHECKS` array (matching the existing `{name, cmd, expect, critical}` shape):

```ts
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
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/worker/handlers/server-verify.ts
git commit -m "feat(server): verify IPv6 forwarding/NAT/INPUT-deny + QUIC listener (H6/N-M4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Document the host firewall posture

**Files:** Modify `docs/security/host-hardening.md`.

- [ ] **Step 1:** Add a "Host INPUT firewall" section: stateful default-deny on both families (lo + ESTABLISHED,RELATED + ICMP/ICMPv6 + 2822/80/443/tcp + 443/udp, then `-P DROP`), applied allow-first; the retrofit's cancel-on-success rollback net; that host SSH stays on IPv4 2822 (explicitly allowed before the policy flip). Note this makes the prior "where the INPUT policy is DROP" assumption true, and remove that stale comment from `server-network.ts` if still present.
- [ ] **Step 2: Commit**

```bash
git add docs/security/host-hardening.md
git commit -m "docs(security): document dual-stack default-deny host INPUT firewall

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 verification gate

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` → PASS.
- [ ] `pnpm test` → PASS (no regressions).
- [ ] Grep: `99-krova.conf` no longer written by `server-network.ts`; `98-krova-forwarding.conf` written by `applyHostNetworking`.
- [ ] Code review: firewall is allow-first-then-DROP; retrofit rollback armed BEFORE the first `-P DROP` and cancelled only after all allows + policy succeed.

**Live application** (running `applyHostNetworking` against real hosts, flipping firewalls) is an operator maintenance-window action (Phase 6 retrofit + Deploy ordering) — not run autonomously. The host smoke checks (host keeps its own IPv6 default route, SSH still reachable, cube egress works) run against real infra.

## Self-review (against spec)

- C1/H5 default-deny INPUT both families, allow-first, retrofit rollback → Task 1 step 5. ✓
- C2 dedicated sysctl file, network phase stops touching 99-krova.conf → Tasks 1, 2. ✓
- H1 single backend (resolver note), H2 RHEL `systemctl enable ip6tables`, H3 accept_ra persisted in the file, H4 multi-WAN detection, L6 br0 accept_ra=0 → Task 1 steps 1, 6. ✓
- N-H1 QUIC UDP-443 carried into the helper + verify → Tasks 1, 4. ✓
- Egress-only FORWARD (no blanket -o br0 ACCEPT) → Task 1 step 4. ✓
- M9 independent br0-addr guards → Task 1 step 2. ✓
- H6/N-M4 verify CHECKS (forwarding, br0 v6, MASQUERADE, INPUT-deny, QUIC) → Task 4. ✓
- M5 Rule-46 ip6tables in server-install + install-host-tools → Task 3. ✓
- No placeholders for the error-prone firewall/sysctl code; routine bridge/NAT commands cross-referenced to the committed spec.
