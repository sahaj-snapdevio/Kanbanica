# Host smoke harness (Tier-2 integration tests)

Real-hardware tests for the cube lifecycle. `pnpm test` (Tier-1) covers pure
logic and runs everywhere; this harness covers the **host behaviors** that only
real Firecracker + jailer + restic on a KVM host can prove. It runs the exact
command sequences the worker emits and asserts the outcomes.

> Requires `/dev/kvm`. It cannot run in normal CI — run it on a dev/test host
> before a release or after touching `lib/ssh/firecracker.ts`,
> `lib/ssh/jailer.ts`, `lib/server/jailer-uids.ts`, the restic command layer, or
> any boot/machine-config path.

## Run it

```bash
pnpm test:host <ssh-target>          # e.g. pnpm test:host root@1.2.3.4
```

`run-remote.sh` bootstraps the host (installs the pinned Firecracker + jailer +
restic — the same artifacts `server-install.ts` uses — and downloads a
Firecracker-CI kernel + rootfs into `/var/lib/krova/images`), copies
`cube-lifecycle-smoke.sh`, and runs it. Idempotent; safe to re-run. Versions
default to the pins in `config/platform.ts` and can be overridden with
`FC_VERSION=… RESTIC_VERSION=… pnpm test:host <target>`.

The host must be a throwaway dev box: the harness installs binaries and writes
under `/var/lib/krova/{images,jail,smoke}`. It only kills firecracker/jailer
processes tagged with its own per-run id and never touches a real cube.

## What it proves (and the bugs each test guards)

| Test | Asserts | Guards against |
| ---- | ------- | -------------- |
| 1. odd vCPU boots | `vcpu_count=3` (smt unset) → InstanceStart 204, Running | Re-introducing a bogus "1-or-even" vCPU restriction. The swagger limits parity ONLY with SMT enabled, and Krova never sets `smt`. |
| 2. virtio-mem hotplug | `PUT` + `PATCH /hotplug/memory` exists (not 404) on v1.15.1 | The live-RAM-resize endpoint silently disappearing on an FC bump. (A full grow needs `CONFIG_VIRTIO_MEM`, which the Krova kernel has but the CI kernel does not.) |
| 3. jailed boot | Krova's exact jailer argv (`--cgroup-version 2 --new-pid-ns`, **no** `--cgroup`) boots on a cgroup-v2-only host | A jailer-arg change that breaks launch; proves omitting `--cgroup` does not. |
| 4. SIGKILL → zombie | a SIGKILL'd jailed FC (PID 1 of its ns) can become a zombie that `kill -0` still reports alive; the `ps -o stat=` check classifies it as exited | Regressing `assertFirecrackerExited` back to a naive `kill -0`, which falsely errors a cube on cold-restart/power-off. |
| 6. sleep / wake | `PATCH /vm {state:Paused}` → Paused, `{state:Resumed}` → Running on a jailed cube | A pause/resume regression that errors a cube on sleep/wake. |
| 7. cold-restart cycle | launch jailed → SIGKILL → zombie-aware wait → relaunch the SAME id → Running | The whole cold-restart path (the exact flow the zombie bug broke); proves kill+relaunch round-trips. |
| 5. restic forget --tag | `forget --tag` scopes the prune to tagged snapshots; restic has **no** `--keep-id` | Re-introducing the rustic-only `--keep-id` flag, or a forget that shreds untagged (manual) snapshots. |

A green run is the gate; a red test names the exact lifecycle behavior that
broke.
