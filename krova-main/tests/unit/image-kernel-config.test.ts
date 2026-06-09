import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Config-integrity guard for the guest kernel + rootfs build. The promise is
// that a cube is a full VPS/EC2-equivalent Linux box (Docker, Kubernetes,
// overlay networks, VPNs, fancy filesystems) — EXCEPT nested virtualization.
// This test does NOT build a kernel; it pins the build SCRIPT so a future edit
// can't silently drop a feature customers depend on. The build's own
// `REQUIRED` verification then proves each option actually compiled in =y.

const SCRIPT = readFileSync(
  fileURLToPath(
    new URL("../../setup/images/build-all-images.sh", import.meta.url)
  ),
  "utf8"
);

/** The `REQUIRED="…"` token set the build verifies as `CONFIG_<tok>=y`. */
const REQUIRED = (() => {
  const m = SCRIPT.match(/REQUIRED="([^"]+)"/);
  assert.ok(m, "build script must declare a REQUIRED kernel-config list");
  return new Set(m[1].split(/\s+/).filter(Boolean));
})();

// Docker + Kubernetes + container-runtime essentials (cross-referenced with
// moby/contrib/check-config.sh). If any of these leaves REQUIRED, the kernel
// could ship without it and `docker info` / kube-proxy would degrade.
const CONTAINER_CRITICAL = [
  // overlay storage driver
  "OVERLAY_FS",
  // bridge / veth / overlay networking (Swarm, k8s CNI)
  "BRIDGE",
  "BRIDGE_NETFILTER",
  "VETH",
  "VXLAN",
  "IPVLAN",
  "MACVLAN",
  "TUN",
  // NAT + conntrack (port publishing, kube-proxy)
  "NF_NAT",
  "NF_CONNTRACK",
  "IP_NF_NAT",
  "IP6_NF_NAT",
  "NF_NAT_REDIRECT",
  "IP_NF_TARGET_MASQUERADE",
  // xtables matches Docker/kube-proxy use
  "NETFILTER_XTABLES",
  "NETFILTER_XT_MATCH_ADDRTYPE",
  "NETFILTER_XT_MATCH_CONNTRACK",
  "NETFILTER_XT_MATCH_IPVS",
  // IPVS (kube-proxy ipvs mode)
  "IP_VS",
  "IP_VS_RR",
  "IP_VS_NFCT",
  "IP_VS_PROTO_TCP",
  "IP_VS_PROTO_UDP",
  // nftables backend (Rule 37 — Ubuntu 24.04 ships iptables-nft)
  "NF_TABLES",
  "NF_TABLES_INET",
  "NF_TABLES_IPV4",
  "NF_TABLES_IPV6",
  "NFT_NAT",
  "NFT_MASQ",
  "NFT_COMPAT",
  // cgroup controllers for container CPU / memory / pids / io limits
  "MEMCG",
  "CPUSETS",
  "CGROUP_CPUACCT",
  "CGROUP_PIDS",
  "CGROUP_BPF",
  "BLK_CGROUP",
  "CGROUP_DEVICE",
  "CGROUP_FREEZER",
  "CGROUP_SCHED",
  "FAIR_GROUP_SCHED",
  "CFS_BANDWIDTH",
  // namespaces (containers + the Firecracker jailer)
  "NAMESPACES",
  "NET_NS",
  "PID_NS",
  "IPC_NS",
  "UTS_NS",
  "USER_NS",
  // seccomp (Docker default profile)
  "SECCOMP",
  "SECCOMP_FILTER",
  // bpf (cilium, modern kube)
  "BPF_SYSCALL",
  "BPF_JIT",
  // container storage drivers
  "BLK_DEV_DM",
  "DM_THIN_PROVISIONING",
  "BTRFS_FS",
  "XFS_FS",
  "FUSE_FS",
  // AppArmor (Docker default LSM on Ubuntu)
  "SECURITY_APPARMOR",
];

test("kernel REQUIRED list covers every container-critical CONFIG (Docker/k8s)", () => {
  const missing = CONTAINER_CRITICAL.filter((opt) => !REQUIRED.has(opt));
  assert.deepEqual(
    missing,
    [],
    `these Docker/k8s-critical kernel configs left the build's REQUIRED list: ${missing.join(", ")}`
  );
});

test("platform features (live RAM resize + virtio entropy) stay REQUIRED", () => {
  for (const opt of ["VIRTIO_MEM", "MEMORY_HOTPLUG", "HW_RANDOM_VIRTIO"]) {
    assert.ok(REQUIRED.has(opt), `${opt} dropped from REQUIRED`);
  }
});

test("nftables backend is compiled in (Rule 37 — iptables-nft default)", () => {
  // The rootfs uses the distro-default iptables-nft, which fails with
  // "Failed to initialize nft: Protocol not supported" without NF_TABLES.
  assert.match(SCRIPT, /^CONFIG_NF_TABLES=y$/m);
  assert.ok(REQUIRED.has("NF_TABLES"));
});

test("rootfs enables systemd-networkd as the universal network manager", () => {
  // Guest networking is renderer-agnostic via systemd-networkd; if it is not
  // enabled the cube boots with no eth0 (SSH / TCP maps / outbound all fail).
  // The `systemctl enable` invocation wraps across a `\` line-continuation, so
  // allow whitespace/backslashes between the verb and the unit.
  assert.match(SCRIPT, /systemctl enable[\s\S]{0,200}systemd-networkd/);
});

test("Docker-preinstall variant enables docker.service + containerd and hard-verifies the packages", () => {
  // The Ubuntu+Docker flavor must come up with a running container host.
  assert.match(SCRIPT, /systemctl enable docker\.service containerd\.service/);
  // and the package install is hard-gated (required_pkgs hard-fail), so a
  // partial apt transaction fails the build rather than shipping a broken image.
  assert.match(SCRIPT, /docker-ce docker-ce-cli containerd\.io/);
});

test("cloud-init is installed but inert by default (user_data opt-in)", () => {
  // Every rootfs ships cloud-init DISABLED; it is enabled per-cube only when
  // the customer passes user_data. The disable flag must be touched at build.
  assert.match(SCRIPT, /cloud-init\.disabled/);
});

test("security-only unattended-upgrades is installed in the rootfs", () => {
  assert.match(SCRIPT, /unattended-upgrades/);
});
