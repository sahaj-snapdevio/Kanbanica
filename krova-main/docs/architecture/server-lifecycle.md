# Server Setup & Cube Lifecycle Recovery

> On-demand detail extracted from CLAUDE.md. CLAUDE.md keeps only a short summary + a pointer to this file; the full reference lives here.

### Phased Server Setup

New bare-metal servers go through six idempotent phases driven from the Orbit UI: `bootstrap` → `install` → `pull_images` → `network` → `reboot` → `verify` → `ready`. A failed phase is recovered by retrying it (each phase is idempotent) — there is no snapshot-based rollback. Each phase tracks state on the `servers` table (`setupPhase`, `setupStatus`, `setupError`, `setupStartedAt`). The bootstrap phase captures one-shot SSH credentials, pushes the platform key, hardens sshd to port 2822 with an ADD-then-REMOVE pattern + backgrounded-sleep rollback safety net, and **auto-detects CPU/RAM/disk capacity** (`nproc` / `/proc/meminfo` / `df -B1G /`) which is persisted to the `servers` row. The operator does not enter hardware totals in the create-server form. The **install** phase also applies the multi-tenant host hardening (KSM **off** + persisted-off, `kvm nx_huge_pages=never` via modprobe.d, cgroup `favordynmods`, **CPU `performance` governor + turbo via a `krova-cpu-perf` systemd oneshot** — audit C1, retrofit existing servers with `pnpm install:cpu-governor`) and **version-gates** the firecracker/jailer/restic/rclone installs (re-running a phase upgrades a host stuck on an old pinned version, mirroring the restic/rclone verify-then-install gate). The **reboot** phase ([server-reboot.ts](lib/worker/handlers/server-reboot.ts)) reboots the host once so those boot-time settings take effect and are proven to survive a real boot — it waits for the host to drop then return and confirms a `boot_id` change, and **hard-refuses if the server has any cube** (Rule 58 preflight), so it is structurally a setup-only operation. The **verify** phase runs its readiness checks (now including `jailer`, `krova-vsock-pty`, KSM-off, `nx_huge_pages=never`, CPU `performance` governor) against the POST-reboot host and, on success, advances to `ready` **WITHOUT auto-activating** — a freshly-set-up server ends `setupPhase=ready` + `status=inactive`, and an operator activates it manually (the Activate button on the Setup or Overview tab flips `status=active` and adds it to the allocation pool). This keeps a not-yet-vetted host out of the pool until a human explicitly opts it in. Per-phase Run/Retry buttons live on the server detail page; live updates via Pusher on `private-server-{serverId}`.

**Live job logs (`job_logs` table).** Every multi-step pg-boss handler instantiates a `JobLogger` from `lib/worker/job-log.ts` and calls `log.info`/`log.warn`/`log.error` for ad-hoc messages or `log.step(label, fn)` to wrap a discrete unit of work with auto-timing + error capture. Each call writes a row to `job_logs` (with optional stdout/stderr tail) and emits a `job.log` Pusher event on `private-{entityType}-{entityId}` so the UI can stream live. The shared `<JobLogStream logsUrl={...} channelName={...} />` component is reused on both the admin server-detail page (`/api/orbit/servers/[serverId]/job-logs` + `private-server-{serverId}`) and the customer cube-detail page (`/api/spaces/[spaceId]/cubes/[cubeId]/job-logs` + `private-cube-{cubeId}`). Falls back to 3-second SWR polling when Pusher is unavailable so the UI stays accurate without realtime.

Wired into: `cube.provision` (via `cube-boot.ts`), `cube.delete`, `cube.sleep`, `cube.wake`, `snapshot.create`, `snapshot.restore`, `snapshot.delete`, `backup.create`, `backup.delete`, `backup.redeploy`, `domain.add`, `domain.remove`, all five `tcp-mapping.*` handlers, the five `server.*` setup phases, `server.refresh-caddy`, and `server.update-caddy`. Periodic system jobs (`cube.state-sync`, `server.reconcile`, `billing.hourly`, `storage.health-check`, the prune/reaper) intentionally don't log per-tick to avoid noise.

Retention is enforced by a daily pg-boss cron (`job-logs.prune` at 03:00 UTC):

- Errors retained 90 days; info/warn retained 30 days (forensics value > UI freshness).
- Per-entity cap: at most 5,000 rows per `(entityType, entityId)` — bounds storage even for entities with chatty job histories.
- A cube's full job_logs are also purged at the end of `cube.delete` since the detail page is no longer reachable.

Setup phases that get stuck at `setupStatus="running"` (e.g. worker process killed mid-handler) are auto-recovered by the `server.setup-reaper` cron (every 5 min, threshold 1 hour). Operators can also force-reset via `POST /api/orbit/servers/[serverId]/setup/reset` from the UI.

**Cross-distro support.** Every package-manager call across the bootstrap, install, and network helpers branches on `apt-get` (Debian/Ubuntu) vs `dnf`/`yum` (RHEL/AlmaLinux/Rocky/CentOS Stream), with an explicit `else exit 1` for unsupported distros. Caddy uses Cloudsmith's deb repo on Debian/Ubuntu and the official `@caddy/caddy` COPR on RHEL. iptables persistence uses `iptables-persistent` + `/etc/iptables/rules.v4` on Debian/Ubuntu and `iptables-services` + `/etc/sysconfig/iptables` on RHEL. Bootstrap also detects and pre-clears SELinux (semanage), firewalld, and ufw automatically — so a fresh AlmaLinux box or a fresh Ubuntu Server box both flow through the same setup phases without operator intervention.

**No phase rollback.** Setup phases are not snapshotted — a failed phase is recovered by retrying it (every phase is idempotent), not by rolling the box back. Bootstrap still has its own sshd_config rollback marker (a backgrounded-sleep auto-restore) so a botched sshd hardening can't lock the operator out.

### Host Reboot Recovery

A bare-metal host reboot kills every Firecracker process — cubes run as bare
`nohup` processes with no host-side autostart. The database is the single
source of truth for cube state: a reboot must NOT change `cubes.status`.

`cube.state-sync` reads `/proc/sys/kernel/random/boot_id` each tick. If it
differs from `servers.last_boot_id`, the host rebooted: state-sync skips its
per-cube demote (so `running` cubes are NOT flipped to `sleeping`) and
enqueues `server.reboot-recovery`. That job restarts every cube the DB says
is `running` on the server via `startCube`, then records the new boot-id. It
is idempotent — keyed on the boot-id — and enqueued with a per-server pg-boss
`singletonKey` so repeat triggers collapse to one run.

For fast recovery, each host runs a `krova-boot-notify.service` systemd
oneshot (installed by the `install` setup phase; retrofit existing servers
with `pnpm install:boot-notify`). On boot it POSTs `/api/internal/server-rebooted`
with a derived per-server token (`HMAC-SHA256(APP_SECRET, serverId)` —
`APP_SECRET` never leaves the control plane), which enqueues recovery
immediately. Without the signal, the `cube.state-sync` boot-id check is the
≤2-minute fallback.

`server.reconcile` never auto-deletes cubes and **never auto-destroys
orphaned VMs on the host either**. A ghost cube (DB says running, VM gone),
a cube stuck in `error`, or an orphaned cube directory on a host (no DB
row, or DB row marked `deleted`) is marked and surfaced to admins by email
— the orphan-notification includes the host path, disk size, process
state, and the exact `pnpm cube:inspect` command to inspect / destroy
after manual confirmation. Cube deletion is operator-controlled through
Orbit or `pnpm cube:inspect <id> --destroy`. The audit log dedupes
repeat orphan emails to one per (cube, server) per 24h.

### Guest-initiated reboot recovery (`cube.auto-relaunch`)

Firecracker does not support guest-initiated reboot — when the guest issues
`reboot` / `systemctl reboot` / `shutdown -r`, the VMM treats it as VM
shutdown and exits cleanly with `exit_code=0` rather than rebooting in
place. Without the platform intervening, the cube goes silent until an
admin cold-restarts it.

`cube.state-sync` covers this gap: when it sees DB=`running` + hypervisor=
`shut off`, it tails the cube's `fc.log` for the `Firecracker exiting
successfully. exit_code=0` marker. If present, it enqueues
`cube.auto-relaunch` ([cube-auto-relaunch.ts](lib/worker/handlers/cube-auto-relaunch.ts))
which atomically claims the cube (`running|booting → booting`), calls
`startCube` with the existing machine config + rootfs, then flips the row
back to `running` with `lastBilledAt` / `lastStartedAt` reset and
`bootedKernelVersion` refreshed to the server's `currentKernelVersion`.
Lifecycle log: _"Cube auto-restarted after guest-issued reboot (kernel
vX.Y)"_.

**Rate limit.** State-sync counts auto-restart lifecycle log entries in the
last 1 hour. Past **3 auto-restarts/hour** the cube is flipped to `error`
with _"Guest issued reboot but cube has hit the auto-restart rate limit…"_
and admins are notified — a guest that reboots itself this often is either
misconfigured or in a boot loop, and burning fleet cycles on it doesn't
help anyone. Manual cold-restart resets the window.

**Dedup.** `cube.auto-relaunch`'s queue has `policy: "exclusive"` and
state-sync enqueues with `singletonKey: cubeId`. Back-to-back state-sync
ticks that both catch the same dead Firecracker before the handler has
flipped the row to `booting` collapse to one in-flight job. The
state-sync helper also gates the lifecycle log on `enqueueJob` returning a
non-null jobId so the UI doesn't show two identical "Guest issued reboot…"
entries.

A guest `shutdown -h now` looks identical on the wire (same exit_code=0
marker) and is treated the same way — auto-relaunch. Customers who want
to truly halt a cube use Sleep / Power Off through the platform UI; an
in-guest halt bypassing the platform is rare enough that auto-relaunching
is the right default (preserves the running billing contract and matches
intent for the common case).

**Reboot-recovery `bootedKernelVersion` refresh.** When
[server-reboot-recovery.ts](lib/worker/handlers/server-reboot-recovery.ts)
actually relaunches a cube (rather than reconciling a still-alive VM), it
also refreshes `cubes.bootedKernelVersion` to the server's
`currentKernelVersion` — same semantics as cube-cold-restart and
cube-auto-relaunch. Without this the UI's "Cold-restart to upgrade" badge
would mislead customers into a redundant cold-restart of an already-current
cube. The no-op branch (VM was already running, recovery just reconciled
the DB) writes a distinct lifecycle log — _"Cube reconciled after host
reboot — VM was already running"_ — instead of the misleading "Cube
restarted after host reboot".

**Orphan loop-mount reaper (`host.mount-reaper`, every 10 min).** A
sibling cron to `server.reconcile` that sweeps stale
`/tmp/krova-mount-<cubeId>` loop-mounts left behind when `createCube()`
/ `snapshot.restore` / `backup.redeploy` crashed between their `mount -o
loop` and the `finally umount`. The leftover loop device keeps pinning
the rootfs inode even after `cube.delete` runs, eating disk blocks as
`(deleted)` until reboot (the 2026-05-22 incident motd
`/tmp/krova-mount-* using 99.7% of 9.76GB`). The reaper is structurally
incapable of touching cube data — its scope is hardcoded to ext4 loop
mounts under `/tmp/krova-mount-<lowercase-alphanumeric>` only (the
`/tmp/krova-transfer-*` mounts used by `cube.transfer` are outside the
regex), it skips any mount whose cube is in
`pending|booting|stopping` (a live handler may still need it), it uses
plain `umount` (not `-l` lazy) so the kernel-authoritative EBUSY check
makes a busy mount unreachable to it, and it follows up with `rmdir`
(refuses non-empty dirs by design). No `rm` is ever called. `cube.delete`
also defensively `umount`s the same path before its workspace `rm -rf`
to prevent the (deleted)-inode pinning in the first place. Reaped mounts
are recorded as `server.mount_reaped` audit-log entries.

### Automatic error recovery (`cube.error-recovery`)

A cube can land in `status='error'` from a transient host problem — the most
common being the bare-metal host going unreachable (`EHOSTUNREACH`) during a
lifecycle op (the 2026-05-28 `mango` outage), a failed cold-restart, or a
guest reboot loop hitting the auto-relaunch rate limit. None of the standard
relaunch paths accept an `error` cube (cold-restart needs `running`, wake
needs `sleeping`), so an `error` cube is otherwise a dead-end until an operator
intervenes (`cube:inspect --restart`).

Two crons close that gap automatically:

1. **`cube.error-recovery-scan`** (every 5 min, `policy: "exclusive"`,
   [cube-error-recovery-scan.ts](lib/worker/handlers/cube-error-recovery-scan.ts)).
   Finds cubes in `error` that (a) are `transferState='idle'`, (b) have
   `last_started_at` set — i.e. successfully ran at least once, so the rootfs
   is known-bootable (a first-provision failure is left for manual handling),
   (c) are under the `error_recovery_attempts` cap, and (d) sit on an
   `active` server. It probes each distinct host's SSH port once
   (`isServerReachable`, a lightweight TCP connect — NOT an SSH handshake) and
   enqueues `cube.error-recovery` only for reachable hosts, `singletonKey=cubeId`.
   A cube on a down host is simply skipped this tick (no attempt burned) and
   retried next tick once the host returns.
2. **`cube.error-recovery`** (per cube, `retryLimit: 0`, `policy: "exclusive"`,
   [cube-error-recovery.ts](lib/worker/handlers/cube-error-recovery.ts)).
   Mirrors `cube.auto-relaunch`: guarded `connectToServer`, atomic claim
   `error → booting`, `startCube` with the existing config + rootfs (customer
   state preserved), then `running`. **On success** the attempt counter resets
   to 0. **On failure** it sets `error` + `error_recovery_attempts = attempt`
   and, once the attempt hits `MAX_ERROR_RECOVERY_ATTEMPTS`
   (`config/platform.ts`, default **3**), emails the admins once and stops.
   `retryLimit: 0` is deliberate — the cron + the DB counter own all retries;
   pg-boss retries would double-count attempts, so the handler never rethrows
   on a recovery failure.

The counter resets to 0 on ANY successful start back to `running` — the
recovery handler itself and the `cube.wake` handler (which covers the manual
`cube:inspect --restart` → wake path). On first deploy, any pre-existing
`error` cubes (counter defaults to 0) become eligible and get up to 3
auto-revive attempts each.

**Guarded-connect invariant (host-down no longer strands rows).** The bug that
motivated all of the above: several handlers flipped a customer-visible row to
an in-progress state (`creating` / `restoring` / `materializing` / cube
`booting`) and then called `connectToServer` OUTSIDE the `try`, so an
`EHOSTUNREACH` escaped uncaught, the pg-boss retry short-circuited on the
no-longer-`pending` guard, and the row was stranded forever. **Every handler
that claims an intermediate-state row MUST do the SSH connect inside a guarded
block that, on failure, runs the same cleanup as its main catch (fail / delete
orphan / set cube `error`) and returns** — see `snapshot.create`,
`snapshot.restore`, `snapshot.promote-to-backup`, `snapshot.export`,
`cube.from-snapshot`, `cube.import-rootfs`, and `backup.redeploy`
(`backup.create` was already correct and is the reference). Prefer the preflight
`isServerReachable` check at the entry point too, but it's only best-effort
(TOCTOU) — the guarded connect is the guarantee.

Three layers protect the auto-snapshot path specifically (the 2026-05-28 outage
left 7 stuck `creating` rows): (1) the `snapshot.scheduler` does a per-host
`isServerReachable` preflight and SKIPS cubes on a down host (no doomed row
created); (2) `snapshot.create`'s guarded connect self-cleans if the host drops
mid-flight; (3) the **`snapshot.stale-check`** cron (hourly at :45,
`policy: "exclusive"`) reaps any `creating` + `storage_path IS NULL` row older
than 2h — the backstop for a worker hard-killed between the claim and the catch.
The cron + the manual `pnpm snapshots:cleanup-stuck` command share the same
eligibility rule + delete via `lib/cubes/stuck-snapshots.ts` (single source of
truth). `isServerReachable` (`lib/ssh`) is a single raw-TCP liveness probe to
the SSH port — NOT an SSH handshake and NOT a Pusher/socket.io connection.

