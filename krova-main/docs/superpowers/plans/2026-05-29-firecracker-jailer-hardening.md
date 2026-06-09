# Firecracker Jailer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every Krova cube's Firecracker process inside the Firecracker **jailer** — a per-cube unprivileged uid, chroot, PID namespace, and cgroup — plus a virtio-rng entropy device and tightened host posture, so a VMM/guest escape no longer lands as root on the host. Migrate the live fleet with zero forced downtime.

**Architecture:** Today Krova launches `nohup firecracker … &` directly **as root**, bare ([lib/ssh/firecracker.ts:476](../../../lib/ssh/firecracker.ts#L476), [:751](../../../lib/ssh/firecracker.ts#L751)). We introduce a `launch_mode` ('bare' | 'jailed') column on `cubes`, a per-cube unprivileged uid (allocated per-server like ports), and a single `lib/ssh/jailer.ts` module that owns jail construction + launch + teardown. The jailer chroots Firecracker to `/var/lib/krova/jail/firecracker/<id>/root/`; we **bind-mount** the canonical `rootfs.ext4` + kernel into that chroot so the existing snapshot/restic/loop-mount/resize code keeps using the original paths unchanged. Only the API socket, vsock UDS, fc.log, and pidfile move into the chroot, resolved through one helper. Networking stays on the shared `br0`/TAP/iptables path (we run the jailer **without `--netns`**). Existing running cubes keep running bare and untouched; they convert to jailed only on their next cold relaunch — lazily on any natural lifecycle event, or proactively via a batched migration command.

**Tech Stack:** Firecracker + jailer **v1.15.1** (pinned, [config/platform.ts:245](../../../config/platform.ts#L245)); jailer docs verified against `firecracker-microvm/firecracker` tag `v1.15.1` `docs/jailer.md`. TypeScript (strict), Drizzle ORM + Postgres, ssh2 client, pg-boss worker, bash over SSH on Ubuntu 24.04 (cgroup v2). Krova kernel 6.1.172 ([build-all-images.sh:162](../../../setup/images/build-all-images.sh#L162)).

> **✅ STATUS — SHIPPED & ENABLED FLEET-WIDE (2026-05-30).** All phases complete; `JAILER_ENABLED = true` in `config/platform.ts` and the live fleet (banana + mango) is migrated — every running cube launches jailed. Validated end-to-end on real hardware: jailed boot (SSH + nginx), per-cube uid isolation (uids 100000/100001), sleep/wake, snapshot/restore, cross-host transfer. **Two decisions below CHANGED during implementation — `CLAUDE.md` is the current source of truth:** (1) **D4** — rootfs/kernel are **HARDLINKED** (`ln -f`, same filesystem) into the chroot, **NOT bind-mounted**; there is no mount, so `rm -rf` teardown is inode-safe (see `lib/ssh/jailer.ts`). (2) **D1** — the dropped Firecracker runs as **gid = uid** (a unique per-cube group), **NOT a shared `kvm` gid**; the jailer mknods the in-chroot `/dev/kvm` owned by the per-cube uid, so device access is via the owner bit and a VMM escape shares no group with any sibling. The only remaining optional item is `ENTROPY_DEVICE_ENABLED` (needs an image rebuild) + host hardening.

---

## Design Decisions (read before implementing — these are the choices the plan locks in)

| # | Decision | Choice | Rationale / tradeoff |
|---|----------|--------|----------------------|
| D1 | Privilege drop | **Per-cube uid**, shared `kvm` gid | A VMM escape as uid X cannot read sibling cube Y's chroot/rootfs (distinct owner, files mode `0600`). Shared `kvm` gid only grants `/dev/kvm` group access, not cross-cube file access. firecrackmanager uses a *single* uid 1000 for all VMs — we do better. |
| D2 | uid allocation | Per-server dynamic pool, stored on `cubes.jailer_uid`, mirrors `lib/server/ports.ts` (Rule 17) | Guarantees no two **co-located** jailed cubes share a uid even across transfers. Base `JAILER_UID_BASE = 100000`. |
| D3 | Network namespace | **No `--netns` in v1** | Keeps the entire `br0`/TAP/iptables/DNAT path untouched. Per-cube netns is a large separate refactor — deferred to a future phase, noted but out of scope. |
| D4 | Rootfs/kernel in chroot | **Bind-mount** canonical paths into the chroot at launch; umount at teardown | Avoids touching snapshot/restic/loop-mount/resize/transfer code — they keep using `/var/lib/krova/cubes/<id>/rootfs.ext4`. Only launch/teardown gains a mount step. |
| D5 | PID namespace | **`--new-pid-ns`** | Real isolation win. Jailer writes the host-visible firecracker PID to `<chroot>/firecracker.pid`; teardown kills that PID with a chroot-path-scoped `pkill` fallback. |
| D6 | cgroup | `--cgroup-version 2` (Ubuntu 24.04 default), placement only in v1 | Resource caps (cpu/mem matching the cube's allocation) are an optional follow-up; v1 just places each FC in its own cgroup leaf for accounting + future limits. |
| D7 | seccomp | Leave Firecracker's **built-in default filter on** (never pass `--no-seccomp`) | Already the case for bare cubes. The jailer does not change this. No custom filter in v1. |
| D8 | Kill switch | `JAILER_ENABLED` flag in `config/platform.ts` | Flip to `false` → new launches go bare again; already-jailed cubes still tear down correctly via `launch_mode`. Clean rollback with no fleet churn. |
| D9 | Host `/dev/kvm` | `0660 root:kvm` (was legacy `0666`) | Jailer mknods its own `/dev/kvm` inside each chroot, so jailed cubes don't depend on host perms. Bare cubes run as root (always allowed). Tightening is safe for both. |
| D10 | Entropy | Firecracker `/entropy` (virtio-rng) device + kernel `CONFIG_HW_RANDOM_VIRTIO=y` | Guarantees guest RNG at first boot (sshd host-key/TLS). Independent, separately shippable (Phase 5). |
| D11 | SMT / side-channels | **Document the posture; leave SMT ON by default** | SMT-off gives true cross-tenant timing isolation but ~halves throughput. We document the residual risk and add an opt-in per-server toggle rather than force it. |

---

## What happens to the cubes you already have running (READ THIS)

**Deploying this code does not touch a single running cube.** The worker never reaches into a live Firecracker process; it only acts on lifecycle events. Concretely:

- **Running bare cubes keep running bare**, as root, exactly as today. The new `cubes.launch_mode` column is backfilled to `'bare'` for every existing row, and **every** stop/sleep/poweroff/delete/status/terminal/reachability/state-sync path branches on that flag — so a bare cube is always managed with its bare paths (`/var/lib/krova/cubes/<id>/…`). Nothing is orphaned by the deploy.
- A bare cube **converts to jailed only on a full cold relaunch** — i.e. wake-from-sleep, cold-restart, auto-relaunch, host-reboot-recovery, transfer, snapshot-restore, or a CPU/RAM-cold resize. At that moment the relaunch path tears down the (already-stopped) bare process, builds the jail, launches jailed, and flips `launch_mode='jailed'`. The customer sees the normal restart they already expect for those operations.
- **Sleeping cubes** convert on their next wake — no downtime concern, they're not running.
- Two rollout options for the existing fleet, you choose at Phase 6:
  - **Lazy** (default, zero forced downtime): cubes drift to jailed naturally as they get restarted/woken over days. Long-running cubes stay bare until something restarts them.
  - **Proactive** (`pnpm cubes:migrate-to-jailer`): a batched, per-server-throttled command that cold-restarts each bare running cube into the jail during a window you pick, writing a customer-visible lifecycle log. Each cube has a brief (~seconds) restart — the same cost as a cold-restart. Recommended after the canary proves out, in a low-traffic window, with customer notice.
- **Snapshots/backups already taken from bare cubes restore into jailed cubes fine** — restore *is* a relaunch, so it just lands in jailed mode.

**Net:** ship it → fleet unaffected → new cubes are jailed immediately → you migrate the rest on your schedule with at most a seconds-long restart per cube.

---

## Audit findings (2026-05-29) — the real blast radius

A full static trace of every per-cube path (`firecracker.sock` / `.pid` / `vsock.sock` / `fc.log` / `serial.log` / `rootfs.ext4`) and every FC launch/kill/status site found **the change is larger than first scoped, and three findings would have broken running jailed cubes if shipped as originally planned.** All are now folded into the tasks below.

**🔴 BREAKING — must fix before any jailed cube exists:**

1. **`lib/ssh/guest-exec.ts` is the linchpin and was missed.** `guestExec` / `guestPing` / `guestMetrics` hardcode `${CUBE_BASE_DIR}/${cubeId}/vsock.sock` and are *"the ONLY way the platform runs commands inside VMs"* — **22 call sites across 11 files**: live disk-grow `resize2fs` (`cube-resize`), reachability L1 ping + L3 metrics (`cube-reachability`, every minute), `cube-from-snapshot`, `cube-import-rootfs`, `backup-redeploy`, `backup-create`, `snapshot-create`, `cube-transfer`, `cube-boot`, and `scripts/install-agent-fleet.ts`. For a jailed cube the vsock UDS moves into the chroot → **all of these break**. **Fix (low-churn):** resolve the path *inside guest-exec itself* with a host-side existence probe — `VS=$([ -S <jailVsock> ] && echo <jailVsock> || echo <bareVsock>)` in the same SSH command — so it's correct for both modes with **zero signature change and zero call-site edits**. This same existence-probe pattern is the recommended resolution strategy everywhere (no DB lookup, no threading `launchMode` through 22 callers).

2. **`server-reconcile` would flag every running jailed cube as a ghost.** It enumerates `ls -1 /var/lib/krova/cubes/` (line 123 — still valid, the canonical cube dir persists under D4) but checks liveness via `cat /var/lib/krova/cubes/<id>/firecracker.pid` (line 219). A live *jailed* cube has its pid in the jail → reconcile reads "stopped" → **false ghost-cube detection + admin-spam email on every running jailed cube, every reconcile tick.** Same bug in `scripts/cube-inspect.ts` (183/366) and `app/api/orbit/servers/[serverId]/health/route.ts` (211). **Fix:** these have DB access — resolve the pid path by the cube's `launch_mode`.

3. **Inline kill/status duplication (latent Rule 14 violation) — 7 sites bypass `firecracker.ts`.** `cube-cold-restart` (86/96), `snapshot-restore` (150/158), and cleanup-kills in `cube-boot` (188), `cube-from-snapshot` (163), `cube-import-rootfs` (195), `backup-redeploy` (192), `cube-transfer-cancel` (155) each re-implement the pid-kill with a hardcoded bare path instead of calling a helper. Every one breaks for jailed cubes. **Fix:** add central `stopFirecrackerProcess(client, cube)` + `firecrackerProcessAlive(client, cube)` helpers (jail-aware) and replace all 7 inline copies + the 5 in `firecracker.ts` — closes the jailer gap AND pays down the duplication.

**🟠 Additional jail-aware sites (correctness, not catastrophic):**
- `cube-state-sync.ts` — **6** `fc.log` refs (57, 287, 309, 489, 505, 515), not the single one first noted. All the guest-reboot exit-marker tails.
- `cube-resize.ts:277` — talks to `firecracker.sock` inline for live RAM/disk PATCH.
- `app/api/orbit/cubes/[cubeId]/vm-console/route.ts` (8/70/75) — reads `serial.log`/`fc.log` for the admin VM console.
- `lib/worker/job-types.ts:121` — a path constant/comment to reconcile.

**🟢 Interaction risks — assessed:**
- **Disk accounting is SAFE, and it validates the bind-mount choice (D4).** `server-measure-disk` computes `overhead = df_used(/) − du(/var/lib/krova/cubes)`. With a **bind-mount**, the rootfs inode is counted once (df sees one inode; `du(cubes)` walks the canonical path) → overhead unchanged. The jail chroot adds only the per-cube firecracker binary copy (~5 MB) + socket/log under `/var/lib/krova/jail`, correctly attributed as overhead. **Had we *copied* the rootfs into the jail instead, every cube's disk would have doubled** — so D4 is not just convenient, it's required for the no-oversell disk math (Rule 53) to stay correct.
- **`host-mount-reaper` won't wrongly touch jail mounts** (regex hardcoded to `/tmp/krova-mount-<id>` ext4) — but it also **won't reap a *leaked* jail bind-mount** under `/var/lib/krova/jail`. If `teardownJail`'s `umount` ever fails, the rootfs inode pins as `(deleted)` (the 2026-05-22 incident class). **Fix:** make `teardownJail` umount robust + extend the reaper's scope to cover `/var/lib/krova/jail/firecracker/<id>/root/rootfs.ext4` mounts.

**Verdict:** the architecture (jailer + bind-mount + `launch_mode` flag) is sound and the fleet-safety design holds, but the **surface is ~20 coupling sites, not the ~6 first listed**, and 3 of them would actively break running jailed cubes. The guest-exec existence-probe pattern collapses the biggest one (22 callers) to a single-file fix. None of this changes the running-cubes safety story — a *bare* cube is unaffected by all of the above because every site resolves by `launch_mode`/socket-existence. The plan's File Structure and tasks below are updated to cover the full set.

---

## Phase 2 review outcome (2026-05-29) — implemented + adversarially reviewed

Phase 2 (jailer launch/teardown wired into `firecracker.ts`, behind `JAILER_ENABLED=false`) is implemented and passed a 5-lens adversarial review (bare-regression, jailed-correctness, leak/idempotency, shell-safety, completeness) + typecheck/lint/pure-checks.

**Confirmed safe:**
- **BARE path is byte-identical to HEAD** (every bare command/path/timeout unchanged; `cubePaths(id,"bare")` === the legacy strings) — verified end-to-end. The only delta is one cheap `isJailed` (`test -d`) probe on delete/sleep/wake/poweroff/status, which degrades to bare on any error and cannot misroute a bare cube.
- **Hardlink design** (`ln -f`, not bind-mount): `rm -rf` of the chroot can never delete the canonical rootfs (same inode, canonical link survives); `teardownJail` is a safe no-op on bare; chown rootfs→uid doesn't harm root-run restic/loop-mount; the virtio-mem retry loop is idempotent (teardown-first); the kernel hardlink keeps disk accounting correct.
- **Jailed launch/config/teardown correct vs the canary facts.** No open-before-link race (PID-ns only, no mount-ns → the post-launch hardlink is visible to the chrooted FC, which opens the drive only at InstanceStart, after `launchJailed` returns).

**Fixed in response to the review:**
- 🔴 **uid preflight (Rule 58)** in `createCube`/`startCube`/`launchJailed` — a jailed launch with a missing/invalid uid now fails read-only BEFORE any host mutation (was an unguarded `as number` that would `chown undefined` the rootfs after spawning the jailer).
- gid NaN guard (gid 0 no longer mistaken for absent); same-filesystem preflight (clear error vs opaque cross-device `ln`); `jailer.ts` docstrings corrected to "hardlink" (a maintainer must not re-add umount).

**Carry-forward to PHASE 3 (the review's deeper recommendation):**
- **Thread the authoritative `cubes.launch_mode` (DB) into `getCubeStatus` / `sleepCube` / `wakeCube` / `powerOffCube` / `deleteCube`** (plus the other kill/path sites: guest-exec, cube-state-sync fc.log, terminal-bridge, server-reconcile, cube-inspect, cube-cold-restart, snapshot-restore, cube-from-snapshot, cube-import-rootfs, backup-redeploy, cube-transfer-cancel, cube-boot). The `isJailed` SSH probe stays ONLY as a defensive fallback. This resolves both (a) the HIGH "isJailed fails-to-bare on probe error → healthy jailed cube reported 'shut off' to state-sync" finding and (b) the extra-probe latency on the hot path — with the DB mode threaded, real cubes never hit the probe.
- Wire `freeJailerUid` on cube delete + transfer-out (currently uncalled).
- **GATE: do NOT flip `JAILER_ENABLED=true` until the launch_mode threading above lands.** It makes the isJailed fail-to-bare finding unreachable for real cubes (and the whole feature is inert while the flag is false).

**Verify on the PHASE 7 canary (settle a reviewer disagreement empirically):**
- Confirm `pkill -f <cubeId>` reaps BOTH the jailer parent AND the chrooted firecracker child (v1.15.1 docs say the jailer execs `firecracker --id=<cubeId> …` so the child carries the id — but two lenses doubted it; settle with `ps`/`pgrep`).
- Confirm an abort/retry mid-launch leaves NO orphan firecracker (no `Open tap device failed: Resource busy` on the next launch).

---

## File Structure

**New files:**
- `lib/ssh/jailer.ts` — jail path resolver, uid allocator, `buildJailerArgs()` (pure), `launchJailed()`, `teardownJail()`. Single source of truth for everything chroot-related.
- `lib/server/jailer-uids.ts` — `allocateJailerUid(client, serverId)` / `freeJailerUid()` mirroring `lib/server/ports.ts`.
- `scripts/migrate-cubes-to-jailer.ts` — proactive batched fleet migration (`pnpm cubes:migrate-to-jailer`).
- `scripts/jailer-pure-checks.ts` — `tsx` assertion scratch for the pure functions (Krova has no test runner; this is the executable verification).
- `docs/security/host-hardening.md` — SMT/side-channel posture + Firecracker production-host checklist.
- `db/migrations/00NN_*.sql` — generated by `pnpm db:generate` (never hand-written, Rule 6).

**Modified files:**
- `db/schema/cubes.ts` — add `launchMode` enum column + `jailerUid` int column.
- `config/platform.ts` — `JAILER_ENABLED`, `JAILER_CHROOT_BASE`, `JAILER_UID_BASE`, `JAILER_BIN`.
- `lib/ssh/firecracker.ts` — route launch (`createCube`/`startCube`) + all kill paths (`deleteCubeVm`/`powerOffCube`/`sleepCube`/retry-kills) through the jailer helpers; resolve socket/vsock/log/pid via the resolver.
- `lib/worker/handlers/cube-terminal-bridge.ts:735` — resolve vsock path by `launch_mode`.
- `lib/worker/handlers/cube-state-sync.ts:505` — resolve fc.log path by `launch_mode`.
- `lib/worker/handlers/cube-reachability.ts` — resolve vsock path by `launch_mode`.
- **`lib/ssh/guest-exec.ts`** — 🔴 the linchpin (22 callers). Resolve vsock path via host-side existence probe (see Audit finding 1).
- `lib/worker/handlers/server-reconcile.ts` + `scripts/cube-inspect.ts` + `app/api/orbit/servers/[serverId]/health/route.ts` — 🔴 jail-aware pid path (Audit finding 2).
- `lib/worker/handlers/cube-cold-restart.ts`, `snapshot-restore.ts`, `cube-transfer-cancel.ts`, `cube-from-snapshot.ts`, `cube-import-rootfs.ts`, `backup-redeploy.ts`, `cube-resize.ts` — 🔴 route inline kill/status/socket through the new central helpers (Audit finding 3 + state-sync/resize).
- `app/api/orbit/cubes/[cubeId]/vm-console/route.ts` — 🟠 jail-aware serial.log/fc.log.
- `lib/worker/handlers/host-mount-reaper.ts` — 🟢 extend scope to reap leaked `/var/lib/krova/jail/.../rootfs.ext4` bind-mounts.
- **Full authoritative list + fix approach per site: see the "Audit findings" section above.**
- `lib/worker/handlers/cube-delete.ts` + `lib/worker/cube-boot.ts` — pass the loaded cube (with `launchMode`) into the firecracker helpers; free the uid on delete.
- The ~10 relaunch handlers (`cube-wake`, `cube-cold-restart`, `cube-auto-relaunch`, `server-reboot-recovery`, `cube-error-recovery`, `cube-transfer`, `snapshot-restore`, `backup-redeploy`, `cube-from-snapshot`, `cube-import-rootfs`, `cube-resize`) — no logic change; they already call `startCube`, which becomes jail-aware internally. Verify each passes the cube's `launchMode` through where the helper now needs it.
- `setup/images/build-all-images.sh` — add `CONFIG_HW_RANDOM_VIRTIO=y` (Phase 5).
- `lib/worker/handlers/server-install.ts` — `/dev/kvm` `0660 root:kvm`; ensure `JAILER_CHROOT_BASE` exists; verify jailer present (already downloaded — confirm in `verify host tools`).

---

## Verification reality

Krova has **no automated test runner** (no `pnpm test`). Verification per task is:
1. `pnpm typecheck` and `pnpm lint` (must be green — the existing bar).
2. Pure functions (`buildJailerArgs`, path resolver, uid math) are exercised by `tsx scripts/jailer-pure-checks.ts` with `assert`.
3. Behavior is proven on a **canary server with a throwaway cube**, following the smoke protocol in Phase 7 — never on a customer cube first.

---

## Phase 0 — Verify the jailer on a canary (no code)

### Task 0.1: Confirm the installed jailer matches the pinned docs

- [ ] **Step 1: Confirm version on an active host**

Run (substitute a real active server):
```bash
ssh -p 2822 root@<host> 'jailer --version; firecracker --version'
```
Expected: both report `v1.15.1`.

- [ ] **Step 2: Hand-launch a throwaway jail to confirm layout + pid + devices**

On the canary host, with a spare rootfs+kernel already present, run a manual jail and record: the exact chroot path (`/var/lib/krova/jail/firecracker/<id>/root/`), that `/dev/kvm` + `/dev/net/tun` appear inside it owned by the test uid, where `firecracker.pid` is written, and that `curl --unix-socket <chroot>/root/run/firecracker.socket http://localhost/` answers. Document the observed paths in the PR description.

- [ ] **Step 3: Decide & record**

Confirm D1–D11 still hold against observed behavior. If anything differs (pid location, socket path), update `lib/ssh/jailer.ts` constants in Phase 2 accordingly. **Gate:** do not start Phase 2 until the manual jail boots a guest end-to-end on the canary.

---

## Phase 1 — Schema, config, and pure helpers (no runtime behavior change)

### Task 1.1: Add `launchMode` + `jailerUid` to the cubes schema

**Files:**
- Modify: `db/schema/cubes.ts`
- Generate: `db/migrations/00NN_*.sql` via `pnpm db:generate`

- [ ] **Step 1: Add the pgEnum + columns**

In `db/schema/cubes.ts`, add near the other cube enums:
```ts
export const cubeLaunchMode = pgEnum("cube_launch_mode", ["bare", "jailed"]);
```
Add to the `cubes` table definition:
```ts
  launchMode: cubeLaunchMode("launch_mode").notNull().default("bare"),
  jailerUid: integer("jailer_uid"),
```
`default("bare")` backfills every existing row as bare (Rule 40: additive, non-locking, safe in PG 11+). `jailerUid` is nullable (bare cubes have none).

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `db/migrations/00NN_*.sql` with `ALTER TABLE "cubes" ADD COLUMN …` + the enum `CREATE TYPE`, plus a matching snapshot + `_journal.json` entry. **Do not hand-edit any of the three** (Rule 6).

- [ ] **Step 3: Verify additive + idempotent**

Read the generated SQL. Confirm it is only `CREATE TYPE` + `ADD COLUMN` (no DROP/ALTER TYPE/RENAME). Confirm the enum/column adds. Run `pnpm typecheck`.

- [ ] **Step 4: Commit**
```bash
git add db/schema/cubes.ts db/migrations/
git commit -m "feat(jailer): add cubes.launch_mode + jailer_uid columns"
```

### Task 1.2: Add jailer config constants

**Files:** Modify: `config/platform.ts`

- [ ] **Step 1: Add constants** (near `FIRECRACKER_VERSION`)
```ts
/** Master switch for jailer-mode launches. When false, new cubes launch bare
 *  (legacy path). Already-jailed cubes still tear down correctly via
 *  cubes.launch_mode. This is the rollback kill-switch (plan D8). */
export const JAILER_ENABLED = true;
/** Path to the jailer binary on hosts (installed by server.install). */
export const JAILER_BIN = "/usr/local/bin/jailer";
/** Base dir under which the jailer builds per-cube chroots:
 *  <base>/firecracker/<cubeId>/root/  (jailer v1.15 layout). */
export const JAILER_CHROOT_BASE = "/var/lib/krova/jail";
/** Per-cube unprivileged uids are allocated from this base upward,
 *  unique per host (plan D2). */
export const JAILER_UID_BASE = 100_000;
```

- [ ] **Step 2: Verify + commit**

Run `pnpm typecheck`. Commit `config/platform.ts`.

### Task 1.3: Per-server jailer-uid allocator (mirror of ports)

**Files:**
- Read first: `lib/server/ports.ts` (copy its locking + in-use-set pattern, Rule 14 — do NOT invent a new scheme)
- Create: `lib/server/jailer-uids.ts`
- Verify with: `scripts/jailer-pure-checks.ts`

- [ ] **Step 1: Implement allocate/free**

`allocateJailerUid(client, serverId)` selects the lowest free uid ≥ `JAILER_UID_BASE` not present in `SELECT jailer_uid FROM cubes WHERE server_id = ? AND jailer_uid IS NOT NULL`, inside the same advisory-locked pattern `ports.ts` uses. `freeJailerUid(cubeId)` nulls the column. Full code follows `ports.ts` structurally — read that file and match it exactly.

- [ ] **Step 2: Pure check for the "lowest free" math**

Add to `scripts/jailer-pure-checks.ts` a `lowestFreeUid(base, inUse: number[])` pure helper (export it from `jailer-uids.ts`) and assert: `lowestFreeUid(100000, [100000,100001]) === 100002`; `lowestFreeUid(100000, []) === 100000`; `lowestFreeUid(100000, [100001]) === 100000`.

- [ ] **Step 3: Run the check**

Run: `pnpm tsx scripts/jailer-pure-checks.ts`
Expected: prints `OK` (no assertion throws).

- [ ] **Step 4: typecheck + lint + commit**

### Task 1.4: The jailer path resolver + arg builder (pure, the core of the module)

**Files:**
- Create: `lib/ssh/jailer.ts`
- Verify with: `scripts/jailer-pure-checks.ts`

- [ ] **Step 1: Implement the resolver + arg builder**
```ts
import { JAILER_BIN, JAILER_CHROOT_BASE } from "@/config/platform";

export const EXEC_FILE_NAME = "firecracker";

/** Host-visible chroot root for a jailed cube (jailer v1.15 layout). */
export function jailRoot(cubeId: string): string {
  return `${JAILER_CHROOT_BASE}/${EXEC_FILE_NAME}/${cubeId}/root`;
}

export interface CubePaths {
  apiSock: string;
  vsockPath: string;
  fcLog: string;
  pidFile: string;
}

/** The four paths that MOVE under the jailer. rootfs.ext4 is intentionally
 *  NOT here — it stays at its canonical /var/lib/krova/cubes path and is
 *  bind-mounted into the chroot (plan D4), so snapshot/restic/mount code is
 *  unchanged. */
export function cubePaths(cubeId: string, mode: "bare" | "jailed"): CubePaths {
  if (mode === "jailed") {
    const r = jailRoot(cubeId);
    return {
      apiSock: `${r}/run/firecracker.socket`,
      vsockPath: `${r}/vsock.sock`,
      fcLog: `${r}/fc.log`,
      // jailer --new-pid-ns writes firecracker.pid INSIDE the chroot root.
      // CONFIRMED on canary banana 2026-05-29: <jailRoot>/firecracker.pid,
      // owner root:root, contents = host-visible FC pid. Read/kill as root over SSH.
      pidFile: `${jailRoot(cubeId)}/firecracker.pid`,
    };
  }
  const d = `/var/lib/krova/cubes/${cubeId}`;
  return {
    apiSock: `${d}/firecracker.sock`,
    vsockPath: `${d}/vsock.sock`,
    fcLog: `${d}/fc.log`,
    pidFile: `${d}/firecracker.pid`,
  };
}

/** Pure: build the jailer argv. FC args after `--` are RELATIVE to the chroot
 *  (jailer chroots before exec). */
export function buildJailerArgs(opts: {
  cubeId: string;
  uid: number;
  gid: number;
}): string[] {
  return [
    "--id", opts.cubeId,
    "--exec-file", `/usr/local/bin/${EXEC_FILE_NAME}`,
    "--uid", String(opts.uid),
    "--gid", String(opts.gid),
    "--chroot-base-dir", JAILER_CHROOT_BASE,
    "--cgroup-version", "2",
    "--new-pid-ns",
    "--",
    "--api-sock", "/run/firecracker.socket",
    "--log-path", "/fc.log",
    "--level", "Info",
  ];
}
```
Note: under the jailer the FC `--api-sock /run/firecracker.socket` resolves to host `jailRoot/run/firecracker.socket` (matches `cubePaths`). `--log-path /fc.log` → `jailRoot/fc.log`.

- [ ] **Step 2: Pure checks**

In `scripts/jailer-pure-checks.ts` assert:
```ts
import assert from "node:assert";
import { cubePaths, buildJailerArgs, jailRoot } from "@/lib/ssh/jailer";
assert.equal(jailRoot("abc"), "/var/lib/krova/jail/firecracker/abc/root");
assert.equal(cubePaths("abc","bare").apiSock, "/var/lib/krova/cubes/abc/firecracker.sock");
assert.equal(cubePaths("abc","jailed").apiSock, "/var/lib/krova/jail/firecracker/abc/root/run/firecracker.socket");
const a = buildJailerArgs({ cubeId: "abc", uid: 100000, gid: 999 });
assert.ok(a.includes("--new-pid-ns") && a.includes("--cgroup-version"));
console.log("OK");
```

- [ ] **Step 3:** Run `pnpm tsx scripts/jailer-pure-checks.ts` → `OK`. typecheck + lint + commit.

---

## Phase 2 — Jail launch + teardown wired into firecracker.ts (behind JAILER_ENABLED)

### Task 2.1: `launchJailed()` + `teardownJail()` in jailer.ts

**Files:** Modify: `lib/ssh/jailer.ts`; read `lib/ssh/firecracker.ts:268-540` for the exact pre-launch sequence to mirror.

- [ ] **Step 1: Implement `launchJailed(client, { cubeId, uid, gid })`**

Sequence (all via `execOrFail(client, …)`):
1. `mkdir -p ${jailRoot(cubeId)}/run`
2. Bind-mount the canonical rootfs + kernel into the chroot (plan D4):
   `mkdir -p ${jailRoot}/rootfs.ext4` is wrong — bind-mount a FILE: `touch ${jailRoot}/rootfs.ext4 && mount --bind /var/lib/krova/cubes/<id>/rootfs.ext4 ${jailRoot}/rootfs.ext4` and likewise the kernel `vmlinux`.
3. `chown -R ${uid}:${gid} ${JAILER_CHROOT_BASE}/firecracker/<id>` and `chmod 0600` the rootfs link.
4. Launch: `nohup ${JAILER_BIN} ${buildJailerArgs(...).join(" ")} > ${jailRoot}/serial.log 2>&1 &` (the jailer daemonizes the chroot; capture nothing from `$!` — read the canonical pid from the jailer's `firecracker.pid` per Task 0.2 findings).
5. Wait for the socket: `for i in $(seq 1 50); do test -S ${apiSock} && break; sleep 0.1; done; test -S ${apiSock}`.

Return `{ apiSock, vsockPath }` for the caller to run the existing FC API config (machine-config/boot-source/drives/network/vsock/InstanceStart) — those calls are unchanged except the **rootfs drive path passed to `/drives/rootfs` becomes `/rootfs.ext4`** (chroot-relative) and **vsock `uds_path` becomes `/vsock.sock`** (chroot-relative), while the worker still curls the host-visible `apiSock`.

- [ ] **Step 2: Implement `teardownJail(client, cubeId)`**

`PID=$(cat ${pidFile} 2>/dev/null); [ -n "$PID" ] && kill "$PID" 2>/dev/null; sleep 2; … kill -9` then a scoped fallback `pkill -f ${jailRoot(cubeId)} 2>/dev/null || true`, then `umount ${jailRoot}/rootfs.ext4 ${jailRoot}/vmlinux 2>/dev/null || true` (D4), then `rm -rf ${JAILER_CHROOT_BASE}/firecracker/<id>`. Uses `kill` semantics identical to the bare path ([firecracker.ts:673](../../../lib/ssh/firecracker.ts#L673)).

- [ ] **Step 3:** typecheck + lint + commit.

### Task 2.2: Route `createCube` + `startCube` through the jailer when enabled

**Files:** Modify: `lib/ssh/firecracker.ts` (launch sites :476 and :751; both take the loaded cube so they can read `launchMode`/`jailerUid`).

- [ ] **Step 1: Thread mode into the launch sites**

`createCube`/`startCube` receive the cube's intended mode: `JAILER_ENABLED ? "jailed" : "bare"` for fresh provisions; for relaunch, the existing `cubes.launch_mode` (a bare cube being woken converts to jailed iff `JAILER_ENABLED`). Allocate `jailerUid` (Task 1.3) when transitioning to jailed and persist it + `launch_mode='jailed'` on the row inside the caller's tx.

- [ ] **Step 2: Branch the launch**

Replace the inline `nohup firecracker …` at :476 and :751 with:
```ts
const paths = cubePaths(cubeId, mode);
if (mode === "jailed") {
  await launchJailed(client, { cubeId, uid, gid: KVM_GID });
} else {
  await execOrFail(client, `rm -f ${paths.apiSock} ${paths.vsockPath}`);
  await execOrFail(client, `nohup firecracker --api-sock ${paths.apiSock} --log-path ${paths.fcLog} --level Info > ${cubeDir}/serial.log 2>&1 & echo $! > ${paths.pidFile}`);
}
// …then the SAME /machine-config … InstanceStart sequence, with the
// rootfs drive path = mode === "jailed" ? "/rootfs.ext4" : `${cubeDir}/rootfs.ext4`
// and vsock uds_path = mode === "jailed" ? "/vsock.sock" : paths.vsockPath
```
`KVM_GID` is resolved once on the host (`getent group kvm | cut -d: -f3`) and cached; D1/D9.

- [ ] **Step 3: Branch every kill site**

`deleteCubeVm`, `powerOffCube`, `sleepCube`, and the two retry-kills ([:540](../../../lib/ssh/firecracker.ts#L540), [:814](../../../lib/ssh/firecracker.ts#L814)) call `teardownJail(client, cubeId)` when the cube is jailed, else the existing pidfile kill. **`sleepCube` keeps the rootfs** (it only pauses/kills the FC process) — for a jailed cube, sleep tears down the FC process + bind-mounts but the canonical rootfs is untouched (it lives at the cube dir, not the chroot), so wake re-bind-mounts and relaunches. Confirm sleep does NOT `rm -rf` the chroot's bind-mount source.

- [ ] **Step 4:** typecheck + lint. **Gate:** smoke on canary (Phase 7) before fleet. Commit.

---

## Phase 3 — Make the observers jail-aware

### Task 3.1: Terminal bridge vsock path

**Files:** Modify: [cube-terminal-bridge.ts:735](../../../lib/worker/handlers/cube-terminal-bridge.ts#L735)

- [ ] **Step 1:** Replace the hardcoded `${CUBE_BASE_DIR}/${cubeId}/vsock.sock` with `cubePaths(cubeId, bundle.launchMode).vsockPath`. Thread `launchMode` into the session bundle (it already loads the cube row).
- [ ] **Step 2:** typecheck + lint + commit.

### Task 3.2: state-sync fc.log path (guest-reboot exit-code tail)

**Files:** Modify: [cube-state-sync.ts:505](../../../lib/worker/handlers/cube-state-sync.ts#L505)

- [ ] **Step 1:** Replace the hardcoded fc.log path with `cubePaths(cubeId, cube.launchMode).fcLog`. The auto-relaunch exit-code marker tail then reads the right log for both modes.
- [ ] **Step 2:** typecheck + lint + commit.

### Task 3.3: reachability vsock path

**Files:** Modify: `lib/worker/handlers/cube-reachability.ts`

- [ ] **Step 1:** Where the L1 agent ping resolves the vsock UDS, use `cubePaths(cube.id, cube.launchMode).vsockPath`. (L2 SSH probe + L3 metrics are over the guest network/vsock CID — unaffected.)
- [ ] **Step 2:** typecheck + lint + commit.

---

## Phase 4 — Host hardening

### Task 4.1: Install the jailer binary + chroot base (HARD PREREQUISITE — confirmed missing fleet-wide on 2026-05-29 canary `banana`)

**Canary facts (2026-05-29):** `firecracker` is v1.15.1 ✓, but `jailer` is **not installed** — `server-install.ts:695-701` downloads `firecracker-v1.15.1-x86_64.tgz` (which contains BOTH `firecracker-…` and `jailer-…`) and `install`s only the firecracker binary, then `rm -rf`s the rest. `/dev/kvm` is already `660 root:kvm` (distro default — the legacy `chmod 666` in `setup-server.sh` is dead). `/usr/local/bin` and `/var/lib/krova` are the same filesystem → jailer hardlinks the FC binary into each chroot (no per-cube copy).

**Files:** Modify: `lib/worker/handlers/server-install.ts`; Create: `scripts/install-jailer.ts` + `pnpm install:jailer`.

- [ ] **Step 1:** In the firecracker install step (`server-install.ts:695-701`), add a sibling `install` line for the jailer from the SAME already-extracted tarball — `install -m 0755 release-${VER}-${ARCH}/jailer-${VER}-${ARCH} /usr/local/bin/jailer` — and change the `test -x /usr/local/bin/firecracker && exit 0` short-circuit to also require `-x /usr/local/bin/jailer` so re-running the step backfills jailer on hosts that already have firecracker. Add `jailer` to the `verify host tools` REQUIRED list (Rule 46).
- [ ] **Step 2:** Add `mkdir -p /var/lib/krova/jail` to the Krova directory-layout step. Leave `/dev/kvm` as-is (already `660 root:kvm`); add an assertion to `verify host tools` that it is `660 root:kvm` rather than mutating it.
- [ ] **Step 3:** Create `scripts/install-jailer.ts` (`pnpm install:jailer`, mirrors `pnpm install:restic`): downloads the pinned FC tarball, installs ONLY the jailer binary + `mkdir -p /var/lib/krova/jail`, fleet-wide over active servers, idempotent (`test -x /usr/local/bin/jailer && skip`), audit-logged. **This must run on every active server before Phase 6 migration and before Phase 0's manual launch on the canary.**
- [ ] **Step 4:** typecheck + lint + commit. Give the new worker job (if any) an explicit `QUEUE_OPTIONS` entry (Rule 56).

### Task 4.2: Host side-channel posture doc + optional SMT toggle

**Files:** Create: `docs/security/host-hardening.md`

- [ ] **Step 1:** Document the Firecracker production-host checklist (verified against the v1.15 `prod-host-setup.md`): SMT decision (D11 — default ON, documented residual timing-side-channel risk for co-tenant cubes), KPTI/spectre mitigations (host kernel defaults), `/dev/kvm` ownership, swap/THP guidance. Add an **opt-in** `nosmt` note for operators who want max isolation per server.
- [ ] **Step 2:** Update README/CLAUDE.md security section to reference jailer mode (Rule 22). Commit.

---

## Phase 5 — virtio-rng entropy device (independent, separately shippable)

### Task 5.1: Kernel `CONFIG_HW_RANDOM_VIRTIO`

**Files:** Modify: `setup/images/build-all-images.sh` (kernel options block)

- [ ] **Step 1:** Add `CONFIG_HW_RANDOM_VIRTIO=y` to the layered options + the REQUIRED-config verification list at end of `build_kernel`. Run `bash -n setup/images/build-all-images.sh` (Rule 39).
- [ ] **Step 2:** Note in the plan/PR: requires `pnpm build:images` + "Update Images" per server; only NEW cold boots pick it up.

### Task 5.2: Add the Firecracker `/entropy` device

**Files:** Modify: `lib/ssh/firecracker.ts` (the API config sequence, both launch sites)

- [ ] **Step 1:** After `/machine-config`, `PUT /entropy {}` (no rate limiter in v1) — guarded so it's skipped if the booted kernel lacks the driver (older rootfs), mirroring the virtio-mem guard at [firecracker.ts:742](../../../lib/ssh/firecracker.ts#L742). Verify FC reads host entropy via `getrandom()` (no `/dev/urandom` node needed in the chroot — confirm in canary smoke; if it does need it, mknod it in `launchJailed`).
- [ ] **Step 2:** typecheck + lint + canary smoke (`cat /proc/sys/kernel/random/entropy_avail` healthy in guest at boot) + commit.

---

## Phase 6 — Fleet migration

### Task 6.1: Lazy migration (already done by Phase 2)

- [ ] **Step 1:** Confirm every relaunch handler (`cube-wake`, `cube-cold-restart`, `cube-auto-relaunch`, `server-reboot-recovery`, `cube-error-recovery`, `cube-transfer`, `snapshot-restore`, `backup-redeploy`, `cube-from-snapshot`, `cube-import-rootfs`, `cube-resize`) lands a previously-bare cube in jailed mode (they all call `startCube`, which now converts when `JAILER_ENABLED`). No per-handler code change — verify by reading each call site that the cube row's `launchMode` is read fresh and persisted after relaunch.

### Task 6.2: Proactive migration command

**Files:** Create: `scripts/migrate-cubes-to-jailer.ts`; register `pnpm cubes:migrate-to-jailer`.

- [ ] **Step 1:** Implement: select `cubes WHERE launch_mode='bare' AND status IN ('running','sleeping') AND transfer_state='idle'`. For `running` cubes, enqueue the existing **cold-restart** job (reuses the tested path: prorated billing, lifecycle log, server reconcile) — per-server concurrency cap 5 (mirror `install:agent-fleet`). For `sleeping` cubes, do nothing (they convert on next wake). Dry-run by default; `--apply` commits; `--server <id>` scopes to one host. Audit-logged + a customer-visible lifecycle log `"Cube restarted to apply security hardening (jailer isolation)"`.
- [ ] **Step 2:** typecheck + lint + commit. **Do not run against the fleet** until Phase 7 canary passes.

---

## Phase 7 — Verification & staged rollout

### Task 7.1: Canary smoke protocol (the real test)

- [ ] **Step 1: One throwaway cube on one canary server**, `JAILER_ENABLED=true`. Provision → assert it's `launch_mode='jailed'`, the FC process runs as the per-cube uid (`ps -o user= -p <pid>` = uid 100000+, not root), `/dev/kvm`+`/dev/net/tun` exist inside the chroot owned by that uid, SSH into the guest works, custom TCP mapping works, **browser terminal** works (vsock path resolved), live metrics/reachability green.
- [ ] **Step 2: Lifecycle matrix on the canary cube:** sleep→wake, cold-restart, snapshot→restore, backup→redeploy, resize (RAM live + CPU cold), transfer to a second server. Each must end `running` + jailed + reachable. Confirm no orphaned chroot/bind-mount after delete (`mount | grep krova/jail` empty; `cube:inspect` clean; mount-reaper unaffected).
- [ ] **Step 3: Bare→jailed conversion:** create a cube with `JAILER_ENABLED=false` (bare), confirm it runs bare, flip the flag, cold-restart it, confirm it converts to jailed with no data loss.
- [ ] **Step 4: Rollback drill:** set `JAILER_ENABLED=false`, confirm new cubes go bare again and existing jailed cubes still sleep/wake/delete correctly.

### Task 7.2: Staged fleet rollout

- [ ] **Step 1:** Deploy with `JAILER_ENABLED=true` → all NEW cubes jailed, fleet untouched. Watch for 48h.
- [ ] **Step 2:** Run `pnpm cubes:migrate-to-jailer --server <one-canary-host> --apply` in a low-traffic window; verify those cubes.
- [ ] **Step 3:** Roll the rest server-by-server with customer notice. Lazy drift covers anything not proactively migrated.

---

## Self-Review notes

- **Spec coverage:** jailer (D1–D9) → Phases 1–4,6; virtio-rng (D10) → Phase 5; SMT/host (D11) → Phase 4.2; **live-fleet question** → dedicated section + Phase 6/7. All covered.
- **Rule check:** Rule 6 (db:generate only) ✓ Task 1.1; Rule 14 (reuse ports.ts pattern, single jailer module) ✓; Rule 17 (uid alloc like ports) ✓; Rule 40 (additive nullable/defaulted columns) ✓; Rule 46 (jailer in verify list) ✓ Task 4.1; Rule 39 (`bash -n`) ✓ Task 5.1; Rule 56/recurring N/A (no new queues except the retrofit job — give it an explicit `QUEUE_OPTIONS` entry).
- **Open item to confirm in Phase 0:** exact `firecracker.pid` location written by `--new-pid-ns`, and whether FC's entropy device needs `/dev/urandom` in the chroot. Both gated before fleet rollout.
- **Out of scope (noted):** per-cube network namespace (`--netns`), cgroup resource *caps* (placement only in v1), custom seccomp filter.
