# Cube IPv6 — Phase 6: Re-IP migration script + wake guard + transfer rollback

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. **Read the spec's "Migration / re-IP procedure §", "Port mappings §", "Transfer path IPv6 §", and "Jailer §" alongside this plan.**

**Goal:** Ship the per-server re-IP tooling + safety guards: a `cubes:migrate-network` operator script (per-host cutover, paused-skip, `status='active'` mapping rebuild, `networkctl reconfigure`, Caddy await + `If-Match`), the `cube-wake` stale-config guard (N-C1), the `cube-transfer` rollback-v6 fix (N-M2), and observer-cron safety during cutover.

**Architecture:** A shared `reIpStoppedCube` / per-cube conversion routine drives both the migration script and the `cube-wake` guard. The script is **dry-run by default, one `--server` per maintenance window, idempotent + resumable** (commit-last; derive from `bridge_subnet`+octet). Running it is an **operator action** (live hosts, maintenance window) — this phase ships the verified code + a runbook; it is NOT executed autonomously.

**Tech Stack:** ssh2, `getCubeStatus`/`startCube`/`wakeCube`, `addTcpPortForward`/`removeTcpPortForward`, `reconcileCaddyRoutes`, `applyHostNetworking`, `cubePaths` (JAILER_ENABLED=true → jailed paths), Drizzle, tsx CLI (mirrors `scripts/install-agent-fleet.ts`).

**Spec:** Migration procedure §, Port mappings § (M1/M2/H9), Transfer path IPv6 § (N-M1/N-M2), N-C1, M3/M4/M6, observer-cron note. **Depends on:** Phases 1-4 (helpers, schema, `applyHostNetworking`, guest writer).

> **Concurrent-edit note:** `cube-transfer.ts`, `cube-wake.ts`, `cube-resize.ts` changed under concurrent commits — read live before editing.

---

## File structure

- **Create** `lib/cubes/reip.ts` — shared, mostly-pure decision + a `reIpStoppedCube(client, cube, S)` host routine (loop-mount via `cubePaths(id, launchMode)` + `writeCubeGuestNetworkConfig` + rebuild `status='active'` mappings + commit-last). Used by the script AND the wake guard.
- **Create** `lib/cubes/reip.test.ts` — pure decision tests (`planCubeReIpAction(status, vmAlive)` → `'live'|'mount'|'skip-paused'`).
- **Modify** `lib/worker/handlers/cube-wake.ts` — N-C1 guard: stale paused cube → cold-convert, not resume.
- **Modify** `lib/worker/handlers/cube-transfer.ts` — capture/restore/set `internalIpv6` in rollback (N-M2).
- **Create** `scripts/migrate-cube-network.ts` + `pnpm cubes:migrate-network` — the per-server cutover driver.
- **Modify** observer crons (`server-reconcile.ts` / `cube-error-recovery-scan.ts`) — skip mid-cutover cubes (guard).

---

## Task 1: Pure per-cube action decision + tests

**Files:** Create `lib/cubes/reip.ts` (decision only for now), `lib/cubes/reip.test.ts`.

- [ ] **Step 1: Failing test** — `lib/cubes/reip.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planCubeReIpAction } from "./reip";

test("running cube → live in-guest re-IP", () => {
  assert.equal(planCubeReIpAction("running", true), "live");
});
test("powered-off / killed (dead VM) → loop-mount rewrite", () => {
  assert.equal(planCubeReIpAction("sleeping", false), "mount");
  assert.equal(planCubeReIpAction("error", false), "mount");
});
test("paused (alive VM, frozen) → skip (do NOT commit, leave on old IP)", () => {
  assert.equal(planCubeReIpAction("sleeping", true), "skip-paused");
});
test("transient states are skipped", () => {
  assert.equal(planCubeReIpAction("booting", false), "skip-transient");
  assert.equal(planCubeReIpAction("pending", false), "skip-transient");
});
```

- [ ] **Step 2: Run → fail** (`pnpm test`, module missing).

- [ ] **Step 3: Implement** — `lib/cubes/reip.ts`:

```ts
/**
 * Decide how a cube is re-IP'd during the per-server cutover (spec Migration §).
 * `vmAlive` distinguishes a paused VM (alive, frozen, rootfs held → CANNOT mount
 * or guestExec → skip + leave on old IP, convert on cold restart, N-C1) from a
 * powered-off/killed VM (dead, rootfs free → loop-mount + rewrite).
 */
export type ReIpAction = "live" | "mount" | "skip-paused" | "skip-transient";

export function planCubeReIpAction(
  status: string,
  vmAlive: boolean
): ReIpAction {
  if (status === "running") return "live";
  if (status === "sleeping" || status === "error") {
    return vmAlive ? "skip-paused" : "mount";
  }
  // pending / booting / stopping / deleted / anything else: don't touch.
  return "skip-transient";
}
```

- [ ] **Step 4: Run → pass** (`pnpm test`). **Step 5: typecheck/lint + commit:**

```bash
pnpm typecheck && pnpm lint
git add lib/cubes/reip.ts lib/cubes/reip.test.ts
git commit -m "feat(reip): pure per-cube re-IP action decision + tests"
```

> The host-side `reIpStoppedCube(client, cube, S)` routine (loop-mount via `cubePaths(cube.id, cube.launchMode)` → `writeCubeGuestNetworkConfig(client, mountDir, newIp)` → rebuild `status='active'` mappings via `removeTcpPortForward(oldIp)`+`addTcpPortForward(newIp, …, cidrsFromDb)` → commit `internal_ip`/`internal_ipv6` LAST → `umount`) is added to `lib/cubes/reip.ts` in Task 4 (it shares the script's helpers). Mirror the loop-mount from `cube-import-rootfs.ts`.

---

## Task 2: `cube-wake` stale-paused-cube guard (N-C1)

**Files:** Modify `lib/worker/handlers/cube-wake.ts`.

**Context:** A paused cube SKIPPED by the migration keeps its OLD `internal_ip`; the host keeps legacy `br0` until no cube holds an old IP, so resume-in-place still works. The guard is the belt-and-suspenders: if a cube is being resumed but its stored `internal_ip` no longer matches its host's `bridge_subnet` (stale), cold-convert it onto the new scheme instead of resuming with stale guest config.

- [ ] **Step 1:** Before the `if (vmState === "paused") { wakeCube(...) }` branch, add:

```ts
import { subnetOf } from "@/lib/server/cube-network";
import { reIpStoppedCube } from "@/lib/cubes/reip";

// N-C1: a paused cube the migration skipped is still on its OLD IP. If its host
// has since been re-IP'd (bridge_subnet no longer matches the cube's IP subnet),
// a resume-in-place would boot stale guest networking → cold-convert instead.
const [srv] = await db
  .select({ bridgeSubnet: schema.servers.bridgeSubnet })
  .from(schema.servers)
  .where(eq(schema.servers.id, cube.serverId))
  .limit(1);
const staleSubnet =
  cube.internalIp != null &&
  srv?.bridgeSubnet != null &&
  subnetOf(cube.internalIp) !== srv.bridgeSubnet;

if (vmState === "paused" && !staleSubnet) {
  await wakeCube(client, cubeId, cube.launchMode); // normal resume
} else {
  // Cold path: if stale, reIpStoppedCube re-derives the new IP + rewrites guest
  // config first; then startCube. (When not stale, this is the existing cold path.)
  if (staleSubnet && srv?.bridgeSubnet != null) {
    await reIpStoppedCube(client, cube, srv.bridgeSubnet);
  }
  // existing startCube(...) call, using the (possibly updated) cube.internalIp
}
```

(Adapt to the live control flow — the file has a paused branch + a fallback-restart branch; the guard converts the `staleSubnet` case to the cold path and runs `reIpStoppedCube` first. Re-read `cube.internalIp` after `reIpStoppedCube` commits the new IP.)

- [ ] **Step 2: typecheck/lint/build + commit:**

```bash
pnpm typecheck && pnpm lint && pnpm build
git add lib/worker/handlers/cube-wake.ts
git commit -m "fix(cube-wake): cold-convert a stale paused cube on wake instead of resuming on old IP (N-C1)"
```

---

## Task 3: `cube-transfer` rollback-v6 (N-M2)

**Files:** Modify `lib/worker/handlers/cube-transfer.ts`.

- [ ] **Step 1:** (read live; line refs from HEAD re-check) — capture `oldInternalIpv6` next to `oldInternalIp` (≈:108): `const oldInternalIpv6 = cube.internalIpv6;`. In the failure rollback (≈:1284) that restores `internalIp: oldInternalIp`, also set `internalIpv6: oldInternalIpv6`. In the success flip (≈:936) that sets the new `internalIp`, also set the new `internalIpv6` (already computed alongside the new IP in the Phase-2 transfer allocation). This prevents a failed transfer leaving v6 split-brained on the dead destination.

- [ ] **Step 2: typecheck/lint/build + commit:**

```bash
pnpm typecheck && pnpm lint && pnpm build
git add lib/worker/handlers/cube-transfer.ts
git commit -m "fix(cube-transfer): restore/set internal_ipv6 in rollback + success flip (N-M2)"
```

---

## Task 4: `reIpStoppedCube` host routine + the migration script

**Files:** Modify `lib/cubes/reip.ts` (add `reIpStoppedCube`); Create `scripts/migrate-cube-network.ts`; Modify `package.json`.

- [ ] **Step 1: Add `reIpStoppedCube(client, cube, S)` to `lib/cubes/reip.ts`** — the shared host conversion (used by the script's `mount` action AND the wake guard). Pseudocode-precise:

```ts
import type { Client } from "ssh2";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { execCommand } from "@/lib/ssh/exec";
import { cubePaths } from "@/lib/ssh/jailer";
import { writeCubeGuestNetworkConfig } from "@/lib/ssh/cube-guest-network";
import { addTcpPortForward, removeTcpPortForward, allocateInternalOctet } from "@/lib/ssh/network";
import { cubeIpv4Address, cubeIpv6Address, octetOf } from "@/lib/server/cube-network";

/** Re-IP a STOPPED cube (VM dead, rootfs free) onto subnet S: rewrite guest net,
 *  rebuild active port-mappings, commit both addresses LAST. Octet preserved. */
export async function reIpStoppedCube(
  client: Client,
  cube: { id: string; internalIp: string; launchMode: "bare" | "jailed" },
  S: number
): Promise<{ newIp: string; newIpv6: string }> {
  const oldIp = cube.internalIp;
  const octet = octetOf(oldIp); // preserved across the re-IP
  const newIp = cubeIpv4Address(S, octet);
  const newIpv6 = cubeIpv6Address(S, octet);

  // 1. Loop-mount the canonical rootfs (hardlinked into the chroot for jailed) + rewrite guest net.
  //    NOTE: cubePaths() has NO rootfs/dir field — the rootfs stays at the
  //    canonical /var/lib/krova/cubes/<id>/rootfs.ext4 (hardlinked into the chroot),
  //    so a host loop-mount works for BOTH bare and jailed cubes. (Same as snapshot-restore.ts.)
  const cubeDir = `/var/lib/krova/cubes/${cube.id}`;
  const rootfs = `${cubeDir}/rootfs.ext4`;
  const mountDir = `/tmp/krova-mount-${cube.id}`;
  await execCommand(client, `mkdir -p ${mountDir} && mount -o loop ${rootfs} ${mountDir}`);
  try {
    await writeCubeGuestNetworkConfig(client, mountDir, newIp);
  } finally {
    await execCommand(client, `umount ${mountDir} 2>/dev/null; rmdir ${mountDir} 2>/dev/null || true`);
  }

  // 2. Rebuild ONLY status='active' port-mappings (M1) — re-point DNAT to newIp, preserve whitelist CIDRs.
  const mappings = await db.query.tcpPortMappings.findMany({
    where: and(eq(schema.tcpPortMappings.cubeId, cube.id), eq(schema.tcpPortMappings.status, "active")),
  });
  for (const m of mappings) {
    const wl = await db.query.tcpMappingWhitelistedIps.findMany({
      where: eq(schema.tcpMappingWhitelistedIps.mappingId, m.id),
    });
    const cidrs = wl.map((w) => w.cidr);
    await removeTcpPortForward(client, m.hostPort, oldIp, m.cubePort);
    await addTcpPortForward(client, m.hostPort, newIp, m.cubePort, cidrs);
  }

  // 3. ip.txt (operator display) + commit BOTH addresses LAST (resumable).
  await execCommand(client, `echo '${newIp}' > ${cubeDir}/ip.txt 2>/dev/null || true`);
  await db.update(schema.cubes)
    .set({ internalIp: newIp, internalIpv6: newIpv6, updatedAt: new Date() })
    .where(eq(schema.cubes.id, cube.id));
  return { newIp, newIpv6 };
}
```

(`cubePaths` has NO `rootfs`/`dir` field — use the canonical `/var/lib/krova/cubes/<id>` literal, matching `snapshot-restore.ts`; drop the now-unused `cubePaths` import from `reIpStoppedCube`. Confirm `tcpPortMappings`/`tcpMappingWhitelistedIps` schema names; mirror `removeTcpPortForward`/`addTcpPortForward` arg order from `lib/ssh/network.ts`.)

- [ ] **Step 2: Create `scripts/migrate-cube-network.ts`** — modeled on `scripts/install-agent-fleet.ts` (server loop, per-server SSH, audit logging). Behaviour:
  - Args: `--apply` (else dry-run), `--server <id>` (required for `--apply`; refuse fleet-wide `--apply` without `--all`).
  - Per target server, inside the maintenance window:
    1. Read/allocate `bridge_subnet = S` (use `allocateBridgeSubnet` only if null; legacy host stays 0).
    2. `applyHostNetworking(client, S, { retrofit: true })` (dual-stack bridge + NAT + firewall, with the cancel-on-success rollback net).
    3. Load that server's cubes `WHERE status <> 'deleted'`. For each, probe `getCubeStatus(client, id, launchMode)` → `planCubeReIpAction(status, vmAlive)`:
       - `live`: `guestExec` write dual-stack `.network` + resolv.conf, then `networkctl reload && networkctl reconfigure eth0` (M6 — verify old addr gone), rebuild active mappings (as in `reIpStoppedCube` steps 2-3 but in-guest for the config), commit both addresses LAST.
       - `mount`: `await reIpStoppedCube(client, cube, S)`.
       - `skip-paused`: log + leave untouched (do NOT commit; do NOT drop its legacy IP).
       - `skip-transient`: refuse/skip with a warning (H9 — an in-flight port-mapping job; quiesce the window).
    4. `server.refresh-caddy` — **enqueue AND await to a terminal state; FAIL the per-server run loudly on non-success** (M3; the queue is `retryLimit:0`).
    5. Verify each migrated cube reachable on its new IP (L2 probe).
    6. Drop legacy `br0` v4 + `10.0.0.0/24` MASQUERADE **only if zero non-deleted cubes on the host still carry a `10.0.0.x` `internal_ip`** (M9 — i.e. no skipped paused cube remains on old IP). Persist.
  - Dry-run prints, per server: target S, the per-cube planned action, and which cubes block the legacy-br0 drop.

  (Full server-loop scaffold mirrors `install-agent-fleet.ts`: `db.select(active servers)`, `connectToServer`, `PER_SERVER_CONCURRENCY` for the per-cube fan-out, audit rows. The `If-Match` hardening for `reconcileCaddyRoutes` is M4 — implement in `lib/ssh/caddy.ts` as part of this task: add an `If-Match: <etag>` to its PATCH, retry-on-412 by re-reading routes.)

- [ ] **Step 3: `package.json`** — `"cubes:migrate-network": "tsx scripts/migrate-cube-network.ts",`

- [ ] **Step 4: typecheck/lint/build:**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Dry-run sanity (read-only, safe to run anywhere with DB access):**

Run: `pnpm cubes:migrate-network` (no `--apply`)
Expected: prints each active server's target S + per-cube planned actions; makes NO changes. (If DB is unreachable in this environment, this step is operator-run.)

- [ ] **Step 6: Commit:**

```bash
git add lib/cubes/reip.ts scripts/migrate-cube-network.ts package.json lib/ssh/caddy.ts
git commit -m "feat(reip): cubes:migrate-network per-server cutover + reIpStoppedCube + Caddy If-Match (M1/M3/M4/M6/N-C1)"
```

---

## Task 5: Observer-cron safety during cutover

**Files:** Modify `lib/worker/handlers/server-reconcile.ts`, `lib/worker/handlers/cube-error-recovery-scan.ts`.

- [ ] **Step 1:** Confirm (read live) that `cube.reachability` / `cube.state-sync` are observer-only for `running→running` (they are — spec). For `server.reconcile` (orphan/ghost emails) and `cube.error-recovery-scan` (which calls `startCube`), ensure a cube mid-cutover isn't misflagged: the cleanest guard is to set a short-lived marker during the per-cube migration window and have these crons skip cubes carrying it — OR document that the operator pauses these two crons for the migrating host's window. **Decision:** document the cron-pause in the runbook (simplest, no new schema) AND add a defensive check in `cube-error-recovery-scan.ts` to skip cubes whose `internal_ip` subnet != their server's `bridge_subnet` (a cube mid-conversion), so error-recovery never races the migration's `startCube`.

- [ ] **Step 2: typecheck/lint + commit:**

```bash
pnpm typecheck && pnpm lint
git add lib/worker/handlers/cube-error-recovery-scan.ts
git commit -m "fix(error-recovery): skip cubes mid-re-IP (subnet != host bridge_subnet) to avoid racing the migration"
```

---

## Phase 6 verification gate

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` → PASS.
- [ ] `pnpm test` → PASS incl. `planCubeReIpAction` tests.
- [ ] `pnpm cubes:migrate-network` (dry-run) → prints per-server plan, no changes (operator-run if no DB here).
- [ ] Code review: paused cubes are `skip-paused` (never committed); legacy br0 drop gated on zero-old-IP-cubes; `server.refresh-caddy` awaited + failure is loud; `networkctl reconfigure` used; transfer rollback sets v6.

**LIVE ROLLOUT IS OPERATOR-GATED (hard-decision boundary):** running `pnpm cubes:migrate-network --server <id> --apply` per host in a maintenance window, the DB migration + `CONCURRENTLY` index build + dedup remediation (Phase 2), and the firewall flips (Phase 3) all run against production with an operator present. This phase ships the verified code + the runbook (Deploy ordering § in the spec); it is NOT executed autonomously.

## Self-review (against spec)

- Per-cube action decision incl. paused-skip (N-C1) → Tasks 1, 4. ✓
- `cube-wake` stale-paused cold-convert (N-C1) → Task 2. ✓
- Transfer rollback v6 (N-M2) → Task 3. ✓
- `status='active'` mapping rebuild (M1), CIDRs from DB (M2), `networkctl reconfigure` (M6), Caddy await + If-Match (M3/M4), legacy-br0-drop predicate (M9), ip.txt (L5), jailer-aware `cubePaths` (JAILER_ENABLED=true) → Task 4. ✓
- H9 in-flight job → `skip-transient` + window quiesce → Task 4. ✓
- Observer-cron safety (reip-deep) → Task 5. ✓
- No placeholders for safety-critical decision code; routine SSH sequences + server-loop scaffold reference the committed spec + `install-agent-fleet.ts`; cross-file names flagged "confirm against live".
