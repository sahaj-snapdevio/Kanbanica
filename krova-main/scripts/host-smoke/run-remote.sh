#!/usr/bin/env bash
#
# Bootstrap a KVM-capable Linux host with the pinned Krova host toolchain
# (Firecracker + jailer + restic) and a test kernel/rootfs, then run the
# cube-lifecycle smoke harness against it over SSH.
#
# Usage:
#   bash scripts/host-smoke/run-remote.sh <ssh-target>
#   pnpm test:host <ssh-target>
#
# <ssh-target> is anything `ssh` accepts (an alias from ~/.ssh/config, or
# root@host). The host must be a DEV/TEST box — the harness installs binaries
# and writes under /var/lib/krova. It never touches a production cube.
#
# Versions default to the pins in config/platform.ts; override via env if a
# bump is being validated:
#   FC_VERSION=v1.15.1 RESTIC_VERSION=0.18.1 bash scripts/host-smoke/run-remote.sh <target>

set -euo pipefail

TARGET=${1:-}
if [ -z "$TARGET" ]; then
  echo "usage: $0 <ssh-target>   (e.g. krova-devtest or root@1.2.3.4)" >&2
  exit 1
fi

# Keep in sync with config/platform.ts (FIRECRACKER_VERSION / RESTIC_VERSION).
FC_VERSION=${FC_VERSION:-v1.15.1}
RESTIC_VERSION=${RESTIC_VERSION:-0.18.1}
# Firecracker CI artifacts for the matching guest-config baseline line.
CI_KERNEL=${CI_KERNEL:-vmlinux-6.1.155}
CI_ROOTFS=${CI_ROOTFS:-ubuntu-24.04.squashfs}
CI_BASE="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.15/x86_64"

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Bootstrapping $TARGET (FC $FC_VERSION, restic $RESTIC_VERSION)"

# shellcheck disable=SC2087  # we intentionally expand locals into the remote heredoc
ssh "$TARGET" FC_VERSION="$FC_VERSION" RESTIC_VERSION="$RESTIC_VERSION" \
  CI_KERNEL="$CI_KERNEL" CI_ROOTFS="$CI_ROOTFS" CI_BASE="$CI_BASE" 'bash -s' <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
ARCH=x86_64

if [ ! -e /dev/kvm ]; then
  echo "FATAL: /dev/kvm not present on this host — Firecracker cannot run here." >&2
  exit 2
fi

echo "-- deps"
apt-get update -qq >/dev/null 2>&1 || true
apt-get install -y -qq curl file e2fsprogs iproute2 iptables netcat-openbsd jq bzip2 >/dev/null 2>&1 || true

echo "-- firecracker + jailer $FC_VERSION"
if ! /usr/local/bin/firecracker --version 2>/dev/null | grep -q "${FC_VERSION#v}"; then
  curl -fsSL -o /tmp/fc.tgz "https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz"
  tar -xzf /tmp/fc.tgz -C /tmp
  install -m0755 "/tmp/release-${FC_VERSION}-${ARCH}/firecracker-${FC_VERSION}-${ARCH}" /usr/local/bin/firecracker
  install -m0755 "/tmp/release-${FC_VERSION}-${ARCH}/jailer-${FC_VERSION}-${ARCH}" /usr/local/bin/jailer
fi

echo "-- restic $RESTIC_VERSION"
if ! /usr/local/bin/restic version 2>/dev/null | grep -q "$RESTIC_VERSION"; then
  curl -fsSL -o /tmp/restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2"
  bunzip2 -f /tmp/restic.bz2
  install -m0755 /tmp/restic /usr/local/bin/restic
fi

echo "-- kernel + rootfs (Firecracker CI artifacts)"
mkdir -p /var/lib/krova/images /var/lib/krova/jail /var/lib/krova/smoke
[ -f /var/lib/krova/images/vmlinux ]    || curl -fsSL -o /var/lib/krova/images/vmlinux    "$CI_BASE/$CI_KERNEL"
[ -f /var/lib/krova/images/rootfs.img ] || curl -fsSL -o /var/lib/krova/images/rootfs.img "$CI_BASE/$CI_ROOTFS"
echo "-- bootstrap done"
REMOTE

echo "==> Copying + running the smoke harness"
scp -q "$HERE/cube-lifecycle-smoke.sh" "$TARGET:/root/cube-lifecycle-smoke.sh"
ssh "$TARGET" 'bash /root/cube-lifecycle-smoke.sh'
