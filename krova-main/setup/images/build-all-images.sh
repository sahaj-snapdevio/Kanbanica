#!/usr/bin/env bash
# ============================================================================
#
#  Krova Firecracker Image Builder
#  This will be executed only on local machines by developers — not in CI/CD pipelines.
#  It provides a simple way to build the kernel and rootfs images for all supported OSes.
#  This is done because of dedicated server does not need to build images on every commit, and building inside Docker ensures consistent results across different host OSes (Linux/macOS).
#  Dedicated server does not need to install docker as well.
#
#  Builds production-ready kernel + rootfs for all supported OS images.
#  Runs entirely inside Docker — works on macOS and Linux.
#
#  Usage:
#      pnpm build:images                # Build everything (recommended)
#      ./build-all-images.sh            # Same, runs directly without TS wrapper
#      ./build-all-images.sh kernel            # Kernel only
#      ./build-all-images.sh ubuntu-24.04      # Single distro by id
#      ./build-all-images.sh ubuntu-24.04-docker  # Ubuntu + Docker preinstalled
#
#  The supported distro list comes from config/platform.ts CUBE_IMAGES,
#  passed to this script via $KROVA_DISTROS_FILE (the TS wrapper writes a
#  generated bash snippet to a temp file). Direct invocation falls back to
#  a hardcoded list — see DISTRO REGISTRY section below.
#
#  Output:
#      images/
#      ├── kernel/vmlinux
#      └── <distro-id>/rootfs.ext4    (one per CUBE_IMAGES entry)
#
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Output directory can be overridden via KROVA_BUILD_OUTDIR. Required when
# running inside a container that talks to a host docker daemon — the path
# must exist on BOTH the host and the container at the same location so that
# `docker run -v` bind mounts resolve correctly on both sides.
OUTDIR="${KROVA_BUILD_OUTDIR:-$SCRIPT_DIR/images}"
PLATFORM="linux/amd64"
ROOTFS_SIZE_MB=4096
TARGET="${1:-all}"

R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m'
C='\033[0;36m' B='\033[0;34m' NC='\033[0m'

log()    { echo -e "  ${G}✓${NC} $*"; }
warn()   { echo -e "  ${Y}!${NC} $*"; }
err()    { echo -e "  ${R}✗${NC} $*" >&2; }
header() {
    echo ""
    echo -e "${C}┌──────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${C}│${NC}  $1"
    echo -e "${C}└──────────────────────────────────────────────────────────────┘${NC}"
}

if ! docker info &>/dev/null 2>&1; then
    err "Docker is not running"; exit 1
fi

mkdir -p "$OUTDIR"

# Stage krova-agent into $OUTDIR so the inner `docker run -v` bind mount
# resolves on the host docker daemon. $SCRIPT_DIR (e.g. /app/setup/images)
# only exists inside the worker container; $OUTDIR is bind-mounted at the
# same path on both sides, so the file is visible to the host daemon.
AGENT_STAGED="$OUTDIR/krova-agent"
cp "$SCRIPT_DIR/krova-agent" "$AGENT_STAGED"
chmod 0755 "$AGENT_STAGED"

echo ""
echo -e "${G}  Krova Firecracker Image Builder${NC}"
echo -e "  Target: ${C}${TARGET}${NC}  Platform: ${C}x86_64${NC}"
echo -e "  Output: ${C}${OUTDIR}${NC}"

# ============================================================================
#  KERNEL
# ============================================================================

build_kernel() {
    header "Kernel — Building Docker-capable Firecracker vmlinux (6.1 LTS)"
    mkdir -p "$OUTDIR/kernel"

    # Always rebuild — remove any prior artifact so a partial/aborted previous
    # run cannot leave a stale vmlinux in place.
    rm -f "$OUTDIR/kernel/vmlinux"

    # Build from source instead of pulling Firecracker's CI vmlinux. Their CI
    # binary is intentionally minimal (Firecracker boots, runs hello-world)
    # and lacks the kernel features Docker / OCI runtimes need:
    # overlay filesystem, br_netfilter, veth, bridge, iptables NAT, IPVS,
    # vxlan, user namespaces, the cgroup_pids/blkio/bpf controllers.
    # Without those, dockerd refuses to start inside a Cube — every Dokploy /
    # k3s / generic container workload fails.
    #
    # We layer Docker-required `=y` options on top of Firecracker's official
    # microvm-kernel-ci-x86_64-6.1 baseline, then `make olddefconfig` to
    # resolve dependencies. All required options are compiled in (`=y`) because
    # we build ONLY `make vmlinux` (never `make modules_install`), so the rootfs
    # has no `/lib/modules/<kver>` tree — any feature built as a module (`=m`)
    # would have no `.ko` to load at runtime. So every feature the guest needs
    # must be `=y`. (CONFIG_MODULES stays `=y` — a few userspace tools probe for
    # module support — but no required feature ships as `=m`; even the
    # modules-load.d/vsock.conf entry is a no-op since VIRTIO_VSOCKETS is `=y`.)
    #
    # Build is heavy: ~120 MB source download + 10–25 min compile on a beefy
    # builder, output vmlinux ~80–150 MB (~160 MB with DEBUG_INFO_BTF for
    # bpftrace). No cache — every invocation rebuilds.
    docker run --rm --platform "$PLATFORM" \
        -v "$OUTDIR/kernel:/out" \
        -e "FC_VERSION=${FC_VERSION:-v1.15.1}" \
        -e "KVER=${KVER:-6.1.174}" \
        -e "CONFIG_KVER=${CONFIG_KVER:-6.1.155}" \
        ubuntu:24.04 bash -c '
        set -euo pipefail
        export DEBIAN_FRONTEND=noninteractive

        echo "  Installing build deps..."
        apt-get update -qq >/dev/null 2>&1
        # `file` is needed for the ELF verification step at the end.
        apt-get install -y -qq curl wget xz-utils ca-certificates \
            build-essential bc bison flex libssl-dev libelf-dev libncurses-dev \
            cpio kmod rsync file >/dev/null 2>&1

        # KVER = kernel SOURCE version we compile (latest 6.1 LTS — security).
        # CONFIG_KVER = Firecracker CI baseline config we layer on top.
        #
        # These differ on purpose. Firecracker CI publishes ONLY ONE config
        # per Firecracker release line in their S3 bucket — currently
        # vmlinux-6.1.155.config for v1.15.x. They do NOT publish a fresh
        # config for every kernel patch release. Verified by listing the
        # bucket prefix on 2026-05-09:
        #   firecracker-ci/v1.15/x86_64/vmlinux-5.10.245.config
        #   firecracker-ci/v1.15/x86_64/vmlinux-6.1.155.config
        # — those are the only two configs in the v1.15 prefix. Spot-probed
        # 6.1.156, .160, .165, .170, .171, .172 — all 404.
        #
        # The fix is the standard kernel forward-config pattern: take the
        # older config, drop it into the newer source tree, run
        # `make olddefconfig` (we already do this further down). Any new
        # CONFIG_* options added between 6.1.155 and the current source
        # version get filled in with their kernel-default values, while
        # everything Firecracker CI explicitly chose carries forward.
        #
        # Why bump KVER: 6.1.174 (latest 6.1 LTS) closes
        # CVE-2026-31431 ("Copy Fail" — algif_aead LPE, CISA KEV active
        # exploitation, fixed in 6.1.170), CVE-2026-43284 / CVE-2026-43500
        # ("Dirty Frag" — xfrm-ESP / RxRPC LPE, public PoC, fixed in
        # 6.1.171), virtio-vsock CVE-2026-23086/-23069 (relevant to our
        # vsock guestExec path), and netfilter CVE-2026-31414. Cubes are
        # multi-tenant; a guest-local LPE means a non-root container in a
        # customer Cube can become root inside that same Cube. Firecracker
        # microVM boundary still holds — this is per-Cube blast radius —
        # but customer expectations are root-stays-root.
        #
        # When to bump CONFIG_KVER: only when Firecracker CI ships a newer
        # baseline (re-run the bucket listing periodically). When upgrading
        # KVER across a major LTS line (e.g. 6.1.x → 6.6.x), expect to also
        # update CONFIG_KVER and re-verify the resulting kernel boots.
        #
        # KVER and CONFIG_KVER are normally injected by scripts/build-images.ts
        # from config/platform.ts. The fallbacks here only kick in if someone
        # invokes this shell script directly without the tsx wrapper — keep
        # them in sync with the constants if you ever take that path.
        KVER="${KVER:-6.1.174}"
        CONFIG_KVER="${CONFIG_KVER:-6.1.155}"
        FC_VER="${FC_VERSION:-v1.15.1}"

        echo "  Downloading Linux $KVER source..."
        cd /tmp
        wget -q "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-$KVER.tar.xz"
        tar xf "linux-$KVER.tar.xz"
        cd "linux-$KVER"

        # Fetch the EXACT config the Firecracker CI uses for its prebuilt
        # vmlinux. This is the post-olddefconfig config from S3, not the
        # short "starting point" baseline in the Firecracker source repo.
        #
        # Why this matters: the source-repo baseline is incomplete — it omits
        # critical options that olddefconfig pulls in based on dependencies
        # the source-repo version doesnt express, including:
        #   - CONFIG_GENERIC_MSI_IRQ=y (required for modern virtio_mmio MSI-X)
        #   - CONFIG_GENERIC_MSI_IRQ_DOMAIN=y
        #   - CONFIG_PCI=y plus PCI infrastructure
        #   - CONFIG_LIBNVDIMM=y, CONFIG_DAX=y (for virtio-pmem)
        #   - CONFIG_BLK_MQ_PCI=y
        # Without those, modern virtio_mmio probes fail with EINVAL because
        # the device cannot allocate MSI-X interrupt vectors. Firecracker
        # speaks modern virtio over MMIO and requires these.
        #
        # Verified by diffing the source-repo baseline against the S3
        # vmlinux-X.Y.Z.config for the same release tag — the S3 one is
        # ~300 lines longer with all the runtime-essential options included.
        # The S3 config ships alongside the Firecracker CI prebuilt vmlinux
        # at the same path, so its guaranteed to match the working binary.
        echo "  Fetching Firecracker CI-validated config ($CONFIG_KVER from S3, will olddefconfig forward to $KVER)..."
        wget -qO .config "https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.15/x86_64/vmlinux-$CONFIG_KVER.config"
        if [[ ! -s .config ]]; then
            echo "ERROR: Failed to fetch Firecracker CI kernel config from S3" >&2
            exit 1
        fi

        echo "  Layering Docker / OCI runtime kernel options on top..."
        # All =y. Cross-referenced against moby/moby contrib/check-config.sh
        # plus what Dokploy (Swarm-based) requires. Listed by category.
        #
        # Heredoc delimiter is QUOTED (<<"EOF" — double quotes used because
        # we are inside an outer bash -c single-quoted block, so apostrophes
        # would terminate the wrapper). Quoted delimiter means the body is
        # treated as literal text — NO variable expansion, NO backtick
        # command substitution, NO $(cmd). If you ever drop a backtick or a
        # $ into a comment in the body, the unquoted form would try to
        # execute it. Lesson learned the hard way; do not unquote without
        # removing those characters first.
        cat >> .config <<"EOF"
# === nftables — modern netfilter (post-iptables) ===
#
# Why we add this on top of the Firecracker CI baseline (which explicitly
# disables CONFIG_NF_TABLES): every modern Linux distro ships userspace
# tools that default to nftables — our supported guest distro
# (Ubuntu 24.04) ships iptables-nft as the default iptables
# binary, plus customer-installed tooling (firewalld nft mode, kube-proxy
# nft mode, Cilium, modern observability agents) increasingly assume
# nftables in the kernel.
#
# Without these options, any nft userspace call returns
# "Failed to initialize nft: Protocol not supported" and the calling
# tool either silently misbehaves or refuses to start.
#
# Pairing strategy: the rootfs leaves the distro-shipped iptables-nft
# as the default `iptables` binary (no update-alternatives switch). With
# nftables in the kernel AND iptables-nft in userspace, Docker / firewalld /
# kube-proxy / customer tooling all work natively. This is also forward-
# compatible — newer distros are increasingly dropping the iptables-legacy
# package entirely.
CONFIG_NF_TABLES=y
CONFIG_NF_TABLES_INET=y
CONFIG_NF_TABLES_NETDEV=y
CONFIG_NF_TABLES_IPV4=y
CONFIG_NF_TABLES_IPV6=y
CONFIG_NFT_NUMGEN=y
CONFIG_NFT_CT=y
CONFIG_NFT_CONNLIMIT=y
CONFIG_NFT_LOG=y
CONFIG_NFT_LIMIT=y
CONFIG_NFT_MASQ=y
CONFIG_NFT_REDIR=y
CONFIG_NFT_NAT=y
CONFIG_NFT_TUNNEL=y
CONFIG_NFT_QUEUE=y
CONFIG_NFT_QUOTA=y
CONFIG_NFT_REJECT=y
# NFT_REJECT_INET is a hidden symbol — defaults to NFT_REJECT, no prompt.
CONFIG_NFT_COMPAT=y
CONFIG_NFT_HASH=y
# NFT_FIB itself is a hidden symbol — auto-selected by the NFT_FIB_* below.
CONFIG_NFT_FIB_INET=y
CONFIG_NFT_FIB_IPV4=y
CONFIG_NFT_FIB_IPV6=y
CONFIG_NFT_XFRM=y
CONFIG_NFT_SOCKET=y
CONFIG_NFT_TPROXY=y
CONFIG_NFT_SYNPROXY=y
CONFIG_NFT_DUP_NETDEV=y
CONFIG_NFT_FWD_NETDEV=y
CONFIG_NFT_DUP_IPV4=y
CONFIG_NFT_DUP_IPV6=y
CONFIG_NF_DUP_NETDEV=y

# === Container runtime additions on top of Firecracker CI config ===
# Storage driver (Docker overlay2)
CONFIG_OVERLAY_FS=y
# Container networking — bridge + veth pair for each container netns
CONFIG_BRIDGE=y
CONFIG_BRIDGE_NETFILTER=y
CONFIG_VETH=y
# Overlay networks (Docker Swarm cross-host)
CONFIG_VXLAN=y
# MODULES framework — Firecracker S3 baseline has it unset to keep vmlinux tiny,
# but several Docker / observability symbols depend on MODULES (e.g. BPF_JIT).
# Compiling the framework in does NOT make runtime modprobe useful — we build
# only `make vmlinux` (no `make modules_install`), so the rootfs has no
# /lib/modules/<kver> tree and there is nothing to load. This just unlocks =y
# settings for symbols whose Kconfig says `depends on MODULES`. Every feature
# the guest actually needs is `=y` (built-in), not `=m`.
CONFIG_MODULES=y
# Netfilter Xtables umbrella — required for IP_NF_*, all XT_* matches/targets.
# (NETFILTER_NETLINK is a hidden auto-select-only symbol; the things that need
# it — NF_TABLES, IP_SET — already select it transitively, so we do not list it.)
CONFIG_NETFILTER_XTABLES=y
# Tracing infrastructure — TRACING, PROBE_EVENTS, DYNAMIC_EVENTS are hidden
# symbols (no Kconfig prompt) auto-selected by KPROBE_EVENTS / UPROBE_EVENTS.
# Setting them directly here would be silently dropped by olddefconfig; we rely
# on the select-chain from KPROBE_EVENTS / UPROBE_EVENTS further below.
# iptables NAT for "-p" port publishing + masquerading
CONFIG_NF_NAT=y
CONFIG_NF_CONNTRACK=y
CONFIG_IP_NF_NAT=y
CONFIG_IP6_NF_NAT=y
CONFIG_NETFILTER_XT_NAT=y
CONFIG_NETFILTER_XT_MATCH_ADDRTYPE=y
CONFIG_NETFILTER_XT_MATCH_CONNTRACK=y
CONFIG_NETFILTER_XT_MATCH_IPVS=y
CONFIG_NETFILTER_XT_MATCH_MULTIPORT=y
CONFIG_NETFILTER_XT_TARGET_MASQUERADE=y
CONFIG_IP_NF_TARGET_MASQUERADE=y
CONFIG_IP_NF_TARGET_REDIRECT=y
CONFIG_NF_NAT_REDIRECT=y
CONFIG_NF_CONNTRACK_FTP=y
CONFIG_NF_NAT_FTP=y
# IPVS for Docker Swarm built-in load balancing.
# Schedulers: RR (default), SH (source-hash for stickiness), WRR + LC for
# completeness. Proto: TCP+UDP. NFCT integrates IPVS with conntrack.
CONFIG_IP_VS=y
CONFIG_IP_VS_NFCT=y
CONFIG_IP_VS_RR=y
CONFIG_IP_VS_SH=y
CONFIG_IP_VS_WRR=y
CONFIG_IP_VS_LC=y
CONFIG_IP_VS_PROTO_TCP=y
CONFIG_IP_VS_PROTO_UDP=y
# Docker Swarm LB requires fwmark manipulation on the mangle table.
# NETFILTER_ADVANCED gates the MARK/CONNMARK target+match symbols — without
# it, olddefconfig silently drops every CONFIG_NETFILTER_XT_*MARK option.
# Smoking gun before this fix: dockerd "Failed to add firewall mark rule ...
# Extension MARK revision 0 not supported, missing kernel module" → /proc/net/ip_vs
# stays empty → swarm overlay services hang on first cross-container TCP.
CONFIG_NETFILTER_ADVANCED=y
CONFIG_NETFILTER_XT_MARK=y
CONFIG_NETFILTER_XT_TARGET_MARK=y
CONFIG_NETFILTER_XT_MATCH_MARK=y
CONFIG_NETFILTER_XT_CONNMARK=y
CONFIG_NETFILTER_XT_TARGET_CONNMARK=y
CONFIG_NETFILTER_XT_MATCH_CONNMARK=y
# iptables tables Docker REQUIREs (per moby/contrib/check-config.sh). Most
# are in the Firecracker S3 baseline already; setting explicitly + verifying
# in REQUIRED keeps us immune to future baseline changes.
CONFIG_IP_NF_FILTER=y
CONFIG_IP_NF_MANGLE=y
CONFIG_IP_NF_RAW=y
CONFIG_IP6_NF_FILTER=y
CONFIG_IP6_NF_MANGLE=y
CONFIG_IP6_NF_RAW=y
# Bridge VLAN filtering — silences the "set bridge default vlan failed:
# default_pvid: permission denied" warning dockerd logs during stack deploys.
CONFIG_BRIDGE_VLAN_FILTERING=y
# Cgroup controllers Docker REQUIREs (in addition to existing CGROUP_PIDS,
# CGROUP_BPF, BLK_CGROUP further down). Likely in baseline — explicit for safety.
CONFIG_CGROUP_DEVICE=y
CONFIG_CGROUP_FREEZER=y
CONFIG_KEYS=y
# Optional libnetwork drivers users may select for non-bridge networks.
CONFIG_IPVLAN=y
CONFIG_MACVLAN=y
# User namespaces (rootless Docker, userns-remap)
CONFIG_USER_NS=y
# Cgroup features Docker uses for limits / accounting.
# CFS_BANDWIDTH (Docker --cpus) requires FAIR_GROUP_SCHED, which requires
# CGROUP_SCHED (the CPU controller menuconfig) — Firecracker baseline does
# not enable CGROUP_SCHED so we do it here.
CONFIG_CGROUP_SCHED=y
CONFIG_FAIR_GROUP_SCHED=y
CONFIG_CFS_BANDWIDTH=y
CONFIG_CGROUP_PIDS=y
CONFIG_CGROUP_BPF=y
CONFIG_BLK_CGROUP=y
CONFIG_CGROUP_NET_PRIO=y
CONFIG_CGROUP_NET_CLASSID=y
# The remaining cgroup controllers Docker / Kubernetes REQUIRE (per
# moby/contrib/check-config.sh): MEMCG backs container memory limits
# (docker run --memory, k8s memory requests/limits), CPUSETS backs
# --cpuset-cpus / k8s cpuManagerPolicy=static, CGROUP_CPUACCT backs per-cgroup
# CPU accounting. All depend only on CGROUPS (already on) so olddefconfig keeps
# them; explicit + REQUIRED-verified so a future baseline change cannot silently
# drop container memory/cpu limit support.
CONFIG_MEMCG=y
CONFIG_CPUSETS=y
CONFIG_CGROUP_CPUACCT=y
# Namespace foundations the container runtimes + the Firecracker jailer rely on.
# Baseline-default and already proven present (jailed cubes boot with
# --new-pid-ns, systemd needs the rest), but pinned explicitly so the guest
# never regresses to a kernel that cannot run containers.
CONFIG_NAMESPACES=y
CONFIG_NET_NS=y
CONFIG_PID_NS=y
CONFIG_IPC_NS=y
CONFIG_UTS_NS=y
# Security
CONFIG_SECCOMP=y
CONFIG_SECCOMP_FILTER=y
CONFIG_SECURITY=y
CONFIG_SECURITYFS=y
CONFIG_SECURITY_APPARMOR=y
CONFIG_SECURITY_APPARMOR_INTROSPECT_POLICY=y
# RESTRICT_USERNS and UNCONFINED_INIT are AppArmor extensions added after v6.1
# (Ubuntu / newer mainline kernels) — not present in v6.1.155 mainline Kconfig.
CONFIG_SECURITY_YAMA=y
CONFIG_AUDIT=y
CONFIG_AUDITSYSCALL=y

# === VPS-equivalent guest kernel features ===
# These give cube guests the same Linux feature surface as a stock Ubuntu /
# Debian VPS, so customer software (containers, VPNs, observability,
# fancy filesystems, modern firewalls) just works without "missing kernel
# module" errors. Only features safe for guest use are enabled here — KEXEC,
# BPF_LSM, FTRACE, hibernation, MD RAID, and other things that would either
# threaten host isolation or add cost-without-value on a single-disk microVM
# are deliberately omitted.

# Filesystems beyond ext4/overlay — userspace tools (btrfs-progs, xfsprogs,
# nfs-utils, samba, fuse) are installed in the rootfs; without these kernel
# options those tools would fail at mount time.
CONFIG_BTRFS_FS=y
CONFIG_BTRFS_FS_POSIX_ACL=y
CONFIG_XFS_FS=y
CONFIG_XFS_POSIX_ACL=y
CONFIG_FUSE_FS=y
CONFIG_NFS_FS=y
# NETWORK_FILESYSTEMS is the umbrella menuconfig under which NFS_FS / NFSD /
# CIFS live; baseline likely already has it but explicit is safer.
CONFIG_NETWORK_FILESYSTEMS=y
CONFIG_NFS_V4=y
CONFIG_NFSD=y
CONFIG_NFSD_V4=y
CONFIG_CIFS=y
CONFIG_AUTOFS_FS=y

# LUKS + LVM thin/snapshot — common in VPS persistent-data setups.
# MD is the parent menuconfig (Multiple devices driver — RAID + LVM); BLK_DEV_DM
# lives inside the `if MD` block. Without MD, olddefconfig silently drops every
# DM_* sub-option. Firecracker S3 baseline does not enable MD/DM since microVMs
# do not need it.
CONFIG_MD=y
CONFIG_BLK_DEV_DM=y
CONFIG_DM_CRYPT=y
CONFIG_DM_THIN_PROVISIONING=y
CONFIG_DM_SNAPSHOT=y

# VPN + tunneling — WireGuard, OpenVPN/Tailscale (need TUN), VLAN trunks,
# GRE. Major customer expectation; refusing would surprise users.
CONFIG_TUN=y
CONFIG_WIREGUARD=y
CONFIG_VLAN_8021Q=y
# IP-in-IP tunneling (the underlying CONFIG_NET_IP_TUNNEL is a hidden symbol
# auto-selected by NET_IPIP / NET_IPGRE — there is no settable IP_TUNNEL).
CONFIG_NET_IPIP=y
CONFIG_NET_IPGRE_DEMUX=y
CONFIG_NET_IPGRE=y

# eBPF stack for observability (Cilium, bcc base) + dynamic tracing.
# FTRACE is the parent menuconfig under which KPROBE_EVENTS / UPROBE_EVENTS
# live — without it, those silently drop. PERF_EVENTS is a UPROBE_EVENTS dep.
# Deliberately skipping: BPF_LSM (security policy in BPF — extra attack surface),
# FUNCTION_TRACER (perf cost even when unused), DEBUG_INFO_BTF (doubles vmlinux
# size and needs full DEBUG_INFO choice setup + dwarves toolchain — customers
# who specifically need bpftrace CO-RE can rebuild a kernel with these on).
CONFIG_BPF_SYSCALL=y
CONFIG_BPF_JIT=y
CONFIG_BPF_JIT_ALWAYS_ON=y
# BPF_EVENTS is a hidden symbol — auto-selected when KPROBE_EVENTS / UPROBE_EVENTS
# are enabled below.
CONFIG_FTRACE=y
CONFIG_PERF_EVENTS=y
CONFIG_KPROBES=y
CONFIG_KPROBE_EVENTS=y
CONFIG_UPROBE_EVENTS=y

# TCP performance — BBR congestion control + modern qdiscs. NET_SCHED is the
# parent menuconfig; sub-options below get silently dropped without it.
CONFIG_NET_SCHED=y
CONFIG_TCP_CONG_BBR=y
CONFIG_NET_SCH_FQ=y
CONFIG_NET_SCH_FQ_CODEL=y
CONFIG_NET_SCH_CAKE=y
CONFIG_NET_CLS_BPF=y

# Netfilter extras Kubernetes / firewalld / docker-iptables expect.
CONFIG_NETFILTER_XT_MATCH_LIMIT=y
CONFIG_NETFILTER_XT_MATCH_STATE=y
CONFIG_NETFILTER_XT_MATCH_COMMENT=y
CONFIG_NETFILTER_XT_MATCH_HASHLIMIT=y
CONFIG_NETFILTER_XT_MATCH_RECENT=y
CONFIG_NETFILTER_XT_MATCH_OWNER=y
CONFIG_NETFILTER_XT_TARGET_LOG=y
CONFIG_NETFILTER_XT_TARGET_TCPMSS=y
CONFIG_NF_CONNTRACK_MARK=y
CONFIG_NF_CONNTRACK_LABELS=y
CONFIG_IP_SET=y
CONFIG_IP_SET_HASH_IP=y
CONFIG_IP_SET_HASH_NET=y

# Kernel TLS — userspace opt-in (gRPC/HTTPS proxies); free if unused.
CONFIG_TLS=y

# Misc
CONFIG_POSIX_MQUEUE=y
CONFIG_DUMMY=y

# virtio-mem live memory hotplug (required for live RAM resize).
# VIRTIO_MEM in Linux 6.1 depends on MEMORY_HOTPLUG + MEMORY_HOTREMOVE;
# CONTIG_ALLOC and EXCLUSIVE_SYSTEM_RAM are hidden def_bool symbols that
# olddefconfig auto-enables from those deps — no explicit entry needed.
# CONFIG_MEMORY_FAILURE is intentionally omitted: it depends on
# ARCH_SUPPORTS_MEMORY_FAILURE which requires CONFIG_X86_MCE, and the
# Firecracker CI base config deliberately disables MCE (attack-surface
# reduction). VIRTIO_MEM in 6.1 neither depends on nor selects
# MEMORY_FAILURE, so live RAM resize works without it.
CONFIG_VIRTIO_MEM=y
CONFIG_MEMORY_HOTPLUG=y
CONFIG_MEMORY_HOTREMOVE=y
CONFIG_ZONE_DEVICE=y
# virtio-rng: lets the guest pull entropy from the host via the Firecracker
# entropy device (PUT /entropy). Built-in (=y) because the rootfs ships no
# /lib/modules tree (we build only vmlinux), so a loadable module would have no
# .ko to bind. HW_RANDOM is the parent framework the virtio backend registers into.
CONFIG_HW_RANDOM=y
CONFIG_HW_RANDOM_VIRTIO=y
EOF

        echo "  Resolving config dependencies (olddefconfig)..."
        make olddefconfig >/dev/null

        # Sanity: confirm the critical configs ended up =y after olddefconfig.
        # olddefconfig silently drops options whose dependencies arent met;
        # we want a hard fail rather than a kernel that builds but mysteriously
        # cannot boot Firecracker VMs or run containers.
        #
        # VIRTIO_BLK / VIRTIO_NET / VIRTIO_VSOCKETS are NON-NEGOTIABLE for
        # Firecracker — without them the kernel cannot see /dev/vda, eth0,
        # or vsock and panics within milliseconds of boot.
        #
        # GENERIC_MSI_IRQ is the option that the source-repo Firecracker
        # baseline omits but the CI config includes — modern virtio_mmio
        # uses MSI-X interrupts which require this. If we ever go back to
        # the source-repo baseline this verification will catch the regression.
        echo "  Verifying required configs ended up =y..."
        REQUIRED="VIRTIO VIRTIO_MMIO VIRTIO_BLK VIRTIO_NET VIRTIO_VSOCKETS VIRTIO_CONSOLE GENERIC_MSI_IRQ MODULES OVERLAY_FS BRIDGE BRIDGE_NETFILTER BRIDGE_VLAN_FILTERING VETH VXLAN IPVLAN MACVLAN TUN WIREGUARD VLAN_8021Q NET_IPIP NET_IPGRE NET_IPGRE_DEMUX NF_NAT NF_CONNTRACK NF_NAT_REDIRECT IP_NF_NAT IP6_NF_NAT IP_NF_FILTER IP_NF_MANGLE IP_NF_RAW IP6_NF_FILTER IP6_NF_MANGLE IP6_NF_RAW IP_NF_TARGET_MASQUERADE IP_NF_TARGET_REDIRECT NETFILTER_ADVANCED NETFILTER_XTABLES NETFILTER_XT_NAT NETFILTER_XT_MARK NETFILTER_XT_TARGET_MARK NETFILTER_XT_MATCH_MARK NETFILTER_XT_CONNMARK NETFILTER_XT_TARGET_CONNMARK NETFILTER_XT_MATCH_CONNMARK NETFILTER_XT_MATCH_ADDRTYPE NETFILTER_XT_MATCH_CONNTRACK NETFILTER_XT_MATCH_IPVS NETFILTER_XT_MATCH_LIMIT NETFILTER_XT_MATCH_STATE NETFILTER_XT_MATCH_COMMENT NETFILTER_XT_MATCH_MULTIPORT NETFILTER_XT_MATCH_HASHLIMIT NETFILTER_XT_MATCH_RECENT NETFILTER_XT_MATCH_OWNER NETFILTER_XT_TARGET_LOG NETFILTER_XT_TARGET_TCPMSS NETFILTER_XT_TARGET_MASQUERADE NF_CONNTRACK_MARK NF_CONNTRACK_LABELS IP_SET IP_SET_HASH_IP IP_SET_HASH_NET NAMESPACES NET_NS PID_NS IPC_NS UTS_NS USER_NS KEYS CGROUP_DEVICE CGROUP_FREEZER CGROUP_PIDS CGROUP_BPF BLK_CGROUP CGROUP_SCHED FAIR_GROUP_SCHED CFS_BANDWIDTH MEMCG CPUSETS CGROUP_CPUACCT SECCOMP SECCOMP_FILTER POSIX_MQUEUE IP_VS IP_VS_RR IP_VS_SH IP_VS_WRR IP_VS_LC IP_VS_NFCT IP_VS_PROTO_TCP IP_VS_PROTO_UDP NF_TABLES NF_TABLES_INET NF_TABLES_IPV4 NF_TABLES_IPV6 NF_TABLES_NETDEV NFT_NAT NFT_MASQ NFT_COMPAT NFT_CT NFT_FIB_INET NFT_FIB_IPV4 NFT_FIB_IPV6 NFT_LIMIT NFT_LOG NFT_REJECT NETWORK_FILESYSTEMS BTRFS_FS BTRFS_FS_POSIX_ACL XFS_FS XFS_POSIX_ACL FUSE_FS NFS_FS NFS_V4 NFSD NFSD_V4 CIFS AUTOFS_FS MD BLK_DEV_DM DM_CRYPT DM_THIN_PROVISIONING DM_SNAPSHOT BPF_SYSCALL BPF_JIT BPF_JIT_ALWAYS_ON FTRACE PERF_EVENTS KPROBES KPROBE_EVENTS UPROBE_EVENTS NET_SCHED TCP_CONG_BBR NET_SCH_FQ NET_SCH_FQ_CODEL NET_SCH_CAKE NET_CLS_BPF TLS SECURITY SECURITYFS SECURITY_APPARMOR SECURITY_APPARMOR_INTROSPECT_POLICY SECURITY_YAMA AUDIT AUDITSYSCALL VIRTIO_MEM MEMORY_HOTPLUG MEMORY_HOTREMOVE ZONE_DEVICE HW_RANDOM HW_RANDOM_VIRTIO"
        # Collect ALL missing symbols in one pass instead of aborting on the first.
        # This way one failed build run gives the complete list of unmet deps,
        # so the operator can fix everything in one commit instead of N iterations.
        MISSING=""
        MISSING_COUNT=0
        for opt in $REQUIRED; do
            if ! grep -q "^CONFIG_$opt=y$" .config; then
                MISSING="$MISSING $opt"
                MISSING_COUNT=$((MISSING_COUNT + 1))
            fi
        done
        if [[ $MISSING_COUNT -gt 0 ]]; then
            # Disable errexit + pipefail for the diagnostic loop. grep returns 1
            # when a symbol is absent entirely, which under `set -euo pipefail`
            # would silently kill the script before the names get printed.
            set +eo pipefail
            echo "ERROR: $MISSING_COUNT required CONFIGs not =y after olddefconfig:" >&2
            for opt in $MISSING; do
                line=$(grep -E "^# CONFIG_$opt is not set\$|^CONFIG_$opt=" .config 2>/dev/null | head -1)
                if [[ -z "$line" ]]; then
                    echo "  CONFIG_$opt  (absent entirely — symbol unknown or unmet dep)" >&2
                else
                    echo "  CONFIG_$opt  ($line)" >&2
                fi
            done
            echo "" >&2
            echo "Fix by adding missing parent menuconfigs / deps to the heredoc above." >&2
            exit 1
        fi
        echo "  All $(echo $REQUIRED | wc -w) required configs confirmed =y"

        echo "  Compiling vmlinux on $(nproc) cores (10-25 min)..."
        make -j$(nproc) vmlinux 2>&1 | tail -5

        echo "  Verifying ELF format..."
        file vmlinux | grep -q "ELF 64-bit LSB executable" || {
            echo "ERROR: produced vmlinux is not a valid x86_64 ELF binary"
            file vmlinux
            exit 1
        }

        cp vmlinux /out/vmlinux
        chmod 644 /out/vmlinux
        echo "  Final size: $(du -h /out/vmlinux | cut -f1)"

        # Clean up source/build artifacts inside the container — they would
        # take 3-5 GB and we dont need them for subsequent builds.
        cd / && rm -rf "/tmp/linux-$KVER" "/tmp/linux-$KVER.tar.xz"
    '
    log "Saved: kernel/vmlinux ($(du -h "$OUTDIR/kernel/vmlinux" | cut -f1)) — Docker-capable"
}

# ============================================================================
#  DEB ROOTFS BUILDER
# ============================================================================

build_deb() {
    local NAME="$1" CODENAME="$2" DISTRO="$3" VERSION="$4" DOCKER_IMG="$5"
    # "1" = install Docker Engine + Compose plugin into the rootfs and enable
    # docker.service / containerd.service at boot. "0" = leave bare. Optional
    # for backward compatibility with older callers that did not pass it.
    local PREINSTALL_DOCKER="${6:-0}"
    header "$NAME ($CODENAME)"

    local DEST="$OUTDIR/$NAME"
    mkdir -p "$DEST"
    rm -f "$DEST/rootfs.ext4"

    local MIRROR COMPONENTS DOCKER_REPO_URL
    if [[ "$DISTRO" == "ubuntu" ]]; then
        MIRROR="http://archive.ubuntu.com/ubuntu"
        COMPONENTS="main,restricted,universe,multiverse"
        DOCKER_REPO_URL="https://download.docker.com/linux/ubuntu"
    else
        MIRROR="http://deb.debian.org/debian"
        COMPONENTS="main,contrib,non-free,non-free-firmware"
        DOCKER_REPO_URL="https://download.docker.com/linux/debian"
    fi

    docker run --rm --platform "$PLATFORM" --privileged \
        -v "$DEST:/out" \
        -v "$AGENT_STAGED:/opt/krova-agent:ro" \
        "$DOCKER_IMG" bash -c '
set -e
export DEBIAN_FRONTEND=noninteractive LC_ALL=C
DISTRO="'"$DISTRO"'" ; VERSION="'"$VERSION"'" ; CODENAME="'"$CODENAME"'"
MIRROR="'"$MIRROR"'" ; COMPONENTS="'"$COMPONENTS"'"
PREINSTALL_DOCKER="'"$PREINSTALL_DOCKER"'"
DOCKER_REPO_URL="'"$DOCKER_REPO_URL"'"
R=/rootfs ; mkdir -p $R

echo "  Installing debootstrap..."
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq debootstrap e2fsprogs >/dev/null 2>&1

echo "  Debootstrap ($CODENAME)... ~3 min"
debootstrap --arch=amd64 --components=$COMPONENTS \
    --include=systemd,systemd-sysv,dbus \
    $CODENAME $R $MIRROR >/dev/null 2>&1

# ── APT sources ──────────────────────────────────────────────────
if [[ "$DISTRO" == "ubuntu" && "$VERSION" == "24.04" ]]; then
    cat > $R/etc/apt/sources.list.d/ubuntu.sources << APTSRC
Types: deb
URIs: $MIRROR
Suites: $CODENAME ${CODENAME}-updates ${CODENAME}-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
APTSRC
    > $R/etc/apt/sources.list 2>/dev/null || true
elif [[ "$DISTRO" == "ubuntu" ]]; then
    cat > $R/etc/apt/sources.list << APTSRC
deb $MIRROR $CODENAME main restricted universe multiverse
deb $MIRROR ${CODENAME}-updates main restricted universe multiverse
deb $MIRROR ${CODENAME}-security main restricted universe multiverse
APTSRC
else
    cat > $R/etc/apt/sources.list << APTSRC
deb $MIRROR $CODENAME main contrib non-free non-free-firmware
deb $MIRROR ${CODENAME}-updates main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security ${CODENAME}-security main contrib non-free non-free-firmware
APTSRC
fi

# ── Chroot: install everything ───────────────────────────────────
mount -t proc proc $R/proc ; mount -t sysfs sys $R/sys
mount --bind /dev $R/dev ; mount --bind /dev/pts $R/dev/pts

echo "  Installing full server packages... ~5 min"
# Heredoc with double-quoted delimiter: body is passed verbatim to chroot bash.
# Without this, the inner `required_pkgs="..."` quotes would have prematurely
# closed the outer `bash -c "..."` and the container bash would have expanded
# every $var in the body to empty (since they are only set INSIDE chroot bash).
# With <<"CHROOT_EOF" the entire body reaches chroot bash unmolested.
#
# Vars the body needs are forwarded explicitly through `env` (DISTRO, CODENAME
# and the Docker-related toggles) — the chroot inherits an empty env otherwise
# and the heredoc body cannot rely on outer-bash assignments. `env` is a
# coreutils binary present in every debootstrap rootfs at /usr/bin/env.
chroot $R env \
    DISTRO="$DISTRO" \
    CODENAME="$CODENAME" \
    PREINSTALL_DOCKER="$PREINSTALL_DOCKER" \
    DOCKER_REPO_URL="$DOCKER_REPO_URL" \
    bash <<"CHROOT_EOF"
export DEBIAN_FRONTEND=noninteractive LC_ALL=C
apt-get update -qq >/dev/null 2>&1

# Goal: match stock Ubuntu Server / Debian minimal VPS images. Anything a
# customer would install on first use (build toolchain, fail2ban, db clients,
# python-pip, hardware-diagnostic tools that have no meaning inside a
# Firecracker microVM) is deliberately NOT pre-installed.

# Server basics — every VPS needs these to be useful at all.
apt-get install -y -qq \
    openssh-server sudo bash-completion cron logrotate rsyslog ufw \
    man-db manpages locales ca-certificates gnupg lsb-release \
    software-properties-common systemd-timesyncd dbus-user-session \
    apt-transport-https apparmor apparmor-profiles \
    needrestart command-not-found unattended-upgrades 2>/dev/null || true

# Networking essentials — basic connect / debug / firewall.
apt-get install -y -qq \
    iproute2 iputils-ping iputils-tracepath net-tools netcat-openbsd \
    dnsutils traceroute curl wget openssh-client \
    iptables nftables ethtool rsync 2>/dev/null || true

# Filesystem — only ext4 tooling. Single virtio-blk disk per cube; no
# partition management, no software RAID, no LVM userspace required.
apt-get install -y -qq \
    e2fsprogs 2>/dev/null || true

# Process / debug observability that ships in stock Ubuntu Server defaults.
# htop / iotop / iftop / sysstat are NOT in the stock ISO; customer installs
# them on first use via apt install htop (etc.).
apt-get install -y -qq \
    procps psmisc lsof strace tcpdump 2>/dev/null || true

# Editors + compression + misc CLI utilities.
apt-get install -y -qq \
    vim nano less file tree unzip zip tar gzip bzip2 xz-utils \
    jq bc tmux 2>/dev/null || true

# Python interpreter only — pip / venv / dev headers are customer-installed.
# Same for build-essential / gcc / g++ / make / git: not on stock Ubuntu VPS,
# customer installs the build toolchain themselves when they need to compile.
apt-get install -y -qq \
    python3 openssl libpam-systemd 2>/dev/null || true

# cloud-init — powers the optional user_data parameter on cube create.
# Installed in every rootfs but left DISABLED by default via
# /etc/cloud/cloud-init.disabled (touched further below). The provisioner
# removes that flag only for cubes that pass user_data, so cubes without it
# boot with cloud-init fully inert and unchanged.
apt-get install -y -qq \
    cloud-init 2>/dev/null || true

# Leave the rootfs default at iptables-nft (the distro-shipped default).
# Our kernel has CONFIG_NF_TABLES + the full NFT_* family compiled in, so
# Docker, kube-proxy, firewalld, and any other modern tool that calls
# iptables (which on Ubuntu 24.04 is iptables-nft) can talk to
# the nftables kernel subsystem cleanly. No update-alternatives switch needed.

locale-gen en_US.UTF-8 2>/dev/null || true
update-locale LANG=en_US.UTF-8 2>/dev/null || true

# Enable systemd-networkd as the universal network manager. The runtime
# provisioner (createCube / cube-transfer / backup-redeploy / cube-import)
# writes /etc/systemd/network/10-eth0.network — this is what reads it.
# We deliberately do NOT enable systemd-resolved because the rootfs
# already ships a static /etc/resolv.conf (no DNS symlink dance needed).
# systemd-networkd is the universal renderer; the legacy netplan path it
# replaced only worked on Ubuntus renderer. Enabling it explicitly is
# idempotent — the netplan first-boot pass enables it too.
systemctl enable ssh cron rsyslog ufw systemd-timesyncd \
    systemd-networkd apt-daily-upgrade.timer \
    serial-getty@ttyS0.service 2>/dev/null || true
# Disk overhaul C: mask the apt-daily METADATA timer (daily package-index
# downloads = recurring guest disk writes). KEEP apt-daily-upgrade.timer above —
# the security-only unattended-upgrades path depends on it. Net: no lost CVE
# patching, less idle disk churn.
systemctl mask apt-daily.timer apt-daily.service 2>/dev/null || true

# === DOCKER ENGINE + COMPOSE (preinstall variant only) ===
#
# Follows the official upstream apt-repository install procedure documented at
#   https://docs.docker.com/engine/install/ubuntu/
#   https://docs.docker.com/engine/install/debian/
# verbatim — same GPG key URL, same apt source line, same five-package
# install set. The keyring path /etc/apt/keyrings/docker.asc and the
# single-line sources.list.d/docker.list format are both the upstream-
# recommended layout (deb822 .sources is equivalent; .list keeps the
# nested quoting trivial in this build script).
#
# Why this works in a chroot:
#   - apt-get install only writes files to disk and runs maintainer
#     scripts; it never tries to talk to systemd at runtime.
#   - The dockerd postinst calls `systemctl enable docker.service`, which
#     in a chroot falls back to creating the WantedBy=multi-user.target
#     symlink directly (no running PID 1 needed). The explicit `systemctl
#     enable` line below is belt-and-braces in case packaging changes.
#   - The kernel built by `build_kernel` above already ships CONFIG_OVERLAY_FS,
#     CONFIG_BRIDGE, CONFIG_VETH, CONFIG_VXLAN, CONFIG_CGROUP_*, CONFIG_NF_*
#     and every other option Docker / OCI need (cross-checked against
#     moby/moby contrib/check-config.sh — see kernel REQUIRED list above).
#     So the dockerd that lands on disk here will start cleanly on first
#     cube boot without any host-side tweaks.
#
# The repo stays configured post-install so the customer can run
# `apt update && apt upgrade docker-ce` to pick up newer Docker releases
# themselves.
if [[ "$PREINSTALL_DOCKER" == "1" ]]; then
    echo "  Installing Docker Engine + Compose plugin (preinstall variant)..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "$DOCKER_REPO_URL/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    # arch=amd64 hard-coded: every cube boots on x86_64 host hardware via
    # Firecracker. Single-line .list format is upstream-equivalent to the
    # deb822 .sources block in the Docker docs.
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] $DOCKER_REPO_URL $CODENAME stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq >/dev/null 2>&1
    apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin >/dev/null 2>&1
    # Belt-and-braces enable — package postinst usually does this already,
    # but in chroot it occasionally no-ops silently. We also drop the symlinks
    # by hand if systemctl returns non-zero, so docker.service / containerd
    # come up automatically on first cube boot regardless.
    systemctl enable docker.service containerd.service 2>/dev/null || true
    for svc in docker.service containerd.service; do
        ln -sf "/lib/systemd/system/$svc" \
            "/etc/systemd/system/multi-user.target.wants/$svc" 2>/dev/null || true
    done
    # Disk overhaul C: bound container logs. The default json-file driver has NO
    # size limit → a chatty container fills the cube disk. Double-quoted heredoc
    # delimiter (Rule 39.2) — JSON needs literal double-quotes, no expansion.
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<"DOCKERD"
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
DOCKERD
fi

# Purge packages that hurt the customer experience inside a Firecracker microVM:
#   - snapd: not usable inside Firecracker, dangling unit files just confuse
#   - ubuntu-pro-client / ubuntu-advantage-tools: prints Canonical ESM upsell
#     ads on every `apt update` / `apt upgrade` — useless without a paid Pro
#     subscription. Customer can `apt install ubuntu-pro-client` to opt in.
#   - packagekit / packagekit-tools: desktop-GUI package abstraction (gnome-
#     software, KDE Discover), nothing in our install list depends on it,
#     wastes ~30 MB RAM idle. Standard cloud images ship without it.
# unattended-upgrades is INSTALLED in the Server-basics block above and
# CONFIGURED security-only (no auto-reboot, no service bounce) via the
# /etc/apt/apt.conf.d files written below. It is NOT purged here — it gives
# unmanaged cubes daily CVE patching. Power users can purge it.
apt-get remove --purge -y \
    snapd \
    ubuntu-pro-client ubuntu-pro-client-l10n ubuntu-advantage-tools \
    packagekit packagekit-tools 2>/dev/null || true
apt-get autoremove -y 2>/dev/null || true
rm -rf /snap /var/snap /var/lib/snapd

# Tame `needrestart` so it doesnt scare or disrupt the customer:
#   - kernelhints = 0 disables the kernel-restart check entirely. We have no
#     in-guest kernel package (Firecracker supplies vmlinux from the host), so
#     the check is meaningless; 0 (not -1) is what actually suppresses the
#     "Failed to retrieve available kernel versions" line (-1 only routes it
#     to stderr, where the customer still sees it).
#   - ucodehints = 0 likewise drops the "Failed to check for processor
#     microcode upgrades" twin (no microcode package in a microVM guest).
#   - restart = l lists services needing a restart but does NOT auto-restart
#     them. Auto-restart on a microVM has bitten us by bouncing krova-agent
#     and sshd mid-customer-session during routine apt upgrades.
#   - override_rc pins krova-agent + ssh to never-restart even if the mode is
#     ever flipped to "a" — defense in depth for the customers lifeline.
mkdir -p /etc/needrestart/conf.d
cat > /etc/needrestart/conf.d/99-krova.conf <<"NRCONF"
# Krova Cube overrides — see /etc/needrestart/needrestart.conf for full list
$nrconf{kernelhints} = 0;
$nrconf{ucodehints} = 0;
$nrconf{restart} = "l";
$nrconf{override_rc} = {
    qr(^krova-agent.*) => 0,
    qr(^ssh(d)?.*) => 0,
};
NRCONF

# Security-only unattended-upgrades. The daily apt-daily-upgrade.timer applies
# ONLY the distros -security pocket (the package default in
# 50unattended-upgrades), never auto-reboots (a guest reboot is meaningless —
# Firecracker supplies the kernel; the platform treats it as shutdown), and the
# needrestart config above means it never bounces sshd or krova-agent.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<"AUTOUPG"
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
AUTOUPG
cat > /etc/apt/apt.conf.d/52unattended-upgrades-krova <<"UNATTUPG"
// Krova Cube policy. Kernel is host-supplied (empty /boot) so a guest reboot
// is meaningless AND Firecracker treats it as shutdown -> auto-relaunch.
// Security-only scope is the Ubuntu package default (50unattended-upgrades);
// we deliberately do NOT redefine Allowed-Origins (apt config lists APPEND,
// not replace, so redefining would only duplicate the security origin).
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
UNATTUPG

apt-get clean
rm -rf /var/cache/apt/archives/*.deb

# Re-run apt update so package lists are fresh for the customer
apt-get update -qq >/dev/null 2>&1 || true

# Hard fail if any baseline VPS package is missing. This prevents
# partially-successful apt runs from producing weak rootfs images.
required_pkgs="systemd openssh-server sudo iproute2 curl wget nftables iptables rsync tmux python3 cloud-init unattended-upgrades needrestart"
# Docker variant: also verify every Docker Engine package landed AND that
# both systemd unit symlinks are in place. A silent apt-get install failure
# here would otherwise produce a "Docker preinstalled" image that booted
# without Docker — worse than the plain Ubuntu variant because customers
# would expect dockerd to be running.
if [[ "$PREINSTALL_DOCKER" == "1" ]]; then
    required_pkgs="$required_pkgs docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
fi
for pkg in $required_pkgs; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        echo "ERROR: required package missing: $pkg" >&2
        exit 1
    fi
done
if [[ "$PREINSTALL_DOCKER" == "1" ]]; then
    for svc in docker.service containerd.service; do
        if [[ ! -L "/etc/systemd/system/multi-user.target.wants/$svc" ]]; then
            echo "ERROR: $svc is not enabled (no WantedBy symlink)" >&2
            exit 1
        fi
    done
    # Sanity-check the binary lands at the expected path.
    if [[ ! -x /usr/bin/dockerd ]]; then
        echo "ERROR: /usr/bin/dockerd not found after install" >&2
        exit 1
    fi
fi
CHROOT_EOF

# ── Config ───────────────────────────────────────────────────────
echo "  Configuring for Firecracker..."

printf "/dev/vda  /  ext4  defaults,noatime,errors=remount-ro  0 1\ntmpfs  /tmp  tmpfs  defaults,nosuid,nodev  0 0\n" > $R/etc/fstab
echo "krova" > $R/etc/hostname
printf "127.0.0.1 localhost\n127.0.1.1 krova\n::1 localhost ip6-localhost ip6-loopback\n" > $R/etc/hosts
ln -sf /usr/share/zoneinfo/UTC $R/etc/localtime
rm -f $R/etc/resolv.conf
# DNS: byte-identical to buildGuestNetworkFiles() in lib/ssh/cube-guest-network.ts
# (v4-first + the glibc options line) so DNS never stalls on a flaky v6 egress.
# Equality is enforced by lib/ssh/cube-guest-network.test.ts. MAXNS=3.
printf "nameserver 1.1.1.1\nnameserver 2606:4700:4700::1111\nnameserver 2001:4860:4860::8888\noptions timeout:1 attempts:2 single-request-reopen\n" > $R/etc/resolv.conf

# Persistent journald — without this dir, journald falls back to /run (RAM)
# and all logs vanish on reboot. Customers expect "journalctl --since yesterday"
# to work after a restart, same as on any real VPS.
mkdir -p $R/var/log/journal
# Cap persistent journald so it cannot grow unbounded on the sold-1:1 cube disk
# (disk overhaul C). 200M keeps "journalctl --since yesterday" useful while
# bounding the footprint. No apostrophes / plain printf (Rule 39 outer block).
mkdir -p $R/etc/systemd/journald.conf.d
printf "[Journal]\nSystemMaxUse=200M\nRuntimeMaxUse=64M\nSystemMaxFileSize=50M\n" > $R/etc/systemd/journald.conf.d/99-krova.conf

mkdir -p $R/etc/ssh/sshd_config.d
printf "PermitRootLogin prohibit-password\nPasswordAuthentication no\nPubkeyAuthentication yes\nAuthorizedKeysFile .ssh/authorized_keys\nUsePAM yes\nX11Forwarding no\nPrintMotd no\nAcceptEnv LANG LC_*\nSubsystem sftp /usr/lib/openssh/sftp-server\n" > $R/etc/ssh/sshd_config.d/krova.conf
mkdir -p $R/root/.ssh && chmod 700 $R/root/.ssh
touch $R/root/.ssh/authorized_keys && chmod 600 $R/root/.ssh/authorized_keys

if [[ "$DISTRO" == "ubuntu" ]]; then
    mkdir -p $R/etc/netplan
    printf "network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: false\n" > $R/etc/netplan/01-netcfg.yaml
fi

# ── Krova guest agent (vsock) ──────────────────────────────────
echo "  Installing krova-agent (vsock guest agent)..."
cp /opt/krova-agent $R/usr/local/bin/krova-agent
chmod +x $R/usr/local/bin/krova-agent

# Heredoc delimiters use DOUBLE quotes — see CLAUDE.md rule 39. The bodies
# below are static (no variable expansion needed); double-quoted delimiters
# also survive the outer single-quoted bash-c wrapper without breaking it.
cat > $R/etc/systemd/system/krova-agent.service <<"AGENTSVC"
[Unit]
Description=Krova Guest Agent (vsock)
After=network.target
Wants=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/krova-agent
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
AGENTSVC

cat > $R/etc/systemd/system/krova-agent-watchdog.service <<"WDGSVC"
[Unit]
Description=Krova Agent Watchdog

[Service]
Type=oneshot
ExecStart=/bin/sh -c "systemctl unmask krova-agent 2>/dev/null; systemctl start krova-agent 2>/dev/null"
WDGSVC

cat > $R/etc/systemd/system/krova-agent-watchdog.timer <<"WDGTMR"
[Unit]
Description=Krova Agent Watchdog Timer

[Timer]
OnBootSec=30
OnUnitActiveSec=60

[Install]
WantedBy=timers.target
WDGTMR

chroot $R systemctl enable krova-agent 2>/dev/null || \
    ln -sf /etc/systemd/system/krova-agent.service \
    $R/etc/systemd/system/multi-user.target.wants/krova-agent.service 2>/dev/null || true
chroot $R systemctl enable krova-agent-watchdog.timer 2>/dev/null || \
    ln -sf /etc/systemd/system/krova-agent-watchdog.timer \
    $R/etc/systemd/system/timers.target.wants/krova-agent-watchdog.timer 2>/dev/null || true

# Make watchdog files immutable so customer cannot disable the agent
chattr +i $R/etc/systemd/system/krova-agent-watchdog.service 2>/dev/null || true
chattr +i $R/etc/systemd/system/krova-agent-watchdog.timer 2>/dev/null || true

# Ensure vsock kernel module loads on boot
mkdir -p $R/etc/modules-load.d
printf "vsock\nvhost_vsock\n" > $R/etc/modules-load.d/vsock.conf

mkdir -p $R/etc/cloud && touch $R/etc/cloud/cloud-init.disabled
printf "\n  Welcome to your Krova Cube\n  Powered by Firecracker microVM\n\n" > $R/etc/motd
truncate -s 0 $R/etc/machine-id
rm -f $R/var/lib/dbus/machine-id
find $R/var/log -type f -exec truncate -s 0 {} \; 2>/dev/null || true
rm -rf $R/tmp/* $R/var/tmp/*

umount $R/dev/pts $R/dev $R/proc $R/sys 2>/dev/null || true

# ── Create ext4 ─────────────────────────────────────────────────
echo "  Packing ext4 image..."
dd if=/dev/zero of=/out/rootfs.ext4 bs=1M count=0 seek='"$ROOTFS_SIZE_MB"' 2>/dev/null
mkfs.ext4 -F -L rootfs -E lazy_itable_init=0,lazy_journal_init=0 -d $R /out/rootfs.ext4 >/dev/null 2>&1
e2fsck -f -y /out/rootfs.ext4 >/dev/null 2>&1 || true
resize2fs -M /out/rootfs.ext4 >/dev/null 2>&1 || true
echo "  Done: $(du -h /out/rootfs.ext4 | cut -f1)"
'
    log "$NAME → $(du -h "$DEST/rootfs.ext4" | cut -f1)"
}


# ============================================================================
#  DISTRO REGISTRY  (single source of truth: config/platform.ts CUBE_IMAGES)
# ============================================================================
#
# The TypeScript wrapper (scripts/build-images.ts) writes a generated bash
# snippet to a temp file and points us at it via $KROVA_DISTROS_FILE. The
# snippet defines parallel arrays:
#   KROVA_DISTRO_IDS, KROVA_DISTRO_FAMILIES, KROVA_DISTRO_VENDORS,
#   KROVA_DISTRO_VERSIONS, KROVA_DISTRO_CODENAMES, KROVA_DISTRO_DOCKER_IMAGES
# All same length — index N across all six is one distro.
#
# If $KROVA_DISTROS_FILE is unset (someone running this script directly
# instead of via `pnpm build:images`), fall back to the same distro list
# the platform currently ships. This fallback is THE ONLY hardcoded distro
# list outside of config/platform.ts; if you change it, also change the
# CUBE_IMAGES array in platform.ts to match (or just use the wrapper).

if [[ -n "${KROVA_DISTROS_FILE:-}" && -f "$KROVA_DISTROS_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$KROVA_DISTROS_FILE"
else
    echo "  WARN: KROVA_DISTROS_FILE not set; using built-in fallback distro list" >&2
    echo "        (run via 'pnpm build:images' to source from config/platform.ts)" >&2
    KROVA_DISTRO_IDS=("ubuntu-24.04" "ubuntu-24.04-docker")
    KROVA_DISTRO_FAMILIES=("debian" "debian")
    KROVA_DISTRO_VENDORS=("ubuntu" "ubuntu")
    KROVA_DISTRO_VERSIONS=("24.04" "24.04")
    KROVA_DISTRO_CODENAMES=("noble" "noble")
    KROVA_DISTRO_DOCKER_IMAGES=("ubuntu:24.04" "ubuntu:24.04")
    KROVA_DISTRO_PREINSTALL_DOCKER=("0" "1")
fi

# Build a single distro by its index in the parallel arrays. Only the
# `debian` family is supported today; any other family is a hard error.
# Pure data lookup; never edit per distro — add/remove entries in the
# source-of-truth array (config/platform.ts CUBE_IMAGES) instead.
build_one_distro() {
    local idx="$1"
    local id="${KROVA_DISTRO_IDS[$idx]}"
    local family="${KROVA_DISTRO_FAMILIES[$idx]}"
    local vendor="${KROVA_DISTRO_VENDORS[$idx]}"
    local version="${KROVA_DISTRO_VERSIONS[$idx]}"
    local codename="${KROVA_DISTRO_CODENAMES[$idx]}"
    local docker_image="${KROVA_DISTRO_DOCKER_IMAGES[$idx]}"
    # Parallel array may be unset for invocations that predate the
    # preinstall-docker feature (e.g. someone sourcing an older
    # KROVA_DISTROS_FILE). Default to "0" so old call sites are no-ops.
    local preinstall_docker="${KROVA_DISTRO_PREINSTALL_DOCKER[$idx]:-0}"

    if [[ "$family" == "debian" ]]; then
        build_deb "$id" "$codename" "$vendor" "$version" "$docker_image" "$preinstall_docker"
    else
        err "Unsupported distro family '$family' for $id (only 'debian' is supported)"
        exit 1
    fi
}

# Look up a distro index by its id (e.g. "ubuntu-24.04" -> 0). Echoes -1
# if not found.
distro_idx_for_id() {
    local target="$1"
    for i in "${!KROVA_DISTRO_IDS[@]}"; do
        if [[ "${KROVA_DISTRO_IDS[$i]}" == "$target" ]]; then
            echo "$i"; return 0
        fi
    done
    echo "-1"
}

# ============================================================================
#  MAIN
# ============================================================================

STARTED=$(date +%s)

if [[ "$TARGET" == "kernel" ]]; then
    build_kernel
elif [[ "$TARGET" == "all" ]]; then
    # Download kernel first (fast, needed by all)
    build_kernel

    # Build every distro in parallel — each runs in its own Docker container.
    # Output is captured to log files to avoid interleaved terminal output.
    NUM_DISTROS="${#KROVA_DISTRO_IDS[@]}"
    echo ""
    echo -e "${C}  Building $NUM_DISTROS rootfs distros in parallel (Docker builds)...${NC}"
    echo ""

    LOGDIR=$(mktemp -d)
    PIDS=()
    NAMES=()

    for i in "${!KROVA_DISTRO_IDS[@]}"; do
        id="${KROVA_DISTRO_IDS[$i]}"
        build_one_distro "$i" > "$LOGDIR/${id}.log" 2>&1 &
        PIDS+=($!)
        NAMES+=("$id")
    done

    # Wait for all builds and track results
    FAILED=()
    for i in "${!PIDS[@]}"; do
        if wait "${PIDS[$i]}"; then
            log "${NAMES[$i]} done"
        else
            FAILED+=("${NAMES[$i]}")
            err "${NAMES[$i]} failed — see ${LOGDIR}/${NAMES[$i]}.log"
        fi
    done

    if [[ ${#FAILED[@]} -gt 0 ]]; then
        echo ""
        err "${#FAILED[@]} build(s) failed: ${FAILED[*]}"
        echo "  Logs: $LOGDIR/"
        exit 1
    fi

    rm -rf "$LOGDIR"
else
    # TARGET is a distro id like "ubuntu-24.04". Look it up.
    IDX=$(distro_idx_for_id "$TARGET")
    if [[ "$IDX" == "-1" ]]; then
        err "Unknown target: $TARGET"
        echo "  Valid targets: all kernel ${KROVA_DISTRO_IDS[*]}"
        exit 1
    fi
    build_kernel
    build_one_distro "$IDX"
fi

ELAPSED=$(( $(date +%s) - STARTED ))

echo ""
echo -e "${G}┌──────────────────────────────────────────────────────────────┐${NC}"
echo -e "${G}│  Build Complete  ($(printf '%dm %ds' $((ELAPSED/60)) $((ELAPSED%60))))                                     │${NC}"
echo -e "${G}└──────────────────────────────────────────────────────────────┘${NC}"
echo ""
printf "  ${B}%-26s %s${NC}\n" "Image" "Size"
printf "  %-26s %s\n" "──────" "────"

[[ -f "$OUTDIR/kernel/vmlinux" ]] && \
    printf "  %-26s %s\n" "kernel/vmlinux" "$(du -h "$OUTDIR/kernel/vmlinux" | cut -f1)"
for d in "${KROVA_DISTRO_IDS[@]}"; do
    [[ -f "$OUTDIR/$d/rootfs.ext4" ]] && \
        printf "  %-26s %s\n" "$d/rootfs.ext4" "$(du -h "$OUTDIR/$d/rootfs.ext4" | cut -f1)"
done

echo ""
echo -e "  ${C}Next steps:${NC} build-images.ts has registered each artifact"
echo -e "  in the platform_images table. To roll out to active servers, click"
echo -e "  ${C}Update Images${NC} on each server detail page in Orbit."
echo ""