# CPU `cpu.weight` Fairness (L1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each cube a host-side cgroup-v2 `cpu.weight` proportional to its vCPUs so that, under CPU contention on an oversold host, no single cube can starve its neighbours — while fully preserving overselling (work-conserving weight, no hard cap).

**Architecture:** A dedicated `/sys/fs/cgroup/krova` parent cgroup (NOT the jailer's default `firecracker`) with the `cpu` controller delegated, prepared by the `install` setup phase + a retrofit script. Every jailed launch passes `--parent-cgroup krova --cgroup cpu.weight=<w>` (via `buildJailerArgs`) so the jailer places each cube in its own leaf with the weight applied. **Everything is gated by `CPU_CGROUP_ENABLED` (default `false`)** — with the flag off, no `--cgroup` arg is emitted, the `krova` parent is never created, and every launch is byte-identical to today (verified: the jailer no-ops a missing parent). A per-launch preflight makes it fail-safe: if the parent cgroup isn't ready, the cube launches WITHOUT the weight (boots fine, just no fairness) rather than failing.

**Tech Stack:** TypeScript (strict) · Firecracker jailer v1.15.1 (`--cgroup`/`--parent-cgroup`) · cgroup v2 (`cpu.weight`, `cgroup.subtree_control`) · `node:test` unit tests · `pnpm test:all` gate · live canary on the dev host `107.172.218.189` (Rule 60: agent may touch ONLY this host).

**Non-negotiables (from the owner):** zero breaking changes to production; cube must boot; network must work; live-validated on the dev host. The flag-gate + dedicated-parent decoupling + fail-safe preflight are how this is guaranteed.

---

## File Structure

- **Create** `lib/cubes/cpu-weight.ts` — pure `cubeCpuWeight(vcpus)` → `clamp(vcpus * 100, 1, 10000)`. One responsibility: the weight formula. Unit-tested.
- **Create** `lib/cubes/cpu-weight.test.ts` — unit tests for the formula + clamping.
- **Create** `lib/ssh/cpu-cgroup.ts` — pure `cpuCgroupPrepScript()` (host bash that creates `/sys/fs/cgroup/krova` + delegates `+cpu`, idempotent + fail-safe) and `cpuCgroupReadyCommand()` (a read-only probe used by the launch preflight). Unit-tested via `bash -n` + content.
- **Create** `lib/ssh/cpu-cgroup.test.ts` — shell-validity + content tests.
- **Modify** `config/platform.ts` — add `CPU_CGROUP_ENABLED = false` + `CPU_CGROUP_PARENT = "krova"`.
- **Modify** `lib/ssh/jailer.ts` — extend `buildJailerArgs` to accept optional `cgroup?: { cpuWeight: number }` and emit `--parent-cgroup <CPU_CGROUP_PARENT> --cgroup cpu.weight=<w>` when present. (Pure; unit-tested in the existing `jailer.test.ts`.)
- **Modify** `lib/ssh/jailer.test.ts` — assert flag-off emits NO `--cgroup` (unchanged argv) and flag-on emits the weight.
- **Modify** `lib/ssh/firecracker.ts` — `launchJailed`: preflight the cgroup readiness (when `CPU_CGROUP_ENABLED`), thread the weight into `buildJailerArgs`; `teardownJail`: `rmdir` the cube's cgroup leaf (fail-safe).
- **Modify** `lib/worker/handlers/server-install.ts` — add a `cpu cgroup prep` install STEP (gated) + export `cpuCgroupInstallScript` for the retrofit.
- **Modify** `lib/worker/handlers/server-verify.ts` — non-critical verify CHECK that the `krova` cgroup exists + delegates `cpu` (only meaningful when the flag is on).
- **Create** `scripts/install-cpu-cgroup.ts` + **modify** `package.json` — `pnpm install:cpu-cgroup` fleet retrofit (mirrors `install:cpu-governor`).

---

## Task 0: Canary-discovery — determine the jailer v2 cgroup leaf path (BLOCKING, dev host only)

No code yet. We must observe where the real jailer v1.15.1 places the leaf + which ancestor needs `+cpu` before writing the host-prep. Agent-run on `107.172.218.189` only (Rule 60).

- [ ] **Step 1: Prep a candidate parent + delegate cpu on the dev host**

```bash
ssh -p 2822 -i ~/.ssh/krova_devtest root@107.172.218.189 'bash -s' <<"EOF"
set -u
mkdir -p /sys/fs/cgroup/krova
grep -qw cpu /sys/fs/cgroup/cgroup.subtree_control || echo +cpu > /sys/fs/cgroup/cgroup.subtree_control
echo +cpu > /sys/fs/cgroup/krova/cgroup.subtree_control 2>/dev/null || true
echo "root subtree_control: $(cat /sys/fs/cgroup/cgroup.subtree_control)"
echo "krova subtree_control: $(cat /sys/fs/cgroup/krova/cgroup.subtree_control)"
EOF
```

- [ ] **Step 2: Launch ONE jailed firecracker with `--parent-cgroup krova --cgroup cpu.weight=200`, then inspect the tree**

```bash
# (full script: a throwaway jailed boot like scripts/host-smoke, but adding
#  --parent-cgroup krova --cgroup cpu.weight=200 to the jailer argv, then:)
find /sys/fs/cgroup/krova -maxdepth 3 -name cpu.weight -printf '%p = ' -exec cat {} \;
find /sys/fs/cgroup/krova -maxdepth 3 -type d
```

Expected: reveals the actual leaf path (e.g. `/sys/fs/cgroup/krova/<id>/cpu.weight` vs `/sys/fs/cgroup/krova/firecracker/<id>/cpu.weight`) and confirms `cpu.weight = 200` landed. **Record the path shape + the exact `subtree_control` chain that made it writable.** This determines the `cpuCgroupPrepScript()` in Task 3.

- [x] **Step 3: Tear the canary cube down + record findings inline in this plan**

**CONFIRMED (2026-06-03, dev host, jailer v1.15.1):**
- Leaf path: **`/sys/fs/cgroup/krova/<id>`** (one level; firecracker confirmed at `0::/krova/<id>`).
- Delegation: root already delegates `cpuset cpu io memory pids` (systemd) → **only `echo +cpu > /sys/fs/cgroup/krova/cgroup.subtree_control` is needed**; no root write, no systemd conflict.
- `cpu.weight=200` applied at `krova/<id>/cpu.weight` ✅. `rmdir` cleanup clean (no leak).
- **REFINEMENT:** cgroupfs is recreated empty on every boot → Task 3's prep must be a **systemd oneshot** (`krova-cgroup-prep.service`, mirrors `krova-cpu-perf`) so `krova` + the `+cpu` delegation are re-established on each boot. The flat-leaf assumption in Task 3 is confirmed correct.

---

## Task 1: `cubeCpuWeight` pure helper

**Files:** Create `lib/cubes/cpu-weight.ts`, Test `lib/cubes/cpu-weight.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { cubeCpuWeight } from "@/lib/cubes/cpu-weight";

test("cubeCpuWeight is vcpus*100, clamped to [1, 10000]", () => {
  assert.equal(cubeCpuWeight(1), 100);
  assert.equal(cubeCpuWeight(2), 200);
  assert.equal(cubeCpuWeight(16), 1600);
  assert.equal(cubeCpuWeight(0), 1); // floor (defensive; vcpus is >=1 in practice)
  assert.equal(cubeCpuWeight(1000), 10000); // ceiling
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm test 2>&1 | grep cpuCpuWeight` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/**
 * Host cgroup-v2 `cpu.weight` for a cube, proportional to its vCPUs so CPU time
 * under contention is shared in proportion to what each cube paid for (audit C2,
 * L1). cgroup-v2 `cpu.weight` range is [1, 10000], default 100 (= 1 vCPU here).
 * Work-conserving: idle cubes' cycles are still redistributed, so overselling is
 * preserved — this only arbitrates the share UNDER contention. No hard cap.
 */
export function cubeCpuWeight(vcpus: number): number {
  return Math.min(10000, Math.max(1, Math.round(vcpus * 100)));
}
```

- [ ] **Step 4: Run it, verify it passes** — `pnpm test 2>&1 | grep cubeCpuWeight` → PASS.

- [ ] **Step 5: Commit** — `git add lib/cubes/cpu-weight.ts lib/cubes/cpu-weight.test.ts && git commit -m "feat(cpu): add cubeCpuWeight helper (L1 fairness)"`

---

## Task 2: Flag + extend `buildJailerArgs` with optional cgroup

**Files:** Modify `config/platform.ts`, `lib/ssh/jailer.ts`, `lib/ssh/jailer.test.ts`

- [ ] **Step 1: Add the flag + parent const to `config/platform.ts`**

```ts
/**
 * Per-cube host cgroup-v2 `cpu.weight` fairness (audit C2 / L1). Default false:
 * with the flag off, buildJailerArgs emits NO `--cgroup`, the `krova` parent is
 * never created, and every jailed launch is byte-identical to today. Flip true
 * ONLY after `pnpm install:cpu-cgroup` (or the install phase) has prepared the
 * `krova` parent cgroup on the host AND a canary cube confirms cpu.weight applies
 * + the cube boots + networks (the brick-the-host invariant — see jailer.ts).
 */
export const CPU_CGROUP_ENABLED = false;
/** Dedicated parent cgroup for cube confinement — deliberately NOT the jailer's
 *  default `firecracker`, so the new path is fully decoupled from the legacy
 *  no-cgroup launch (a flag-off cube never touches this tree). */
export const CPU_CGROUP_PARENT = "krova";
```

- [ ] **Step 2: Write the failing jailer test** (append to `lib/ssh/jailer.test.ts`)

```ts
test("buildJailerArgs with cgroup emits --parent-cgroup + cpu.weight (in a leaf)", () => {
  const args = buildJailerArgs({ cubeId: "abc", uid: 100001, gid: 100001, cgroup: { cpuWeight: 200 } });
  const i = args.indexOf("--parent-cgroup");
  assert.ok(i >= 0 && args[i + 1] === "krova", "expected --parent-cgroup krova");
  assert.ok(args.includes("--cgroup") && args.includes("cpu.weight=200"), "expected --cgroup cpu.weight=200");
  // still v2 + new-pid-ns + appears BEFORE the `--` exec separator
  assert.ok(args.indexOf("--cgroup") < args.indexOf("--"), "cgroup args must precede --");
  assert.deepEqual(args.slice(args.indexOf("--cgroup-version"), args.indexOf("--cgroup-version") + 2), ["--cgroup-version", "2"]);
});

test("buildJailerArgs WITHOUT cgroup is unchanged (no --cgroup/--parent-cgroup)", () => {
  const args = buildJailerArgs({ cubeId: "abc", uid: 100001, gid: 100001 });
  assert.ok(!args.includes("--cgroup"), "flag-off must emit no --cgroup");
  assert.ok(!args.includes("--parent-cgroup"), "flag-off must emit no --parent-cgroup");
});
```

- [ ] **Step 3: Run it, verify it fails** — `pnpm test 2>&1 | grep "with cgroup"` → FAIL (cgroup opt unsupported).

- [ ] **Step 4: Implement in `lib/ssh/jailer.ts`** (extend the `opts` type + argv)

```ts
import { JAILER_CHROOT_BASE, CPU_CGROUP_PARENT } from "@/config/platform";
// ...
export function buildJailerArgs(opts: {
  cubeId: string;
  uid: number;
  gid: number;
  /** L1: when present, place the cube in a `<CPU_CGROUP_PARENT>` leaf with this
   *  cpu.weight. Omitted (flag off) → legacy behavior, NO cgroup args. */
  cgroup?: { cpuWeight: number };
}): string[] {
  const cgroupArgs = opts.cgroup
    ? ["--parent-cgroup", CPU_CGROUP_PARENT, "--cgroup", `cpu.weight=${opts.cgroup.cpuWeight}`]
    : [];
  return [
    "--id", opts.cubeId,
    "--exec-file", FIRECRACKER_BIN,
    "--uid", String(opts.uid),
    "--gid", String(opts.gid),
    "--chroot-base-dir", JAILER_CHROOT_BASE,
    "--cgroup-version", "2",
    ...cgroupArgs,
    "--new-pid-ns",
    "--",
    "--api-sock", JAILED_INNER.apiSock,
    "--log-path", JAILED_INNER.fcLog,
    "--level", "Info",
  ];
}
```

- [ ] **Step 5: Run it, verify it passes** — `pnpm test 2>&1 | grep -E "with cgroup|WITHOUT cgroup"` → both PASS.

- [ ] **Step 6: Commit** — `git add config/platform.ts lib/ssh/jailer.ts lib/ssh/jailer.test.ts && git commit -m "feat(cpu): buildJailerArgs optional cpu.weight cgroup (L1, flag-gated)"`

---

## Task 3: Host cgroup-prep script (finalize per Task 0)

**Files:** Create `lib/ssh/cpu-cgroup.ts`, `lib/ssh/cpu-cgroup.test.ts`

> Fill the `subtree_control` chain from Task 0's observed leaf path. The version below assumes the leaf is one level under `krova` (`krova/<id>`); if Task 0 showed nesting (`krova/firecracker/<id>`), add `echo +cpu > /sys/fs/cgroup/krova/firecracker/cgroup.subtree_control` to the prep AND have the jailer create that dir — adjust here.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cpuCgroupPrepScript, cpuCgroupReadyCommand } from "@/lib/ssh/cpu-cgroup";

const dir = mkdtempSync(join(tmpdir(), "krova-cgroup-"));
function validShell(cmd: string, label: string) {
  const f = join(dir, `${label}.sh`); writeFileSync(f, cmd);
  execFileSync("bash", ["-n", f], { stdio: "pipe" });
}

test("cpuCgroupPrepScript: valid shell, creates krova + delegates cpu, idempotent", () => {
  const s = cpuCgroupPrepScript(); validShell(s, "prep");
  assert.match(s, /\/sys\/fs\/cgroup\/krova/);
  assert.match(s, /\+cpu/);
  assert.match(s, /subtree_control/);
});
test("cpuCgroupReadyCommand: read-only probe, valid shell", () => {
  const c = cpuCgroupReadyCommand(); validShell(c, "ready");
  assert.match(c, /\/sys\/fs\/cgroup\/krova/);
  assert.ok(!/mkdir|>\s*\/sys/.test(c), "ready probe must not write");
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm test 2>&1 | grep cpuCgroup` → FAIL.

- [ ] **Step 3: Implement `lib/ssh/cpu-cgroup.ts`** (finalize chain per Task 0)

```ts
import { CPU_CGROUP_PARENT } from "@/config/platform";
const ROOT = "/sys/fs/cgroup";
const PARENT = `${ROOT}/${CPU_CGROUP_PARENT}`;

/**
 * Host cgroup-v2 prep for per-cube cpu.weight (L1). Creates the dedicated
 * `krova` parent and delegates the `cpu` controller down to it so the jailer's
 * per-cube leaves can set cpu.weight. Idempotent + fail-safe. Does NOT touch the
 * jailer's default `firecracker` parent, so a flag-off launch is unaffected.
 * The `krova` parent holds NO processes directly (jailer puts FC in leaves), so
 * the cgroup-v2 no-internal-process rule is satisfied.
 */
export function cpuCgroupPrepScript(): string {
  return [
    "set -u",
    `mkdir -p ${PARENT}`,
    // delegate cpu root -> krova (idempotent; tolerate already-present)
    `grep -qw cpu ${ROOT}/cgroup.subtree_control || echo +cpu > ${ROOT}/cgroup.subtree_control 2>/dev/null || true`,
    `grep -qw cpu ${PARENT}/cgroup.subtree_control || echo +cpu > ${PARENT}/cgroup.subtree_control 2>/dev/null || true`,
    `echo "krova cpu delegated: $(cat ${PARENT}/cgroup.subtree_control 2>/dev/null)"`,
  ].join("\n");
}

/** Read-only: exits 0 iff the krova parent exists AND delegates cpu (used by the
 *  launch preflight to fall back to a no-weight launch when prep hasn't run). */
export function cpuCgroupReadyCommand(): string {
  return `test -d ${PARENT} && grep -qw cpu ${PARENT}/cgroup.subtree_control`;
}
```

- [ ] **Step 4: Run it, verify it passes** — `pnpm test 2>&1 | grep cpuCgroup` → PASS.

- [ ] **Step 5: Commit** — `git add lib/ssh/cpu-cgroup.ts lib/ssh/cpu-cgroup.test.ts && git commit -m "feat(cpu): host cgroup-v2 prep + ready-probe builders (L1)"`

---

## Task 4: Wire host-prep into the install phase + verify check (gated)

**Files:** Modify `lib/worker/handlers/server-install.ts`, `lib/worker/handlers/server-verify.ts`

- [ ] **Step 1: Export an install-script wrapper + add the gated STEP** (`server-install.ts`)

```ts
import { CPU_CGROUP_ENABLED } from "@/config/platform";
import { cpuCgroupPrepScript } from "@/lib/ssh/cpu-cgroup";
export function cpuCgroupInstallScript(): string {
  const b64 = Buffer.from(cpuCgroupPrepScript()).toString("base64");
  return `echo '${b64}' | base64 -d | bash`;
}
// In STEPS, AFTER "cpu performance governor" (gated so it's inert until enabled):
...(CPU_CGROUP_ENABLED ? [{
  name: "cpu cgroup prep (krova parent + cpu delegation)",
  cmd: cpuCgroupInstallScript(),
  timeoutMs: 10_000,
}] : []),
```

- [ ] **Step 2: Add a non-critical verify CHECK** (`server-verify.ts`)

```ts
...(CPU_CGROUP_ENABLED ? [{
  name: "krova cgroup delegates cpu",
  cmd: "grep -qw cpu /sys/fs/cgroup/krova/cgroup.subtree_control 2>/dev/null && echo ok || echo none",
  expect: (out: string) => out.trim() === "ok" || out.trim() === "none",
  critical: false,
}] : []),
```

- [ ] **Step 3: Verify green** — `pnpm typecheck && pnpm test 2>&1 | tail -3` → PASS (flag off → steps absent; no behavior change).

- [ ] **Step 4: Commit** — `git add lib/worker/handlers/server-install.ts lib/worker/handlers/server-verify.ts && git commit -m "feat(cpu): install-phase cgroup prep + verify check (L1, gated)"`

---

## Task 5: Retrofit script + pnpm command

**Files:** Create `scripts/install-cpu-cgroup.ts`, Modify `package.json`

- [ ] **Step 1: Create `scripts/install-cpu-cgroup.ts`** (mirror `scripts/install-cpu-governor.ts`)

```ts
/** Retrofit the krova cgroup-v2 parent (cpu delegation) onto every active
 *  server so per-cube cpu.weight works once CPU_CGROUP_ENABLED is flipped on.
 *  Idempotent + active-host-safe (creates an empty parent cgroup + delegates a
 *  controller; touches no running cube). Run: pnpm install:cpu-cgroup */
import { existsSync } from "fs";
if (existsSync(".env")) process.loadEnvFile();
async function main(): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers } = await import("@/db/schema");
  const { connectToServer, execCommand } = await import("@/lib/ssh");
  const { cpuCgroupInstallScript } = await import("@/lib/worker/handlers/server-install");
  const rows = await db.select({ id: servers.id, hostname: servers.hostname }).from(servers).where(eq(servers.status, "active"));
  console.log(`Preparing krova cgroup on ${rows.length} active server(s)...`);
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const r = await execCommand(client, cpuCgroupInstallScript(), 30_000);
        console.log(r.exitCode === 0 ? `  ok ${row.hostname}` : `  x ${row.hostname}: ${r.stderr.slice(-200)}`);
      } finally { client.end(); }
    } catch (err) { console.error(`  x ${row.hostname}: ${err instanceof Error ? err.message : err}`); }
  }
  process.exit(0);
}
main().catch((e) => { console.error("Retrofit failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add to `package.json`** after `install:network-tuning`: `"install:cpu-cgroup": "tsx scripts/install-cpu-cgroup.ts",`

- [ ] **Step 3: Verify green** — `pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 4: Commit** — `git add scripts/install-cpu-cgroup.ts package.json && git commit -m "feat(cpu): pnpm install:cpu-cgroup fleet retrofit (L1)"`

---

## Task 6: Wire `launchJailed` (gated + fail-safe preflight) + leaf cleanup

**Files:** Modify `lib/ssh/firecracker.ts`

- [ ] **Step 1: In `launchJailed`, compute the cgroup opt behind the flag + a readiness preflight**

```ts
import { CPU_CGROUP_ENABLED } from "@/config/platform";
import { cubeCpuWeight } from "@/lib/cubes/cpu-weight";
import { cpuCgroupReadyCommand } from "@/lib/ssh/cpu-cgroup";
// inside launchJailed, before buildJailerArgs:
let cgroup: { cpuWeight: number } | undefined;
if (CPU_CGROUP_ENABLED) {
  // FAIL-SAFE: only pass --cgroup if the krova parent is actually prepped on this
  // host. If not (prep didn't run), launch WITHOUT it — the cube boots, just with
  // no weight — rather than letting the jailer error on a missing parent.
  const ready = await execCommand(client, cpuCgroupReadyCommand(), 5_000).catch(() => ({ exitCode: 1 }));
  if (ready.exitCode === 0) cgroup = { cpuWeight: cubeCpuWeight(opts.vcpus) };
  else console.warn(`[firecracker] cube ${opts.cubeId}: krova cgroup not ready, launching without cpu.weight`);
}
const args = buildJailerArgs({ cubeId: opts.cubeId, uid: opts.uid, gid, cgroup }).join(" ");
```

(Confirm `opts.vcpus` is in scope in `launchJailed`; if not, thread it from `createCube`/`startCube` — both already carry `vcpus`.)

- [ ] **Step 2: In `teardownJail`, remove the cube's cgroup leaf (fail-safe)**

```ts
// after the chroot rm -rf, best-effort remove the cgroup leaf (path per Task 0):
await execCommand(client, `rmdir /sys/fs/cgroup/${CPU_CGROUP_PARENT}/${cubeId} 2>/dev/null || true`, 5_000).catch(() => {});
```

- [ ] **Step 3: Verify green** — `pnpm typecheck && pnpm test:all` → PASS (flag off → `cgroup` is always `undefined`, argv unchanged, no behavior change).

- [ ] **Step 4: Commit** — `git add lib/ssh/firecracker.ts && git commit -m "feat(cpu): launchJailed cpu.weight (gated, fail-safe preflight) + leaf cleanup (L1)"`

---

## Task 7: LIVE dev-host validation (the owner's requirement)

Agent-run on `107.172.218.189` only (Rule 60). Prove: cube boots, network works, weight applied, cleanup works — WITH the flag conceptually on (we temporarily prep + pass the cgroup on the dev host; production stays flag-off).

- [ ] **Step 1: Run `pnpm install:cpu-cgroup` semantics on the dev host** (prep the krova parent) — `cpuCgroupPrepScript()` over SSH; confirm `krova cpu delegated: cpu ...`.

- [ ] **Step 2: Boot a real jailed cube on the dev host with `--cgroup cpu.weight=400`** (4-vCPU), reusing the host-smoke jailed path + the new argv. Assert: `InstanceStart` 204, cube reaches running, `cat /sys/fs/cgroup/krova/<id>/cpu.weight` == 400.

- [ ] **Step 3: Validate networking end-to-end inside the cube** — reuse the `krova-cube-network-test` protocol (gateway ping, external ping, DNS, HTTPS, 3 MB download). Assert ALL pass — proving the cgroup confinement did NOT break the cube's network.

- [ ] **Step 4: Tear the cube down, assert the leaf is gone** — `test ! -d /sys/fs/cgroup/krova/<id>` → leaf cleaned up, no leak.

- [ ] **Step 5: Confirm flag-OFF is byte-identical** — boot a jailed cube with `CPU_CGROUP_ENABLED` off semantics (no `--cgroup`); assert it boots + networks exactly as today and never touches `/sys/fs/cgroup/krova`.

- [ ] **Step 6: Record results + clean the dev host** (`rmdir /sys/fs/cgroup/krova`).

---

## Task 8: Full gate + finalize

- [ ] **Step 1: `pnpm test:all`** → unit + migrations + integration GREEN (no schema change in L1, so migrations unaffected).
- [ ] **Step 2: `pnpm lint`** → clean.
- [ ] **Step 3: Update CLAUDE.md** — add `install:cpu-cgroup` to the command table + a note under the jailer section that `CPU_CGROUP_ENABLED` (default false) adds per-cube `cpu.weight` via a dedicated `krova` parent cgroup, and the rollout order (prep host → canary → flip flag). Update the jailer "no --cgroup limits today" line to reflect the gated path.
- [ ] **Step 4: Commit** — `git commit -m "docs(cpu): document L1 cpu.weight fairness + install:cpu-cgroup"`

---

## Rollout (operator, AFTER merge — Rule 60)

1. Deploy (code is inert: flag off).
2. `pnpm install:cpu-cgroup` (preps the krova parent on every active host — empty cgroup, no cube impact).
3. **Canary:** on ONE active host, confirm a freshly-cold-booted cube lands in `krova/<id>` with the right `cpu.weight` + still networks (the dev-host validation, repeated on a real prod host during a low-traffic window).
4. Flip `CPU_CGROUP_ENABLED = true`, deploy. New + cold-booted cubes get their weight; running cubes get it on next cold boot. Fully reversible (flip off + redeploy → back to today).

---

## Self-review

- **Spec coverage:** flag-gate ✓ (Task 2), dedicated parent ✓ (Task 2/3), host prep ✓ (Task 3/4/5), launch wiring + fail-safe ✓ (Task 6), leaf cleanup ✓ (Task 6), live boot+network validation ✓ (Task 7), rollout ✓.
- **The one open input:** Task 0's empirical leaf path → finalizes Task 3's delegation chain + Task 6's cleanup path. Everything downstream references `CPU_CGROUP_PARENT` so a path change is one constant.
- **No-breaking-changes guarantee:** every behavior change is inside `if (CPU_CGROUP_ENABLED)` or an optional `cgroup` arg that is `undefined` when the flag is off; Task 2/6 tests assert flag-off argv is unchanged; Task 7 Step 5 proves it on real hardware.
