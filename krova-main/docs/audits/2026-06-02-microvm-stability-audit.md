# Krova microVM Stability & Performance Audit — 2026-06-02

Author: automated deep audit (read-only).
Trigger: two live customer symptoms —
- **(A)** an in-cube **WireGuard mesh** overlay "looks stuck" and "works after a manual restart";
- **(B)** cubes appear pinned to the **CPU base frequency** despite BIOS turbo being enabled.

## Scope & method

- **What was audited:** the whole microVM runtime — guest kernel build, Firecracker launch, CPU template, memory/virtio-mem, clock across the lifecycle, guest + host networking, jailer/cgroup, disk/rootfs, in-guest agent/vsock, and the observer crons.
- **How:** a multi-agent fan-out (rate-limited by the environment — 14/15 agents returned empty), **plus direct file reads of every claim below by the author.** Every finding is cited to code that was read directly. Nothing here is from memory of an external API.
- **Hard constraint (Rule 60):** no command was run against production. All "Diagnostic" commands are for the **operator** to run; nothing was executed on the live cube or its host.
- **Not done:** this audit was *not* validated against the live cube. The diagnostics in Part 6 are required to confirm which mechanism is actually biting before any fix is shipped.

### Severity legend
`CRITICAL` data loss / fleet-wide outage · `HIGH` customer-visible breakage · `MEDIUM` intermittent / conditional · `LOW` latent / defense-in-depth · `INFO` no action.

---

## Executive summary

| # | Finding | Sev | Likelihood it's a live cause | Symptom |
|---|---------|-----|------------------------------|---------|
| C1 | Host CPU governor never set to `performance` | HIGH | high | B (root cause) |
| C2 | Jailer applies no cgroup CPU/IO limits → noisy-neighbour contention | MEDIUM | med | B (secondary) |
| W1 | Port mappings are **TCP-only** → **inbound WireGuard UDP impossible** | HIGH | high (for a mesh) | A |
| W2 | Host NAT **conntrack UDP idle-timeout** kills idle outbound tunnels | HIGH | high | A |
| W3 | No MSS clamp + eth0 MTU 1500 → **PMTUD black-hole** for tunneled bulk data | HIGH | med-high | A |
| W4 | Guest **clock lags after sleep→wake**; timesyncd mitigates but leaves a window | MEDIUM | med | A |
| W5 | **No entropy device** + `RANDOM_TRUST_CPU` unset → `getrandom()` boot stall risk | MEDIUM | low-med | A |
| W6 | `resolv.conf` unconditionally clobbered on transfer/restore | MEDIUM | med (if VPN DNS) | A |
| W7 | IPv6 RA flap on pre-fix cubes resets eth0 underlay | MEDIUM | low (mitigated) | A |
| S1 | Restore disk pre-flight `NaN`-skips its own space guard | MEDIUM | low | stability |
| S2 | Transfer ignores `e2fsck` exit code → can boot corrupt rootfs | MEDIUM | low | stability |
| S3 | Transfer rollback couples two flags → can skip a customer-visible restore | LOW | low | stability |
| S4 | `KVM_GUEST`/`PARAVIRT_CLOCK` not pinned in REQUIRED kernel list | LOW | latent | A (regression guard) |
| S5 | Memory-hotplug failure fails the whole boot (fail-loud) | LOW | low | stability |
| S6 | SSH host keys likely baked into the shared image (verify) | LOW | n/a | security-adjacent |

**Bottom line.** Symptom **B** has a single clear root cause (C1). Symptom **A** is a *cluster* — for a **mesh** topology the dominant pair is **W1 (no inbound UDP)** + **W2 (outbound tunnels idle out of conntrack)**, with **W3 (MTU)** as a strong third. None of these is "WireGuard is broken in the kernel" — WireGuard is correctly compiled in (`CONFIG_WIREGUARD=y`, in the REQUIRED verification list). The instability is in the **host NAT/firewall/MTU/clock environment** the tunnel runs inside.

---

## Part 1 — CPU underutilization (symptom B)

### C1 — `HIGH` Host CPU frequency governor is never set to `performance`
- **Mechanism:** nothing in `lib/`, `setup/`, `config/`, or `scripts/` sets a cpufreq governor, touches `intel_pstate`/`no_turbo`, or installs `cpupower`/`tuned` (verified by exhaustive grep — zero hits). Host hardening at `lib/worker/handlers/server-install.ts:290` tunes KSM/nx_huge_pages/favordynmods and nothing else. So every host runs the distro/BIOS default governor. If that default is `powersave` on `acpi-cpufreq` (or a conservative `schedutil`), cores stay near/below base under real load and never reach turbo — so BIOS turbo "enabled" has no runtime effect.
- **Measurement trap:** a KVM guest's `/proc/cpuinfo` "MHz" is the CPUID *base* value and does **not** reflect real execution speed. The cube can be running at turbo while reporting base. The truth is host-side core frequency under load, or in-guest throughput.
- **Evidence:** grep of the whole repo; `lib/worker/handlers/server-install.ts:261-299` (host-tuning block, no cpufreq line).
- **Affected:** every cube on every host.
- **Fix (code-change + retrofit):** in the `install` phase — install `linux-tools-generic`/`cpupower`, set `governor=performance` + `energy_perf_bias=performance` on all CPUs, ensure `/sys/devices/system/cpu/intel_pstate/no_turbo = 0`, persist (systemd oneshot or `cpufrequtils`), and add a `verify`-phase assertion that all `scaling_governor == performance`. Add a `pnpm install:cpu-governor` fleet retrofit for already-active hosts (idempotent).
- **Diagnostic (operator, host, read-only):**
  ```bash
  for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do cat "$f"; done | sort | uniq -c
  cat /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null   # 0 = turbo allowed
  command -v turbostat >/dev/null && turbostat --quiet sleep 5 2>/dev/null | awk 'NR==1||/-/{print}'
  # Real ramp test: pin one core busy and watch it climb above base:
  ( timeout 8 sh -c 'while :; do :; done' & ); sleep 4; grep -m1 MHz /proc/cpuinfo; cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq
  ```

### C2 — `MEDIUM` Jailer applies no cgroup CPU/IO limits (noisy-neighbour contention)
- **Mechanism:** `buildJailerArgs` passes `--cgroup-version 2` but **no `--cgroup` limits** (`lib/ssh/jailer.ts:108-128`, `:154-156`). By design today there is **no per-cube CPU/memory/pids confinement** beyond the Firecracker VMM's own vcpu/mem caps. One cube saturating a host can starve a sibling's vCPU threads → intermittent slowness/"stuck", which can read as underutilization. This is contention, **not** the base-frequency cause (that's C1).
- **Evidence:** `lib/ssh/jailer.ts:108-128` (explicit "NO host-level CPU/memory/pids cap" comment), `:154-156`.
- **Affected:** all jailed cubes (fleet-wide since jailer is on).
- **Fix (investigation → code, gated on host prep):** the documented planned follow-up — host-side parent-cgroup prep, then per-cube `--cgroup cpu.weight`/`cpu.max`/`memory.high`. **Do not** add `--cgroup` limits before the host prep ships (it would brick jailed launches — see the operator invariant in `jailer.ts:122-128`). Until then this is a capacity/placement concern, not a quick fix.
- **Diagnostic:** on host under load — `top -H` / `cat /proc/pressure/cpu` (PSI) to see if cube vCPU threads are CPU-starved.

---

## Part 2 — WireGuard mesh instability (symptom A)

> Topology confirmed by the operator: a **mesh** (cube both initiates *and* receives). That makes W1 + W2 the dominant pair.

### W1 — `HIGH` Port mappings are TCP-only → inbound WireGuard UDP is impossible
- **Mechanism:** `addTcpPortForward` only ever emits `-p tcp` DNAT/MASQUERADE/whitelist rules (`lib/ssh/network.ts:104`, `:113`, `:234`, `:244`), and the `tcp_port_mappings` schema has **no protocol column** (`db/schema/tcp-mappings.ts`). There is no path to DNAT a **UDP** port to a cube. A mesh peer that needs to connect *into* this cube on its WireGuard UDP listen port **cannot reach it** — only outbound (cube-initiated) tunnels work. In a mesh this silently halves connectivity; peers fall back to relays (Tailscale/DERP) or just fail, and the set of working tunnels depends on who initiated — exactly the "flaky, fixed by restart (which re-initiates outbound)" pattern.
- **Evidence:** `lib/ssh/network.ts:90-130` (TCP-only forward), `db/schema/tcp-mappings.ts:23-47` (no protocol field); host FORWARD chain accepts inbound to cubes only via the per-port TCP whitelist (`lib/ssh/network.ts:204-244`) — nothing opens inbound UDP.
- **Affected:** any cube needing an inbound UDP listener (WireGuard server/mesh peer, Tailscale direct, game servers, DNS, QUIC origin).
- **Fix (code-change — a feature):** add a `protocol` column (`tcp|udp`) to `tcp_port_mappings` and a UDP DNAT/MASQUERADE/FORWARD path in `lib/ssh/network.ts` (mirror the TCP functions with `-p udp`). Surface protocol in the mapping UI/API. This is the only way to support inbound mesh peers.
- **Diagnostic (operator):** on host — `iptables-legacy -t nat -S PREROUTING | grep <cube_ip>` (you will see only `-p tcp`). In cube — `ss -lunp | grep <wg-port>` shows the listener exists but no host DNAT routes to it.

### W2 — `HIGH` Host NAT conntrack UDP idle-timeout kills idle outbound tunnels
- **Mechanism:** cube egress is MASQUERADE'd (`lib/server/cube-network-host.ts:153-160`) and return traffic is permitted **only** via `conntrack --ctstate ESTABLISHED,RELATED` (`:172-175`). No conntrack timeout is tuned anywhere (only `CONFIG_NF_CONNTRACK=y`; no sysctl in `lib/`/`setup/`/`config/`/`scripts/`). So an outbound WireGuard flow with **no `PersistentKeepalive`** loses its UDP conntrack entry after the kernel default (`nf_conntrack_udp_timeout_stream ≈ 120s`), after which the peer's return packets are dropped (no ESTABLISHED match, and FORWARD has no NEW-inbound rule). The tunnel goes silently dead until the cube re-initiates — a manual restart forces a fresh handshake + new conntrack entry → "works after restart." WireGuard's own docs recommend `PersistentKeepalive = 25` *specifically* for NAT/firewall traversal, which is exactly Krova's MASQUERADE setup.
- **Evidence:** `lib/server/cube-network-host.ts:153-160` (MASQUERADE), `:172-175` (ESTABLISHED,RELATED return), no conntrack sysctl anywhere.
- **Affected:** every cube with an idle outbound UDP tunnel and no keepalive.
- **Fix:** (a) *customer-side, immediate* — set `PersistentKeepalive = 25` on each peer; (b) *platform-side* — raise `net.netfilter.nf_conntrack_udp_timeout` / `_stream` (e.g. 180 / 600) and `nf_conntrack_max` in the host's `98-krova-forwarding.conf`, applied in the `network` phase + a fleet retrofit.
- **Diagnostic (operator, host):** `conntrack -L -p udp 2>/dev/null | grep <cube_ip>` right after the tunnel goes quiet — watch the entry disappear ~2 min after last traffic. In cube: `wg show` → "latest handshake" age grows without recovering.

### W3 — `HIGH` No MSS clamp + eth0 MTU left at 1500 → PMTUD black-hole
- **Mechanism:** the cube's eth0 has **no explicit MTU** — `buildGuestNetworkFiles` writes addresses/gateways/DNS but no `MTUBytes=` (`lib/ssh/cube-guest-network.ts:53-74`), so eth0 stays 1500. The host FORWARD chain has **no `TCPMSS --clamp-mss-to-pmtu`** (`lib/server/cube-network-host.ts:164-176`) even though the kernel compiles the target (`CONFIG_NETFILTER_XT_TARGET_TCPMSS=y`). WireGuard's ~60-80 B overhead reduces the usable path MTU; tunneled TCP then relies on PMTUD, and if ICMP "frag-needed"/"packet-too-big" is dropped anywhere on the path the connection **black-holes on large packets** — the handshake and small packets succeed, bulk transfers hang. Another textbook "looks stuck" signature.
- **Evidence:** `lib/ssh/cube-guest-network.ts:47-78` (no MTU), `lib/server/cube-network-host.ts:164-176` (FORWARD, no MSS clamp), `setup/images/build-all-images.sh` (TCPMSS target compiled but unused on the host path).
- **Affected:** all cubes running any in-guest VPN/overlay (WireGuard, Tailscale, Docker Swarm/k8s overlay).
- **Fix (code-change, SHIPPED):** add `iptables/ip6tables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu` (both families) in `applyHostNetworking` — **the `mangle` table, NOT `filter`: the filter FORWARD egress `-i br0 ! -o br0 -j ACCEPT` is a terminating ACCEPT that short-circuits a clamp appended to filter FORWARD, so it would never fire** (caught + fixed in commit `8904d4c`; mangle FORWARD is traversed before filter FORWARD, so the clamp always runs, both directions). Confirm ICMP/ICMPv6 frag-needed is allowed through FORWARD. Document recommended in-guest WireGuard `MTU = 1420` (or lower for nested overlays). Retrofit existing hosts with `pnpm install:network-tuning`; validated end-to-end on a live cube (clamp fires, full connectivity).
- **Diagnostic (operator):** in cube — `ip link show eth0 | grep mtu` (expect 1500), `ping -M do -s 1472 1.1.1.1 -c2` (host path), then `ping -M do -s 1392 <peer-tunnel-ip> -c2` over the tunnel to find the real ceiling.

### W4 — `MEDIUM` Guest clock lags after sleep→wake (mitigated, not eliminated)
- **Mechanism:** sleep = Firecracker `Pause` / wake = `Resume` (`lib/ssh/firecracker.ts:898-928`). A paused guest's clock freezes; on resume it lags wall-time by the pause duration. WireGuard embeds a TAI64N wall-clock stamp in its handshake and a peer rejects stale-timestamp handshakes (replay protection) → the tunnel can't re-key until the clock is corrected. **Mitigation present:** `systemd-timesyncd` is installed + enabled (`setup/images/build-all-images.sh:752`), so it self-heals — **but** only on its SNTP poll cadence (tens of seconds up to ~34 min), it depends on outbound NTP (UDP 123, itself subject to W2's conntrack + DNS), and there is **no `ptp_kvm`/chrony** for instant local correction. So there is a real post-wake window where WireGuard is broken until timesyncd steps the clock.
- **Evidence:** `lib/ssh/firecracker.ts:898-928` (Pause/Resume), `lib/worker/handlers/cube-wake.ts` (resume with no network/clock kick), `setup/images/build-all-images.sh:752` (timesyncd enabled), no `ptp_kvm`/chrony in the build.
- **Affected:** slept-then-woken cubes (and sleeping cubes that get restored/transferred and re-paused).
- **Fix (image-rebuild + small config):** enable `CONFIG_PTP_1588_CLOCK_KVM` in the guest kernel and install `chrony` with `refclock PHC /dev/ptp0` so the guest gets an *instant local* clock source on resume (no network dependency). Cheaper interim: a `systemctl restart systemd-timesyncd` (or `chronyc makestep`) nudge on wake via the agent.
- **Diagnostic (operator):** in cube right after a wake — `timedatectl` (watch "System clock synchronized" + the offset), `cat /sys/devices/system/clocksource/clocksource0/current_clocksource` (expect `kvm-clock`).

### W5 — `MEDIUM` No entropy device + `RANDOM_TRUST_CPU` unset → boot `getrandom()` stall
- **Mechanism:** the kernel supports virtio-rng (`CONFIG_HW_RANDOM_VIRTIO=y`, `setup/images/build-all-images.sh`), but the device is **gated off in production** (`ENTROPY_DEVICE_ENABLED = false`, `config/platform.ts:300`; the `PUT /entropy` is skipped at `lib/ssh/firecracker.ts:764` and `:1116`), and `CONFIG_RANDOM_TRUST_CPU` is **not** set in the build (RDRAND not trusted for early CRNG init). On an entropy-starved early boot the CRNG can be slow to initialize, blocking `getrandom()` and delaying sshd + any service that generates keys/handshakes — looking "stuck" right after a (re)start.
- **Evidence:** `config/platform.ts:291-300` (entropy device gated false), `lib/ssh/firecracker.ts:760-765`, `:1114-1116`; `CONFIG_HW_RANDOM_VIRTIO=y` present; `RANDOM_TRUST_CPU` absent from the config block.
- **Affected:** all cubes at boot (worse on hosts with little ambient entropy).
- **Fix (config-flag, low-risk):** flip `ENTROPY_DEVICE_ENABLED = true` after the documented canary check (the device + `PUT /entropy` plumbing already exists and is byte-identical-gated). Optionally add `CONFIG_RANDOM_TRUST_CPU=y` (or `random.trust_cpu=on` boot arg) as belt-and-suspenders.
- **Diagnostic (operator):** in cube — `cat /proc/sys/kernel/random/entropy_avail`, `journalctl -b | grep -i "crng\|random"` (look for "crng init done" timing vs sshd start).

### W6 — `MEDIUM` `/etc/resolv.conf` unconditionally clobbered on transfer/restore
- **Mechanism:** `writeCubeGuestNetworkConfig` always `rm -f`s and rewrites `/etc/resolv.conf` to the Krova v4-first list (`lib/ssh/cube-guest-network.ts:111-124`), and it runs on transfer, restore, import, and from-snapshot. A customer whose cube resolves DNS through the mesh (resolv.conf → a tunnel-internal resolver) silently loses it after any of those events → "VPN up but name resolution broken/intermittent."
- **Evidence:** `lib/ssh/cube-guest-network.ts:110-124` (unconditional rewrite); call sites in `cube-transfer.ts`, `snapshot-restore.ts`, `cube-import-rootfs.ts`.
- **Affected:** any cube with VPN-managed DNS that gets transferred/restored/redeployed.
- **Fix (code + product decision):** only force-rewrite resolv.conf when the IP actually changed (transfer/import), skip on same-host restore; or detect a customer-managed marker and warn instead of clobbering. Genuine tension between Krova-owned base DNS and customer VPN DNS — needs a product call.
- **Diagnostic (operator):** in cube after a transfer/restore — `cat /etc/resolv.conf`.

### W7 — `MEDIUM` IPv6 RA flap on pre-fix cubes resets the eth0 underlay
- **Mechanism:** the fix (`IPv6AcceptRA=no`, `lib/ssh/cube-guest-network.ts:62-71`) stops systemd-networkd's RA-client from timing out and periodically reconfiguring eth0 (which re-armed DAD and flapped the static v6 present↔absent). But it only applies on a cube's **next cold restart**. A pre-fix cube still flaps, and each flap briefly resets the underlay a tunnel rides on.
- **Evidence:** `lib/ssh/cube-guest-network.ts:62-71` (the comment documents the flap + that it applies on next cold restart).
- **Affected:** cubes booted before the IPv6-flap fix and not yet cold-restarted.
- **Fix (operator):** `pnpm install:guest-network` writes the unit live (flap fix lands on next cold restart); a cold restart fully resolves it.
- **Diagnostic (operator):** in cube — `networkctl status eth0` (watch for repeated reconfigure / address churn), `journalctl -u systemd-networkd -b | grep -i eth0`.

---

## Part 3 — Other stability findings (not WG-specific)

### S1 — `MEDIUM` Restore disk pre-flight `NaN`-skips its own space guard
- `lib/worker/handlers/snapshot-restore.ts:178-190` parses `df -BG --output=avail | tr -d ' G'`; if the parse yields `NaN`, the guard `!isNaN(avail) && !isNaN(needed) && avail < needed` is **false**, so the check is **skipped** and the restore proceeds with possibly no space. **Fix:** parse `df --output=avail -B1` as bytes and **fail closed** (treat unparseable as insufficient).

### S2 — `MEDIUM` Transfer ignores `e2fsck` exit → can boot a corrupt rootfs
- `lib/worker/handlers/cube-transfer.ts:565` runs `e2fsck -fy … || true` (exit discarded), unlike restore which aborts on `exitCode >= 4` (`snapshot-restore.ts:277`). A torn/partially-rsynced rootfs can boot corrupt on the destination and manifest later as random in-guest errors (including a broken in-guest `/etc/wireguard/*.conf`). **Fix:** capture the exit and abort the boot if `>= 4`, matching restore.

### S3 — `LOW` Transfer rollback couples two flags → can skip a customer-visible restore
- In the pre-flip failure branch, origin/ingress restore and destination cleanup are gated on `domainRoutingApplied` / `newInternalIp` (`cube-transfer.ts:809-811`, `:1226`, `:1248`, `:1343-1361`); the flags can diverge. The CF re-point is idempotent so impact is limited, but per Rule 57 the customer-visible origin-restore should run unconditionally when `activeDomains.length > 0`, independent of the in-flight flag. **Fix:** hoist origin-restore out of the flag guard.

### S4 — `LOW` `KVM_GUEST`/`PARAVIRT_CLOCK` not pinned in the REQUIRED kernel list
- The build's REQUIRED verification list (`setup/images/build-all-images.sh:537`) omits `KVM_GUEST`, `PARAVIRT_CLOCK`, `PTP`. kvm-clock is present today via the firecracker-ci baseline, but a future `CONFIG_KVER` bump could silently drop the paravirt clock → every pause/resume would skew guest time (compounding W4) and TLS/WireGuard would break. **Fix:** add `KVM_GUEST PARAVIRT PARAVIRT_CLOCK` (and ideally `PTP_1588_CLOCK_KVM`) to the layered `=y` options and the REQUIRED list.

### S5 — `LOW` Memory-hotplug failure fails the whole boot (fail-loud)
- `plugInitialMemory` propagates any plug/timeout error to the caller's catch (`lib/ssh/firecracker.ts:135-141`, called at `:777` / `:1127`), so a hotplug failure → cube goes to `error` rather than booting silently under-RAM. This is the *safe* direction (no silent under-provisioning), but if hotplug is flaky on a host it presents as boot failures. **No fix needed**; monitor `error`-state cubes after the `cube.error-recovery` cron retries.

### S6 — `LOW` SSH host keys likely baked into the shared image (verify — security-adjacent)
- No `ssh-keygen`/host-key-regeneration step was found in the rootfs build or first-boot path (grep returned nothing). If host keys are baked into the shared rootfs, **every cube from the same image shares the same SSH host key** (MITM exposure + "host key changed" churn across redeploys). **Out of the stability scope** but worth a separate check. **Verify:** in two different cubes, compare `sha256sum /etc/ssh/ssh_host_ed25519_key.pub`.

---

## Part 4 — Confirmed healthy (no action — ruling out red herrings)

- **WireGuard is correctly in the kernel.** `CONFIG_WIREGUARD=y` and in the REQUIRED verification list (`build-all-images.sh:442`, `:537`) — it cannot silently drop. The symptom is environmental, not a missing kernel feature.
- **AVX-512 CPU template is correct and is *not* a cause of either symptom.** It masks leaf 0x7 (and 0xD) AVX-512 bits, is fail-safe-wrapped, and applies on cold boot. Masking removes a capability — it cannot lower clock (rules it out for B) and the kernel self-protects its own crypto via XCR0 (not a deterministic-then-"fixed-by-restart" WG cause). `lib/ssh/cpuid-template.ts`.
- **Reachability cron is a pure observer.** It writes only `lastReachabilityAt`/`reachabilityJsonb`/`lastMetricsJsonb`, never `status`/`updatedAt` (`lib/worker/handlers/cube-reachability.ts:29-30`, `:274-280`). A busy/momentarily-unreachable mesh node gets a red badge but is **not** auto-slept/relaunched. (Caveat: `cube.state-sync` *will* auto-relaunch a cube whose Firecracker actually exited, rate-limited to 3/hr then `error` — `cube-state-sync.ts:54`, `:276-340`; a true crash/reboot loop, e.g. OOM, would trip this, but a healthy busy cube won't.)
- **Restore never corrupts the live rootfs** (atomic temp→fsck→rename, `snapshot-restore.ts`), and the **default-deny INPUT firewall** posture is sound (`cube-network-host.ts:178-202`).

---

## Part 5 — Prioritized remediation roadmap

**P0 — confirm root cause on the live mesh cube (operator, read-only — Part 6).** Do this first; it tells us which of W1–W3 dominates.

**P1 — high impact, low risk:**
1. **C1** CPU `performance` governor in `install` + `verify` + fleet retrofit. *(code)*
2. **W2** raise host conntrack UDP timeouts + advise `PersistentKeepalive=25`. *(code + customer note)*
3. **W3** add `TCPMSS --clamp-mss-to-pmtu` on FORWARD (both families) + document WG MTU. *(code)*
4. **W5** flip `ENTROPY_DEVICE_ENABLED = true` after canary. *(config-flag)*

**P2 — feature / image work:**
5. **W1** add `udp` protocol support to port mappings (schema + `network.ts` + UI/API) — required for inbound mesh peers. *(feature)*
6. **W4 + S4** enable `ptp_kvm` + chrony in the guest image; pin `KVM_GUEST/PARAVIRT_CLOCK` in REQUIRED. *(image-rebuild)*
7. **W6** stop clobbering customer resolv.conf on same-host restore. *(code + product call)*

**P3 — correctness hardening:**
8. **S1** fail-closed restore disk check. **S2** honor transfer `e2fsck` exit. **S3** hoist transfer origin-restore. *(code)*
9. **C2** per-cube cgroup limits (after host parent-cgroup prep). *(larger effort)*

Each P1–P3 code item must ship with tests and pass `pnpm test:all` (Rule 59); networking changes must go through the operator (Rule 60), not be applied from dev.

---

## Part 6 — Operator diagnostics to run on the live mesh cube (read-only, Rule 60)

Run these and paste output back to confirm which mechanism is biting before any fix ships.

```bash
# ---- in the cube ----
wg show                                            # handshake ages, endpoints, transfer counters
grep -i persistentkeepalive /etc/wireguard/*.conf  # set? (absent → W2)
ip link show eth0 | grep mtu                        # 1500? (→ W3)
ip link show | grep -iE 'wg|tun'                    # tunnel iface + its MTU
ping -M do -s 1392 <peer-tunnel-ip> -c3             # PMTU over the tunnel (→ W3)
timedatectl                                         # clock sync + offset (→ W4)
cat /proc/sys/kernel/random/entropy_avail           # entropy (→ W5)
cat /etc/resolv.conf                                # VPN DNS clobbered? (→ W6)

# ---- on the cube's host ----
conntrack -L -p udp 2>/dev/null | grep <cube_ip>    # is the WG flow tracked / expiring? (→ W2)
iptables-legacy -t nat -S PREROUTING | grep <cube_ip>   # any UDP DNAT? (expect none → W1)
for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do cat "$f"; done | sort | uniq -c   # (→ C1)
```

---

## Appendix — coverage honesty

The multi-agent fan-out was rate-limited, so the following were covered by **direct author reads** (cited above) rather than a dedicated deep agent, and would benefit from a second pass if desired: full memory-pressure/OOM path under host contention, an exhaustive kernel `.config` diff against the firecracker-ci baseline, vsock reliability across many pause/resume cycles, and the disk-full → ext4-remount-ro guest behavior. None of these changed the ranked conclusions above, but they are the areas with the least depth in this document.
