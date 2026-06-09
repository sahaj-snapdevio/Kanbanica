# Jailer canary smoke protocol

Run this on ONE canary host (e.g. `banana`, already primed with the jailer
binary + `/var/lib/krova/jail`) BEFORE flipping `JAILER_ENABLED=true` fleet-wide.
It validates jailed-mode end-to-end and settles the two items the Phase-2/3
reviews flagged for empirical confirmation. **Gate: do not flip the flag in
production until every step here passes.**

Prereqs:
- Jailer installed on the canary: `pnpm install:jailer` (or a fresh `install`).
- A deploy/build of the worker with `JAILER_ENABLED = true` (config/platform.ts),
  pointed at the canary. Keep the rest of the fleet on a separate worker/flag=false,
  OR test on a non-customer host.

Throughout, `J=/var/lib/krova/jail/firecracker/<cubeId>/root`.

## 1. Provision a throwaway jailed cube
Create a cube via the dashboard/API on the canary. Then on the host:
```bash
# launch_mode should be 'jailed' in the DB; confirm the FC process is NOT root:
PID=$(cat $J/firecracker.pid); ps -o pid,user,args -p "$PID"   # user = 100000+, NOT root
# jailer-provisioned device nodes, owned by the cube uid:
ls -la $J/dev $J/dev/net                                        # kvm, net/tun, urandom, userfaultfd, all <uid>
stat -c '%a %U' $J                                              # 700 <uid>
```
Then from the dashboard confirm: **SSH into the guest works**, a **custom TCP
mapping** works, the **browser terminal** connects (vsock path resolved), and the
**Live status** card shows healthy metrics (reachability L1/L3 via guest-exec).

## 2. pkill reaping (settles the reviewer disagreement)
Confirm `pkill -f <cubeId>` matches BOTH the jailer parent AND the chrooted
firecracker child (the v1.15 jailer execs `firecracker --id=<cubeId> …`):
```bash
pgrep -af "<cubeId>"     # expect TWO lines: the jailer and the firecracker child
```
If only one line shows the child, the teardown's pkill fallback needs the
chroot-path variant — report back before proceeding.

## 3. Abort-path leak check
Force a mid-launch failure (e.g. temporarily point the kernel path at a missing
file, or kill the jailer right after the chroot appears) and confirm teardown
leaves NO orphan:
```bash
pgrep -af "<cubeId>"          # expect empty after the handler's catch runs
mount | grep krova/jail || echo "no jail mounts (expected — we use hardlinks)"
# then relaunch the cube — must NOT fail with "Open tap device failed: Resource busy"
```

## 4. Lifecycle matrix (all must end running + jailed + reachable)
On the canary cube, exercise each and confirm it ends healthy and `launch_mode='jailed'`:
- Sleep → Wake
- Cold-restart
- Snapshot → Restore
- Save-as-backup → Redeploy (to a new cube)
- Resize: RAM grow (live) + vCPU change (cold restart)
- Transfer to a second canary server (then back)
After a Delete: `ls /var/lib/krova/jail/firecracker/ | grep <cubeId> || echo gone`
and confirm the canonical rootfs is gone too (no leaked chroot/hardlink).

## 5. bare → jailed conversion (no data loss)
Create a cube with `JAILER_ENABLED=false` (bare), write a marker file inside the
guest, then flip the flag and cold-restart it. Confirm: `launch_mode` flips to
`jailed`, the cube boots, and the marker file survives.

## 6. Rollback drill
Set `JAILER_ENABLED=false` again. Confirm: a NEW cube provisions bare; an
existing jailed cube still sleeps/wakes/deletes correctly; and cold-restarting a
jailed cube reverts it to bare (drains the fleet back).

## 7. Entropy device (Phase 5 — only after the kernel rebuild)
After `pnpm build:images` (kernel now has CONFIG_HW_RANDOM_VIRTIO) + "Update
Images" on the canary, set `ENTROPY_DEVICE_ENABLED=true`, cold-restart a cube,
and inside the guest:
```bash
cat /sys/devices/virtual/misc/hw_random/rng_available   # lists virtio_rng
cat /proc/sys/kernel/random/entropy_avail               # healthy (256+)
```

---
When all pass: enable `JAILER_ENABLED=true` fleet-wide (after `pnpm install:jailer`
on every server). The fleet rollout completed 2026-05-30 — existing cubes converted
to jailed mode on cold-restart/wake and the one-shot `cubes:migrate-to-jailer` tool
has since been removed; future per-cube canaries flip via `JAILER_ENABLED_CUBE_IDS`.
