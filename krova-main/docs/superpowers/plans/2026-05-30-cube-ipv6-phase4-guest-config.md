# Cube IPv6 — Phase 4: Guest dual-stack config + resolv.conf + snapshot-restore

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Make every cube's guest `eth0` dual-stack and its `/etc/resolv.conf` v6-first, by upgrading `writeCubeGuestNetworkConfig` to derive both families from `internalIp` (no signature change), updating the baked rootfs default, and adding the missing guest-net re-assert to `snapshot.restore`.

**Architecture:** The writer derives `S = subnetOf(internalIp)` + `octet = octetOf(internalIp)` and emits a dual-stack systemd-networkd unit + an unconditional `/etc/resolv.conf`. Because `S` comes from `internalIp`, the existing 5 callers need no change. `snapshot.restore` (which overwrites the rootfs) becomes the 6th caller so a restored pre-re-IP snapshot can't boot stale networking — and since `JAILER_ENABLED=true`, its loop-mount uses `cubePaths(id, launchMode)` (the canonical rootfs hardlinked into the chroot).

**Tech Stack:** systemd-networkd `.network` units, static `/etc/resolv.conf`, host loop-mount over SSH.

**Spec:** Guest-side config §, Jailer § (JAILER_ENABLED=true), resolv.conf decision 3, H7. **Depends on:** Phase 1 (`cube-network.ts`), Phase 2 (`internal_ip` is new-scheme).

> **Concurrent-edit note:** `snapshot-restore.ts`, `cube-from-snapshot.ts` changed under concurrent commits — read live before editing. `cube-guest-network.ts` is unchanged.

---

## File structure

- **Modify** `lib/server/cube-network.ts` — add pure `subnetOf(ip): number` (+ test in `cube-network.test.ts`).
- **Modify** `lib/ssh/cube-guest-network.ts` — dual-stack `.network` + unconditional `/etc/resolv.conf`; v4 gateway from `cubeIpv4Gateway(S)` (fixes H7). Signature unchanged.
- **Modify** `setup/images/build-all-images.sh` (≈line 865) — baked resolv.conf default → the 3 v6-first entries.
- **Modify** `lib/worker/handlers/snapshot-restore.ts` — loop-mount + `writeCubeGuestNetworkConfig` after restore, before `startCube`, inside the heartbeat span, guaranteed umount.

---

## Task 1: `subnetOf` helper (pure)

**Files:** Modify `lib/server/cube-network.ts`, `lib/server/cube-network.test.ts`.

- [ ] **Step 1: Add the failing test** — append to `cube-network.test.ts`:

```ts
import { subnetOf } from "./cube-network";

test("subnetOf reconstructs S from the middle two octets", () => {
  assert.equal(subnetOf("10.0.0.7"), 0); // legacy
  assert.equal(subnetOf("10.0.5.10"), 5);
  assert.equal(subnetOf("10.18.52.7"), 0x1234); // hi=18, lo=52
  assert.equal(subnetOf("10.255.255.2"), 0xffff);
});

test("subnetOf round-trips with cubeIpv4Address", () => {
  for (const s of [0, 1, 5, 0x1234, 0xffff]) {
    assert.equal(subnetOf(cubeIpv4Address(s, 7)), s);
  }
});

test("subnetOf rejects non-IPv4", () => {
  assert.throws(() => subnetOf("fd00:c0be:5::a"));
  assert.throws(() => subnetOf("10.0.0"));
});
```

(`cubeIpv4Address` is already imported in this test file from Phase 1.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — `subnetOf` not exported.

- [ ] **Step 3: Implement** — add to `lib/server/cube-network.ts`:

```ts
/** Reconstruct the per-server subnet S from a cube IPv4's middle two octets. */
export function subnetOf(internalIp: string): number {
  const labels = internalIp.split(".");
  if (labels.length !== 4) {
    throw new Error(`subnetOf: not a valid IPv4 address: "${internalIp}"`);
  }
  const hi = Number.parseInt(labels[1], 10);
  const lo = Number.parseInt(labels[2], 10);
  if (
    !Number.isInteger(hi) || String(hi) !== labels[1] || hi < 0 || hi > 255 ||
    !Number.isInteger(lo) || String(lo) !== labels[2] || lo < 0 || lo > 255
  ) {
    throw new Error(`subnetOf: not a valid IPv4 address: "${internalIp}"`);
  }
  return (hi << 8) | lo;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
pnpm typecheck && pnpm lint
git add lib/server/cube-network.ts lib/server/cube-network.test.ts
git commit -m "feat(network): subnetOf() — reconstruct S from a cube IPv4 + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Dual-stack `writeCubeGuestNetworkConfig` + unconditional resolv.conf

**Files:** Modify `lib/ssh/cube-guest-network.ts`.

- [ ] **Step 1: Rewrite the unit + add resolv.conf** (read the live file first; preserve the existing base64-write mechanism, netplan wipe, and networkd-enable best-effort blocks). Replace the `networkUnit` construction + add the resolv.conf write:

```ts
import { CUBE_DNS_SERVERS } from "@/config/platform";
import {
  cubeIpv4Gateway,
  cubeIpv6Address,
  cubeIpv6Gateway,
  octetOf,
  subnetOf,
} from "@/lib/server/cube-network";

// inside writeCubeGuestNetworkConfig(client, mountDir, internalIp):
const S = subnetOf(internalIp);
const octet = octetOf(internalIp);
const networkUnit = [
  "[Match]",
  "Name=eth0",
  "",
  "[Network]",
  `Address=${internalIp}/24`,
  `Gateway=${cubeIpv4Gateway(S)}`, // was hardcoded 10.0.0.1 (H7 fix)
  `Address=${cubeIpv6Address(S, octet)}/64`,
  `Gateway=${cubeIpv6Gateway(S)}`,
  ...CUBE_DNS_SERVERS.map((ns) => `DNS=${ns}`),
  "",
].join("\n");
```

…keep the existing `mkdir -p ${mountDir}/etc/systemd/network` + base64 write of `10-eth0.network`. THEN add the unconditional resolv.conf write (the authoritative DNS source — systemd-resolved is off):

```ts
const resolvConf =
  CUBE_DNS_SERVERS.map((ns) => `nameserver ${ns}`).join("\n") + "\n";
const resolvB64 = Buffer.from(resolvConf).toString("base64");
const writeResolv = await execCommand(
  client,
  `rm -f ${mountDir}/etc/resolv.conf && echo '${resolvB64}' | base64 -d > ${mountDir}/etc/resolv.conf`
);
if (writeResolv.exitCode !== 0) {
  throw new Error(`Failed to write guest /etc/resolv.conf: ${writeResolv.stderr}`);
}
```

(`rm -f` first in case the rootfs ever ships a resolv.conf symlink.) Keep the netplan wipe + networkd-enable best-effort blocks unchanged.

- [ ] **Step 2: Typecheck + lint + test**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS (signature unchanged → no caller breaks; helpers resolve).

- [ ] **Step 3: Commit**

```bash
git add lib/ssh/cube-guest-network.ts
git commit -m "feat(network): dual-stack guest eth0 + unconditional v6-first resolv.conf (H7)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Baked rootfs resolv.conf default

**Files:** Modify `setup/images/build-all-images.sh` (≈line 865).

- [ ] **Step 1: Update the printf** — replace the baked default (currently `8.8.8.8 / 1.1.1.1 / 8.8.4.4`) with the 3 v6-first entries (matching `CUBE_DNS_SERVERS`; Rule 14 cross-language note). Find the line writing `$R/etc/resolv.conf` and change it to:

```sh
# DNS: keep in sync with CUBE_DNS_SERVERS in config/platform.ts (v6-first, MAXNS=3)
printf "nameserver 2606:4700:4700::1111\nnameserver 2001:4860:4860::8888\nnameserver 1.1.1.1\n" > $R/etc/resolv.conf
```

- [ ] **Step 2: Verify shell syntax (Rule 39)**

Run: `bash -n setup/images/build-all-images.sh`
Expected: no output (valid).

- [ ] **Step 3: Commit**

```bash
git add setup/images/build-all-images.sh
git commit -m "feat(images): baked resolv.conf v6-first default (matches CUBE_DNS_SERVERS)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `snapshot.restore` re-asserts guest networking (the missing 6th caller)

**Files:** Modify `lib/worker/handlers/snapshot-restore.ts`.

**Context:** `snapshot-restore.ts` restores the rootfs from restic then `startCube`s with NO guest-net rewrite — so a restored pre-re-IP snapshot boots stale `10.0.0.x`. It must loop-mount the restored rootfs and call `writeCubeGuestNetworkConfig(client, mountDir, cube.internalIp)` AFTER the restore and BEFORE `startCube`, inside the existing `withCubeHeartbeat` span (Rule 34), with a guaranteed umount. Since `JAILER_ENABLED=true`, mount the **canonical** rootfs via `cubePaths(cubeId, launchMode).<rootfs>` (it's hardlinked into the chroot). Do NOT touch the `.bak` rollback path.

- [ ] **Step 1: Read the live handler** and locate: the restic-restore completion point, the `cubePaths`/`launchMode` already resolved there (the file resolves `launchMode` via `resolveLaunchModeForCube`), and the `startCube` call. Mirror the loop-mount pattern from `lib/worker/handlers/cube-import-rootfs.ts` (its `writeCubeGuestNetworkConfig` call at ≈line 343 with the surrounding `mount -o loop` / `finally umount`).

- [ ] **Step 2: Insert the re-assert** — after the rootfs is restored + e2fsck'd, before `startCube`:

```ts
import { writeCubeGuestNetworkConfig } from "@/lib/ssh/cube-guest-network";
import { cubePaths } from "@/lib/ssh/jailer";

// cube.internalIp is the cube's CURRENT (post-migration) IP; rootfsPath is the
// canonical host file (hardlinked into the chroot for jailed cubes).
const { rootfs: rootfsPath } = cubePaths(cubeId, launchMode);
const mountDir = `/tmp/krova-mount-${cubeId}`;
await execCommand(client, `mkdir -p ${mountDir} && mount -o loop ${rootfsPath} ${mountDir}`);
try {
  await writeCubeGuestNetworkConfig(client, mountDir, cube.internalIp);
} finally {
  await execCommand(client, `umount ${mountDir} 2>/dev/null; rmdir ${mountDir} 2>/dev/null || true`);
}
```

(Match the exact `cubePaths` field name for the rootfs from `lib/ssh/jailer.ts`, and the existing mount-dir convention used by `cube-import-rootfs.ts` — read both live. The whole block stays inside the `withCubeHeartbeat` wrapper that already brackets the restore→startCube span.)

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/worker/handlers/snapshot-restore.ts
git commit -m "fix(snapshot): re-assert guest network config on restore (prevents stale-IP boot after re-IP)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 verification gate

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` → PASS.
- [ ] `pnpm test` → PASS incl. new `subnetOf` round-trip tests.
- [ ] `bash -n setup/images/build-all-images.sh` → valid.
- [ ] Grep: no `Gateway=10.0.0.1` literal remains in `cube-guest-network.ts`; `writeCubeGuestNetworkConfig` now has 6 callers incl. `snapshot-restore.ts`.

**Image rebuild + Update Images fleet-wide** (so the baked default + the in-guest agent reach existing cubes) is an operator action; new cubes get the dual-stack config immediately via the writer regardless of image age.

## Self-review (against spec)

- `subnetOf` derivation (obsoletes L2/L3 threading) → Task 1, spec Guest-side config §. ✓
- Dual-stack `.network` + v4 gateway `cubeIpv4Gateway(S)` (H7) + unconditional resolv.conf (H7) → Task 2. ✓
- Baked default = `CUBE_DNS_SERVERS` (Rule 14/39) → Task 3. ✓
- `snapshot.restore` 6th caller, jailed-aware `cubePaths`, heartbeat span, guaranteed umount → Task 4. ✓
- No placeholders; signature unchanged so no caller drift; types consistent (`subnetOf → number`).
