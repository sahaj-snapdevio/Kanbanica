# Bare-metal host hardening (Firecracker multi-tenant)

Operator guidance for the bare-metal hosts that run customer cubes. Verified
against Firecracker **v1.15.1** `docs/prod-host-setup.md` (the pinned
`FIRECRACKER_VERSION`). This complements the jailer work in
[lib/ssh/jailer.ts](../../lib/ssh/jailer.ts) and the
[2026-05-29 jailer-hardening plan](../superpowers/plans/2026-05-29-firecracker-jailer-hardening.md).

## What the platform does automatically

- **Jailer per cube** — when `JAILER_ENABLED=true`, every cube's Firecracker
  runs under the jailer with a **unique uid AND gid per cube** (`gid = uid`),
  a chroot, and a new PID namespace. That trio is the isolation boundary — a
  VMM/guest escape lands as an unprivileged per-cube uid in a chroot, not root
  on the host. This matches Firecracker's core recommendation: *"Firecracker
  should be started using the jailer binary"* and *"each runs with its unique
  uid and gid."* **cgroups: NOT used for resource confinement (yet).** We pass
  `--cgroup-version 2` only so the jailer never falls back to the cgroup-v1
  hierarchy (the `--cgroup-version` default is `1`), which our cgroup-v2-only
  hosts don't mount — but we pass **no `--cgroup` limits**, so under v1.15.1 the
  jailer creates no cgroup and applies no CPU/memory/pids cap (the VMM's own
  `vcpu_count`/`mem_size`/virtio-mem ceiling plus Krova's allocator overcommit
  accounting are the resource bounds). **Operator invariant: never pre-create
  `/sys/fs/cgroup/firecracker` with domain controllers (memory/cpu/…) enabled in
  its `cgroup.subtree_control`** — the jailer would then try to move Firecracker
  into it and the move fails ("no internal process constraint"), bricking every
  jailed launch on that host. Real per-cube cgroup confinement is a planned
  follow-up (needs host-side parent-cgroup prep to land first).
- **Default seccomp** — we never pass `--no-seccomp` or `--seccomp-filter`.
  Firecracker: *"the most restrictive filters … is the recommended option for
  production"*; *"Production usage of --seccomp-filter or --no-seccomp is not
  recommended."*
- **`/dev/kvm`** — left at the distro default `0660 root:kvm`. Under the jailer
  this is irrelevant to cubes anyway: the jailer mknods its own `/dev/kvm` inside
  each chroot (owned by the cube's uid:gid), so a cube never touches the host node.
- **KSM disabled** — the `install` phase forces Kernel Same-page Merging OFF
  (sysfs + a tmpfiles `0` rule that persists across reboot + disabling any legacy
  KSM unit). KSM is a cross-VM page-dedup side channel and RAM is allocated 1:1
  (`servers.max_ram_overcommit` default `1.0`), so dedup buys no density. The
  `verify` phase asserts `ksm/run = 0`.
- **`kvm nx_huge_pages=never`** — the `install` phase persists this via
  modprobe.d (Firecracker's recommended fix for the Linux 6.1 KVM iTLB-multihit
  boot/perf regression); the `reboot` phase activates it and `verify` asserts it.
- **cgroup v2 `favordynmods`** — remounted by the `install` phase (the alternative
  path for that same 6.1 regression).

## Host INPUT firewall (dual-stack default-deny)

`applyHostNetworking` ([lib/server/cube-network-host.ts](../../lib/server/cube-network-host.ts))
installs a **stateful default-deny `INPUT` chain on BOTH families** (`iptables`
AND `ip6tables`). New servers get it in the `network` setup phase; existing
servers get it from the Phase-6 re-IP migration retrofit. The rules are added
**allow-list-first, then the policy is flipped to DROP** — never DROP before the
allows, or the worker's own SSH session (and every customer service) drops the
moment the policy flips:

- `INPUT -i lo -j ACCEPT`
- `INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT` (keeps the
  worker's live SSH session up across the change)
- `INPUT -p icmp -j ACCEPT` (v4) / `INPUT -p ipv6-icmp -j ACCEPT` (v6 —
  **mandatory**: without ICMPv6, NDP and PMTUD break and IPv6 stops working)
- `INPUT -p tcp --dport 2822 -j ACCEPT` (host SSH — explicitly allowed BEFORE
  the policy flip; host SSH stays on **IPv4 2822**)
- `INPUT -p tcp --dport 80 -j ACCEPT`, `--dport 443 -j ACCEPT`
- `INPUT -p udp --dport 443 -j ACCEPT` (QUIC / HTTP/3 — Caddy listens on UDP 443
  when h3 is in its protocols list; without this rule QUIC packets are silently
  dropped now that the INPUT policy really is DROP)
- then `-P INPUT DROP` on both `iptables` and `ip6tables`.

This is the first time the IPv4 INPUT posture is actually default-deny (the
prior setup left INPUT at the kernel-default ACCEPT, so the QUIC allow rule was
inert — its old "where the INPUT policy is DROP" comment was aspirational).

**Retrofit safety net.** On the existing-fleet retrofit path (`opts.retrofit`),
`applyHostNetworking` arms a backgrounded `sleep 60 && iptables -P INPUT ACCEPT
&& ip6tables -P INPUT ACCEPT` (pid stashed in `/run/krova-fw-rollback.pid`)
**before** the first `-P INPUT DROP`, and **cancels** it only after every allow
rule + both policy flips succeed. So a mistaken allow-list (or an SSH drop
mid-change) auto-reverts to ACCEPT within 60 s rather than locking the worker
out — mirroring the bootstrap phase's sshd_config rollback marker. New-server
runs (the `network` phase) skip the rollback net: there is no live session to
protect, and the `verify` phase re-asserts the policy afterward.

Egress is unrestricted from cubes (the bridge `FORWARD` chain is egress-only:
`-i br0 ! -o br0 ACCEPT` + return `ESTABLISHED,RELATED`), but unsolicited
inbound to the host itself is now denied on both families except the ports
above.

## Operator checklist (manual, per host)

**Most host-level mitigations are now AUTOMATED by the setup phases** (KSM-off,
`nx_huge_pages=never`, cgroup `favordynmods` — see "What the platform does
automatically" above; `install` applies them, `reboot` activates the boot-time
ones, `verify` asserts them). The only item still left to the operator is the
**SMT decision** below; sections 2–3 are retained for reference and for manually
remediating a host that pre-dates the automated hardening.

### 1. Disable SMT for tenant separation — DECISION REQUIRED

Firecracker: *"Disable SMT in production scenarios that require tenant
separation"* because *"SMT is frequently a precondition for speculation
issues"* (Spectre/MDS cross-tenant leakage).

**Krova's default posture: SMT is left ENABLED** — disabling it roughly halves
usable vCPU throughput, and the pricing/capacity model assumes SMT-on. The
residual risk is a cross-tenant timing side channel between cubes co-located on
sibling hyperthreads. Operators who require strict tenant isolation (e.g. a
host dedicated to untrusted/regulated workloads) should disable SMT on that
host:

```bash
echo off > /sys/devices/system/cpu/smt/control   # runtime
# persist: add `nosmt` to the kernel command line
```

### 2. Linux 6.1 KVM mitigations (our kernel is 6.1.x)

Firecracker flags two x86_64 boot regressions specific to Linux ≥ 6.1 (the
host kernel family; our guest kernel is also 6.1.x):

```bash
# (a) nx_huge_pages — avoids an iTLB-multihit mitigation perf cliff
modprobe -r kvm_intel kvm   # or kvm_amd kvm
modprobe kvm nx_huge_pages=never
modprobe kvm_intel           # or kvm_amd
cat /sys/module/kvm/parameters/nx_huge_pages   # expect: never
# persist:
echo "options kvm nx_huge_pages=never" >> /etc/modprobe.d/kvm.conf

# (b) cgroup favordynmods — cgroup v2 (Ubuntu 24.04 default)
mount -o remount,favordynmods /sys/fs/cgroup
# persist: add `cgroup_favordynmods=true` (cgroup v1) or the systemd mount opt
```

### 3. Side-channel / memory hygiene

- Keep the host kernel current and follow the latest
  [kernel hardware-vulnerabilities docs](https://www.kernel.org/doc/html/latest/admin-guide/hw-vuln/index.html).
- ECC RAM with Target Row Refresh — already a hardware promise of our
  bare-metal partners.
- **KSM**: Firecracker recommends disabling Kernel Samepage Merging for
  multi-tenant (it is a cross-VM info-leak vector). Verify `cat /sys/kernel/mm/ksm/run`
  is `0` on cube hosts. (Note: KSM is intentionally enabled on the *Dokploy*
  control-plane host for dedup; it should be **off** on cube hosts.)

### 4. Verify

```bash
spectre-meltdown-checker      # or: wget -O - https://meltdown.ovh | bash
cat /sys/devices/system/cpu/smt/active     # 1 = SMT on (Krova default)
cat /sys/module/kvm/parameters/nx_huge_pages
```
