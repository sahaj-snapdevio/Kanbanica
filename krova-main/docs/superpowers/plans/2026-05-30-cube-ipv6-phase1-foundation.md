# Cube IPv6 — Phase 1: Foundation (pure helpers + math test suite + config)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the pure, fully-tested address-math foundation (config constants, the v4/v6 derivation helpers, the per-server-subnet pure allocator) plus a `node --test` runner — the hard prerequisite the audit named, with zero runtime/behaviour change.

**Architecture:** All logic in this phase is **pure functions** in `lib/server/` driven by `config/platform.ts` constants, covered by a new `tsx --test` suite. Nothing here is wired into a runtime path yet — later phases consume these helpers. This isolates the bug-prone hex/subnet arithmetic behind table-driven tests before any host or DB code depends on it.

**Tech Stack:** TypeScript (strict), Node 22 `node:test` + `node:assert/strict` run via `tsx`, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-30-cube-ipv6-design.md` (Config constants §, Helpers §, Tests § — the "hard prerequisite" decision 9).

---

## Phase plan series (dependency order)

This feature is split into 6 sequential plans, each shipping working, testable software:

1. **Phase 1 — Foundation (THIS PLAN):** config constants + pure `cube-network.ts` helpers + `bridge-subnets.ts` pure allocator + `node --test` suite.
2. **Phase 2 — Schema + DB allocation + C4 fix:** `bridge_subnet`/`internal_ipv6` columns + partial unique indexes + dedup preflight; `allocateBridgeSubnet(tx)`; `allocateInternalIp → allocateInternalOctet`; advisory-lock `cube-boot`/`backup-redeploy`; set both addresses at all 5 sites; create-server tx.
3. **Phase 3 — Host networking + firewall + C2 fix + verify:** `applyHostNetworking` (dual-stack bridge/NAT, default-deny INPUT, dedicated sysctl file), `server-network.ts` refactor, `server-verify.ts` IPv6/INPUT/QUIC checks, Rule-46 host-tools.
4. **Phase 4 — Guest config:** `writeCubeGuestNetworkConfig` dual-stack + unconditional resolv.conf + all 6 callers incl. `snapshot.restore`; baked resolv.conf.
5. **Phase 5 — Address visibility:** remove `internalIp` from webhooks/v1/openapi; add `internal_ipv6` to Orbit only.
6. **Phase 6 — Re-IP migration + rollout:** `cubes:migrate-network` script (status filters, paused-skip, `networkctl reconfigure`, Caddy await/`If-Match`), `cube-wake` stale-config guard, transfer-rollback v6, observer-cron handling.

Each later phase gets its own plan file written when we reach it (signatures from earlier phases must be locked first to keep the code placeholder-free).

---

## File structure (this phase)

- **Create** `lib/server/cube-network.ts` — pure v4/v6 address derivation + `octetOf`. One responsibility: turn `(bridge_subnet S, octet)` into address/gateway/subnet strings, and parse an octet back out.
- **Create** `lib/server/cube-network.test.ts` — table-driven tests for every helper, incl. the hex-conversion edge cases the audit flagged (10→a, 16→10, 254→fe) and `S=0` legacy reproduction.
- **Create** `lib/server/bridge-subnets.ts` — pure `lowestFreeSubnet(min, max, inUse)` with an explicit exhaustion ceiling (audit N-L1). (The DB-bound `allocateBridgeSubnet(tx)` lands in Phase 2.)
- **Create** `lib/server/bridge-subnets.test.ts` — gap-fill / min / max / exhaustion tests.
- **Modify** `config/platform.ts` — add the IPv6/subnet/DNS constants.
- **Modify** `package.json` — add the `test` script.

---

## Task 1: Test runner setup (`pnpm test` via tsx)

**Files:**
- Modify: `package.json` (scripts)
- Test: `lib/server/__runner-smoke__.test.ts` (temporary smoke test, deleted in Step 6)

- [ ] **Step 1: Add the `test` script to `package.json`**

Open `package.json`, find the `"scripts"` object, and add this entry (keep the existing entries; insert alphabetically near `"typecheck"`):

```json
"test": "tsx --test \"lib/**/*.test.ts\"",
```

- [ ] **Step 2: Write a temporary smoke test to prove the runner works**

Create `lib/server/__runner-smoke__.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("test runner is wired up", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run it and confirm the runner executes**

Run: `pnpm test`
Expected: output contains `# pass 1` and `# fail 0`, process exits 0. (If `tsx: command not found`, run `pnpm install` first — `tsx` is already in `devDependencies`.)

- [ ] **Step 4: Delete the smoke test**

Run: `rm lib/server/__runner-smoke__.test.ts`

- [ ] **Step 5: Confirm `pnpm test` now reports no test files gracefully**

Run: `pnpm test`
Expected: exits 0 with `# tests 0` (Node's runner treats "no matching files" as success). This is fine — Task 3 adds real tests.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "test: add tsx-based node:test runner (pnpm test)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Config constants

**Files:**
- Modify: `config/platform.ts`

- [ ] **Step 1: Add the constants**

Open `config/platform.ts`. Add this block near the other cube/network constants (exact placement doesn't matter; keep it with related cube config). These are the single source of truth (Rule 30):

```ts
/**
 * IPv6 + globally-unique networking (see
 * docs/superpowers/specs/2026-05-30-cube-ipv6-design.md).
 * `bridge_subnet` S (per server) drives BOTH families:
 *   IPv4 = 10.<S_hi>.<S_lo>.<octet>, IPv6 = fd00:c0be:<S-hex>::<octet>.
 * S=0 reproduces the legacy 10.0.0.x scheme and is RESERVED for the one
 * pre-existing host left un-re-IP'd, so the allocator starts at 1.
 */
export const CUBE_IPV4_PREFIX = "10";
export const CUBE_IPV6_PREFIX = "fd00:c0be";
export const CUBE_BRIDGE_SUBNET_MIN = 1;
export const CUBE_BRIDGE_SUBNET_MAX = 0xff_ff;

/**
 * Guest /etc/resolv.conf nameservers, v6-first. glibc honours only the first
 * MAXNS=3 (systemd-resolved is off), so exactly three entries.
 */
export const CUBE_DNS_SERVERS = [
  "2606:4700:4700::1111", // Cloudflare IPv6
  "2001:4860:4860::8888", // Google IPv6
  "1.1.1.1", // Cloudflare IPv4 fallback
] as const;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors). The constants are unused so far — that's fine; Phase 1 helpers consume them next.

- [ ] **Step 3: Commit**

```bash
git add config/platform.ts
git commit -m "feat(config): add cube IPv6 + bridge-subnet + DNS constants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Pure address-math helpers (`cube-network.ts`)

**Files:**
- Create: `lib/server/cube-network.ts`
- Test: `lib/server/cube-network.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/server/cube-network.test.ts` (relative import to the module under test so resolution is unconditional; the module itself imports `@/config/platform`, which tsx resolves):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cubeIpv4Address,
  cubeIpv4Gateway,
  cubeIpv4Subnet,
  cubeIpv6Address,
  cubeIpv6Gateway,
  cubeIpv6Subnet,
  octetOf,
} from "./cube-network";

test("octetOf parses the last IPv4 label as base-10", () => {
  assert.equal(octetOf("10.0.5.10"), 10); // base-10, NOT hex
  assert.equal(octetOf("10.18.52.254"), 254);
  assert.equal(octetOf("10.0.0.2"), 2);
});

test("octetOf rejects non-IPv4 / out-of-range input", () => {
  assert.throws(() => octetOf("fd00:c0be:5::a"));
  assert.throws(() => octetOf("garbage"));
  assert.throws(() => octetOf("10.0.0.300"));
});

test("cubeIpv4Address splits S into the middle two octets; S=0 is legacy", () => {
  assert.equal(cubeIpv4Address(0, 7), "10.0.0.7"); // legacy reproduction
  assert.equal(cubeIpv4Address(5, 10), "10.0.5.10");
  assert.equal(cubeIpv4Address(0x12_34, 7), "10.18.52.7"); // hi=0x12=18, lo=0x34=52
  assert.equal(cubeIpv4Address(0xff_ff, 254), "10.255.255.254");
});

test("cubeIpv4Gateway / Subnet", () => {
  assert.equal(cubeIpv4Gateway(5), "10.0.5.1");
  assert.equal(cubeIpv4Subnet(5), "10.0.5.0/24");
  assert.equal(cubeIpv4Gateway(0), "10.0.0.1");
});

test("cubeIpv6Address converts octet to HEX suffix", () => {
  assert.equal(cubeIpv6Address(0, 7), "fd00:c0be:0::7");
  assert.equal(cubeIpv6Address(5, 10), "fd00:c0be:5::a"); // 10 -> a
  assert.equal(cubeIpv6Address(5, 16), "fd00:c0be:5::10"); // 16 -> 10 (hex!)
  assert.equal(cubeIpv6Address(5, 254), "fd00:c0be:5::fe");
  assert.equal(cubeIpv6Address(0x12_34, 2), "fd00:c0be:1234::2");
});

test("cubeIpv6Gateway / Subnet use hex S", () => {
  assert.equal(cubeIpv6Gateway(5), "fd00:c0be:5::1");
  assert.equal(cubeIpv6Subnet(5), "fd00:c0be:5::/64");
  assert.equal(cubeIpv6Subnet(0x12_34), "fd00:c0be:1234::/64");
});

test("S out of [0, 0xff_ff] is rejected", () => {
  assert.throws(() => cubeIpv4Address(-1, 2));
  assert.throws(() => cubeIpv4Address(0x1_00_00, 2));
  assert.throws(() => cubeIpv6Address(0x1_00_00, 2));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './cube-network'` (the module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/server/cube-network.ts`:

```ts
/**
 * Pure derivation of a cube's IPv4 + IPv6 addresses from its server's
 * `bridge_subnet` (S) and the cube's host octet. Single source of truth for
 * the address math (spec: Unified addressing §).
 *
 * S (0..65535) → middle two IPv4 octets (hi=S>>8, lo=S&0xff) AND the third
 * IPv6 hextet (hex). The cube's 4th IPv4 octet doubles as the IPv6 suffix
 * (hex). S=0 reproduces the legacy 10.0.0.x / fd00:c0be::x scheme exactly.
 *
 * INVARIANT (spec L9): TAP name, vsock CID, and ip.txt derive ONLY from the
 * IPv4 internal_ip — never from internal_ipv6. These helpers never feed v6
 * into anything octet-derived.
 */
import {
  CUBE_BRIDGE_SUBNET_MAX,
  CUBE_IPV4_PREFIX,
  CUBE_IPV6_PREFIX,
} from "@/config/platform";

function assertSubnet(s: number): void {
  // Allow 0 here (legacy host); the ALLOCATOR enforces MIN=1 for new servers.
  if (!Number.isInteger(s) || s < 0 || s > CUBE_BRIDGE_SUBNET_MAX) {
    throw new Error(
      `cube-network: bridge_subnet ${s} out of range [0, ${CUBE_BRIDGE_SUBNET_MAX}]`
    );
  }
}

function subnetBytes(s: number): { hi: number; lo: number } {
  assertSubnet(s);
  return { hi: (s >> 8) & 0xff, lo: s & 0xff };
}

/** Last IPv4 octet as a base-10 number (NOT hex). Throws on non-IPv4 input. */
export function octetOf(internalIp: string): number {
  const labels = internalIp.split(".");
  const last = labels.length === 4 ? labels[3] : undefined;
  const n = last === undefined ? Number.NaN : Number.parseInt(last, 10);
  if (!Number.isInteger(n) || String(n) !== last || n < 0 || n > 255) {
    throw new Error(`octetOf: not a valid IPv4 address: "${internalIp}"`);
  }
  return n;
}

export function cubeIpv4Subnet(s: number): string {
  const { hi, lo } = subnetBytes(s);
  return `${CUBE_IPV4_PREFIX}.${hi}.${lo}.0/24`;
}

export function cubeIpv4Gateway(s: number): string {
  const { hi, lo } = subnetBytes(s);
  return `${CUBE_IPV4_PREFIX}.${hi}.${lo}.1`;
}

export function cubeIpv4Address(s: number, octet: number): string {
  const { hi, lo } = subnetBytes(s);
  return `${CUBE_IPV4_PREFIX}.${hi}.${lo}.${octet}`;
}

export function cubeIpv6Subnet(s: number): string {
  assertSubnet(s);
  return `${CUBE_IPV6_PREFIX}:${s.toString(16)}::/64`;
}

export function cubeIpv6Gateway(s: number): string {
  assertSubnet(s);
  return `${CUBE_IPV6_PREFIX}:${s.toString(16)}::1`;
}

export function cubeIpv6Address(s: number, octet: number): string {
  assertSubnet(s);
  return `${CUBE_IPV6_PREFIX}:${s.toString(16)}::${octet.toString(16)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all `cube-network` tests green (`# fail 0`).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/server/cube-network.ts lib/server/cube-network.test.ts
git commit -m "feat(network): pure cube IPv4/IPv6 address derivation helpers + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Pure bridge-subnet allocator (`lowestFreeSubnet`)

**Files:**
- Create: `lib/server/bridge-subnets.ts`
- Test: `lib/server/bridge-subnets.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/server/bridge-subnets.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lowestFreeSubnet } from "./bridge-subnets";

test("returns MIN when nothing is in use", () => {
  assert.equal(lowestFreeSubnet(1, 0xff_ff, []), 1);
});

test("fills the lowest gap", () => {
  assert.equal(lowestFreeSubnet(1, 0xff_ff, [1, 2, 4]), 3);
  assert.equal(lowestFreeSubnet(1, 0xff_ff, [1, 2, 3]), 4);
});

test("ignores out-of-range / duplicate in-use values", () => {
  assert.equal(lowestFreeSubnet(1, 0xff_ff, [1, 1, 2, 999999]), 3);
});

test("THROWS on exhaustion instead of returning MAX+1 (audit N-L1)", () => {
  assert.throws(() => lowestFreeSubnet(1, 3, [1, 2, 3]));
});

test("can allocate the very last slot", () => {
  assert.equal(lowestFreeSubnet(1, 3, [1, 2]), 3);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './bridge-subnets'`.

- [ ] **Step 3: Write the implementation**

Create `lib/server/bridge-subnets.ts`:

```ts
/**
 * Per-server `bridge_subnet` (S) allocation. S is GLOBALLY unique (one per
 * server) so both cube address families derive globally-unique addresses
 * (spec: Helpers §). This file holds the PURE picker; the DB-bound
 * `allocateBridgeSubnet(tx)` (advisory lock seed 3 + servers query) lands in
 * Phase 2 and reuses this.
 *
 * Unlike lib/server/jailer-uids.ts `lowestFreeUid` (which has NO ceiling),
 * this MUST throw on exhaustion rather than hand out an out-of-range subnet
 * (audit finding N-L1).
 */

/** Lowest integer in [min, max] not present in `inUse`. Throws if none free. */
export function lowestFreeSubnet(
  min: number,
  max: number,
  inUse: Iterable<number>
): number {
  const used = new Set(inUse);
  for (let s = min; s <= max; s++) {
    if (!used.has(s)) {
      return s;
    }
  }
  throw new Error(
    `bridge_subnet space exhausted: no free subnet in [${min}, ${max}]`
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all `bridge-subnets` + `cube-network` tests green.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/server/bridge-subnets.ts lib/server/bridge-subnets.test.ts
git commit -m "feat(network): pure lowestFreeSubnet allocator with exhaustion ceiling + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 done — verification gate

Run all three and confirm green before declaring Phase 1 complete:

- [ ] `pnpm test` → `# fail 0`, both `cube-network` + `bridge-subnets` suites run.
- [ ] `pnpm typecheck` → PASS.
- [ ] `pnpm lint` → PASS.

No runtime path consumes these yet, so there is nothing to smoke-test in the app — that begins in Phase 2 (schema + DB allocation).

---

## Self-review (against spec)

- **Config constants §** → Task 2 (all five constants, MIN=1). ✓
- **Helpers § (`cube-network.ts` derivations + `octetOf`)** → Task 3, every helper + the 10→a / 16→10 / 254→fe hex cases + S=0 legacy + range guard. ✓
- **Helpers § (`lowestFreeSubnet` + N-L1 ceiling)** → Task 4, incl. the exhaustion-throw test. ✓
- **Tests § (decision 9, hard blocker — `node --test` + `pnpm test`)** → Task 1. ✓
- **L9 invariant (TAP/vsock derive only from v4)** → documented in `cube-network.ts` header; enforced structurally (helpers never feed v6 into octet math). ✓
- Out of scope for Phase 1 (correctly deferred): `allocateBridgeSubnet(tx)` (Phase 2), schema, host/guest wiring. No placeholders; every code step shows complete code; types are consistent (`octetOf → number`, `lowestFreeSubnet(min,max,inUse) → number`).
