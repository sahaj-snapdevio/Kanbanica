# Snapshot & Backup Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the platform-wide auto-snapshot setting with a per-plan cadence + retention bucket system. Add snapshot download as `.cube` (24h presigned email link), clone-to-new-cube, pin auto → manual, promote snapshot → backup, and per-GB-month backup storage billing. Remove the "save as backup from running cube" surface — backup creation becomes pre-deletion-only (paid plans).

**Architecture:** Each `plans` row gets cadence + retention bucket + manual cap columns. The new `snapshot.scheduler` cron iterates running/sleeping cubes hourly, decides per-cube whether a snapshot is due based on the cube's plan + a `last_auto_snapshot_at`/`snapshotted_since_sleep` state pair on `cubes`. A new `snapshot.auto-prune` daily cron runs restic `forget` per cube with the plan's retention buckets. Snapshot exports materialize via `restic dump | zstd | tar` on the source cube's host into a new `snapshot_exports` table; a reaper deletes after 24h. Snapshot → backup promotion uses the same dump pipeline but lands in the existing backups prefix and creates a `cube_backups` row. Clone-to-new-cube allocates a server and dumps directly onto its rootfs. Backup storage billing is a new pass appended to `billing-hourly`.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, PostgreSQL, pg-boss, restic CLI over SSH, rclone, React Email, react-hook-form + Zod.

---

## File Structure

### New files

- `db/schema/snapshot-exports.ts` — `snapshot_exports` Drizzle table
- `db/migrations/0055_snapshot_overhaul.sql` — additive schema for plans/cubes/snapshots/settings columns + snapshot_exports table
- `db/migrations/0056_seed_plan_snapshot_columns.sql` — backfill cadence/retention/cap on the 4 seeded plans + seed `backup_storage_rate_per_gb_per_month`
- `db/migrations/0057_snapshot_kind_backfill.sql` — set `cube_snapshots.kind` from existing `is_automatic` (idempotent)
- `lib/plan/snapshot-limits.ts` — `assertCanCreateManualSnapshot`, `assertCanCreateBackup`, `assertCanPromoteToBackup`, snapshot plan-config reader
- `lib/worker/handlers/snapshot-scheduler.ts` — new per-plan hourly scheduler (replaces old `snapshot-auto.ts`)
- `lib/worker/handlers/snapshot-auto-prune.ts` — daily retention-bucket pruner per cube
- `lib/worker/handlers/snapshot-export.ts` — materialize + upload + email + insert export row
- `lib/worker/handlers/snapshot-export-reap.ts` — delete expired export `.cube` files
- `lib/worker/handlers/snapshot-promote-to-backup.ts` — materialize a snapshot + insert `cube_backups` row
- `lib/worker/handlers/cube-from-snapshot.ts` — allocate server + restic-dump rootfs + boot new cube
- `lib/email/templates/snapshot-export-ready.ts` + `lib/email/components/snapshot-export-ready.tsx` — email template
- `app/api/spaces/[spaceId]/cubes/[cubeId]/snapshots/[snapshotId]/export/route.ts` — POST to start export
- `app/api/spaces/[spaceId]/cubes/[cubeId]/snapshots/[snapshotId]/promote-backup/route.ts` — POST to promote
- `app/api/spaces/[spaceId]/cubes/[cubeId]/snapshots/[snapshotId]/clone/route.ts` — POST to clone-to-new-cube
- `app/api/spaces/[spaceId]/cubes/[cubeId]/snapshots/[snapshotId]/pin/route.ts` — POST to flip kind auto → manual
- `components/snapshot-export-button.tsx` — client component button + spinner
- `components/snapshot-clone-sheet.tsx` — clone sheet
- `components/snapshot-promote-backup-button.tsx` — promote button + confirm
- `components/snapshot-pin-button.tsx` — pin button + confirm
- `tests/lib/plan/snapshot-limits.test.ts`
- `tests/lib/worker/handlers/snapshot-scheduler.test.ts`
- `tests/lib/worker/handlers/snapshot-auto-prune.test.ts`

### Modified files

- `db/schema/plans.ts` — add 5 columns (cadence + 3 retention buckets + manual cap)
- `db/schema/cubes.ts` — add `snapshotted_since_sleep` + `last_auto_snapshot_at`
- `db/schema/snapshots.ts` — add `cube_snapshots.kind` enum, deprecate `is_automatic` (kept for now)
- `db/schema/platform-settings.ts` — add `backup_storage_rate_per_gb_per_month`
- `lib/plan/limits.ts` — extend `EffectiveLimits` with snapshot fields; update `effectiveLimits()`
- `lib/plan/usage.ts` — add `countManualSnapshotsForCube`, `countAutoSnapshotsForCube`
- `lib/service-config.ts` — DELETE `getSnapshotConfig` + the static config consumers, replaced by per-plan reads
- `config/platform.ts` — remove `SNAPSHOT_AUTO_*` exports (or mark as legacy)
- `app/actions/snapshots.ts` — `createSnapshot` reads plan cap via `assertCanCreateManualSnapshot`; insert `kind='manual'`
- `app/actions/backups.ts` — delete `createBackupFromCube`; update import surfaces
- `app/actions/cubes.ts` — `deleteCube` checks plan allows pre-deletion backup
- `app/actions/orbit-plans.ts` — add 5 fields to Zod schema, create/update validation, defaults
- `app/(orbit)/orbit/plans/_components/plan-form-sheet.tsx` — UI for new fields
- `app/(orbit)/orbit/plans/[planId]/page.tsx` + plan-list — display snapshot config
- `app/(orbit)/orbit/platform-settings/page.tsx` (+ form component, find via grep) — add backup storage rate field
- `app/actions/orbit-platform-settings.ts` — schema + persist new field
- `lib/worker/handlers/snapshot-create.ts` — set `kind` from payload; clear `snapshotted_since_sleep` on cube
- `lib/worker/handlers/cube-sleep.ts` — flip `snapshotted_since_sleep = false` on transition into sleeping
- `lib/worker/handlers/billing-hourly.ts` — append backup storage pass
- `lib/worker/boss.ts` — register new handlers + crons; remove `snapshot-auto` scheduling
- `lib/worker/ensure-queues.ts` — queue policy entries for new jobs
- `lib/worker/job-types.ts` — add JOB_NAMES + payload types for new jobs; remove `SNAPSHOT_AUTO`
- `components/cube-snapshots.tsx` — split list by `kind` (Auto/Manual), wire Pin/Export/Clone/Promote buttons; remove "Save as Backup" (running cube)
- `components/cube-detail-header.tsx` — `preserveBackup` checkbox: default `true` on paid plans, hidden on Trial; check `canCreateBackup` against plan
- `app/(dashboard)/[spaceId]/cubes/[cubeId]/snapshots/page.tsx` — pass plan info + kind into the props
- `lib/worker/handlers/snapshot-auto.ts` — DELETE
- `README.md`, `CLAUDE.md` — document new behavior

---

## Naming conventions used below

- pg-boss queue/job names use dotted form (`snapshot.scheduler`, `snapshot.export`)
- `JOB_NAMES` constants are UPPER_SNAKE_CASE (`JOB_NAMES.SNAPSHOT_SCHEDULER`)
- Payload types end in `Payload` (`SnapshotExportPayload`)
- Server actions return `{ success: true, data: … }` or `{ error: "string" }`
- API routes return JSON, status codes following existing conventions

---

# PHASE 0 — Schema foundation

Goal: every new column exists in the DB with safe defaults, callable from Drizzle, no behavior change yet.

### Task 0.1: Add plan columns to schema

**Files:**
- Modify: `db/schema/plans.ts`

- [ ] **Step 1: Extend the `plans` table definition**

Add the 5 new columns after `maxBackups` (around line 39):

```typescript
// Auto-snapshot cadence in hours. NULL = auto-snapshots disabled for this plan.
// Validated >= 2 in the Orbit form; lower than that hammers the host I/O.
autoSnapshotCadenceHours: integer("auto_snapshot_cadence_hours"),
// Retention buckets passed to `restic forget` for auto snapshots.
// All three default to 0 → no auto rotation kept.
autoSnapshotKeepLast: integer("auto_snapshot_keep_last").notNull().default(0),
autoSnapshotKeepDaily: integer("auto_snapshot_keep_daily").notNull().default(0),
autoSnapshotKeepWeekly: integer("auto_snapshot_keep_weekly").notNull().default(0),
// Hard cap on user-created (manual) snapshots per cube. 0 = customer
// cannot create manual snapshots on this plan.
maxManualSnapshotsPerCube: integer("max_manual_snapshots_per_cube").notNull().default(0),
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: passes (no callers reference the new fields yet).

- [ ] **Step 3: Commit**

```bash
git add db/schema/plans.ts
git commit -m "feat(plans): add auto-snapshot cadence + retention + manual cap columns"
```

### Task 0.2: Add cube tracking columns

**Files:**
- Modify: `db/schema/cubes.ts`

- [ ] **Step 1: Locate the `cubes` table definition + the existing `lastBilledAt` column for placement reference**

Run: `grep -n "lastBilledAt\|withTimezone" db/schema/cubes.ts | head -10`

- [ ] **Step 2: Add the two columns**

Right after `lastBilledAt` (or in alphabetical placement with other booleans/timestamps), add:

```typescript
// Timestamp of the most recent successful auto-snapshot for this cube.
// NULL = no auto-snapshot ever taken. The scheduler reads this column
// (vs the plan's cadence) to decide whether a tick is due.
lastAutoSnapshotAt: timestamp("last_auto_snapshot_at", { withTimezone: true }),
// True iff at least one auto-snapshot has succeeded since the cube most
// recently entered `sleeping`. Reset to false by `cube-sleep.ts` on the
// sleeping transition. Used by the scheduler to enforce "one snapshot per
// sleep cycle" — a sleeping cube has an unchanging rootfs, no point
// re-snapshotting it every cadence tick.
snapshottedSinceSleep: boolean("snapshotted_since_sleep").notNull().default(true),
```

Note: default `true` is intentional — for cubes that already exist (never been asleep), the gate is open. The flag only meaningfully gates after a cube has entered sleeping at least once and the cube-sleep handler reset it.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add db/schema/cubes.ts
git commit -m "feat(cubes): add auto-snapshot tracking columns"
```

### Task 0.3: Add snapshot kind enum + column

**Files:**
- Modify: `db/schema/snapshots.ts`

- [ ] **Step 1: Add pgEnum + column**

Add above the `cubeSnapshots` table definition:

```typescript
/**
 * Whether the snapshot is system-managed (auto) or customer-managed (manual).
 * Auto snapshots are rotated by `snapshot.auto-prune` per the plan's retention
 * policy and CANNOT be deleted by the customer. Manual snapshots count against
 * the plan's manual cap and ARE customer-deletable. Pinning an auto snapshot
 * is a tag swap from "auto" to "manual" via the pin API.
 */
export const snapshotKind = pgEnum("snapshot_kind", ["auto", "manual"])
```

Add inside `cubeSnapshots` columns block, right after `isAutomatic`:

```typescript
kind: snapshotKind("kind").notNull().default("manual"),
```

Add a partial index for the scheduler/pruner's hot path inside the table options array:

```typescript
index("cube_snapshots_cube_id_kind_status_idx").on(t.cubeId, t.kind, t.status),
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add db/schema/snapshots.ts
git commit -m "feat(snapshots): add kind column for auto/manual separation"
```

### Task 0.4: Add backup storage rate to platform_settings

**Files:**
- Modify: `db/schema/platform-settings.ts`

- [ ] **Step 1: Add column** (place near other numeric rate fields, right before `polarCreditProductId`)

```typescript
/**
 * Per-GB-month rate for backup storage billing. Charged hourly by
 * `billing.hourly` on every space with `complete` backups. $0.01/GB/mo
 * is the conservative default (≈$0.05/mo for a 5 GB backup) — covers
 * S3 cost + margin.
 */
backupStorageRatePerGbPerMonth: numeric("backup_storage_rate_per_gb_per_month", {
  precision: 12,
  scale: 6,
})
  .notNull()
  .default("0.01"),
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add db/schema/platform-settings.ts
git commit -m "feat(settings): add backup_storage_rate_per_gb_per_month"
```

### Task 0.5: Create snapshot_exports schema

**Files:**
- Create: `db/schema/snapshot-exports.ts`
- Modify: `db/schema/index.ts` (add re-export)

- [ ] **Step 1: Write the table file**

```typescript
import { createId } from "@paralleldrive/cuid2"
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { cubeSnapshots } from "./snapshots"
import { spaces } from "./spaces"
import { storageBackends } from "./storage-backends"
import { user } from "./auth"

export const snapshotExportStatus = pgEnum("snapshot_export_status", [
  "pending",
  "materializing",
  "ready",
  "failed",
  "expired",
])

/**
 * One row per customer-initiated snapshot export-as-.cube. The worker
 * builds the archive on the source cube's host (restic dump | zstd | tar),
 * uploads to `<env>/exports/{spaceId}/{exportId}.cube`, emails a 24h
 * presigned link. The reaper deletes the S3 object and the row after
 * `expiresAt`.
 */
export const snapshotExports = pgTable(
  "snapshot_exports",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => cubeSnapshots.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    status: snapshotExportStatus("status").notNull().default("pending"),
    /** S3 object key under the backend's bucket. */
    storagePath: text("storage_path"),
    storageBackendId: text("storage_backend_id").references(
      () => storageBackends.id,
      { onDelete: "set null" }
    ),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Presigned URL emailed to the customer. Stored for re-send on resend request. */
    presignedUrl: text("presigned_url"),
    /** Wall-clock expiry — the reaper deletes at or after this timestamp. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    requestedBy: text("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    failureReason: text("failure_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("snapshot_exports_status_expires_idx").on(t.status, t.expiresAt),
    index("snapshot_exports_snapshot_id_idx").on(t.snapshotId),
  ]
)
```

- [ ] **Step 2: Add re-export to schema index**

Open `db/schema/index.ts` and add `export * from "./snapshot-exports"` in alphabetical order with the other exports.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add db/schema/snapshot-exports.ts db/schema/index.ts
git commit -m "feat(snapshots): add snapshot_exports table for .cube downloads"
```

### Task 0.6: Generate migration

**Files:**
- Create: `db/migrations/0055_*.sql` (drizzle-kit assigns the name)

- [ ] **Step 1: Generate**

Run: `pnpm db:generate`
Expected: creates `db/migrations/0055_<random>.sql` with `ALTER TABLE plans ADD COLUMN …`, `ALTER TABLE cubes ADD COLUMN …`, `CREATE TYPE snapshot_kind …`, `ALTER TABLE cube_snapshots ADD COLUMN kind …`, `ALTER TABLE platform_settings ADD COLUMN …`, `CREATE TYPE snapshot_export_status …`, `CREATE TABLE snapshot_exports …`, `CREATE INDEX …`. Also generates `meta/0055_snapshot.json` + `meta/_journal.json` entry. Per Rule 6 — do NOT hand-edit these.

- [ ] **Step 2: Inspect the generated SQL**

Run: `ls -lt db/migrations/*.sql | head -3 && cat db/migrations/0055_*.sql`
Expected: contains the 5 new plan columns, 2 new cubes columns, the snapshot_kind enum + cube_snapshots.kind column, the backup_storage_rate_per_gb_per_month column, the snapshot_exports table.

- [ ] **Step 3: Apply locally**

Run: `pnpm db:migrate`
Expected: `migrations applied`. Connect to local DB, run `\d plans` and confirm new columns present.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0055_*.sql db/migrations/meta/
git commit -m "feat(db): migration 0055 snapshot overhaul schema"
```

### Task 0.7: Append seed UPDATEs + kind backfill to migration 0055

Per Rule 6, drizzle-kit owns the journal and snapshot files. SQL-only edits to a freshly-generated migration ARE permitted (and encouraged for data migrations that need to ship in the same deploy as the schema change). Append the data migration to the bottom of the migration 0055 SQL file produced in Task 0.6.

**Files:**
- Modify: `db/migrations/0055_*.sql` (the file generated in Task 0.6 — append only, leave the auto-generated DDL untouched at top)

- [ ] **Step 1: Append the seed + backfill UPDATEs**

Open the file generated by Task 0.6 (e.g. `db/migrations/0055_<random>.sql`) and append at the bottom, AFTER the auto-generated DDL:

```sql
--> statement-breakpoint
-- Seed snapshot cadence / retention / manual cap on the four bundled plans.
-- Idempotent: WHERE id = '...' touches each row only once.
-- Trial: no snapshots at all.
-- Starter: every 12h, keep 4 recent + 7 daily + 1 weekly, 1 manual.
-- Pro: every 6h, keep 8 recent + 7 daily + 2 weekly, 2 manual.
-- Business: every 4h, keep 12 recent + 14 daily + 4 weekly, 4 manual.
UPDATE plans SET
  auto_snapshot_cadence_hours = NULL,
  auto_snapshot_keep_last = 0,
  auto_snapshot_keep_daily = 0,
  auto_snapshot_keep_weekly = 0,
  max_manual_snapshots_per_cube = 0
WHERE id = 'plan_trial';
--> statement-breakpoint
UPDATE plans SET
  auto_snapshot_cadence_hours = 12,
  auto_snapshot_keep_last = 4,
  auto_snapshot_keep_daily = 7,
  auto_snapshot_keep_weekly = 1,
  max_manual_snapshots_per_cube = 1
WHERE id = 'plan_starter';
--> statement-breakpoint
UPDATE plans SET
  auto_snapshot_cadence_hours = 6,
  auto_snapshot_keep_last = 8,
  auto_snapshot_keep_daily = 7,
  auto_snapshot_keep_weekly = 2,
  max_manual_snapshots_per_cube = 2
WHERE id = 'plan_pro';
--> statement-breakpoint
UPDATE plans SET
  auto_snapshot_cadence_hours = 4,
  auto_snapshot_keep_last = 12,
  auto_snapshot_keep_daily = 14,
  auto_snapshot_keep_weekly = 4,
  max_manual_snapshots_per_cube = 4
WHERE id = 'plan_business';
--> statement-breakpoint
-- Backfill cube_snapshots.kind from the legacy is_automatic boolean.
-- Idempotent: only touches rows still on the default ('manual').
UPDATE cube_snapshots SET kind = 'auto'
WHERE is_automatic = true AND kind = 'manual';
```

The `--> statement-breakpoint` marker is required by drizzle-kit's SQL splitter — it tells the migrator each statement is independent (don't wrap them in one BEGIN/COMMIT, which is important for the ALTER TYPE + UPDATE ordering).

- [ ] **Step 2: Drop the migration record + reapply**

Because 0055 was already applied by Task 0.6, the migrator will skip it. Roll back the row and reapply:

```bash
psql "$DATABASE_URL" -c "DELETE FROM __drizzle_migrations WHERE hash = (SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1);"
pnpm db:migrate
```

Verify:
```bash
psql "$DATABASE_URL" -c "SELECT id, auto_snapshot_cadence_hours, auto_snapshot_keep_last, auto_snapshot_keep_daily, auto_snapshot_keep_weekly, max_manual_snapshots_per_cube FROM plans ORDER BY sort_order;"
psql "$DATABASE_URL" -c "SELECT kind, count(*) FROM cube_snapshots GROUP BY kind;"
```
Expected: trial=NULL/0/0/0/0, starter=12/4/7/1/1, pro=6/8/7/2/2, business=4/12/14/4/4. cube_snapshots.kind counts match the prior `is_automatic=true` distribution (or table is empty in fresh dev).

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0055_*.sql
git commit -m "feat(db): seed snapshot config + backfill kind"
```

---

# PHASE 1 — Manual cap enforcement + kind tracking

Goal: customer-initiated snapshot creation respects the per-plan manual cap. Trial = 0 manual snapshots. The new `kind` column is written end-to-end.

### Task 1.1: Extend EffectiveLimits with snapshot fields

**Files:**
- Modify: `lib/plan/limits.ts`

- [ ] **Step 1: Add fields to EffectiveLimits**

In the `EffectiveLimits` interface (around line 47), add right after `maxVcpus`:

```typescript
// Per-plan snapshot config. Plans below provide null/0 → snapshots off.
maxManualSnapshotsPerCube: number;
autoSnapshotCadenceHours: number | null;
autoSnapshotKeepLast: number;
autoSnapshotKeepDaily: number;
autoSnapshotKeepWeekly: number;
```

- [ ] **Step 2: Update effectiveLimits() merger**

In the returned object literal in `effectiveLimits()`, add:

```typescript
maxManualSnapshotsPerCube: plan.maxManualSnapshotsPerCube,
autoSnapshotCadenceHours: plan.autoSnapshotCadenceHours,
autoSnapshotKeepLast: plan.autoSnapshotKeepLast,
autoSnapshotKeepDaily: plan.autoSnapshotKeepDaily,
autoSnapshotKeepWeekly: plan.autoSnapshotKeepWeekly,
```

(These are plan-only — no per-space overrides for now. If overrides become needed later, add `override_*` columns following the existing `override_max_backups` pattern.)

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

### Task 1.2: Write failing test for assertCanCreateManualSnapshot

**Files:**
- Create: `tests/lib/plan/snapshot-limits.test.ts`
- Test: `tests/lib/plan/snapshot-limits.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it } from "vitest"
import {
  assertCanCreateManualSnapshot,
  assertCanCreateBackup,
} from "@/lib/plan/snapshot-limits"
import type { EffectiveLimits } from "@/lib/plan/limits"

const baseLimits = {
  label: "TestPlan",
  maxConcurrentCubes: 10,
  maxVcpus: 8,
  maxRamMb: 16384,
  maxDiskGb: 100,
  maxSeats: 5,
  maxBackups: 10,
  maxDomains: 5,
  maxManualSnapshotsPerCube: 2,
  autoSnapshotCadenceHours: 6,
  autoSnapshotKeepLast: 8,
  autoSnapshotKeepDaily: 7,
  autoSnapshotKeepWeekly: 2,
  allowTopup: true,
  allowOverage: true,
  includedCreditUsd: 0,
} satisfies EffectiveLimits

describe("assertCanCreateManualSnapshot", () => {
  it("rejects when manual cap is 0 (Trial)", () => {
    const result = assertCanCreateManualSnapshot(
      { ...baseLimits, maxManualSnapshotsPerCube: 0 },
      0
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/does not include manual snapshots/i)
    }
  })

  it("rejects when at cap", () => {
    const result = assertCanCreateManualSnapshot(baseLimits, 2)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/at most 2 manual snapshots/i)
    }
  })

  it("allows under cap", () => {
    expect(assertCanCreateManualSnapshot(baseLimits, 1)).toEqual({ ok: true })
  })
})

describe("assertCanCreateBackup", () => {
  it("rejects when maxBackups is 0 (Trial)", () => {
    expect(
      assertCanCreateBackup({ ...baseLimits, maxBackups: 0 }, 0).ok
    ).toBe(false)
  })

  it("rejects at cap", () => {
    expect(assertCanCreateBackup({ ...baseLimits, maxBackups: 3 }, 3).ok).toBe(
      false
    )
  })

  it("allows under cap", () => {
    expect(assertCanCreateBackup(baseLimits, 5)).toEqual({ ok: true })
  })

  it("allows when maxBackups is null (unlimited)", () => {
    expect(
      assertCanCreateBackup({ ...baseLimits, maxBackups: null }, 999).ok
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/plan/snapshot-limits.test.ts`
Expected: FAIL — module `@/lib/plan/snapshot-limits` does not exist.

### Task 1.3: Implement assertCanCreateManualSnapshot + assertCanCreateBackup

**Files:**
- Create: `lib/plan/snapshot-limits.ts`

- [ ] **Step 1: Write the module**

```typescript
import { and, count, eq, ne } from "drizzle-orm"
import { cubeSnapshots } from "@/db/schema"
import { db } from "@/lib/db"
import type { EffectiveLimits, LimitCheck } from "@/lib/plan/limits"

/**
 * Block manual snapshot creation when the cube is at its plan's manual cap.
 * Trial plans (cap=0) get a friendlier "upgrade your plan" message.
 */
export function assertCanCreateManualSnapshot(
  limits: EffectiveLimits,
  currentManualCount: number
): LimitCheck {
  if (limits.maxManualSnapshotsPerCube <= 0) {
    return {
      ok: false,
      error: `The ${limits.label} plan does not include manual snapshots. Upgrade your plan to create one.`,
    }
  }
  if (currentManualCount >= limits.maxManualSnapshotsPerCube) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${limits.maxManualSnapshotsPerCube} manual snapshot${limits.maxManualSnapshotsPerCube === 1 ? "" : "s"} per Cube. Delete an existing manual snapshot first.`,
    }
  }
  return { ok: true }
}

/**
 * Block backup creation (pre-deletion OR promote-from-snapshot) when the
 * space is at its plan's backup cap. Mirrors `assertCanKeepBackupV2` but
 * uses the same wording for both entry points.
 */
export function assertCanCreateBackup(
  limits: EffectiveLimits,
  currentBackupCount: number
): LimitCheck {
  if (limits.maxBackups === null) {
    return { ok: true }
  }
  if (limits.maxBackups <= 0) {
    return {
      ok: false,
      error: `The ${limits.label} plan does not include backups. Upgrade your plan to keep one.`,
    }
  }
  if (currentBackupCount >= limits.maxBackups) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${limits.maxBackups} backup${limits.maxBackups === 1 ? "" : "s"}. Delete an existing backup, or upgrade your plan.`,
    }
  }
  return { ok: true }
}

/**
 * DB query: count this cube's non-failed manual snapshots. Used by
 * `assertCanCreateManualSnapshot`'s caller.
 */
export async function countManualSnapshotsForCube(
  cubeId: string
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cubeSnapshots)
    .where(
      and(
        eq(cubeSnapshots.cubeId, cubeId),
        eq(cubeSnapshots.kind, "manual"),
        ne(cubeSnapshots.status, "failed")
      )
    )
  return Number(row?.n ?? 0)
}

/**
 * DB query: count this cube's non-failed auto snapshots. Used by the
 * auto-prune handler to decide whether to call restic forget.
 */
export async function countAutoSnapshotsForCube(
  cubeId: string
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cubeSnapshots)
    .where(
      and(
        eq(cubeSnapshots.cubeId, cubeId),
        eq(cubeSnapshots.kind, "auto"),
        eq(cubeSnapshots.status, "complete")
      )
    )
  return Number(row?.n ?? 0)
}
```

- [ ] **Step 2: Re-run the test**

Run: `pnpm vitest run tests/lib/plan/snapshot-limits.test.ts`
Expected: 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/plan/snapshot-limits.ts tests/lib/plan/snapshot-limits.test.ts lib/plan/limits.ts
git commit -m "feat(plan): manual snapshot + backup creation guards"
```

### Task 1.4: Wire createSnapshot server action to new guard

**Files:**
- Modify: `app/actions/snapshots.ts`

- [ ] **Step 1: Replace the legacy manual cap check**

Find the block starting `// Limit manual snapshots per cube (configurable via Orbit)` (around line 81) and replace through `if ((manualCount?.count ?? 0) >= maxManual) {…}` with:

```typescript
// Per-plan manual snapshot cap. Counted across non-failed `kind='manual'`
// snapshots — auto snapshots and pinned-from-auto snapshots both count.
const limits = await loadEffectiveLimits(spaceId)
const manualCount = await countManualSnapshotsForCube(cubeId)
const capCheck = assertCanCreateManualSnapshot(limits, manualCount)
if (!capCheck.ok) {
  return { error: capCheck.error }
}
```

Update the imports at top of file:

```typescript
import { loadEffectiveLimits } from "@/lib/plan/limits"
import {
  assertCanCreateManualSnapshot,
  countManualSnapshotsForCube,
} from "@/lib/plan/snapshot-limits"
```

Remove the unused `getSnapshotConfig` import.

- [ ] **Step 2: Write `kind: 'manual'` on insert**

In the insert block (around line 99), add `kind: "manual"` after `createdBy`:

```typescript
const [snapshot] = await db
  .insert(schema.cubeSnapshots)
  .values({
    cubeId,
    spaceId,
    name: trimmedName,
    status: "pending",
    createdBy: session.user.id,
    kind: "manual",
  })
  .returning()
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Manual smoke test**

```bash
pnpm dev
```
Sign in as a Trial-plan user, navigate to a cube's Snapshots tab, click "Create Snapshot". Expected: server error "The Trial plan does not include manual snapshots…". Switch to Starter (via Orbit), create 1 manual snapshot — succeeds. Try a 2nd — fails with "at most 1 manual snapshot…".

- [ ] **Step 5: Commit**

```bash
git add app/actions/snapshots.ts
git commit -m "feat(snapshots): enforce per-plan manual snapshot cap"
```

### Task 1.5: Block deletion of auto snapshots from the customer

**Files:**
- Modify: `app/actions/snapshots.ts`

- [ ] **Step 1: Find `deleteSnapshot` action**

Run: `grep -n "deleteSnapshot\|kind" app/actions/snapshots.ts | head`

- [ ] **Step 2: Add guard inside the existing snapshot-loaded block**

After the snapshot is loaded (look for `if (snapshot.status === "creating")` or similar), insert:

```typescript
if (snapshot.kind === "auto") {
  return {
    error:
      "Auto snapshots are system-managed and cannot be deleted directly. Pin this snapshot to convert it to a manual snapshot, then delete it.",
  }
}
```

- [ ] **Step 3: Run typecheck + manual test**

Run: `pnpm typecheck && pnpm dev`
Trigger a manual auto-tagged row in dev (via psql: `UPDATE cube_snapshots SET kind='auto' WHERE id='…';`), then attempt deletion from the UI. Expected: inline error.

- [ ] **Step 4: Commit**

```bash
git add app/actions/snapshots.ts
git commit -m "feat(snapshots): refuse customer deletion of auto snapshots"
```

### Task 1.6: Block backup creation per plan

**Files:**
- Modify: `app/actions/cubes.ts` (the `deleteCube` action's `preserveBackup` branch)
- Modify: `app/actions/backups.ts` (`createBackupFromCube` — STAYS for now, will be deleted in Phase 6; but gate it on plan)

- [ ] **Step 1: Find the `preserveBackup` branch in deleteCube**

Run: `grep -n "preserveBackup\|assertCanKeepBackup" app/actions/cubes.ts | head`

- [ ] **Step 2: Add plan check before enqueueing pre-deletion backup**

Inside the `if (preserveBackup) {` block, BEFORE the existing `assertCanKeepBackupV2` (or where it would fit), add the new guard. The existing `assertCanKeepBackupV2` already covers the cap; the issue is whether `maxBackups === 0` (Trial) returns a clear error. Verify by reading the existing assertion — if it does, no change is needed here. Document the existing behavior with a comment:

```typescript
// Trial plans have maxBackups = 0; assertCanKeepBackupV2 returns the
// "does not include Cube backups" error in that branch.
```

- [ ] **Step 3: Same check in createBackupFromCube** (still alive in Phase 1; deleted in Phase 6)

Run: `grep -n "assertCanKeepBackup\|maxBackups" app/actions/backups.ts | head`
Verify the existing guard. If absent, add it inside the per-space-locked transaction.

- [ ] **Step 4: Manual smoke test**

In dev, on a Trial-plan space, attempt cube delete with "Preserve backup" checked. Expected: error.

- [ ] **Step 5: Commit only if changes made**

```bash
git add app/actions/cubes.ts app/actions/backups.ts
git commit -m "feat(backups): document/verify per-plan backup gating"
```

(Skip commit if nothing changed — the existing assertCanKeepBackupV2 already handles it.)

---

# PHASE 2 — Snapshot export as .cube (download)

Goal: customer-initiated snapshot export materializes a `.cube` on the host, uploads to a dedicated S3 prefix, emails a 24h presigned link. Reaper deletes expired exports.

### Task 2.1: Add JOB_NAMES + payload types

**Files:**
- Modify: `lib/worker/job-types.ts`

- [ ] **Step 1: Append new entries to the JOB_NAMES constant**

Locate the `export const JOB_NAMES = { … } as const` block. Add:

```typescript
SNAPSHOT_EXPORT: "snapshot.export",
SNAPSHOT_EXPORT_REAP: "snapshot.export-reap",
SNAPSHOT_PROMOTE_TO_BACKUP: "snapshot.promote-to-backup",
CUBE_FROM_SNAPSHOT: "cube.from-snapshot",
SNAPSHOT_SCHEDULER: "snapshot.scheduler",
SNAPSHOT_AUTO_PRUNE: "snapshot.auto-prune",
```

REMOVE the existing `SNAPSHOT_AUTO: "snapshot.auto",` entry (its handler is being replaced).

- [ ] **Step 2: Add payload types at the bottom of the file**

```typescript
export type SnapshotExportPayload = {
  exportId: string
  snapshotId: string
  cubeId: string
  spaceId: string
  serverId: string
}

export type SnapshotPromoteToBackupPayload = {
  snapshotId: string
  cubeId: string
  spaceId: string
  serverId: string
  backupId: string
  backupName: string
}

export type CubeFromSnapshotPayload = {
  // The cube row is pre-created (status="pending") before enqueue.
  cubeId: string
  spaceId: string
  serverId: string
  // The source snapshot to dump from.
  sourceSnapshotId: string
  sourceCubeId: string
  // SSH key the new cube boots with.
  sshPublicKey: string
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: TypeScript errors on every file that imports `JOB_NAMES.SNAPSHOT_AUTO` — these will be fixed as we delete or rewire those callers.

- [ ] **Step 4: Don't commit yet** (typecheck is intentionally broken until next tasks fix the callers)

### Task 2.2: Add queue policies

**Files:**
- Modify: `lib/worker/ensure-queues.ts`

- [ ] **Step 1: Add entries to QUEUE_OPTIONS**

Inside the `QUEUE_OPTIONS` object:

```typescript
// Snapshot export: materialize + zstd + tar + upload + presign + email.
// Long-running for multi-GB rootfs; one in flight per snapshot via
// singletonKey at enqueue time.
[JOB_NAMES.SNAPSHOT_EXPORT]: {
  retryLimit: 1,
  retryDelay: 120,
  expireInSeconds: 3600, // 1h budget
  policy: "exclusive",
},
// Snapshot export reaper: scans `snapshot_exports` for expired rows
// every hour. Exclusive prevents tick stacking.
[JOB_NAMES.SNAPSHOT_EXPORT_REAP]: {
  retryLimit: 1,
  expireInSeconds: 600,
  policy: "exclusive",
},
// Promote snapshot to backup: same materialize pipeline.
[JOB_NAMES.SNAPSHOT_PROMOTE_TO_BACKUP]: {
  retryLimit: 1,
  retryDelay: 120,
  expireInSeconds: 3600,
  policy: "exclusive",
},
// Clone snapshot into a new cube — restic dump straight to allocated server.
[JOB_NAMES.CUBE_FROM_SNAPSHOT]: {
  retryLimit: 1,
  retryDelay: 120,
  expireInSeconds: 3600,
},
// Auto-snapshot scheduler: runs hourly; reads every running/sleeping cube
// + its plan + last_auto_snapshot_at. Idempotent — re-running same hour
// no-ops via the cadence check.
[JOB_NAMES.SNAPSHOT_SCHEDULER]: {
  retryLimit: 1,
  expireInSeconds: 600,
  policy: "exclusive",
},
// Daily auto-snapshot pruner: per-cube `restic forget` with the plan's
// retention buckets.
[JOB_NAMES.SNAPSHOT_AUTO_PRUNE]: {
  retryLimit: 1,
  expireInSeconds: 3600,
  policy: "exclusive",
},
```

REMOVE the `[JOB_NAMES.SNAPSHOT_AUTO]: …` entry if present.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: still errors on legacy SNAPSHOT_AUTO references — to be cleaned next.

### Task 2.3: Write the snapshot-export handler

**Files:**
- Create: `lib/worker/handlers/snapshot-export.ts`

- [ ] **Step 1: Write the handler**

```typescript
import { eq } from "drizzle-orm"
import type { Job } from "pg-boss"
import {
  cubeSnapshots,
  cubes,
  lifecycleLogs,
  snapshotExports,
} from "@/db/schema"
import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { enqueueEmail } from "@/lib/email"
import { getSpaceOwner } from "@/lib/email/helpers"
import { snapshotExportReadyTemplate } from "@/lib/email/templates/snapshot-export-ready"
import { env } from "@/lib/env"
import { connectToServer, execCommand, shellEscape } from "@/lib/ssh"
import { adjustBackendUsage, selectBackend } from "@/lib/storage/backends"
import { buildCubeArchive } from "@/lib/storage/cube-archive"
import { presignBackupDownloadUrl } from "@/lib/storage/cube-archive/presign"
import { loadResticRepoConfig } from "@/lib/storage/restic"
import { s3HostUpload } from "@/lib/storage/s3-transfer"
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat"
import { JobLogger } from "@/lib/worker/job-log"
import type { SnapshotExportPayload } from "@/lib/worker/job-types"

const EXPORT_TTL_HOURS = 24

async function handleSnapshotExportJob(
  job: Job<SnapshotExportPayload>
): Promise<void> {
  const { exportId, snapshotId, cubeId, spaceId, serverId } = job.data
  const log = new JobLogger(job.id, "snapshot.export", "cube", cubeId)
  await log.info(`Snapshot export started (exportId=${exportId})`)

  // 1. Claim atomically pending → materializing.
  const [claimed] = await db
    .update(snapshotExports)
    .set({ status: "materializing" })
    .where(eq(snapshotExports.id, exportId))
    .returning()
  if (!claimed || claimed.status !== "materializing") {
    await log.warn(`Export ${exportId} no longer pending, skipping`)
    return
  }

  // 2. Load snapshot + cube + repo config.
  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, snapshotId),
  })
  if (!snapshot || snapshot.status !== "complete" || !snapshot.storagePath) {
    await markExportFailed(
      exportId,
      "Source snapshot is not in a complete state"
    )
    return
  }
  const cube = await db.query.cubes.findFirst({ where: eq(cubes.id, cubeId) })
  if (!cube) {
    await markExportFailed(exportId, "Source cube was deleted")
    return
  }
  if (!snapshot.storageBackendId) {
    await markExportFailed(
      exportId,
      "Source snapshot has no storage backend reference"
    )
    return
  }
  const { config: repoConfig } = await loadResticRepoConfig(
    cubeId,
    snapshot.storageBackendId
  )

  // 3. Pick a backend for the export object. Reuse selectBackend so it
  //    lands on the one with most free capacity (export storage is
  //    short-lived; choose by current capacity, not pinned).
  const destBackend = await selectBackend()
  if (!destBackend) {
    await markExportFailed(
      exportId,
      "No active storage backend available for export"
    )
    return
  }

  // 4. Open SSH to the source cube's host.
  const { client } = await connectToServer(serverId)
  const workingDir = `/tmp/krova-export-${exportId}`

  try {
    await withCubeHeartbeat(cubeId, async () => {
      // 4a. Make working dir.
      await execCommand(
        client,
        `mkdir -p ${shellEscape(workingDir)}`,
        10_000
      )

      // 4b. restic dump the rootfs from the snapshot into the workdir.
      //     `restic dump <snap> rootfs.ext4` writes to stdout — we
      //     redirect to a file. This is bulk read from S3 → host disk;
      //     the per-cube restic cache speeds chunk fetches.
      await log.step("Restic dump rootfs", async () => {
        const env_ = resticEnvInline(repoConfig)
        const cmd = `${env_} restic -o s3.bucket-lookup=path dump ${shellEscape(snapshot.storagePath!)} rootfs.ext4 > ${shellEscape(workingDir + "/rootfs.ext4")}`
        const r = await execCommand(client, cmd, 1_800_000) // 30 min
        if (r.exitCode !== 0) {
          throw new Error(`restic dump failed (exit ${r.exitCode}): ${r.stderr.slice(0, 500)}`)
        }
      })

      // 4c. Build .cube archive. Reuses buildCubeArchive (compress +
      //     manifest + tar) so the format matches what cube.import-rootfs
      //     accepts on the way back in.
      const archiveResult = await log.step("Build .cube archive", async () => {
        return buildCubeArchive(client, {
          workingDir,
          rootfsFilename: "rootfs.ext4",
          archiveFilename: `${exportId}.cube`,
          manifestSource: {
            source: {
              cubeId,
              cubeName: cube.name,
              spaceId,
              // platformVersion is optional — leave null. Matches what
              // backup-create.ts does today (no version tagging).
              platformVersion: null,
            },
            config: {
              vcpus: cube.vcpus,
              ramMb: cube.ramMb,
              diskLimitGb: cube.diskLimitGb,
              imageId: cube.imageId,
              userData: cube.userData ?? null,
              kernelArgs: null,
            },
            exportedAt: new Date(),
          },
        })
      })

      // 4d. Upload to S3. Env prefix matches the existing pattern in
      //     backup-create.ts:255-257 — `production` in prod, `development`
      //     otherwise. Mirror that so audits/orphan-sweeps stay consistent.
      const envPrefix = env.NODE_ENV === "production" ? "production" : "development"
      const s3Key = `${envPrefix}/exports/${spaceId}/${exportId}.cube`
      await log.step("Upload to S3", async () => {
        await s3HostUpload(client, {
          backend: destBackend,
          localPath: archiveResult.archivePath,
          s3Key,
        })
      })

      // 4e. Clean local archive.
      await execCommand(
        client,
        `rm -rf ${shellEscape(workingDir)}`,
        30_000
      )

      // 4f. Presign 24h URL.
      const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 3600 * 1000)
      const presignedUrl = await presignBackupDownloadUrl(
        destBackend,
        s3Key,
        EXPORT_TTL_HOURS * 3600
      )

      // 4g. Record + email.
      await db
        .update(snapshotExports)
        .set({
          status: "ready",
          storagePath: s3Key,
          storageBackendId: destBackend.id,
          sizeBytes: archiveResult.archiveSizeBytes,
          presignedUrl,
          expiresAt,
          completedAt: new Date(),
        })
        .where(eq(snapshotExports.id, exportId))

      await adjustBackendUsage(destBackend.id, archiveResult.archiveSizeBytes)

      const owner = await getSpaceOwner(spaceId)
      if (owner) {
        const { html, text } = await snapshotExportReadyTemplate({
          userName: owner.name,
          spaceName: owner.spaceName,
          snapshotName: snapshot.name,
          cubeName: cube.name,
          downloadUrl: presignedUrl,
          expiresAt,
          sizeBytes: archiveResult.archiveSizeBytes,
        })
        await enqueueEmail({
          to: owner.email,
          subject: `Your snapshot "${snapshot.name}" is ready to download`,
          html,
          text,
        })
      }

      await db.insert(lifecycleLogs).values({
        entityType: "cube",
        entityId: cubeId,
        message: `Snapshot "${snapshot.name}" exported — download link valid for 24h`,
      })

      audit({
        action: "snapshot.export_ready",
        category: "cube",
        actorType: "system",
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `Snapshot export ready (size=${archiveResult.archiveSizeBytes})`,
        metadata: { exportId, snapshotId, sizeBytes: archiveResult.archiveSizeBytes },
        source: "worker",
      })

      await log.info(`Export ready — link expires ${expiresAt.toISOString()}`)
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await log.error(`Export failed: ${reason}`)
    // Best-effort host cleanup.
    await execCommand(client, `rm -rf ${shellEscape(workingDir)}`, 30_000).catch(
      () => {}
    )
    await markExportFailed(exportId, reason)
  } finally {
    client.end()
  }
}

async function markExportFailed(
  exportId: string,
  reason: string
): Promise<void> {
  await db
    .update(snapshotExports)
    .set({ status: "failed", failureReason: reason.slice(0, 500) })
    .where(eq(snapshotExports.id, exportId))
}

// Inline-env helper for restic dump — same pattern as resticEnv() in
// lib/storage/restic/commands.ts but exposed here because dump uses
// shell redirection and needs the env on the bash line.
function resticEnvInline(conn: {
  repoUrl: string
  repoPassword: string
  accessKeyId: string
  secretAccessKey: string
}): string {
  return [
    `RESTIC_REPOSITORY=${shellEscape(conn.repoUrl)}`,
    `RESTIC_PASSWORD=${shellEscape(conn.repoPassword)}`,
    `AWS_ACCESS_KEY_ID=${shellEscape(conn.accessKeyId)}`,
    `AWS_SECRET_ACCESS_KEY=${shellEscape(conn.secretAccessKey)}`,
    "RESTIC_PROGRESS_FPS=0",
    "RESTIC_CACHE_DIR=/var/lib/krova/restic-cache",
  ].join(" ")
}

export async function handleSnapshotExport(
  jobs: Job<SnapshotExportPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleSnapshotExportJob(job)
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: errors on missing `snapshotExportReadyTemplate` + `presignBackupDownloadUrl` — fix in next steps. May also error on `env.NEXT_PUBLIC_APP_VERSION` and `env.KROVA_ENV` — replace with whatever the existing handlers use for those (grep `KROVA_ENV` / `process.env.KROVA_ENV` to find the canonical reference).

- [ ] **Step 3: Verify presign helper exists**

Run: `grep -n "presignBackupDownloadUrl\|getPresignedUrl\|signGetObject" lib/storage/`
Expected: an existing helper in `lib/storage/cube-archive/presign.ts`. If the name differs, update the import in step 1.

### Task 2.4: Write the snapshot-export-ready email template

**Files:**
- Create: `lib/email/templates/snapshot-export-ready.ts`
- Create: `lib/email/components/snapshot-export-ready.tsx`

- [ ] **Step 1: Find a reference template + component to copy**

Run: `cat lib/email/templates/credit-granted.ts lib/email/components/credit-granted.tsx`

- [ ] **Step 2: Write the React Email component**

```tsx
// lib/email/components/snapshot-export-ready.tsx
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components"

export interface SnapshotExportReadyEmailProps {
  userName: string
  spaceName: string
  snapshotName: string
  cubeName: string
  downloadUrl: string
  expiresAtIso: string
  sizeMb: string
  productName: string
  logoUrl: string
}

export function SnapshotExportReadyEmail({
  userName,
  spaceName,
  snapshotName,
  cubeName,
  downloadUrl,
  expiresAtIso,
  sizeMb,
  productName,
  logoUrl,
}: SnapshotExportReadyEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your snapshot "{snapshotName}" is ready to download</Preview>
      <Body style={{ backgroundColor: "#fafafa", fontFamily: "sans-serif" }}>
        <Container style={{ backgroundColor: "#fff", padding: "32px", borderRadius: "8px" }}>
          <Img src={logoUrl} alt={productName} width="120" />
          <Heading>Your snapshot is ready</Heading>
          <Text>Hi {userName},</Text>
          <Text>
            The snapshot <strong>{snapshotName}</strong> of cube{" "}
            <strong>{cubeName}</strong> in <strong>{spaceName}</strong> has been
            packaged as a <code>.cube</code> archive ({sizeMb} MB) and is ready
            to download.
          </Text>
          <Section style={{ textAlign: "center", margin: "32px 0" }}>
            <Button
              href={downloadUrl}
              style={{
                backgroundColor: "#000",
                color: "#fff",
                padding: "12px 24px",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              Download snapshot
            </Button>
          </Section>
          <Text>
            <strong>This link expires {expiresAtIso}.</strong> After 24 hours,
            the archive is deleted from our servers — request a new export from
            the dashboard if you need it again.
          </Text>
          <Hr />
          <Text style={{ fontSize: "12px", color: "#888" }}>
            You can re-import this archive as a new cube via the "Import Cube"
            flow in any space.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
```

- [ ] **Step 3: Write the template wrapper**

```typescript
// lib/email/templates/snapshot-export-ready.ts
import { createElement } from "react"
import { SnapshotExportReadyEmail } from "@/lib/email/components/snapshot-export-ready"
import { getPlatformBranding } from "@/lib/email/helpers"
import { renderEmailTemplate } from "@/lib/email/renderer"

export interface SnapshotExportReadyOptions {
  userName: string
  spaceName: string
  snapshotName: string
  cubeName: string
  downloadUrl: string
  expiresAt: Date
  sizeBytes: number
  productName?: string
}

export async function snapshotExportReadyTemplate({
  userName,
  spaceName,
  snapshotName,
  cubeName,
  downloadUrl,
  expiresAt,
  sizeBytes,
  productName,
}: SnapshotExportReadyOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding()
  const name = productName ?? branding.productName

  const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1)
  const expiresAtIso = expiresAt.toUTCString()

  const html = await renderEmailTemplate(
    createElement(SnapshotExportReadyEmail, {
      userName,
      spaceName,
      snapshotName,
      cubeName,
      downloadUrl,
      expiresAtIso,
      sizeMb,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  )

  const text = `Hi ${userName},

Your snapshot "${snapshotName}" of cube "${cubeName}" in ${spaceName} is ready to download.
Archive size: ${sizeMb} MB

Download: ${downloadUrl}

⚠️ This link expires ${expiresAtIso}.
After 24 hours, the archive is deleted from our servers — request a new export from the dashboard if you need it again.

— ${name}`

  return { html, text }
}
```

- [ ] **Step 4: Verify the email renders**

Run: `pnpm tsx scripts/email-render-check.ts snapshot-export-ready` (if the script supports passing a template name; otherwise just `pnpm tsx scripts/email-render-check.ts` and confirm no errors).

- [ ] **Step 5: Commit Phase 2 progress so far**

```bash
git add lib/worker/job-types.ts lib/worker/ensure-queues.ts lib/worker/handlers/snapshot-export.ts lib/email/templates/snapshot-export-ready.ts lib/email/components/snapshot-export-ready.tsx
git commit -m "feat(snapshots): snapshot.export handler + email template"
```

### Task 2.5: Write the export reaper

**Files:**
- Create: `lib/worker/handlers/snapshot-export-reap.ts`

- [ ] **Step 1: Write the handler**

```typescript
import { and, eq, lt } from "drizzle-orm"
import type { Job } from "pg-boss"
import { snapshotExports, storageBackends } from "@/db/schema"
import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { decryptValue } from "@/lib/encrypt"
import { deleteObject } from "@/lib/storage/s3-direct"

/**
 * Hourly cron: delete expired snapshot exports from S3 + DB.
 *
 * - rows with status='ready' AND expiresAt < now() → delete S3 object,
 *   set status='expired', adjust backend usage.
 * - rows with status='failed' older than 7 days → hard-delete the row.
 */
export async function handleSnapshotExportReap(_jobs: Job[]): Promise<void> {
  void _jobs
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)

  // 1. Expire ready rows past TTL.
  const expired = await db
    .select({
      id: snapshotExports.id,
      storagePath: snapshotExports.storagePath,
      storageBackendId: snapshotExports.storageBackendId,
      sizeBytes: snapshotExports.sizeBytes,
    })
    .from(snapshotExports)
    .where(
      and(
        eq(snapshotExports.status, "ready"),
        lt(snapshotExports.expiresAt, now)
      )
    )

  for (const row of expired) {
    if (!row.storagePath || !row.storageBackendId) {
      // Defensive — should never happen for `ready` rows but be tolerant.
      await db
        .update(snapshotExports)
        .set({ status: "expired" })
        .where(eq(snapshotExports.id, row.id))
      continue
    }
    try {
      const [backend] = await db
        .select()
        .from(storageBackends)
        .where(eq(storageBackends.id, row.storageBackendId))
        .limit(1)
      if (backend) {
        await deleteObject({
          endpoint: backend.endpoint,
          region: backend.region,
          bucket: backend.bucket,
          accessKeyId: decryptValue(backend.accessKeyId),
          secretAccessKey: decryptValue(backend.secretAccessKey),
          key: row.storagePath,
        })
      }
      await db
        .update(snapshotExports)
        .set({ status: "expired" })
        .where(eq(snapshotExports.id, row.id))
      audit({
        action: "snapshot.export_expired",
        category: "platform",
        actorType: "system",
        entityType: "space",
        entityId: row.id,
        description: `Snapshot export expired and S3 object deleted`,
        metadata: { exportId: row.id, storagePath: row.storagePath },
        source: "worker",
      })
    } catch (err) {
      console.error(
        `[snapshot-export-reap] failed to reap ${row.id}:`,
        err instanceof Error ? err.message : err
      )
    }
  }

  // 2. Hard-delete old failed rows.
  await db
    .delete(snapshotExports)
    .where(
      and(
        eq(snapshotExports.status, "failed"),
        lt(snapshotExports.createdAt, sevenDaysAgo)
      )
    )

  console.log(`[snapshot-export-reap] reaped ${expired.length} expired exports`)
}
```

- [ ] **Step 2: Verify deleteObject signature**

Run: `grep -n "deleteObject\|export function" lib/storage/s3-direct.ts | head`
If signature differs, adjust the call.

- [ ] **Step 3: Commit**

```bash
git add lib/worker/handlers/snapshot-export-reap.ts
git commit -m "feat(snapshots): snapshot export reaper cron"
```

### Task 2.6: Register handlers + cron in boss.ts

**Files:**
- Modify: `lib/worker/boss.ts`

- [ ] **Step 1: Add imports** (in the same block as the other dynamic imports)

```typescript
const { handleSnapshotExport } = await import(
  "@/lib/worker/handlers/snapshot-export"
)
const { handleSnapshotExportReap } = await import(
  "@/lib/worker/handlers/snapshot-export-reap"
)
```

- [ ] **Step 2: Find the existing snapshot handler registrations + add new ones**

Run: `grep -n "boss.work\|boss.schedule\|SNAPSHOT" lib/worker/boss.ts | head -30`

- [ ] **Step 3: Add `boss.work` registrations**

```typescript
await boss.work(JOB_NAMES.SNAPSHOT_EXPORT, handleSnapshotExport)
await boss.work(JOB_NAMES.SNAPSHOT_EXPORT_REAP, handleSnapshotExportReap)
```

- [ ] **Step 4: Add the export-reap cron** (hourly)

```typescript
await boss.schedule(JOB_NAMES.SNAPSHOT_EXPORT_REAP, "0 * * * *", undefined, {
  // Reaper runs hourly, but exclusive policy ensures it never overlaps.
})
```

- [ ] **Step 5: REMOVE the old `snapshot.auto` import + work + schedule**

Find and delete:
- `const { handleSnapshotAuto } = await import("@/lib/worker/handlers/snapshot-auto")`
- `await boss.work(JOB_NAMES.SNAPSHOT_AUTO, handleSnapshotAuto)`
- `await boss.schedule(JOB_NAMES.SNAPSHOT_AUTO, …)`

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: passes (or errors only on the now-orphan `snapshot-auto.ts` file — that's deleted in Phase 4).

- [ ] **Step 7: Commit**

```bash
git add lib/worker/boss.ts
git commit -m "feat(worker): register snapshot export handlers + reaper cron"
```

### Task 2.7: Server action for starting an export

**Files:**
- Modify: `app/actions/snapshots.ts`

- [ ] **Step 1: Add the exportSnapshot action**

At the bottom of the file:

```typescript
export async function exportSnapshot(
  spaceId: string,
  cubeId: string,
  snapshotId: string
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) return { error: "Unauthorized" }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    )
    if ("error" in permResult) return permResult

    const accessError = await requireActionCubeAccess(
      permResult.membership,
      cubeId
    )
    if (accessError) return accessError

    // Storage backend must exist (export uploads to S3).
    const storageError = await assertBackupStorageAvailable()
    if (storageError) return storageError

    // Load snapshot + ensure it belongs to this cube + is complete.
    const snapshot = await db.query.cubeSnapshots.findFirst({
      where: and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      ),
    })
    if (!snapshot) return { error: "Snapshot not found" }
    if (snapshot.status !== "complete") {
      return {
        error: `Snapshot is currently ${snapshot.status}. Only completed snapshots can be exported.`,
      }
    }

    // Rate limit: at most one in-flight export per snapshot.
    const [existing] = await db
      .select({ id: schema.snapshotExports.id })
      .from(schema.snapshotExports)
      .where(
        and(
          eq(schema.snapshotExports.snapshotId, snapshotId),
          inArray(schema.snapshotExports.status, ["pending", "materializing"])
        )
      )
      .limit(1)
    if (existing) {
      return {
        error:
          "An export of this snapshot is already in progress. Check your email shortly.",
      }
    }

    const cube = await db.query.cubes.findFirst({
      where: eq(schema.cubes.id, cubeId),
      columns: { serverId: true },
    })
    if (!cube) return { error: "Cube not found" }

    const [row] = await db
      .insert(schema.snapshotExports)
      .values({
        snapshotId,
        spaceId,
        status: "pending",
        // Placeholder — handler overwrites with actual completedAt + 24h.
        // The reaper checks expiresAt < now so a placeholder of now+25h is safe
        // in the failure case where the handler dies before setting it.
        expiresAt: new Date(Date.now() + 25 * 3600 * 1000),
        requestedBy: session.user.id,
      })
      .returning()

    await enqueueJob(JOB_NAMES.SNAPSHOT_EXPORT, {
      exportId: row.id,
      snapshotId,
      cubeId,
      spaceId,
      serverId: cube.serverId,
    })

    audit({
      action: "snapshot.export_requested",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Customer requested export of snapshot "${snapshot.name}"`,
      metadata: { exportId: row.id, snapshotId },
      ...extractRequestContext(await headers()),
    })

    return { success: true, data: { exportId: row.id } }
  } catch (err) {
    console.error("[action:exportSnapshot]", err)
    return { error: "Something went wrong while starting the export." }
  }
}
```

Update imports as needed (`inArray`).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/actions/snapshots.ts
git commit -m "feat(snapshots): exportSnapshot server action"
```

### Task 2.8: UI button + sheet for export

**Files:**
- Modify: `components/cube-snapshots.tsx`

- [ ] **Step 1: Add "Download as .cube" button to each complete snapshot row**

Find the action buttons block (Restore / Delete) in the DataTable column definitions. Add a new button:

```tsx
{snapshot.status === "complete" && (
  <Button
    size="sm"
    variant="outline"
    disabled={isPending}
    onClick={() => handleExport(snapshot.id)}
  >
    <DownloadIcon className="size-4" />
    Download
  </Button>
)}
```

Add the handler at component level:

```typescript
const handleExport = (snapshotId: string) => {
  startTransition(async () => {
    const result = await exportSnapshot(spaceId, cubeId, snapshotId)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(
      "Export started — we'll email a download link when it's ready (typically 5–15 min)."
    )
    router.refresh()
  })
}
```

Import `exportSnapshot` from `@/app/actions/snapshots` and `DownloadIcon` from `@phosphor-icons/react`.

- [ ] **Step 2: Manual smoke test**

```bash
pnpm dev
```
1. Sign in as a Pro-plan user.
2. Snapshot a running cube.
3. Wait for snapshot to complete.
4. Click "Download" — toast appears.
5. Worker logs show snapshot.export running; after ~30s with a tiny rootfs, the customer receives the email (check sent emails / dev SMTP).

- [ ] **Step 3: Commit**

```bash
git add components/cube-snapshots.tsx
git commit -m "feat(snapshots): UI button to export snapshot as .cube"
```

---

# PHASE 3 — Clone snapshot → new cube

Goal: customer can spin up a new cube from any complete snapshot. New cube gets its own SSH key, runs in any region the customer's plan allows.

### Task 3.1: Write the cube-from-snapshot handler

**Files:**
- Create: `lib/worker/handlers/cube-from-snapshot.ts`

- [ ] **Step 1: Write the handler**

Pattern modeled after `cube-import-rootfs.ts`. Skeleton:

```typescript
import { eq } from "drizzle-orm"
import type { Job } from "pg-boss"
import { cubeSnapshots, cubes, lifecycleLogs } from "@/db/schema"
import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { triggerCubeLifecycleEvent } from "@/lib/pusher"
import { connectToServer, execCommand, shellEscape } from "@/lib/ssh"
import { writeCubeGuestNetworkConfig } from "@/lib/ssh/cube-guest-network"
import { startCube } from "@/lib/ssh/firecracker"
import { loadResticRepoConfig } from "@/lib/storage/restic"
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat"
import { JobLogger } from "@/lib/worker/job-log"
import type { CubeFromSnapshotPayload } from "@/lib/worker/job-types"

/**
 * Spin up a new cube from a source snapshot. The new cube row is
 * pre-created (status="pending"), allocated to a server, and this
 * handler:
 *
 *  1. restic-dumps the source snapshot's rootfs straight onto the new
 *     cube's working dir on the destination server (no S3 round-trip
 *     through a .cube archive — saves ~5 GB of redundant transfer).
 *  2. Loop-mounts the rootfs, injects the customer's new SSH key,
 *     rewrites the guest network config for the new IP.
 *  3. Boots via startCube.
 */
async function handleCubeFromSnapshotJob(
  job: Job<CubeFromSnapshotPayload>
): Promise<void> {
  const { cubeId, spaceId, serverId, sourceSnapshotId, sourceCubeId, sshPublicKey } = job.data
  const log = new JobLogger(job.id, "cube.from-snapshot", "cube", cubeId)
  await log.info(`Clone from snapshot started`)

  // 1. Atomically claim cube row pending → booting.
  const [claimed] = await db
    .update(cubes)
    .set({ status: "booting" })
    .where(and(eq(cubes.id, cubeId), eq(cubes.status, "pending")))
    .returning()
  if (!claimed) {
    await log.warn("Cube row not in pending state, skipping")
    return
  }

  // 2. Load source snapshot + verify complete.
  const sourceSnapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, sourceSnapshotId),
  })
  if (!sourceSnapshot || sourceSnapshot.status !== "complete" || !sourceSnapshot.storagePath) {
    await markCubeError(cubeId, "Source snapshot is not in a complete state")
    return
  }
  if (!sourceSnapshot.storageBackendId) {
    await markCubeError(cubeId, "Source snapshot has no storage backend")
    return
  }

  const cube = await db.query.cubes.findFirst({ where: eq(cubes.id, cubeId) })
  if (!cube) {
    await log.error("New cube row vanished")
    return
  }

  // 3. SSH to destination server. Restic dump straight to the cube's rootfs.
  const { config: repoConfig } = await loadResticRepoConfig(
    sourceCubeId,
    sourceSnapshot.storageBackendId
  )
  const { client } = await connectToServer(serverId)
  const cubeDir = `/var/lib/krova/cubes/${cubeId}`

  try {
    await withCubeHeartbeat(cubeId, async () => {
      await execCommand(client, `mkdir -p ${shellEscape(cubeDir)}`, 10_000)

      await log.step("Restic dump source rootfs", async () => {
        // Same resticEnvInline pattern as snapshot-export. Could be shared
        // into lib/storage/restic — for now duplicated to keep the handler
        // self-contained.
        const env_ = `RESTIC_REPOSITORY=${shellEscape(repoConfig.repoUrl)} RESTIC_PASSWORD=${shellEscape(repoConfig.repoPassword)} AWS_ACCESS_KEY_ID=${shellEscape(repoConfig.accessKeyId)} AWS_SECRET_ACCESS_KEY=${shellEscape(repoConfig.secretAccessKey)} RESTIC_PROGRESS_FPS=0 RESTIC_CACHE_DIR=/var/lib/krova/restic-cache`
        const cmd = `${env_} restic -o s3.bucket-lookup=path dump ${shellEscape(sourceSnapshot.storagePath!)} rootfs.ext4 > ${shellEscape(cubeDir + "/rootfs.ext4")}`
        const r = await execCommand(client, cmd, 1_800_000)
        if (r.exitCode !== 0) {
          throw new Error(`restic dump failed (exit ${r.exitCode}): ${r.stderr.slice(0, 500)}`)
        }
      })

      // Grow the rootfs if the destination cube has a larger disk than the source.
      // (Shrink is impossible — would corrupt ext4. Validated at action layer.)
      if (cube.diskLimitGb > sourceSnapshot.sizeBytes! / (1024 ** 3)) {
        await log.step("Grow rootfs", async () => {
          await execCommand(
            client,
            `truncate -s ${cube.diskLimitGb}G ${shellEscape(cubeDir + "/rootfs.ext4")} && e2fsck -y -f ${shellEscape(cubeDir + "/rootfs.ext4")} && resize2fs ${shellEscape(cubeDir + "/rootfs.ext4")}`,
            300_000
          )
        })
      }

      // Loop-mount + inject SSH key + rewrite network config.
      // Reuse the same helpers backup-redeploy uses.
      await log.step("Inject SSH key + network config", async () => {
        const mountPoint = `/tmp/krova-mount-${cubeId}`
        await execCommand(client, `mkdir -p ${shellEscape(mountPoint)}`, 10_000)
        await execCommand(client, `mount -o loop ${shellEscape(cubeDir + "/rootfs.ext4")} ${shellEscape(mountPoint)}`, 30_000)
        try {
          await execCommand(client, `mkdir -p ${shellEscape(mountPoint + "/root/.ssh")} && chmod 700 ${shellEscape(mountPoint + "/root/.ssh")}`, 10_000)
          // Use printf via base64 (Rule 39) to dodge quoting.
          const b64 = Buffer.from(sshPublicKey + "\n").toString("base64")
          await execCommand(
            client,
            `echo ${b64} | base64 -d > ${shellEscape(mountPoint + "/root/.ssh/authorized_keys")} && chmod 600 ${shellEscape(mountPoint + "/root/.ssh/authorized_keys")}`,
            10_000
          )
          await writeCubeGuestNetworkConfig(client, mountPoint, cube)
        } finally {
          await execCommand(client, `umount ${shellEscape(mountPoint)} && rmdir ${shellEscape(mountPoint)}`, 30_000).catch(() => {})
        }
      })

      // Boot via startCube (same as cube-import-rootfs).
      await log.step("Start cube", async () => {
        await startCube(client, cube)
      })

      await db
        .update(cubes)
        .set({ status: "running", lastStartedAt: new Date(), lastBilledAt: new Date() })
        .where(eq(cubes.id, cubeId))
      await db.insert(lifecycleLogs).values({
        entityType: "cube",
        entityId: cubeId,
        message: `Cube cloned from snapshot "${sourceSnapshot.name}" of cube ${sourceCubeId}`,
      })
      await triggerCubeLifecycleEvent(cubeId, spaceId, { status: "running" })

      audit({
        action: "cube.clone_from_snapshot_complete",
        category: "cube",
        actorType: "user",
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `Cube cloned from snapshot ${sourceSnapshotId}`,
        metadata: { sourceCubeId, sourceSnapshotId },
        source: "worker",
      })
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await log.error(`Clone failed: ${reason}`)
    await markCubeError(cubeId, reason)
  } finally {
    client.end()
  }
}

async function markCubeError(cubeId: string, reason: string): Promise<void> {
  // Mirrors lib/worker/handlers/cube-import-rootfs.ts — `cubes` has no
  // errorMessage column; the reason goes to lifecycle_logs instead.
  await db
    .update(cubes)
    .set({ status: "error", updatedAt: new Date() })
    .where(eq(cubes.id, cubeId))
  await db.insert(lifecycleLogs).values({
    entityType: "cube",
    entityId: cubeId,
    message: `Clone from snapshot failed: ${reason.slice(0, 500)}`,
  })
}

export async function handleCubeFromSnapshot(
  jobs: Job<CubeFromSnapshotPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleCubeFromSnapshotJob(job)
  }
}
```

Add the `and` import.

- [ ] **Step 2: Register in boss.ts**

In `lib/worker/boss.ts`, add the import + `boss.work`:

```typescript
const { handleCubeFromSnapshot } = await import(
  "@/lib/worker/handlers/cube-from-snapshot"
)
// …
await boss.work(JOB_NAMES.CUBE_FROM_SNAPSHOT, handleCubeFromSnapshot)
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: passes. If `cubes.errorMessage` doesn't exist, look at how other handlers mark cube error and copy that pattern (probably uses a `lifecycleLogs` insert + `status='error'` only).

- [ ] **Step 4: Commit**

```bash
git add lib/worker/handlers/cube-from-snapshot.ts lib/worker/boss.ts
git commit -m "feat(snapshots): cube.from-snapshot handler — clone via restic dump"
```

### Task 3.2: Server action for cloning

**Files:**
- Modify: `app/actions/snapshots.ts`

- [ ] **Step 1: Add cloneSnapshot action**

```typescript
export async function cloneSnapshotToNewCube(
  spaceId: string,
  cubeId: string,
  snapshotId: string,
  input: {
    name: string
    regionId: string
    vcpus: number
    ramMb: number
    diskLimitGb: number
    sshPublicKey: string
  }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) return { error: "Unauthorized" }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    )
    if ("error" in permResult) return permResult

    const accessError = await requireActionCubeAccess(
      permResult.membership,
      cubeId
    )
    if (accessError) return accessError

    const trimmedName = validateName(input.name)
    if (!trimmedName) return { error: "Cube name must be 1–64 printable chars" }
    if (!isValidSshPublicKey(input.sshPublicKey)) {
      return { error: "Invalid SSH public key" }
    }

    // Load snapshot.
    const snapshot = await db.query.cubeSnapshots.findFirst({
      where: and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      ),
    })
    if (!snapshot) return { error: "Snapshot not found" }
    if (snapshot.status !== "complete") {
      return { error: "Snapshot must be complete before cloning" }
    }

    const sourceCube = await db.query.cubes.findFirst({
      where: eq(schema.cubes.id, cubeId),
    })
    if (!sourceCube) return { error: "Source cube not found" }

    // Disk cannot shrink (ext4 corruption).
    if (input.diskLimitGb < sourceCube.diskLimitGb) {
      return {
        error: `Disk cannot shrink below the source cube's ${sourceCube.diskLimitGb} GB.`,
      }
    }

    // Plan-tier gating + allocation inside a per-space lock — mirrors createCube.
    const result = await db.transaction(async (tx) => {
      await acquireSpaceLock(tx, spaceId)
      const limits = await loadEffectiveLimitsTx(tx, spaceId)
      const sizeCheck = assertCanCreateCubeV2(
        limits,
        await countActiveCubesTx(tx, spaceId),
        { vcpus: input.vcpus, ramMb: input.ramMb, diskGb: input.diskLimitGb }
      )
      if (!sizeCheck.ok) return { error: sizeCheck.error }

      const allocated = await allocateServerAndCreateCube(tx, {
        spaceId,
        name: trimmedName,
        vcpus: input.vcpus,
        ramMb: input.ramMb,
        diskLimitGb: input.diskLimitGb,
        imageId: sourceCube.imageId,
        regionId: input.regionId,
        sshPublicKey: input.sshPublicKey,
        userData: sourceCube.userData,
      })
      if ("error" in allocated) return allocated
      return { cubeId: allocated.cubeId, serverId: allocated.serverId }
    })
    if ("error" in result) return result

    await enqueueJob(JOB_NAMES.CUBE_FROM_SNAPSHOT, {
      cubeId: result.cubeId,
      spaceId,
      serverId: result.serverId,
      sourceCubeId: cubeId,
      sourceSnapshotId: snapshotId,
      sshPublicKey: input.sshPublicKey,
    })

    return { success: true, data: { cubeId: result.cubeId } }
  } catch (err) {
    console.error("[action:cloneSnapshotToNewCube]", err)
    return { error: "Something went wrong while cloning the snapshot." }
  }
}
```

Add `loadEffectiveLimitsTx` to imports.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck`

```bash
git add app/actions/snapshots.ts
git commit -m "feat(snapshots): cloneSnapshotToNewCube server action"
```

### Task 3.3: Sheet UI for cloning

**Files:**
- Create: `components/snapshot-clone-sheet.tsx`
- Modify: `components/cube-snapshots.tsx` (add "Clone to New Cube" button + render the sheet)

- [ ] **Step 1: Write the sheet**

```tsx
// components/snapshot-clone-sheet.tsx
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { cloneSnapshotToNewCube } from "@/app/actions/snapshots"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { PlanCubeLimits } from "@/lib/cube-options"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64),
  regionId: z.string().min(1, "Region is required"),
  vcpus: z.number().int().positive(),
  ramMb: z.number().int().positive(),
  diskLimitGb: z.number().int().positive(),
  sshPublicKey: z.string().trim().min(1, "SSH public key is required"),
})
type Values = z.infer<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (next: boolean) => void
  spaceId: string
  cubeId: string
  snapshotId: string
  // From the source cube — pre-populates the form.
  sourceCube: { vcpus: number; ramMb: number; diskLimitGb: number }
  regions: { id: string; name: string }[]
  planLimits: PlanCubeLimits
}

export function SnapshotCloneSheet({
  open,
  onOpenChange,
  spaceId,
  cubeId,
  snapshotId,
  sourceCube,
  regions,
  planLimits,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      name: "",
      regionId: regions[0]?.id ?? "",
      vcpus: Math.min(sourceCube.vcpus, planLimits.maxVcpus),
      ramMb: Math.min(sourceCube.ramMb, planLimits.maxRamMb),
      diskLimitGb: Math.min(
        Math.max(sourceCube.diskLimitGb, sourceCube.diskLimitGb),
        planLimits.maxDiskGb
      ),
      sshPublicKey: "",
    },
  })

  const onSubmit = (values: Values) => {
    startTransition(async () => {
      const result = await cloneSnapshotToNewCube(
        spaceId,
        cubeId,
        snapshotId,
        values
      )
      if (result.error) {
        form.setError("root", { message: result.error })
        return
      }
      toast.success("Cloning — your new cube is provisioning.")
      onOpenChange(false)
      router.push(`/${spaceId}/cubes/${result.data.cubeId}`)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Clone snapshot to new cube</SheetTitle>
          <SheetDescription>
            Spins up a new cube from this snapshot. Disk can grow but cannot
            shrink below the source cube's {sourceCube.diskLimitGb} GB.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 mt-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cube name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="regionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Region</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {regions.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vcpus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>vCPUs (max {planLimits.maxVcpus})</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={planLimits.maxVcpus}
                      value={field.value}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ramMb"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RAM MB (max {planLimits.maxRamMb})</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={512}
                      max={planLimits.maxRamMb}
                      step={512}
                      value={field.value}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="diskLimitGb"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Disk GB (min {sourceCube.diskLimitGb}, max{" "}
                    {planLimits.maxDiskGb})
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={sourceCube.diskLimitGb}
                      max={planLimits.maxDiskGb}
                      value={field.value}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>Cannot shrink below source.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sshPublicKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SSH public key</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="ssh-ed25519 AAAA…"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Overwrites the source cube's authorized_keys in the new cube.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              disabled={!form.formState.isValid || isPending}
              className="w-full"
            >
              {isPending && <Spinner className="size-4" />}
              Clone to new cube
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Add button to snapshot row in cube-snapshots.tsx**

```tsx
{snapshot.status === "complete" && (
  <Button size="sm" variant="outline" onClick={() => setCloneSnapshotId(snapshot.id)}>
    <CopyIcon className="size-4" />
    Clone to new cube
  </Button>
)}
```

- [ ] **Step 3: Manual smoke test**

In dev, take a snapshot, then clone → new cube appears in list, boots, SSH works with the new key.

- [ ] **Step 4: Commit**

```bash
git add components/snapshot-clone-sheet.tsx components/cube-snapshots.tsx
git commit -m "feat(snapshots): clone-to-new-cube UI"
```

---

# PHASE 4 — Per-plan auto-snapshot scheduler + retention

Goal: scheduler runs hourly, decides per cube whether a snapshot is due based on the cube's plan cadence + `last_auto_snapshot_at`. Sleeping cubes get exactly one snapshot per sleep cycle. Daily pruner runs `restic forget` with the plan's retention buckets per cube.

### Task 4.1: Reset snapshotted_since_sleep on sleep transition

**Files:**
- Modify: `lib/worker/handlers/cube-sleep.ts`

- [ ] **Step 1: Find the cube status update**

Run: `grep -n "status.*sleeping\|set.*status" lib/worker/handlers/cube-sleep.ts | head`

- [ ] **Step 2: Add the flag reset in the same UPDATE**

Wherever the cube row is updated to `status: "sleeping"`, add `snapshottedSinceSleep: false`:

```typescript
await tx
  .update(cubes)
  .set({
    status: "sleeping",
    snapshottedSinceSleep: false,
    // … existing fields …
  })
  .where(eq(cubes.id, cubeId))
```

Do the same in `cube-power-off.ts` (which also ends in sleeping per CLAUDE.md).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add lib/worker/handlers/cube-sleep.ts lib/worker/handlers/cube-power-off.ts
git commit -m "feat(cubes): reset snapshotted_since_sleep on sleep transition"
```

### Task 4.2: Set snapshotted_since_sleep + last_auto_snapshot_at on snapshot complete

**Files:**
- Modify: `lib/worker/handlers/snapshot-create.ts`

- [ ] **Step 1: Locate the success-path cube update**

Run: `grep -n "completedAt\|status.*complete" lib/worker/handlers/snapshot-create.ts | head`

The handler currently only updates the snapshot row. We need an additional UPDATE on the cube row, conditional on `kind='auto'`.

- [ ] **Step 2: After the snapshot UPDATE to `complete`, add**

```typescript
// Maintain auto-snapshot bookkeeping on the cube row. The scheduler
// reads these to decide whether the next tick is due.
if (snapshot.kind === "auto") {
  await db
    .update(cubes)
    .set({
      lastAutoSnapshotAt: new Date(),
      snapshottedSinceSleep: true,
    })
    .where(eq(cubes.id, cubeId))
}
```

Pull `kind` into the destructured snapshot read at top.

- [ ] **Step 3: Update the snapshot-create payload type if needed**

Check `lib/worker/job-types.ts` `SnapshotCreatePayload`. If it doesn't already carry `kind`, leave it alone — the kind is read from the `cube_snapshots` row directly.

- [ ] **Step 4: Typecheck + commit**

```bash
git add lib/worker/handlers/snapshot-create.ts
git commit -m "feat(snapshots): track auto-snapshot bookkeeping on cube row"
```

### Task 4.3: Write the scheduler handler test

**Files:**
- Create: `tests/lib/worker/handlers/snapshot-scheduler.test.ts`

- [ ] **Step 1: Write the test**

Pure function test for the per-cube decision logic. Extract decision into `shouldScheduleAutoSnapshot(cube, plan, now)` for testability.

```typescript
import { describe, expect, it } from "vitest"
import { shouldScheduleAutoSnapshot } from "@/lib/worker/handlers/snapshot-scheduler"

const HOUR = 60 * 60 * 1000

describe("shouldScheduleAutoSnapshot", () => {
  const now = new Date("2026-05-25T12:00:00Z")
  const planWithCadence = { autoSnapshotCadenceHours: 6 }
  const planNoAuto = { autoSnapshotCadenceHours: null }

  it("skips when plan has no auto cadence (Trial)", () => {
    expect(
      shouldScheduleAutoSnapshot(
        { status: "running", lastAutoSnapshotAt: null, snapshottedSinceSleep: true },
        planNoAuto,
        now
      )
    ).toBe(false)
  })

  it("schedules immediately when no prior snapshot", () => {
    expect(
      shouldScheduleAutoSnapshot(
        { status: "running", lastAutoSnapshotAt: null, snapshottedSinceSleep: true },
        planWithCadence,
        now
      )
    ).toBe(true)
  })

  it("schedules when cadence has elapsed", () => {
    expect(
      shouldScheduleAutoSnapshot(
        {
          status: "running",
          lastAutoSnapshotAt: new Date(now.getTime() - 7 * HOUR),
          snapshottedSinceSleep: true,
        },
        planWithCadence,
        now
      )
    ).toBe(true)
  })

  it("skips when cadence has NOT elapsed", () => {
    expect(
      shouldScheduleAutoSnapshot(
        {
          status: "running",
          lastAutoSnapshotAt: new Date(now.getTime() - 1 * HOUR),
          snapshottedSinceSleep: true,
        },
        planWithCadence,
        now
      )
    ).toBe(false)
  })

  it("schedules a sleeping cube once after sleep transition", () => {
    expect(
      shouldScheduleAutoSnapshot(
        { status: "sleeping", lastAutoSnapshotAt: null, snapshottedSinceSleep: false },
        planWithCadence,
        now
      )
    ).toBe(true)
  })

  it("skips a sleeping cube that already snapshotted since sleep", () => {
    expect(
      shouldScheduleAutoSnapshot(
        {
          status: "sleeping",
          lastAutoSnapshotAt: new Date(now.getTime() - 24 * HOUR),
          snapshottedSinceSleep: true,
        },
        planWithCadence,
        now
      )
    ).toBe(false)
  })

  it("skips error/transferring cubes", () => {
    expect(
      shouldScheduleAutoSnapshot(
        { status: "error", lastAutoSnapshotAt: null, snapshottedSinceSleep: true },
        planWithCadence,
        now
      )
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/worker/handlers/snapshot-scheduler.test.ts`
Expected: module not found.

### Task 4.4: Implement the scheduler

**Files:**
- Create: `lib/worker/handlers/snapshot-scheduler.ts`

- [ ] **Step 1: Write the module**

```typescript
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import type { Job } from "pg-boss"
import { cubeSnapshots, cubes, plans, spaces } from "@/db/schema"
import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { selectBackend } from "@/lib/storage/backends"
import { enqueueJob } from "@/lib/worker/enqueue"
import { JOB_NAMES } from "@/lib/worker/job-types"

interface CubeForScheduling {
  status: string
  lastAutoSnapshotAt: Date | null
  snapshottedSinceSleep: boolean
}

interface PlanForScheduling {
  autoSnapshotCadenceHours: number | null
}

/**
 * Pure decision function — separated from the DB scan so it can be unit-
 * tested without a database. Returns true iff an auto-snapshot should
 * be enqueued for this cube on this tick.
 *
 * Rules:
 *  - Plan must declare a cadence (else opted out, e.g. Trial).
 *  - Cube must be `running` OR `sleeping` (rootfs exists on disk both
 *    ways). Error/transferring/booting/pending/stopping = skip.
 *  - Sleeping cubes get AT MOST ONE auto-snapshot per sleep cycle
 *    (their rootfs doesn't change while asleep). Tracked via
 *    `snapshotted_since_sleep`.
 *  - Running cubes are due when `now - lastAutoSnapshotAt >= cadence`
 *    or when there is no prior auto-snapshot at all.
 */
export function shouldScheduleAutoSnapshot(
  cube: CubeForScheduling,
  plan: PlanForScheduling,
  now: Date
): boolean {
  if (plan.autoSnapshotCadenceHours == null) return false
  if (cube.status !== "running" && cube.status !== "sleeping") return false
  if (cube.status === "sleeping") {
    return cube.snapshottedSinceSleep === false
  }
  // running
  if (cube.lastAutoSnapshotAt == null) return true
  const elapsedMs = now.getTime() - cube.lastAutoSnapshotAt.getTime()
  const cadenceMs = plan.autoSnapshotCadenceHours * 3600 * 1000
  return elapsedMs >= cadenceMs
}

/**
 * Hourly cron: scan every running/sleeping cube + its plan, enqueue
 * `snapshot.create` (kind=auto) for any that are due.
 *
 * The scheduler does NOT pre-check the manual cap (that's manual-only).
 * It does NOT check storage backend availability per cube — the
 * snapshot-create handler skips if there's no backend.
 */
export async function handleSnapshotScheduler(_jobs: Job[]): Promise<void> {
  void _jobs

  // Pre-flight: no backend? skip the whole cycle, like snapshot-auto.ts did.
  const backend = await selectBackend().catch(() => null)
  if (!backend) {
    console.warn("[snapshot-scheduler] no active storage backend, skipping cycle")
    return
  }

  // Single join query: every active cube + its plan's cadence.
  const rows = await db
    .select({
      id: cubes.id,
      name: cubes.name,
      status: cubes.status,
      spaceId: cubes.spaceId,
      serverId: cubes.serverId,
      lastAutoSnapshotAt: cubes.lastAutoSnapshotAt,
      snapshottedSinceSleep: cubes.snapshottedSinceSleep,
      cadence: plans.autoSnapshotCadenceHours,
    })
    .from(cubes)
    .innerJoin(spaces, eq(cubes.spaceId, spaces.id))
    .innerJoin(plans, eq(spaces.planId, plans.id))
    .where(
      and(
        inArray(cubes.status, ["running", "sleeping"]),
        isNotNull(plans.autoSnapshotCadenceHours)
      )
    )

  const now = new Date()
  let enqueued = 0
  const timestamp = now.toISOString().slice(0, 16).replace("T", " ")

  for (const row of rows) {
    const decide = shouldScheduleAutoSnapshot(
      {
        status: row.status,
        lastAutoSnapshotAt: row.lastAutoSnapshotAt,
        snapshottedSinceSleep: row.snapshottedSinceSleep,
      },
      { autoSnapshotCadenceHours: row.cadence },
      now
    )
    if (!decide) continue

    try {
      const [snap] = await db
        .insert(cubeSnapshots)
        .values({
          cubeId: row.id,
          spaceId: row.spaceId,
          name: `Auto ${timestamp}`,
          status: "pending",
          kind: "auto",
          isAutomatic: true, // legacy boolean, kept in sync for now
        })
        .returning()
      await enqueueJob(JOB_NAMES.SNAPSHOT_CREATE, {
        snapshotId: snap.id,
        cubeId: row.id,
        spaceId: row.spaceId,
        serverId: row.serverId,
      })
      enqueued++
    } catch (err) {
      console.error(
        `[snapshot-scheduler] failed to enqueue for cube ${row.id}:`,
        err instanceof Error ? err.message : err
      )
    }
  }

  audit({
    action: "snapshot.scheduler_tick",
    category: "platform",
    actorType: "system",
    entityType: "cube",
    description: `Scheduler tick: ${rows.length} eligible cubes, ${enqueued} snapshots enqueued`,
    metadata: { eligibleCubes: rows.length, enqueued },
    source: "worker",
  })

  console.log(
    `[snapshot-scheduler] tick complete — eligible=${rows.length} enqueued=${enqueued}`
  )
}
```

- [ ] **Step 2: Re-run unit test**

Run: `pnpm vitest run tests/lib/worker/handlers/snapshot-scheduler.test.ts`
Expected: 7 tests pass.

- [ ] **Step 3: Register in boss.ts + ensure-queues.ts**

In `lib/worker/boss.ts`:
```typescript
const { handleSnapshotScheduler } = await import(
  "@/lib/worker/handlers/snapshot-scheduler"
)
// …
await boss.work(JOB_NAMES.SNAPSHOT_SCHEDULER, handleSnapshotScheduler)
await boss.schedule(JOB_NAMES.SNAPSHOT_SCHEDULER, "0 * * * *") // every hour
```

(The queue policy entry was already added in Task 2.2.)

- [ ] **Step 4: Commit**

```bash
git add lib/worker/handlers/snapshot-scheduler.ts tests/lib/worker/handlers/snapshot-scheduler.test.ts lib/worker/boss.ts
git commit -m "feat(snapshots): per-plan hourly auto-snapshot scheduler"
```

### Task 4.5: Write the auto-prune handler test

**Files:**
- Create: `tests/lib/worker/handlers/snapshot-auto-prune.test.ts`

- [ ] **Step 1: Write a pure test on the bucket selection logic**

If the auto-prune handler is short and DB-dependent, a pure test focuses on the "build the restic forget command from a plan row" logic:

```typescript
import { describe, expect, it } from "vitest"
import { buildResticForgetArgs } from "@/lib/worker/handlers/snapshot-auto-prune"

describe("buildResticForgetArgs", () => {
  it("emits all three keep flags", () => {
    expect(
      buildResticForgetArgs({
        autoSnapshotKeepLast: 8,
        autoSnapshotKeepDaily: 7,
        autoSnapshotKeepWeekly: 2,
      })
    ).toBe("--keep-last 8 --keep-daily 7 --keep-weekly 2 --tag auto")
  })

  it("omits zero buckets", () => {
    expect(
      buildResticForgetArgs({
        autoSnapshotKeepLast: 4,
        autoSnapshotKeepDaily: 0,
        autoSnapshotKeepWeekly: 0,
      })
    ).toBe("--keep-last 4 --tag auto")
  })

  it("returns null when all buckets are zero (no auto retention configured)", () => {
    expect(
      buildResticForgetArgs({
        autoSnapshotKeepLast: 0,
        autoSnapshotKeepDaily: 0,
        autoSnapshotKeepWeekly: 0,
      })
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm vitest run tests/lib/worker/handlers/snapshot-auto-prune.test.ts`
Expected: module not found.

### Task 4.6: Implement the auto-prune handler

**Files:**
- Create: `lib/worker/handlers/snapshot-auto-prune.ts`

- [ ] **Step 1: Write the handler**

```typescript
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import type { Job } from "pg-boss"
import { cubeSnapshots, cubes, plans, spaces } from "@/db/schema"
import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { connectToServer } from "@/lib/ssh"
import { execCommand } from "@/lib/ssh"
import { loadResticRepoConfig } from "@/lib/storage/restic"

export interface RetentionBuckets {
  autoSnapshotKeepLast: number
  autoSnapshotKeepDaily: number
  autoSnapshotKeepWeekly: number
}

/**
 * Build the args portion of a `restic forget` command from a plan's
 * retention buckets. Returns null when ALL buckets are zero — caller
 * should skip the prune entirely.
 *
 * The `--tag auto` filter ensures `restic forget` never touches manual
 * (or pinned-from-auto-to-manual) snapshots even if they fall outside
 * the keep windows.
 */
export function buildResticForgetArgs(buckets: RetentionBuckets): string | null {
  const parts: string[] = []
  if (buckets.autoSnapshotKeepLast > 0) parts.push(`--keep-last ${buckets.autoSnapshotKeepLast}`)
  if (buckets.autoSnapshotKeepDaily > 0) parts.push(`--keep-daily ${buckets.autoSnapshotKeepDaily}`)
  if (buckets.autoSnapshotKeepWeekly > 0) parts.push(`--keep-weekly ${buckets.autoSnapshotKeepWeekly}`)
  if (parts.length === 0) return null
  parts.push("--tag auto")
  return parts.join(" ")
}

/**
 * Daily cron at 03:30 UTC: per-cube `restic forget` with the plan's
 * retention buckets. Restic computes which snapshots to drop based on
 * walltime within `--keep-*-N` windows. We also clean up the DB rows
 * for snapshots restic just removed (the cube's local restic snapshot
 * list is the post-forget truth).
 */
export async function handleSnapshotAutoPrune(_jobs: Job[]): Promise<void> {
  void _jobs

  const rows = await db
    .select({
      cubeId: cubes.id,
      spaceId: cubes.spaceId,
      serverId: cubes.serverId,
      keepLast: plans.autoSnapshotKeepLast,
      keepDaily: plans.autoSnapshotKeepDaily,
      keepWeekly: plans.autoSnapshotKeepWeekly,
    })
    .from(cubes)
    .innerJoin(spaces, eq(cubes.spaceId, spaces.id))
    .innerJoin(plans, eq(spaces.planId, plans.id))
    .where(
      and(
        inArray(cubes.status, ["running", "sleeping"]),
        isNotNull(plans.autoSnapshotCadenceHours)
      )
    )

  for (const row of rows) {
    const args = buildResticForgetArgs({
      autoSnapshotKeepLast: row.keepLast,
      autoSnapshotKeepDaily: row.keepDaily,
      autoSnapshotKeepWeekly: row.keepWeekly,
    })
    if (!args) continue

    try {
      // Pull this cube's restic repo password + backend creds.
      const sample = await db.query.cubeSnapshots.findFirst({
        where: and(
          eq(cubeSnapshots.cubeId, row.cubeId),
          eq(cubeSnapshots.kind, "auto"),
          eq(cubeSnapshots.status, "complete")
        ),
        columns: { storageBackendId: true },
      })
      if (!sample?.storageBackendId) continue // No auto snapshots yet for this cube
      const { config: repoConfig } = await loadResticRepoConfig(
        row.cubeId,
        sample.storageBackendId
      )

      const { client } = await connectToServer(row.serverId)
      try {
        const env_ = `RESTIC_REPOSITORY=${shellEscape(repoConfig.repoUrl)} RESTIC_PASSWORD=${shellEscape(repoConfig.repoPassword)} AWS_ACCESS_KEY_ID=${shellEscape(repoConfig.accessKeyId)} AWS_SECRET_ACCESS_KEY=${shellEscape(repoConfig.secretAccessKey)} RESTIC_PROGRESS_FPS=0 RESTIC_CACHE_DIR=/var/lib/krova/restic-cache`
        const result = await execCommand(
          client,
          `${env_} restic -o s3.bucket-lookup=path forget ${args} --prune`,
          1_200_000
        )
        if (result.exitCode !== 0) {
          console.error(
            `[snapshot-auto-prune] restic forget failed for cube ${row.cubeId}: exit ${result.exitCode}`
          )
          continue
        }

        // Now reconcile DB: any kind=auto status=complete row whose
        // storagePath is no longer in the repo gets deleted.
        const listResult = await execCommand(
          client,
          `${env_} restic -o s3.bucket-lookup=path snapshots --json --no-lock`,
          60_000
        )
        if (listResult.exitCode === 0) {
          const liveIds = new Set<string>()
          try {
            const parsed = JSON.parse(listResult.stdout) as Array<{ id: string }>
            for (const s of parsed) liveIds.add(s.id)
          } catch {
            // ignore parse errors — leave DB alone, will re-converge next run
          }
          if (liveIds.size > 0) {
            const dbRows = await db
              .select({ id: cubeSnapshots.id, storagePath: cubeSnapshots.storagePath })
              .from(cubeSnapshots)
              .where(
                and(
                  eq(cubeSnapshots.cubeId, row.cubeId),
                  eq(cubeSnapshots.kind, "auto"),
                  eq(cubeSnapshots.status, "complete")
                )
              )
            const toDelete = dbRows
              .filter((r) => r.storagePath && !liveIds.has(r.storagePath))
              .map((r) => r.id)
            if (toDelete.length > 0) {
              await db.delete(cubeSnapshots).where(inArray(cubeSnapshots.id, toDelete))
            }
          }
        }
      } finally {
        client.end()
      }
    } catch (err) {
      console.error(
        `[snapshot-auto-prune] failed for cube ${row.cubeId}:`,
        err instanceof Error ? err.message : err
      )
    }
  }

  audit({
    action: "snapshot.auto_prune_cycle",
    category: "platform",
    actorType: "system",
    entityType: "cube",
    description: `Auto-prune cycle: ${rows.length} cubes processed`,
    metadata: { cubeCount: rows.length },
    source: "worker",
  })
}
```

Add the `shellEscape` import from `@/lib/ssh`.

- [ ] **Step 2: Run unit test**

Run: `pnpm vitest run tests/lib/worker/handlers/snapshot-auto-prune.test.ts`
Expected: passes.

- [ ] **Step 3: Register in boss.ts**

```typescript
const { handleSnapshotAutoPrune } = await import(
  "@/lib/worker/handlers/snapshot-auto-prune"
)
// …
await boss.work(JOB_NAMES.SNAPSHOT_AUTO_PRUNE, handleSnapshotAutoPrune)
await boss.schedule(JOB_NAMES.SNAPSHOT_AUTO_PRUNE, "30 3 * * *") // 03:30 UTC daily
```

- [ ] **Step 4: Commit**

```bash
git add lib/worker/handlers/snapshot-auto-prune.ts tests/lib/worker/handlers/snapshot-auto-prune.test.ts lib/worker/boss.ts
git commit -m "feat(snapshots): per-plan retention bucket pruner"
```

### Task 4.7: Delete the legacy snapshot-auto handler + config

**Files:**
- Delete: `lib/worker/handlers/snapshot-auto.ts`
- Modify: `lib/service-config.ts` (remove `getSnapshotConfig`)
- Modify: `config/platform.ts` (remove `SNAPSHOT_AUTO_*` exports)

- [ ] **Step 1: Verify no other callers**

Run: `grep -rn "getSnapshotConfig\|SNAPSHOT_AUTO\|snapshot-auto" lib/ app/ scripts/ components/ 2>&1`
Expected: only references in the files we're about to delete/modify.

- [ ] **Step 2: Delete the handler**

```bash
rm lib/worker/handlers/snapshot-auto.ts
```

- [ ] **Step 3: Remove from service-config**

Delete the `getSnapshotConfig` function + `SnapshotConfig` interface + import of `SNAPSHOT_AUTO_*` from `config/platform`.

- [ ] **Step 4: Remove from config/platform.ts**

Find: `grep -n "SNAPSHOT_AUTO\|SNAPSHOT_MANUAL" config/platform.ts`
Delete the 4 exports.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add config/platform.ts lib/service-config.ts
git rm lib/worker/handlers/snapshot-auto.ts
git commit -m "refactor(snapshots): remove legacy snapshot-auto + platform-wide config"
```

### Task 4.8: Display auto/manual split in cube snapshots UI

**Files:**
- Modify: `components/cube-snapshots.tsx`
- Modify: `app/(dashboard)/[spaceId]/cubes/[cubeId]/snapshots/page.tsx`

- [ ] **Step 1: Pass `kind` through the page query**

In `page.tsx`, include `kind: schema.cubeSnapshots.kind` in the select projection, and add it to the `snapshots.map(...)` returned shape + the `Snapshot` interface in the client component.

- [ ] **Step 2: Add tabs (Manual / Auto / All) in cube-snapshots.tsx**

Use the existing shadcn Tabs component. Filter the snapshots list by tab. Show a header above the manual list with "X of Y manual snapshots used" badge.

- [ ] **Step 3: Hide "Create Snapshot" button on Auto tab**

Snapshots there are system-managed; the create button only makes sense on Manual.

- [ ] **Step 4: Manual test**

```bash
pnpm dev
```
Verify: Trial user sees no Manual or Auto tab content (both empty + "Trial plan does not include snapshots"). Pro user sees both tabs after waiting for the hourly scheduler to run.

- [ ] **Step 5: Commit**

```bash
git add components/cube-snapshots.tsx "app/(dashboard)/[spaceId]/cubes/[cubeId]/snapshots/page.tsx"
git commit -m "feat(snapshots): split auto/manual in cube snapshots UI"
```

---

# PHASE 5 — Pin auto → manual

Goal: customer can convert an auto snapshot into a manual snapshot. The flag swap counts the snapshot against the plan's manual cap (rejected if cap is already full); after the swap, the snapshot survives auto-prune and can be deleted by the customer.

### Task 5.1: API route for pin

**Files:**
- Create: `app/api/spaces/[spaceId]/cubes/[cubeId]/snapshots/[snapshotId]/pin/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { and, eq } from "drizzle-orm"
import { type NextRequest, NextResponse } from "next/server"
import * as schema from "@/db/schema"
import {
  requireCubeAccess,
  requirePermission,
  requireSession,
  requireSpaceMember,
} from "@/lib/api/auth-helpers"
import { audit, extractRequestContext } from "@/lib/audit"
import { db } from "@/lib/db"
import { loadEffectiveLimits } from "@/lib/plan/limits"
import {
  assertCanCreateManualSnapshot,
  countManualSnapshotsForCube,
} from "@/lib/plan/snapshot-limits"

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ spaceId: string; cubeId: string; snapshotId: string }> }
) {
  const { spaceId, cubeId, snapshotId } = await ctx.params
  const session = await requireSession()
  if ("response" in session) return session.response
  const membership = await requireSpaceMember(session.user.id, spaceId)
  if ("response" in membership) return membership.response
  const perm = await requirePermission(membership.membership, "cube.manage")
  if ("response" in perm) return perm.response
  const access = await requireCubeAccess(membership.membership, cubeId)
  if ("response" in access) return access.response

  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: and(
      eq(schema.cubeSnapshots.id, snapshotId),
      eq(schema.cubeSnapshots.cubeId, cubeId),
      eq(schema.cubeSnapshots.spaceId, spaceId)
    ),
  })
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 })
  }
  if (snapshot.kind !== "auto") {
    return NextResponse.json(
      { error: "Snapshot is already manual" },
      { status: 400 }
    )
  }
  if (snapshot.status !== "complete") {
    return NextResponse.json(
      { error: "Snapshot is not in a complete state" },
      { status: 400 }
    )
  }

  // Cap check — pinning consumes a manual slot.
  const limits = await loadEffectiveLimits(spaceId)
  const manualCount = await countManualSnapshotsForCube(cubeId)
  const capCheck = assertCanCreateManualSnapshot(limits, manualCount)
  if (!capCheck.ok) {
    return NextResponse.json({ error: capCheck.error }, { status: 400 })
  }

  // Flip the kind + the legacy boolean. DB-only operation — restic still
  // has the snapshot tagged 'auto', but the next auto-prune will look at
  // the DB to decide what to forget. Cleaner than calling restic rewrite.
  await db
    .update(schema.cubeSnapshots)
    .set({ kind: "manual", isAutomatic: false })
    .where(eq(schema.cubeSnapshots.id, snapshotId))

  audit({
    action: "snapshot.pinned",
    category: "cube",
    actorType: "user",
    actorId: session.user.id,
    actorEmail: session.user.email,
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Pinned auto snapshot "${snapshot.name}" to manual`,
    metadata: { snapshotId },
    ...extractRequestContext(req.headers),
  })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Update auto-prune handler to filter by DB kind too**

The auto-prune handler already filters DB queries to `kind='auto'` — but it calls `restic forget --tag auto` which would still drop the pinned snapshot from restic (since restic still has the 'auto' tag). Fix: change `buildResticForgetArgs` to NOT pass `--tag auto`, and instead pass an explicit list of snapshot IDs to keep.

Better approach: pass `--keep-id <pinnedSnapshotId>` to restic forget for every pinned snapshot. Add to `snapshot-auto-prune.ts`:

```typescript
// Find all DB rows we've pinned (kind=manual but originally created as auto —
// proxy: any complete manual snapshot whose name starts with "Auto " — fragile).
// Better: add cube_snapshots.was_pinned column. For now, query: any kind=manual
// snapshot's storagePath that exists in restic, add as --keep-id.
const pinnedIds = await db
  .select({ storagePath: cubeSnapshots.storagePath })
  .from(cubeSnapshots)
  .where(and(eq(cubeSnapshots.cubeId, row.cubeId), eq(cubeSnapshots.kind, "manual")))
const keepIdArgs = pinnedIds
  .filter((p) => p.storagePath)
  .map((p) => `--keep-id ${p.storagePath}`)
  .join(" ")
// Concat onto the forget command
const fullArgs = `${args} ${keepIdArgs}`.trim()
```

Restic supports `--keep-id` (plural) since 0.16+. Verify pinned `RESTIC_VERSION` in `config/platform.ts` is ≥ 0.16. If not, bump.

- [ ] **Step 3: Manual test**

Create an auto snapshot via the scheduler. Click "Pin" on it. Verify:
- DB: `cube_snapshots.kind = 'manual'`
- Manual cap counter incremented
- Next auto-prune does NOT remove it from restic

- [ ] **Step 4: Commit**

```bash
git add "app/api/spaces/[spaceId]/cubes/[cubeId]/snapshots/[snapshotId]/pin/route.ts" lib/worker/handlers/snapshot-auto-prune.ts
git commit -m "feat(snapshots): pin auto → manual (cap-counted, restic-preserved)"
```

### Task 5.2: Pin button UI

**Files:**
- Create: `components/snapshot-pin-button.tsx`
- Modify: `components/cube-snapshots.tsx`

- [ ] **Step 1: Write the button component**

Small client component, `fetch` POST to the pin route, toast + `router.refresh()` on success.

- [ ] **Step 2: Add to auto snapshot rows**

Inside the Auto tab in `cube-snapshots.tsx`, add the Pin button next to Restore/Export.

- [ ] **Step 3: Manual test + commit**

```bash
git add components/snapshot-pin-button.tsx components/cube-snapshots.tsx
git commit -m "feat(snapshots): Pin button UI on auto snapshots"
```

---

# PHASE 6 — Backup pricing + Trial gating + pre-deletion default

Goal: backups cost $0.01/GB/month, billed hourly. Trial plans cannot create backups. Pre-deletion backup checkbox defaults to CHECKED on paid plans. Remove "Save as backup from running cube".

### Task 6.1: Append backup storage billing pass to billing-hourly

**Files:**
- Modify: `lib/worker/handlers/billing-hourly.ts`

- [ ] **Step 1: Find the end of the existing per-space loop**

Run: `grep -n "spacesFailed\|cycle complete\|cubesBySpace" lib/worker/handlers/billing-hourly.ts | head`

- [ ] **Step 2: Add a backup storage pass before "cycle complete"**

After the per-space cube charging loop, add:

```typescript
// ─── Backup storage billing pass ────────────────────────────────────
// Per CLAUDE.md: backups are chargeable storage, snapshots aren't.
// Rate is `platform_settings.backup_storage_rate_per_gb_per_month`.
const [settings] = await db
  .select({
    rate: schema.platformSettings.backupStorageRatePerGbPerMonth,
  })
  .from(schema.platformSettings)
  .where(eq(schema.platformSettings.id, 1))
  .limit(1)
const backupRatePerGbPerMonth = Number.parseFloat(settings?.rate ?? "0")
const backupRatePerGbPerHour = backupRatePerGbPerMonth / 730 // ~hours per month

if (backupRatePerGbPerHour > 0) {
  // Aggregate backup GB per space — only complete backups occupy storage.
  const backupRows = await db
    .select({
      spaceId: cubeBackups.spaceId,
      diskGb: cubeBackups.diskSizeGb,
      sizeBytes: cubeBackups.sizeBytes,
    })
    .from(cubeBackups)
    .where(eq(cubeBackups.status, "complete"))

  const totalGbBySpace = new Map<string, number>()
  for (const b of backupRows) {
    // Prefer actual compressed sizeBytes over the original diskSizeGb so
    // customers are billed for what the .cube actually consumes on S3.
    const gb = b.sizeBytes ? b.sizeBytes / 1024 ** 3 : b.diskGb
    totalGbBySpace.set(b.spaceId, (totalGbBySpace.get(b.spaceId) ?? 0) + gb)
  }

  for (const [spaceId, gb] of totalGbBySpace) {
    if (gb <= 0) continue
    const hourlyCost = Math.round(gb * backupRatePerGbPerHour * 10_000) / 10_000
    if (hourlyCost <= 0) continue

    try {
      await db.transaction(async (tx) => {
        const [space] = await tx
          .select({
            creditBalance: spaces.creditBalance,
            overageEnabled: spaces.overageEnabled,
            overageCapUsd: spaces.overageCapUsd,
            thisPeriodOverageUsd: spaces.thisPeriodOverageUsd,
            subscriptionStatus: spaces.subscriptionStatus,
          })
          .from(spaces)
          .where(eq(spaces.id, spaceId))
          .for("update")
          .limit(1)
        if (!space) return

        const planRow = await getSpacePlanRowTx(tx, spaceId)
        const overrides = await getSpaceOverridesTx(tx, spaceId)
        const limits = effectiveLimits(planRow, overrides)

        await applyOverageCascadeTx({
          tx,
          input: {
            space: {
              id: spaceId,
              creditBalance: space.creditBalance ?? "0",
              allowOverage: limits.allowOverage,
              overageEnabled: space.overageEnabled,
              overageCapUsd: space.overageCapUsd,
              thisPeriodOverageUsd: space.thisPeriodOverageUsd,
              subscriptionStatus: space.subscriptionStatus,
            },
            totalCost: hourlyCost,
          },
          billedAt: new Date(),
        })

        await tx.insert(billingEvents).values({
          spaceId,
          amount: hourlyCost.toFixed(4),
          type: "hourly_charge", // existing enum — description distinguishes
          description: `Backup storage: ${gb.toFixed(2)} GB @ $${backupRatePerGbPerMonth}/GB/mo`,
        })
      })
    } catch (err) {
      console.error(
        `[billing-hourly] backup storage charge failed for space ${spaceId}:`,
        err
      )
    }
  }
}
```

Add `cubeBackups` to the imports.

- [ ] **Step 2: Manual smoke test**

In dev, create a backup, wait 1 minute, run `pnpm tsx -e "import('@/lib/worker/handlers/billing-hourly').then(m => m.handleBillingHourly([]))"`. Verify the space credit balance decreases by roughly `(diskGb / 1024^3) * 0.01 / 730`.

- [ ] **Step 3: Commit**

```bash
git add lib/worker/handlers/billing-hourly.ts
git commit -m "feat(billing): per-GB-month backup storage charging"
```

### Task 6.2: Default "Preserve backup" to checked on paid plans, hide on Trial

**Files:**
- Modify: `components/cube-detail-header.tsx`

- [ ] **Step 1: Pass plan info into the component**

Find where `cube-detail-header.tsx` is rendered (likely from the cube detail page server component). Add a prop `planAllowsBackups: boolean` (= `effectiveLimits.maxBackups != null && effectiveLimits.maxBackups > 0`).

- [ ] **Step 2: Update state init**

Change:
```typescript
const [preserveBackup, setPreserveBackup] = useState(false)
```
to:
```typescript
const [preserveBackup, setPreserveBackup] = useState(planAllowsBackups)
```

- [ ] **Step 3: Hide the checkbox entirely when plan disallows**

Wrap the existing `{canCreateBackup && (...)}` JSX with an additional `&& planAllowsBackups`:

```tsx
{canCreateBackup && planAllowsBackups && (
  <div className="space-y-2 rounded-md border p-3">
    {/* … existing block, but Checkbox is now default-checked … */}
  </div>
)}
```

- [ ] **Step 4: Run dev, manually test as Trial vs Pro**

Trial: no checkbox visible, delete just deletes. Pro: checkbox pre-checked.

- [ ] **Step 5: Commit**

```bash
git add components/cube-detail-header.tsx app/path/where/its/rendered/page.tsx
git commit -m "feat(cubes): default preserve-backup checkbox on paid plans"
```

### Task 6.3: Remove "Save as Backup from running cube" feature

**Files:**
- Modify: `components/cube-snapshots.tsx` (remove the createBackupFromCube button + sheet)
- Delete: `app/actions/backups.ts` `createBackupFromCube` export only
- Modify: any orbit / admin path that calls it (grep first)

- [ ] **Step 1: Find all callers**

Run: `grep -rn "createBackupFromCube" app/ components/ lib/`
Expected: in `components/cube-snapshots.tsx` (sheet trigger), possibly in `app/actions/backups.ts` definition.

- [ ] **Step 2: Remove the UI sheet + button**

In `components/cube-snapshots.tsx`, find the backup sheet (search for `createBackupSchema` / `createBackupFromCube`) and delete the entire block — sheet, form, button trigger.

- [ ] **Step 3: Remove the action**

Delete the `createBackupFromCube` function from `app/actions/backups.ts`. Keep `redeployBackup` and any others.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add components/cube-snapshots.tsx app/actions/backups.ts
git commit -m "refactor(backups): remove save-as-backup from running cube"
```

---

# PHASE 7 — Promote snapshot → backup

Goal: customer picks a complete snapshot and promotes it to a backup. New `cube_backups` row + `.cube` archive built from the snapshot.

### Task 7.1: Write the promote-to-backup handler

**Files:**
- Create: `lib/worker/handlers/snapshot-promote-to-backup.ts`

- [ ] **Step 1: Write the handler**

Pattern: same as `snapshot-export.ts` but the upload target is the backups prefix and a `cube_backups` row is inserted/updated.

Reuse the helper from `lib/cubes/create-pre-deletion-backup.ts` to compute `cubeConfig` JSONB (the customer-facing redeployment expects domains/tcp/etc.). The promote flow uses the SOURCE cube's current state for `cubeConfig` (not the snapshot, since snapshots don't carry config).

```typescript
// lib/worker/handlers/snapshot-promote-to-backup.ts
import { eq } from "drizzle-orm"
import type { Job } from "pg-boss"
import {
  cubeBackups,
  cubeSnapshots,
  cubes,
  lifecycleLogs,
} from "@/db/schema"
import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { connectToServer, execCommand, shellEscape } from "@/lib/ssh"
import { adjustBackendUsage, selectBackend } from "@/lib/storage/backends"
import { buildCubeArchive } from "@/lib/storage/cube-archive"
import { loadResticRepoConfig } from "@/lib/storage/restic"
import { s3HostUpload } from "@/lib/storage/s3-transfer"
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat"
import { JobLogger } from "@/lib/worker/job-log"
import type { SnapshotPromoteToBackupPayload } from "@/lib/worker/job-types"

async function handleJob(
  job: Job<SnapshotPromoteToBackupPayload>
): Promise<void> {
  const { snapshotId, cubeId, spaceId, serverId, backupId } = job.data
  const log = new JobLogger(job.id, "snapshot.promote-to-backup", "cube", cubeId)

  // Claim backup row pending → creating
  const [claimed] = await db
    .update(cubeBackups)
    .set({ status: "creating" })
    .where(eq(cubeBackups.id, backupId))
    .returning()
  if (!claimed || claimed.status !== "creating") {
    await log.warn("Backup not pending, skipping")
    return
  }

  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, snapshotId),
  })
  if (!snapshot || !snapshot.storagePath || !snapshot.storageBackendId) {
    await markBackupFailed(backupId, "Source snapshot invalid")
    return
  }

  const cube = await db.query.cubes.findFirst({ where: eq(cubes.id, cubeId) })
  if (!cube) {
    await markBackupFailed(backupId, "Source cube not found")
    return
  }

  const destBackend = await selectBackend()
  if (!destBackend) {
    await markBackupFailed(backupId, "No active storage backend")
    return
  }

  const { config: repoConfig } = await loadResticRepoConfig(
    cubeId,
    snapshot.storageBackendId
  )
  const { client } = await connectToServer(serverId)
  const workingDir = `/tmp/krova-promote-${backupId}`

  try {
    await withCubeHeartbeat(cubeId, async () => {
      await execCommand(client, `mkdir -p ${shellEscape(workingDir)}`, 10_000)

      const env_ = `RESTIC_REPOSITORY=${shellEscape(repoConfig.repoUrl)} RESTIC_PASSWORD=${shellEscape(repoConfig.repoPassword)} AWS_ACCESS_KEY_ID=${shellEscape(repoConfig.accessKeyId)} AWS_SECRET_ACCESS_KEY=${shellEscape(repoConfig.secretAccessKey)} RESTIC_PROGRESS_FPS=0 RESTIC_CACHE_DIR=/var/lib/krova/restic-cache`
      await log.step("Restic dump rootfs", async () => {
        const r = await execCommand(
          client,
          `${env_} restic -o s3.bucket-lookup=path dump ${shellEscape(snapshot.storagePath!)} rootfs.ext4 > ${shellEscape(workingDir + "/rootfs.ext4")}`,
          1_800_000
        )
        if (r.exitCode !== 0) throw new Error(`restic dump failed: ${r.stderr.slice(0, 500)}`)
      })

      const archiveResult = await log.step("Build .cube archive", async () => {
        return buildCubeArchive(client, {
          workingDir,
          rootfsFilename: "rootfs.ext4",
          archiveFilename: `${backupId}.cube`,
          manifestSource: {
            source: {
              cubeId,
              cubeName: cube.name,
              spaceId,
              platformVersion: null,
            },
            config: {
              vcpus: cube.vcpus,
              ramMb: cube.ramMb,
              diskLimitGb: cube.diskLimitGb,
              imageId: cube.imageId,
              userData: cube.userData ?? null,
              kernelArgs: null,
            },
          },
        })
      })

      const envPrefix = env.NODE_ENV === "production" ? "production" : "development"
      const s3Key = `${envPrefix}/backups/${spaceId}/${backupId}.cube`
      await log.step("Upload to S3", async () => {
        await s3HostUpload(client, {
          backend: destBackend,
          localPath: archiveResult.archivePath,
          s3Key,
        })
      })

      await execCommand(client, `rm -rf ${shellEscape(workingDir)}`, 30_000)

      await db
        .update(cubeBackups)
        .set({
          status: "complete",
          storagePath: s3Key,
          storageBackendId: destBackend.id,
          sizeBytes: archiveResult.archiveSizeBytes,
          completedAt: new Date(),
        })
        .where(eq(cubeBackups.id, backupId))

      await adjustBackendUsage(destBackend.id, archiveResult.archiveSizeBytes)

      await db.insert(lifecycleLogs).values({
        entityType: "cube",
        entityId: cubeId,
        message: `Snapshot "${snapshot.name}" promoted to backup`,
      })
      audit({
        action: "backup.promoted_from_snapshot",
        category: "cube",
        actorType: "user",
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `Snapshot ${snapshotId} promoted to backup ${backupId}`,
        metadata: { snapshotId, backupId },
        source: "worker",
      })
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await log.error(`Promote failed: ${reason}`)
    await execCommand(client, `rm -rf ${shellEscape(workingDir)}`, 30_000).catch(() => {})
    await markBackupFailed(backupId, reason)
  } finally {
    client.end()
  }
}

async function markBackupFailed(backupId: string, reason: string): Promise<void> {
  await db
    .update(cubeBackups)
    .set({ status: "failed" })
    .where(eq(cubeBackups.id, backupId))
}

export async function handleSnapshotPromoteToBackup(
  jobs: Job<SnapshotPromoteToBackupPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleJob(job)
  }
}
```

- [ ] **Step 2: Register in boss.ts**

```typescript
const { handleSnapshotPromoteToBackup } = await import(
  "@/lib/worker/handlers/snapshot-promote-to-backup"
)
// …
await boss.work(JOB_NAMES.SNAPSHOT_PROMOTE_TO_BACKUP, handleSnapshotPromoteToBackup)
```

- [ ] **Step 3: Commit**

```bash
git add lib/worker/handlers/snapshot-promote-to-backup.ts lib/worker/boss.ts
git commit -m "feat(snapshots): promote-to-backup handler"
```

### Task 7.2: Server action + UI button

**Files:**
- Modify: `app/actions/snapshots.ts`
- Modify: `components/cube-snapshots.tsx`

- [ ] **Step 1: Add the server action**

```typescript
export async function promoteSnapshotToBackup(
  spaceId: string,
  cubeId: string,
  snapshotId: string,
  name: string
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) return { error: "Unauthorized" }

    const perm = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "cube.manage"
    )
    if ("error" in perm) return perm

    const access = await requireActionCubeAccess(perm.membership, cubeId)
    if (access) return access

    const trimmed = validateName(name)
    if (!trimmed) return { error: "Backup name must be 1–64 chars" }

    const storage = await assertBackupStorageAvailable()
    if (storage) return storage

    const snapshot = await db.query.cubeSnapshots.findFirst({
      where: and(
        eq(schema.cubeSnapshots.id, snapshotId),
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.spaceId, spaceId)
      ),
    })
    if (!snapshot) return { error: "Snapshot not found" }
    if (snapshot.status !== "complete") {
      return { error: "Snapshot must be complete to promote" }
    }

    const cube = await db.query.cubes.findFirst({
      where: eq(schema.cubes.id, cubeId),
    })
    if (!cube) return { error: "Cube not found" }

    // Reuse createPreDeletionBackup helper for cubeConfig + insert.
    // Pass deleteCubeAfter: false to keep source cube alive.
    const { backupId } = await db.transaction(async (tx) => {
      await acquireSpaceLock(tx, spaceId)
      const limits = await loadEffectiveLimitsTx(tx, spaceId)
      const backupCount = await countSpaceBackups(spaceId) // count, not tx-aware ok here
      const capCheck = assertCanCreateBackup(limits, backupCount)
      if (!capCheck.ok) throw new Error(capCheck.error)

      return createPreDeletionBackup({
        cube,
        createdBy: session.user.id,
        lifecycleMessage: `Promoting snapshot "${snapshot.name}" to backup "${trimmed}"`,
        backupName: trimmed,
        deleteCubeAfter: false,
      })
    })

    // The helper enqueued `backup.create` — but we want the
    // promote-to-backup handler instead (which restic-dumps from the
    // snapshot rather than zstd-compressing the live rootfs). Override
    // by enqueueing our handler directly. Update createPreDeletionBackup
    // to accept a `skipEnqueue: true` option so we can enqueue ours.

    // ... handler enqueue
    await enqueueJob(JOB_NAMES.SNAPSHOT_PROMOTE_TO_BACKUP, {
      snapshotId,
      cubeId,
      spaceId,
      serverId: cube.serverId,
      backupId,
      backupName: trimmed,
    })

    return { success: true, data: { backupId } }
  } catch (err) {
    if (err instanceof Error) return { error: err.message }
    return { error: "Something went wrong while promoting the snapshot." }
  }
}
```

NOTE: the comment about `skipEnqueue` indicates a refactor — modify `lib/cubes/create-pre-deletion-backup.ts` to accept `skipEnqueue?: boolean` and bypass the `enqueueJob(JOB_NAMES.BACKUP_CREATE)` when true. This is a tiny additive change.

- [ ] **Step 2: Modify createPreDeletionBackup to support skipEnqueue**

In `lib/cubes/create-pre-deletion-backup.ts`, add to the opts:

```typescript
skipEnqueue?: boolean // promote-from-snapshot caller enqueues a different handler
```

Wrap the existing `enqueueJob(JOB_NAMES.BACKUP_CREATE, …)` in `if (!opts.skipEnqueue) { … }`.

Update the promote action above to pass `skipEnqueue: true`.

- [ ] **Step 3: Add UI button**

In `components/cube-snapshots.tsx`, for each complete snapshot row add:

```tsx
<Button size="sm" variant="outline" onClick={() => setPromoteSnapshotId(snapshot.id)}>
  <ArchiveIcon className="size-4" />
  Save as Backup
</Button>
```

Use an AlertDialog (per Rule 12 — confirmations) to confirm with a name input.

- [ ] **Step 4: Commit**

```bash
git add app/actions/snapshots.ts lib/cubes/create-pre-deletion-backup.ts components/cube-snapshots.tsx
git commit -m "feat(snapshots): promote-to-backup action + UI button"
```

---

# PHASE 8 — Orbit admin UI + platform settings + docs

Goal: operators can edit per-plan snapshot config from Orbit; the backup storage rate is editable in platform settings; CLAUDE.md + README.md document the new system.

### Task 8.1: Add snapshot fields to plan form sheet

**Files:**
- Modify: `app/(orbit)/orbit/plans/_components/plan-form-sheet.tsx`
- Modify: `app/actions/orbit-plans.ts`

- [ ] **Step 1: Extend Zod schema in the form**

Add to `formSchema`:
```typescript
autoSnapshotCadenceHours: z.number().int().min(2).max(168).nullable(),
autoSnapshotKeepLast: z.number().int().min(0).max(100),
autoSnapshotKeepDaily: z.number().int().min(0).max(365),
autoSnapshotKeepWeekly: z.number().int().min(0).max(104),
maxManualSnapshotsPerCube: z.number().int().min(0).max(100),
```

Add to `PlanFormInitial`, `toFormValues`, and the form's default values.

- [ ] **Step 2: Render fields in the form JSX**

After the existing snapshot/backup count fields, add a new section "Snapshots":

```tsx
<Separator />
<div>
  <h3>Snapshots</h3>
  <FormField control={form.control} name="autoSnapshotCadenceHours" render={({field}) => (
    <FormItem>
      <FormLabel>Auto-snapshot cadence (hours)</FormLabel>
      <FormControl>
        <Input type="number" min={2} {...field}
          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
          value={field.value ?? ""}
        />
      </FormControl>
      <FormDescription>Blank = disabled. Minimum 2h.</FormDescription>
      <FormMessage />
    </FormItem>
  )} />
  {/* keep-last, keep-daily, keep-weekly inputs */}
  {/* maxManualSnapshotsPerCube input */}
</div>
```

- [ ] **Step 3: Extend the server action schema**

In `app/actions/orbit-plans.ts`, add the same 5 fields to the Zod schemas for `createPlan` + `updatePlan`. Persist them in the insert/update.

- [ ] **Step 4: Update plan-list / plan detail page to display the new values**

In `app/(orbit)/orbit/plans/[planId]/page.tsx`, add a "Snapshots" card showing the configured cadence + buckets + manual cap.

- [ ] **Step 5: Commit**

```bash
git add "app/(orbit)/orbit/plans/_components/plan-form-sheet.tsx" "app/(orbit)/orbit/plans/[planId]/page.tsx" app/actions/orbit-plans.ts
git commit -m "feat(orbit): per-plan snapshot config form fields"
```

### Task 8.2: Platform-settings field for backup storage rate

**Files:**
- Modify: `app/actions/orbit-platform-settings.ts`
- Modify: `app/(orbit)/orbit/platform-settings/page.tsx` (or whichever file has the form)

- [ ] **Step 1: Find the form file**

Run: `find "app/(orbit)" -path "*platform-settings*" -type f`

- [ ] **Step 2: Add field to Zod schema + form**

```typescript
backupStorageRatePerGbPerMonth: z.number().min(0).max(10),
```

UI: a number input with helper text "Per-GB-month rate billed hourly. Default $0.01."

- [ ] **Step 3: Commit**

```bash
git add "app/(orbit)/orbit/platform-settings/page.tsx" app/actions/orbit-platform-settings.ts
git commit -m "feat(orbit): backup storage rate setting"
```

### Task 8.3: Update CLAUDE.md + README.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Replace the "Snapshots & Backups" section in CLAUDE.md**

Update the table and prose to reflect:
- Per-plan auto cadence (12h/6h/4h Starter/Pro/Business; Trial disabled)
- Per-plan retention buckets via restic `forget --keep-last/daily/weekly`
- Per-plan manual cap (1/2/4)
- Sleeping-cube one-snapshot rule + `cubes.snapshotted_since_sleep` column
- Snapshot export as `.cube` (24h presigned email link)
- Clone snapshot → new cube
- Pin auto → manual (cap-counted)
- Promote snapshot → backup (chargeable)
- Backup storage billing ($0.01/GB/mo, hourly)
- Pre-deletion backup default-checked on paid plans
- "Save as backup from running cube" removed

- [ ] **Step 2: Add a new Rule** (Rule 48?) about retention bucket consistency:

> **48. Auto-snapshot retention is enforced by `restic forget` with `--keep-last/daily/weekly` AND a `--keep-id` list for pinned snapshots.** A snapshot pinned by the customer is flipped from `kind='auto'` to `kind='manual'` in our DB but the restic snapshot keeps its original tag — so `restic forget --tag auto` alone would drop it. The auto-prune handler MUST query `cube_snapshots WHERE kind='manual'` per cube, take their `storagePath` (restic snapshot id), and append `--keep-id <id>` to the forget command for each. Verify the pinned `RESTIC_VERSION` in `config/platform.ts` supports `--keep-id` (added in 0.16).

- [ ] **Step 3: Update README.md** with a customer-facing description

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: snapshot/backup overhaul"
```

---

# Self-review checklist

After all phases:

- [ ] **Spec coverage**
  - Auto cadence per plan ✓ (Phase 0 schema, Phase 4 scheduler)
  - Retention buckets per plan ✓ (Phase 4 pruner)
  - Manual cap per plan ✓ (Phase 1)
  - Trial = no snapshots ✓ (Phase 1, Phase 4 cadence=NULL)
  - Sleeping cube one-snapshot rule ✓ (Phase 4 + cube-sleep handler)
  - Snapshot download .cube + 24h email link ✓ (Phase 2)
  - Clone snapshot → new cube ✓ (Phase 3)
  - Pin auto → manual ✓ (Phase 5)
  - Promote snapshot → backup ✓ (Phase 7)
  - Backup pricing $0.01/GB/mo hourly ✓ (Phase 6)
  - Backup count caps 3/10/30 ✓ (already in plans.maxBackups since 0037; verified in Phase 1)
  - Pre-deletion backup default-checked on paid plans ✓ (Phase 6)
  - Remove "Save as backup from running cube" ✓ (Phase 6)
  - Orbit admin UI for new fields ✓ (Phase 8)
  - Backup storage rate operator-tunable ✓ (Phase 8)
  - Docs updated ✓ (Phase 8)

- [ ] **Production data safety (Rule 40)**
  - Migration 0055 adds only nullable / defaulted columns ✓
  - No DROP COLUMN, no ALTER COLUMN TYPE ✓
  - Seed UPDATEs are idempotent + use ID-based WHERE ✓
  - The `is_automatic` legacy column is KEPT (not dropped) — backfilled but not removed; will retire later
  - `cube_snapshots.kind` defaults to 'manual' — existing rows initially all 'manual' until the backfill UPDATE runs ✓

- [ ] **Plan documentation matches code**
  - JOB_NAMES constant matches every `boss.work` + `boss.schedule` ✓
  - All new queues registered in ensure-queues.ts ✓
  - Recurring queues have `policy: "exclusive"` (Rule 34 / scheduler comment) ✓

- [ ] **No leftover legacy references**
  - `getSnapshotConfig` removed from `lib/service-config.ts` ✓
  - `SNAPSHOT_AUTO_*` constants removed from `config/platform.ts` ✓
  - `snapshot-auto.ts` deleted ✓
  - `JOB_NAMES.SNAPSHOT_AUTO` removed ✓
  - `createBackupFromCube` server action + UI button removed ✓

---

## Notes on test coverage

This plan includes unit tests for the pure decision functions (`shouldScheduleAutoSnapshot`, `buildResticForgetArgs`, `assertCanCreateManualSnapshot`, `assertCanCreateBackup`) — those have the highest risk of subtle wrong behavior at boundaries. The handlers themselves are end-to-end SSH/restic flows where a unit test gives little value; they're verified by manual smoke tests in dev as called out at the end of each phase.

If you want richer integration tests, add a Vitest suite that hits the actions through a test db setup — pattern in `tests/lib/billing/` is the existing reference, model after `overage.test.ts`.

---

## Estimated effort

- Phase 0 (schema): 1.5h
- Phase 1 (manual cap + kind): 1.5h
- Phase 2 (export): 4h (handler + email template + reaper + UI + manual smoke)
- Phase 3 (clone): 3h
- Phase 4 (scheduler + pruner): 4h
- Phase 5 (pin): 1.5h
- Phase 6 (backup billing + Trial gate + remove save-as-backup): 2.5h
- Phase 7 (promote): 2h
- Phase 8 (Orbit + docs): 2h

Total: ~22 engineering hours, 1.5–2 working days if uninterrupted.
