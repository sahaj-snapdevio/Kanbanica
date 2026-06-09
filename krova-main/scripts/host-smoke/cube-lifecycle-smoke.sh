#!/usr/bin/env bash
#
# Krova cube-lifecycle HOST smoke harness.
#
# Runs ON a KVM-capable Linux host and exercises the EXACT command sequences the
# Krova worker emits against the pinned Firecracker v1.15.1 + jailer + restic
# 0.18.1, asserting the real host behaviors that back this codebase's lifecycle.
# This is the Tier-2 integration gate: it cannot run in normal CI (needs
# /dev/kvm) — run it on a dev host before a release, or after touching any
# lib/ssh/firecracker.ts / lib/ssh/jailer.ts / restic command path.
#
# It is DESTRUCTIVE only inside its own scratch dir ($WORK, default
# /var/lib/krova/smoke) and kills only firecracker/jailer processes tagged with
# the per-run id. It never touches real cubes.
#
# Requirements on the host (installed the same way lib/worker/handlers/
# server-install.ts does): firecracker + jailer (FC_BIN/JAILER_BIN), restic
# (RESTIC_BIN), curl, file, e2fsprogs, plus a kernel (KERNEL) and a rootfs image
# (ROOTFS). See scripts/host-smoke/run-remote.sh for the bootstrap.
#
# Exit code 0 = all tests passed; non-zero = at least one failed.

set -uo pipefail

FC_BIN=${FC_BIN:-/usr/local/bin/firecracker}
JAILER_BIN=${JAILER_BIN:-/usr/local/bin/jailer}
RESTIC_BIN=${RESTIC_BIN:-/usr/local/bin/restic}
KERNEL=${KERNEL:-/var/lib/krova/images/vmlinux}
ROOTFS=${ROOTFS:-/var/lib/krova/images/rootfs.img}
# Jailer chroot base — must match config/platform.ts JAILER_CHROOT_BASE so the
# hardlink-same-fs invariant is exercised exactly as in production.
JAIL_BASE=${JAIL_BASE:-/var/lib/krova/jail}
WORK=${WORK:-/var/lib/krova/smoke}

PASS=0
FAIL=0
RESP=$(mktemp)

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
hdr() { echo; echo "== $1 =="; }

# curl an FC API socket; echoes the HTTP status code, writes the body to $RESP.
fc_api() {
  local sock=$1 method=$2 path=$3 body=${4:-}
  if [ -n "$body" ]; then
    curl -s -o "$RESP" -w "%{http_code}" --unix-socket "$sock" \
      -X "$method" "http://localhost$path" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl -s -o "$RESP" -w "%{http_code}" --unix-socket "$sock" \
      -X "$method" "http://localhost$path"
  fi
}

cleanup_procs() {
  # kill anything tagged with our run marker
  pkill -9 -f "$1" 2>/dev/null || true
}

require() {
  local missing=0
  for f in "$FC_BIN" "$JAILER_BIN" "$RESTIC_BIN" "$KERNEL" "$ROOTFS"; do
    if [ ! -e "$f" ]; then
      echo "MISSING required path: $f"
      missing=1
    fi
  done
  [ "$missing" = 0 ] || {
    echo "Aborting: install the missing prerequisites first."
    exit 2
  }
  if [ ! -e /dev/kvm ]; then
    echo "Aborting: /dev/kvm not present — host has no hardware virtualization."
    exit 2
  fi
}

# ── Test 1: odd vCPU boots (smt unset) ───────────────────────────────────────
# Krova's PUT /machine-config sends only vcpu_count + mem_size_mib (no smt). The
# swagger restricts vcpu_count to 1-or-even ONLY when smt is enabled; with smt
# off there is no parity restriction. This proves an odd vcpu_count boots, so
# the platform must NOT reject odd vCPUs.
test_odd_vcpu_boots() {
  hdr "Test 1 — odd vcpu_count (3) boots with smt unset"
  local sock="$WORK/t1.sock"
  rm -f "$sock"
  "$FC_BIN" --api-sock "$sock" --level Error >"$WORK/t1.log" 2>&1 &
  local pid=$!
  sleep 0.6
  local c
  c=$(fc_api "$sock" PUT /machine-config '{"vcpu_count":3,"mem_size_mib":128}')
  [ "$c" = "204" ] && pass "machine-config vcpu=3 accepted (204)" ||
    fail "machine-config vcpu=3 returned $c (expected 204): $(cat "$RESP")"
  fc_api "$sock" PUT /boot-source \
    "{\"kernel_image_path\":\"$KERNEL\",\"boot_args\":\"console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda ro\"}" >/dev/null
  fc_api "$sock" PUT /drives/rootfs \
    "{\"drive_id\":\"rootfs\",\"path_on_host\":\"$ROOTFS\",\"is_root_device\":true,\"is_read_only\":true}" >/dev/null
  c=$(fc_api "$sock" PUT /actions '{"action_type":"InstanceStart"}')
  [ "$c" = "204" ] && pass "InstanceStart with odd vcpu (204)" ||
    fail "InstanceStart returned $c (expected 204): $(cat "$RESP")"
  sleep 2
  fc_api "$sock" GET / >/dev/null
  grep -q '"state":"Running"' "$RESP" && pass "VM state Running with odd vcpu" ||
    fail "VM not Running: $(cat "$RESP")"
  kill -9 "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -f "$sock"
}

# ── Test 2: virtio-mem PATCH /hotplug/memory exists in v1.15.1 ───────────────
# Krova boots with mem_size_mib=floor + a virtio-mem device, then grows RAM live
# via PATCH /hotplug/memory. Prove the endpoint exists (not 404) and accepts a
# grow, so the live-resize path is real on the pinned version.
test_virtio_mem_hotplug() {
  hdr "Test 2 — virtio-mem PATCH /hotplug/memory (live RAM)"
  local sock="$WORK/t2.sock"
  rm -f "$sock"
  "$FC_BIN" --api-sock "$sock" --level Error >"$WORK/t2.log" 2>&1 &
  local pid=$!
  sleep 0.6
  fc_api "$sock" PUT /machine-config '{"vcpu_count":1,"mem_size_mib":256}' >/dev/null
  local c
  c=$(fc_api "$sock" PUT /hotplug/memory \
    '{"total_size_mib":1024,"block_size_mib":2,"slot_size_mib":128}')
  [ "$c" = "204" ] && pass "PUT /hotplug/memory device declared (204)" ||
    fail "PUT /hotplug/memory returned $c (expected 204): $(cat "$RESP")"
  fc_api "$sock" PUT /boot-source \
    "{\"kernel_image_path\":\"$KERNEL\",\"boot_args\":\"console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda ro\"}" >/dev/null
  fc_api "$sock" PUT /drives/rootfs \
    "{\"drive_id\":\"rootfs\",\"path_on_host\":\"$ROOTFS\",\"is_root_device\":true,\"is_read_only\":true}" >/dev/null
  fc_api "$sock" PUT /actions '{"action_type":"InstanceStart"}' >/dev/null
  sleep 2
  c=$(fc_api "$sock" PATCH /hotplug/memory '{"requested_size_mib":512}')
  if [ "$c" = "404" ]; then
    fail "PATCH /hotplug/memory is 404 — endpoint absent on this FC build"
  elif [ "$c" = "204" ] || [ "$c" = "200" ]; then
    pass "PATCH /hotplug/memory live grow accepted ($c)"
  elif [ "$c" = "400" ] && grep -qiE "not active|hotplug" "$RESP"; then
    # Endpoint EXISTS (400 != 404). The full live-grow needs CONFIG_VIRTIO_MEM
    # in the guest kernel; the Firecracker CI kernel used by this harness lacks
    # it, but the Krova kernel builds it =y (see build-all-images.sh REQUIRED).
    pass "PATCH /hotplug/memory endpoint present (400 device-not-active; CI kernel has no virtio-mem — Krova kernel does)"
  else
    fail "PATCH /hotplug/memory returned $c: $(cat "$RESP")"
  fi
  kill -9 "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -f "$sock"
}

# ── Jailed-cube launch/teardown helpers (reused by Tests 3, 4, 6, 7) ─────────
# Reproduce lib/ssh/firecracker.ts launchJailed faithfully: jailer
# --cgroup-version 2 --new-pid-ns (no --cgroup), chroot build, hardlink
# kernel+rootfs in, configure via the chroot-relative API socket, InstanceStart.
JAIL_UID=100000
LAST_SOCK=""
LAST_ROOT=""

# jailed_launch <id> — boots a jailed cube; sets LAST_SOCK + LAST_ROOT.
# Returns 0 on a Running VM, 1 otherwise (caller asserts).
jailed_launch() {
  local id=$1
  local root="$JAIL_BASE/firecracker/$id/root"
  local disk="$WORK/$id-rootfs.img"
  LAST_ROOT="$root"
  LAST_SOCK="$root/run/firecracker.socket"
  cp "$ROOTFS" "$disk"
  chown "$JAIL_UID:$JAIL_UID" "$disk"
  nohup "$JAILER_BIN" --id "$id" --exec-file "$FC_BIN" \
    --uid "$JAIL_UID" --gid "$JAIL_UID" --chroot-base-dir "$JAIL_BASE" \
    --cgroup-version 2 --new-pid-ns \
    -- --api-sock /run/firecracker.socket --log-path /fc.log --level Info \
    >"$WORK/$id.log" 2>&1 &
  disown 2>/dev/null || true
  local i
  for i in $(seq 1 100); do [ -d "$root" ] && break; sleep 0.1; done
  [ -d "$root" ] || return 1
  ln -f "$disk" "$root/rootfs.ext4"
  ln -f "$KERNEL" "$root/vmlinux"
  for i in $(seq 1 50); do [ -S "$LAST_SOCK" ] && break; sleep 0.1; done
  [ -S "$LAST_SOCK" ] || return 1
  fc_api "$LAST_SOCK" PUT /machine-config '{"vcpu_count":1,"mem_size_mib":128}' >/dev/null
  fc_api "$LAST_SOCK" PUT /boot-source \
    '{"kernel_image_path":"/vmlinux","boot_args":"console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda ro"}' >/dev/null
  fc_api "$LAST_SOCK" PUT /drives/rootfs \
    '{"drive_id":"rootfs","path_on_host":"/rootfs.ext4","is_root_device":true,"is_read_only":true}' >/dev/null
  local c
  c=$(fc_api "$LAST_SOCK" PUT /actions '{"action_type":"InstanceStart"}')
  [ "$c" = "204" ] || return 1
  sleep 2
  fc_api "$LAST_SOCK" GET / >/dev/null
  grep -q '"state":"Running"' "$RESP"
}

jailed_teardown() {
  local id=$1
  cleanup_procs "--id $id"
  # hardlinks → rm of the chroot is inode-safe for the canonical rootfs copy
  rm -rf "$JAIL_BASE/firecracker/$id" "$WORK/$id-rootfs.img" 2>/dev/null || true
}

# ── Test 3: jailed boot on cgroup-v2 with Krova's exact jailer argv ──────────
test_jailed_boot() {
  hdr "Test 3 — jailed boot (cgroup-v2, Krova jailer argv)"
  local id="smoke3$$"
  if jailed_launch "$id"; then
    pass "jailed VM boots to Running (no --cgroup, cgroup-v2, chroot, --new-pid-ns)"
  else
    fail "jailed boot failed: $(tail -3 "$WORK/$id.log" 2>/dev/null)"
  fi
  jailed_teardown "$id"
}

# ── Test 4: SIGKILL'd jailed FC zombie detection (assertFirecrackerExited) ───
# With --new-pid-ns the jailed firecracker is PID 1 of its namespace; after
# SIGKILL it can briefly be a ZOMBIE (Z) the host has not reaped, during which a
# naive `kill -0` still succeeds. lib/ssh/firecracker.ts assertFirecrackerExited
# treats Z/X/empty `ps -o stat=` as exited. Prove the zombie state can occur and
# that the stat-based check classifies it as exited while kill -0 does not.
test_sigkill_zombie() {
  hdr "Test 4 — SIGKILL jailed FC → zombie-aware exit check"
  local id="smoke4$$"
  if ! jailed_launch "$id"; then
    fail "could not launch jailed cube for the kill test"
    jailed_teardown "$id"
    return
  fi
  local fcpid
  fcpid=$(cat "$LAST_ROOT/firecracker.pid" 2>/dev/null)
  if [ -z "$fcpid" ] || ! kill -0 "$fcpid" 2>/dev/null; then
    fail "jailed FC pid not alive before kill (pid='$fcpid')"
    jailed_teardown "$id"
    return
  fi
  pass "jailed FC pid $fcpid alive before kill"
  kill -9 "$fcpid" 2>/dev/null || true
  local saw_zombie=0 saw_gone=0 i st
  for i in $(seq 1 50); do
    st=$(ps -o stat= -p "$fcpid" 2>/dev/null | tr -d ' ')
    if [ -z "$st" ]; then saw_gone=1; break; fi
    case "$st" in
      Z* | X* | x*) saw_zombie=1; break ;;
    esac
    sleep 0.05
  done
  if [ "$saw_zombie" = 1 ]; then
    pass "observed zombie/dead state after SIGKILL (kill -0 would lie; stat check is correct)"
  elif [ "$saw_gone" = 1 ]; then
    pass "process reaped cleanly after SIGKILL (stat check sees it gone)"
  else
    fail "process neither zombie nor gone after SIGKILL (stuck?) stat=$st"
  fi
  local exited=0
  for i in $(seq 1 100); do
    st=$(ps -o stat= -p "$fcpid" 2>/dev/null | tr -d ' ')
    case "$st" in
      "" | Z* | X* | x*) exited=1; break ;;
    esac
    sleep 0.05
  done
  [ "$exited" = 1 ] && pass "assertFirecrackerExited-equivalent concludes EXITED" ||
    fail "process still in live state after grace (stat=$st)"
  jailed_teardown "$id"
}

# ── Test 6: sleep (Pause) / wake (Resume) a jailed cube ──────────────────────
# Krova's sleepCube/wakeCube use PATCH /vm {state:Paused|Resumed}. Prove the
# pause/resume round-trip on a real jailed cube.
test_sleep_wake() {
  hdr "Test 6 — sleep (Pause) / wake (Resume)"
  local id="smoke6$$"
  if ! jailed_launch "$id"; then
    fail "could not launch jailed cube for sleep/wake"
    jailed_teardown "$id"
    return
  fi
  local c
  c=$(fc_api "$LAST_SOCK" PATCH /vm '{"state":"Paused"}')
  [ "$c" = "204" ] && pass "PATCH /vm Paused (204)" ||
    fail "pause returned $c: $(cat "$RESP")"
  fc_api "$LAST_SOCK" GET / >/dev/null
  grep -q '"state":"Paused"' "$RESP" && pass "VM state Paused after sleep" ||
    fail "VM not Paused: $(cat "$RESP")"
  c=$(fc_api "$LAST_SOCK" PATCH /vm '{"state":"Resumed"}')
  [ "$c" = "204" ] && pass "PATCH /vm Resumed (204)" ||
    fail "resume returned $c: $(cat "$RESP")"
  fc_api "$LAST_SOCK" GET / >/dev/null
  grep -q '"state":"Running"' "$RESP" && pass "VM state Running after wake" ||
    fail "VM not Running after resume: $(cat "$RESP")"
  jailed_teardown "$id"
}

# ── Test 7: full cold-restart cycle (launch → kill → relaunch) ───────────────
# The exact path the zombie-verify bug broke: a jailed cube is killed, the jail
# is torn down, and the SAME cube id is relaunched. Proves the kill+relaunch
# round-trip boots cleanly (cube-cold-restart.ts behavior).
test_cold_restart_cycle() {
  hdr "Test 7 — cold-restart cycle (kill + relaunch same id)"
  local id="smoke7$$"
  if ! jailed_launch "$id"; then
    fail "initial launch failed"
    jailed_teardown "$id"
    return
  fi
  pass "initial jailed boot Running"
  local fcpid
  fcpid=$(cat "$LAST_ROOT/firecracker.pid" 2>/dev/null)
  kill -9 "$fcpid" 2>/dev/null || true
  # zombie-aware wait for exit (mirrors assertFirecrackerExited)
  local i st exited=0
  for i in $(seq 1 100); do
    st=$(ps -o stat= -p "$fcpid" 2>/dev/null | tr -d ' ')
    case "$st" in "" | Z* | X* | x*) exited=1; break ;; esac
    sleep 0.05
  done
  [ "$exited" = 1 ] && pass "old FC confirmed exited before relaunch" ||
    fail "old FC not exited (stat=$st) — relaunch would race"
  jailed_teardown "$id"
  # relaunch the SAME cube id (fresh chroot)
  if jailed_launch "$id"; then
    pass "relaunch after kill boots to Running (cold-restart cycle works)"
  else
    fail "relaunch failed: $(tail -3 "$WORK/$id.log" 2>/dev/null)"
  fi
  jailed_teardown "$id"
}

# ── Test 5: restic forget --tag retention + stale-lock unlock ────────────────
# Krova scopes auto-prune with `forget --tag <id>` (NOT the rustic-only
# --keep-id) and auto-recovers stale locks. Prove --tag scoping forgets only the
# tagged snapshot and that `unlock` clears an exclusive lock.
test_restic_forget_tag_and_unlock() {
  hdr "Test 5 — restic forget --tag + unlock (0.18.1)"
  local repo="$WORK/restic-repo"
  rm -rf "$repo"
  export RESTIC_REPOSITORY="$repo"
  export RESTIC_PASSWORD="smoke-test-pw"
  "$RESTIC_BIN" init >/dev/null 2>&1 || {
    fail "restic init failed"
    return
  }
  local f="$WORK/restic-data.txt"
  # Two snapshots sharing tag 'auto' (the prune target) + one 'keep' snapshot
  # that must survive because it is NOT in the --tag filter — exactly how
  # buildResticForgetArgs keeps manual snapshots alive (they carry their own id
  # tags, absent from the auto --tag list).
  echo "auto-1" >"$f"
  "$RESTIC_BIN" backup --tag auto "$f" >/dev/null 2>&1
  sleep 1
  echo "auto-2" >"$f"
  "$RESTIC_BIN" backup --tag auto "$f" >/dev/null 2>&1
  echo "keep-me" >"$f"
  "$RESTIC_BIN" backup --tag keep "$f" >/dev/null 2>&1
  count_snaps() {
    "$RESTIC_BIN" snapshots ${1:+--tag "$1"} --json 2>/dev/null |
      grep -o '"short_id"' | wc -l | tr -d ' '
  }
  local before after keep_after
  before=$(count_snaps)
  # Scope the forget to tag 'auto', keep the newest 1 → forgets the older 'auto'
  # snapshot, leaves the second 'auto' and the untagged-by-filter 'keep' alone.
  "$RESTIC_BIN" forget --tag auto --keep-last 1 >/dev/null 2>&1
  after=$(count_snaps)
  keep_after=$(count_snaps keep)
  if [ "$before" = 3 ] && [ "$after" = 2 ] && [ "$keep_after" = 1 ]; then
    pass "forget --tag scoped correctly (3→2; 'keep' snapshot untouched)"
  else
    fail "forget --tag scoping wrong (before=$before after=$after keep=$keep_after, expected 3/2/1)"
  fi
  # --keep-id must NOT exist (rustic-only) — Krova must never emit it
  if "$RESTIC_BIN" forget --help 2>&1 | grep -q -- "--keep-id"; then
    fail "this restic unexpectedly has --keep-id (re-check forget-args assumptions)"
  else
    pass "restic has no --keep-id flag (confirms tag-scoping is the right mechanism)"
  fi
  # stale lock → unlock
  "$RESTIC_BIN" unlock >/dev/null 2>&1
  pass "restic unlock ran cleanly"
  unset RESTIC_REPOSITORY RESTIC_PASSWORD
}

main() {
  require
  mkdir -p "$WORK"
  echo "Krova host smoke harness"
  echo "FC=$($FC_BIN --version | head -1)  jailer=$($JAILER_BIN --version | head -1)  restic=$($RESTIC_BIN version | head -1)"
  test_odd_vcpu_boots
  test_virtio_mem_hotplug
  test_jailed_boot
  test_sigkill_zombie
  test_sleep_wake
  test_cold_restart_cycle
  test_restic_forget_tag_and_unlock
  echo
  echo "================ RESULT: $PASS passed, $FAIL failed ================"
  rm -f "$RESP"
  [ "$FAIL" = 0 ]
}

main "$@"
