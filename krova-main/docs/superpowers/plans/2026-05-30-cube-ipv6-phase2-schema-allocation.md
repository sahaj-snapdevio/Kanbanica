# Cube IPv6 — Phase 2: Schema + DB allocation + C4 lock fix

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Add the `bridge_subnet` + `internal_ipv6` columns and their partial unique indexes (built `CONCURRENTLY`, after a duplicate preflight), the DB-bound `allocateBridgeSubnet(tx)`, the `allocateInternalIp → allocateInternalOctet` refactor, and wire all 5 allocation sites to set BOTH addresses inside an advisory-locked transaction — fixing the pre-existing unlocked-allocation race (C4) on the way.

**Architecture:** Builds on Phase 1's pure helpers (`cube-network.ts`, `bridge-subnets.ts lowestFreeSubnet`). New servers get a globally-unique `bridge_subnet` at create; the one legacy host is backfilled `S=0`. Every cube row now carries `internal_ip` (`10.<S>.<octet>`) + `internal_ipv6` (`fd00:c0be:<S>::<octet>`), both derived at write-time from the same freshly-picked octet under a per-server advisory lock.

**Tech Stack:** Drizzle ORM + drizzle-kit (`pnpm db:generate`), PostgreSQL partial unique indexes, `pg_advisory_xact_lock`.

**Spec:** Schema §, Helpers §, Allocation write-sites §, Pre-existing bugs § (C4), Deploy ordering §. **Depends on:** Phase 1 (helpers + constants + `pnpm test`).

> **Concurrent-edit note:** the files below were touched by parallel commits during planning — the executing agent MUST read the live file before editing and adapt to the current code; the canonical pattern shown here is the shape to apply, not necessarily verbatim current lines.

---

## File structure (this phase)

- **Modify** `db/schema/servers.ts` — add `bridgeSubnet` + its partial unique index.
- **Modify** `db/schema/cubes.ts` — add `internalIpv6` + the v6-global + transitional-v4 partial unique indexes.
- **Generate** `db/migrations/NNNN_*.sql` (+ snapshot + journal) via `pnpm db:generate`; hand-edit the SQL body only for `CONCURRENTLY` / `IF NOT EXISTS` / the legacy `S=0` backfill (Rule 6 — never the journal/snapshot).
- **Create** `scripts/check-duplicate-cube-ips.ts` + `pnpm cubes:check-dup-ips` — the read-only dedup preflight (N-C2).
- **Modify** `lib/server/bridge-subnets.ts` — add `allocateBridgeSubnet(tx)` (uses Phase 1's `lowestFreeSubnet`).
- **Modify** `lib/ssh/network.ts` — `allocateInternalIp(existingIps)` → `allocateInternalOctet(existingOctets)`; **Modify** `lib/ssh/index.ts` barrel export.
- **Modify** the 5 allocation sites: `lib/worker/cube-boot.ts`, `lib/worker/handlers/{cube-from-snapshot,cube-import-rootfs,cube-transfer,backup-redeploy}.ts` — set both addresses; add the lock to the two unlocked ones (C4).
- **Modify** `app/api/orbit/servers/route.ts` — wrap the insert in a tx + `allocateBridgeSubnet`.

---

## Task 1: Schema columns + partial unique indexes

**Files:** Modify `db/schema/servers.ts`, `db/schema/cubes.ts`; generate migration.

- [ ] **Step 1: Add `bridgeSubnet` to `servers.ts`**

In the `servers` pgTable column list add (near the other `integer` columns):

```ts
bridgeSubnet: integer("bridge_subnet"), // nullable; per-server 16-bit subnet (S). 0 = legacy host.
```

In the table's index callback (the `(t) => ({ … })` / `(t) => [ … ]` block — match the file's existing style), add:

```ts
bridgeSubnetUnq: uniqueIndex("servers_bridge_subnet_unq")
  .on(t.bridgeSubnet)
  .where(sql`bridge_subnet IS NOT NULL`),
```

Ensure `uniqueIndex` and `sql` are imported at the top (they already are in sibling schema files — add if missing).

- [ ] **Step 2: Add `internalIpv6` + indexes to `cubes.ts`**

Add the column (next to `internalIp`):

```ts
internalIpv6: text("internal_ipv6"), // fd00:c0be:<S>::<octet>; nullable, derived from internal_ip
```

Add to the index block:

```ts
internalIpv6Unq: uniqueIndex("cubes_internal_ipv6_unq")
  .on(t.internalIpv6)
  .where(sql`internal_ipv6 IS NOT NULL AND status <> 'deleted'`),
serverInternalIpUnq: uniqueIndex("cubes_server_id_internal_ip_unq")
  .on(t.serverId, t.internalIp)
  .where(sql`internal_ip IS NOT NULL AND status <> 'deleted'`),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `db/migrations/NNNN_*.sql` + updated `meta/NNNN_snapshot.json` + `_journal.json`. Confirm the SQL has `ALTER TABLE … ADD COLUMN "bridge_subnet"`, `ADD COLUMN "internal_ipv6"`, and three `CREATE UNIQUE INDEX`.

- [ ] **Step 4: Hand-edit ONLY the generated SQL body for prod safety (Rule 40)**

Edit the generated `.sql` (NOT the journal/snapshot):
- Add `IF NOT EXISTS` to each `ADD COLUMN` and `CREATE UNIQUE INDEX`.
- Change each `CREATE UNIQUE INDEX` → `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS` and move them to run outside the implicit transaction. **drizzle's migrator wraps each file in a tx; `CONCURRENTLY` cannot run in a tx.** So split: keep the `ADD COLUMN`s in this migration, and put the three `CREATE UNIQUE INDEX CONCURRENTLY` statements + the legacy backfill in a SEPARATE follow-up migration file that the operator applies out-of-band (documented in the deploy runbook), OR add `--no-transaction` handling. **Simplest safe path:** this migration does only the additive `ADD COLUMN IF NOT EXISTS`s (transaction-safe); a separate operator step (Task 6 preflight → then `psql` `CREATE UNIQUE INDEX CONCURRENTLY`) builds the indexes after dedup. Document both in the SQL as comments.
- Append the legacy-host `S=0` backfill (idempotent):
  `UPDATE servers SET bridge_subnet = 0 WHERE bridge_subnet IS NULL AND id = '<LEGACY_SERVER_ID>';`
  — the operator substitutes the chosen busiest/oldest server id; leave a clear `-- OPERATOR: set legacy host id` comment. (If left unset, the first migrated host becomes S=0 via the migration script instead.)

- [ ] **Step 5: Run `bash -n` is N/A (SQL); verify the schema typechecks**

Run: `pnpm typecheck`
Expected: PASS — the new columns are referenced by later tasks but the schema itself compiles.

- [ ] **Step 6: Commit**

```bash
git add db/schema/servers.ts db/schema/cubes.ts db/migrations/
git commit -m "feat(db): add bridge_subnet + internal_ipv6 columns + partial unique indexes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Duplicate-IP preflight script (N-C2)

**Files:** Create `scripts/check-duplicate-cube-ips.ts`; Modify `package.json`.

- [ ] **Step 1: Write the script**

Create `scripts/check-duplicate-cube-ips.ts`:

```ts
/**
 * Read-only preflight (audit N-C2): finds non-deleted cubes that share an
 * (server_id, internal_ip) — duplicates from the historical unlocked-allocation
 * race (C4). The transitional UNIQUE(server_id, internal_ip) index CANNOT be
 * built while any such pair exists. Run BEFORE building that index; remediate
 * (re-IP one of each pair on its host) until this reports zero.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main(): Promise<void> {
  const rows = await db.execute(sql`
    SELECT server_id, internal_ip, count(*)::int AS n
    FROM cubes
    WHERE internal_ip IS NOT NULL AND status <> 'deleted'
    GROUP BY server_id, internal_ip
    HAVING count(*) > 1
    ORDER BY n DESC
  `);
  const dups = rows as unknown as Array<{ server_id: string; internal_ip: string; n: number }>;
  if (dups.length === 0) {
    console.log("✓ No duplicate (server_id, internal_ip) pairs — safe to build the unique index.");
    process.exit(0);
  }
  console.error(`✗ ${dups.length} duplicate (server_id, internal_ip) pair(s) — MUST remediate before the unique index:`);
  for (const d of dups) {
    console.error(`  server=${d.server_id} ip=${d.internal_ip} count=${d.n}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the `pnpm` script**

In `package.json` scripts: `"cubes:check-dup-ips": "tsx scripts/check-duplicate-cube-ips.ts",`

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-duplicate-cube-ips.ts package.json
git commit -m "feat(scripts): cubes:check-dup-ips preflight for the unique-index migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `allocateBridgeSubnet(tx)` (DB-bound allocator)

**Files:** Modify `lib/server/bridge-subnets.ts`; Test: `lib/server/bridge-subnets.test.ts` (extend).

- [ ] **Step 1: Add the implementation** (keeps the Phase-1 pure `lowestFreeSubnet`)

Append to `lib/server/bridge-subnets.ts`:

```ts
import { isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  CUBE_BRIDGE_SUBNET_MAX,
  CUBE_BRIDGE_SUBNET_MIN,
} from "@/config/platform";
import * as schema from "@/db/schema";

type Tx = Parameters<Parameters<typeof import("@/lib/db").db.transaction>[0]>[0];

/**
 * Allocate the next free globally-unique bridge_subnet (S) for a NEW server.
 * Serializes on a single GLOBAL advisory lock (disjoint seed 3 — seeds 0/1/2
 * are taken by acquireSpaceLock / per-user / jailer-uid). The tx holds ONLY
 * this lock (never `servers FOR UPDATE`) to avoid deadlock ordering. MIN=1 so
 * S=0 is never auto-issued (reserved for the legacy host).
 */
export async function allocateBridgeSubnet(tx: Tx): Promise<number> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('bridge_subnet_alloc', 3))`
  );
  const rows = await tx
    .select({ s: schema.servers.bridgeSubnet })
    .from(schema.servers)
    .where(isNotNull(schema.servers.bridgeSubnet));
  const inUse = rows.map((r) => r.s).filter((s): s is number => s !== null);
  return lowestFreeSubnet(CUBE_BRIDGE_SUBNET_MIN, CUBE_BRIDGE_SUBNET_MAX, inUse);
}
```

(`lowestFreeSubnet` is already defined + tested in Phase 1; the throw-on-exhaustion ceiling is covered there.)

- [ ] **Step 2: Typecheck + existing tests still pass**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (the pure `lowestFreeSubnet` tests are unaffected; `allocateBridgeSubnet` is DB-bound, exercised in integration via create-server in Task 6).

- [ ] **Step 3: Commit**

```bash
git add lib/server/bridge-subnets.ts
git commit -m "feat(network): allocateBridgeSubnet(tx) — global subnet allocation under advisory lock seed 3

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `allocateInternalIp → allocateInternalOctet` refactor

**Files:** Modify `lib/ssh/network.ts` (≈line 244), `lib/ssh/index.ts` (barrel).

- [ ] **Step 1: Replace the function** in `lib/ssh/network.ts`

Replace the existing `allocateInternalIp(existingIps: string[]): string` with:

```ts
/**
 * Allocate the lowest free host octet (2..254) for a server, given the octets
 * already in use on that server. Callers compose the full address via
 * cubeIpv4Address(S, octet) / cubeIpv6Address(S, octet) — see lib/server/cube-network.ts.
 * (Renamed from allocateInternalIp, which returned a hardcoded 10.0.0.<octet>.)
 */
export function allocateInternalOctet(existingOctets: number[]): number {
  const used = new Set(existingOctets);
  for (let i = 2; i <= 254; i++) {
    if (!used.has(i)) {
      return i;
    }
  }
  throw new Error("Internal IP subnet exhausted: no free host octet in 2..254");
}
```

- [ ] **Step 2: Update the barrel export** in `lib/ssh/index.ts`

Change the `allocateInternalIp` export to `allocateInternalOctet`.

- [ ] **Step 3: Typecheck — expect FAILURES at the 5 call sites**

Run: `pnpm typecheck`
Expected: FAIL — every caller still imports/calls `allocateInternalIp`. This is the worklist for Task 5. (Do NOT commit yet — the tree won't typecheck until Task 5.)

---

## Task 5: Wire all 5 allocation sites (set both addresses; lock the 2 unlocked ones — C4)

**Files:** Modify `lib/worker/cube-boot.ts`, `lib/worker/handlers/{cube-from-snapshot,cube-import-rootfs,cube-transfer,backup-redeploy}.ts`.

**Canonical pattern to apply at each site** — read the live block, then transform it to: (a) run inside `db.transaction` under `pg_advisory_xact_lock(hashtext(<server>))`, (b) read the server's `bridge_subnet` S, (c) build the in-use set as **octets**, (d) pick the octet, (e) set BOTH `internal_ip` + `internal_ipv6`:

```ts
import { octetOf, cubeIpv4Address, cubeIpv6Address } from "@/lib/server/cube-network";
import { allocateInternalOctet } from "@/lib/ssh/network"; // or "@/lib/ssh"

const { internalIp, internalIpv6 } = await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${serverId}))`);

  const [srv] = await tx
    .select({ bridgeSubnet: schema.servers.bridgeSubnet })
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .limit(1);
  if (!srv || srv.bridgeSubnet === null) {
    throw new Error(`server ${serverId} has no bridge_subnet (run the bridge_subnet backfill)`);
  }
  const S = srv.bridgeSubnet;

  const existing = await tx.query.cubes.findMany({
    where: and(eq(cubes.serverId, serverId), ne(cubes.status, "deleted")),
    columns: { internalIp: true },
  });
  const existingOctets = existing
    .map((v) => v.internalIp)
    .filter((ip): ip is string => Boolean(ip))
    .map(octetOf);
  const octet = allocateInternalOctet(existingOctets);
  const ip = cubeIpv4Address(S, octet);
  const ipv6 = cubeIpv6Address(S, octet);
  await tx
    .update(cubes)
    .set({ internalIp: ip, internalIpv6: ipv6, updatedAt: new Date() })
    .where(eq(cubes.id, cubeId));
  return { internalIp: ip, internalIpv6: ipv6 };
});
```

- [ ] **Step 1: `cube-from-snapshot.ts`, `cube-import-rootfs.ts`** — already locked; just swap the body to octet-based + set `internal_ipv6`. Read S from the destination server (the `serverId` they already lock on).

- [ ] **Step 2: `cube-transfer.ts`** — **destination-scoped (N-M1).** It allocates on the DESTINATION server while `cube.serverId` is still the source. Keep its existing OR-filter (`eq(serverId,dest) OR eq(transferDestinationServerId,dest)`) for the in-use set; read S from the **destination** server's `bridge_subnet`; derive both addresses from the single fresh dest octet. Comment: *octet is NOT preserved across transfer.*

- [ ] **Step 3: `cube-boot.ts` (C4 fix)** — currently UNLOCKED (no tx). Wrap the allocation in the locked-tx pattern above. (`serverId` is in scope; `sql` import may need adding.)

- [ ] **Step 4: `backup-redeploy.ts` (C4 fix)** — currently UNLOCKED. Same wrap. Capture `conn.server` (not just `conn.client`) if S isn't otherwise available, or read the server row in the tx.

- [ ] **Step 5: Typecheck + lint + tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS — no remaining `allocateInternalIp` references; all 5 sites set both addresses under a lock.

- [ ] **Step 6: Commit**

```bash
git add lib/ssh/network.ts lib/ssh/index.ts lib/worker/cube-boot.ts lib/worker/handlers/cube-from-snapshot.ts lib/worker/handlers/cube-import-rootfs.ts lib/worker/handlers/cube-transfer.ts lib/worker/handlers/backup-redeploy.ts
git commit -m "feat(network): allocate octet+both addresses under advisory lock at all 5 sites (fixes C4 unlocked race)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: create-server allocates `bridge_subnet` in a transaction (N-M3/H8)

**Files:** Modify `app/api/orbit/servers/route.ts` (≈line 145).

- [ ] **Step 1: Wrap the insert in a transaction + allocate the subnet**

Replace the bare `db.insert(schema.servers).values({…}).returning()` with:

```ts
const [server] = await db.transaction(async (tx) => {
  const bridgeSubnet = await allocateBridgeSubnet(tx);
  return tx
    .insert(schema.servers)
    .values({
      id: serverId,
      hostname,
      publicIp,
      regionId,
      sshKeyId,
      status: "inactive",
      setupPhase: "bootstrap",
      setupStatus: "idle",
      bridgeSubnet,
      ...(maxCpuOvercommit !== undefined && { maxCpuOvercommit: String(maxCpuOvercommit) }),
      ...(maxRamOvercommit !== undefined && { maxRamOvercommit: String(maxRamOvercommit) }),
    })
    .returning();
});
```

Add `import { allocateBridgeSubnet } from "@/lib/server/bridge-subnets";`.

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/orbit/servers/route.ts
git commit -m "feat(server): allocate bridge_subnet in a tx at server create (H8/N-M3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 verification gate

- [ ] `pnpm typecheck` → PASS
- [ ] `pnpm lint` → PASS
- [ ] `pnpm test` → PASS (Phase 1 suites green)
- [ ] `pnpm build` → PASS
- [ ] Grep `allocateInternalIp` repo-wide → only the renamed `allocateInternalOctet` remains (no stale references).
- [ ] Migration SQL reviewed: additive `ADD COLUMN IF NOT EXISTS`; unique indexes split to `CONCURRENTLY` (out-of-band, after `pnpm cubes:check-dup-ips` reports zero) per the deploy runbook.

**DB migration + index build + dedup remediation are operator/maintenance-window actions** (Deploy ordering §) — not run autonomously. Phase 2 ships the schema + code that make them correct.

## Self-review (against spec)

- Schema §, CONCURRENTLY, dedup preflight (N-C2), legacy S=0 backfill (H8) → Tasks 1, 2. ✓
- `allocateBridgeSubnet` seed-3 lock, MIN=1 → Task 3. ✓
- `allocateInternalOctet` + octet-keyed in-use sets (N-L2/M10) → Tasks 4, 5. ✓
- C4 lock on cube-boot + backup-redeploy → Task 5 Steps 3-4. ✓
- Transfer destination-scoped, fresh octet (N-M1) → Task 5 Step 2. ✓
- create-server tx + bridge_subnet (N-M3/H8) → Task 6. ✓
- No placeholders; canonical code shown; types consistent with Phase 1 (`octetOf → number`, `cubeIpv4Address(S,octet)`, `allocateInternalOctet(number[]) → number`).
