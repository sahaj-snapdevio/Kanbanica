# Snapshot status decoupling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A snapshot's `status` describes only the snapshot; once `complete` it stays `complete` until deleted, so a failed restore (or any operation) can never brick it.

**Architecture:** Restore claims the **cube** (`status='stopping'`) as its lock and normalizes the snapshot back to `complete` on every terminal outcome — it never writes `restoring`/`failed` to the snapshot. Create-failures route through one pure policy (`auto → delete row`, `manual → dismissible failed note`). A one-shot script heals existing wrongly-`failed`/`restoring` rows. No schema change.

**Tech Stack:** Next.js 16 server actions, Drizzle ORM, pg-boss worker handlers, `tsx --test` unit tests, React (shadcn/ui).

**Spec:** [docs/superpowers/specs/2026-05-30-snapshot-status-decoupling-design.md](../specs/2026-05-30-snapshot-status-decoupling-design.md)

**Refinements vs spec (intentional, same intent):**
- Restore handler **normalizes snapshot → `complete`** on success AND failure (instead of "remove the failed writes"). The snapshot is always intact on restore failure (restore only reads restic), so this is correct and self-heals deploy-boundary rows.
- Worker guard accepts `snapshot.status IN ('complete','restoring')` (the `restoring` allowance only matters for jobs already in flight at deploy time) AND requires `cube.status='stopping'`.

---

## Task 1: Pure failure-policy helpers (TDD)

Centralizes the two decisions so create + the heal script share one source of truth (Rule 14) and the risky logic is unit-tested.

**Files:**
- Create: `lib/snapshots/failure-policy.ts`
- Test: `lib/snapshots/failure-policy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/snapshots/failure-policy.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifySnapshotForHeal,
  snapshotCreateFailureAction,
} from "./failure-policy";

test("create failure: auto deletes the row, manual keeps a dismissible note", () => {
  assert.equal(snapshotCreateFailureAction("auto"), "delete");
  assert.equal(snapshotCreateFailureAction("manual"), "mark-failed");
});

test("heal: a complete row is left alone", () => {
  assert.equal(
    classifySnapshotForHeal({ status: "complete", kind: "manual", storagePath: "abc" }),
    "leave"
  );
});

test("heal: failed/restoring WITH data → heal back to complete (intact, wrongly marked)", () => {
  assert.equal(
    classifySnapshotForHeal({ status: "failed", kind: "manual", storagePath: "abc" }),
    "heal-to-complete"
  );
  assert.equal(
    classifySnapshotForHeal({ status: "restoring", kind: "auto", storagePath: "abc" }),
    "heal-to-complete"
  );
});

test("heal: auto failed/restoring WITHOUT data → delete (auto noise, no artifact)", () => {
  assert.equal(
    classifySnapshotForHeal({ status: "failed", kind: "auto", storagePath: null }),
    "delete"
  );
});

test("heal: manual failed WITHOUT data → leave as the dismissible note", () => {
  assert.equal(
    classifySnapshotForHeal({ status: "failed", kind: "manual", storagePath: null }),
    "leave"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './failure-policy'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/snapshots/failure-policy.ts
export type SnapshotKind = "auto" | "manual";
export type SnapshotStatus =
  | "pending"
  | "creating"
  | "complete"
  | "restoring"
  | "failed";

/**
 * A snapshot CREATE that never produced a usable artifact.
 * - auto   → delete the row; the scheduler retries on the next cadence and the
 *            customer can't act on it, so a lingering note would be pure noise.
 * - manual → keep a non-blocking, dismissible `failed` note (holds no data,
 *            excluded from the manual-snapshot cap).
 */
export function snapshotCreateFailureAction(
  kind: SnapshotKind
): "delete" | "mark-failed" {
  return kind === "auto" ? "delete" : "mark-failed";
}

/**
 * One-shot heal classifier for an EXISTING cube_snapshots row (see
 * scripts/heal-snapshot-status.ts). A `restoring` row always had data (restore
 * requires a `complete` source), and a `failed` row WITH data is a snapshot a
 * failed restore — or a post-complete create downgrade — wrongly bricked.
 */
export function classifySnapshotForHeal(row: {
  status: SnapshotStatus;
  kind: SnapshotKind;
  storagePath: string | null;
}): "heal-to-complete" | "delete" | "leave" {
  const stuck = row.status === "failed" || row.status === "restoring";
  if (!stuck) {
    return "leave";
  }
  if (row.storagePath) {
    return "heal-to-complete";
  }
  if (row.kind === "auto") {
    return "delete";
  }
  return "leave";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (all 5 tests under failure-policy.test.ts green).

- [ ] **Step 5: Commit**

```bash
git add lib/snapshots/failure-policy.ts lib/snapshots/failure-policy.test.ts
git commit -m "feat(snapshots): pure failure-policy helpers (create-failure + heal classifier)"
```

---

## Task 2: Create handler routes failures through the policy + never downgrades a complete row

**Files:**
- Modify: `lib/worker/handlers/snapshot-create.ts`

- [ ] **Step 1: Add the import and a local `failCreate` helper**

At the top of the file, add to the existing imports:

```ts
import { snapshotCreateFailureAction } from "@/lib/snapshots/failure-policy";
```

Add this helper function just above `async function handleSnapshotCreateJob`:

```ts
/**
 * Apply the create-failure policy to a row that never produced a usable
 * snapshot: auto → delete; manual → a dismissible `failed` note (storagePath
 * nulled — it holds no data). Lifecycle log + audit are written by the caller.
 */
async function failCreate(
  snapshotId: string,
  kind: "auto" | "manual"
): Promise<void> {
  if (snapshotCreateFailureAction(kind) === "delete") {
    await db
      .delete(cubeSnapshots)
      .where(eq(cubeSnapshots.id, snapshotId))
      .catch(() => {});
    return;
  }
  await db
    .update(cubeSnapshots)
    .set({ status: "failed", storagePath: null })
    .where(eq(cubeSnapshots.id, snapshotId));
}
```

- [ ] **Step 2: Replace the four pre-upload failure exits**

Replace each `db.update(cubeSnapshots).set({ status: "failed" })...` block at the early guards with `await failCreate(snapshotId, snapshot.kind)`:

- "cube not running/sleeping" guard (currently `:48-51`):

```ts
  if (!cube || (cube.status !== "running" && cube.status !== "sleeping")) {
    await failCreate(snapshotId, snapshot.kind);
    console.log(
      `[snapshot-create] cube ${cubeId} not running/sleeping (status=${cube?.status}), marking snapshot failed`
    );
    return;
  }
```

- "mid-transfer" guard (currently `:65-69`):

```ts
  if (cube.transferState !== "idle") {
    await failCreate(snapshotId, snapshot.kind);
    await log.error(
      `Snapshot "${snapshot.name}" refused: cube is mid-transfer (transferState=${cube.transferState}). Try again once the transfer completes.`
    );
    return;
  }
```

- "backend resolution failed" catch (currently `:103-106`): replace the `db.update(...).set({ status: "failed" })` line with `await failCreate(snapshotId, snapshot.kind);` (keep the surrounding `console.error`, `log.error`, and lifecycle-log insert).

- "guarded-connect failure" catch (currently `:152-155`, today a `db.delete(...)`): replace the delete with `await failCreate(snapshotId, snapshot.kind);` (keep the `log.error` + lifecycle-log insert). This unifies the path so a manual connect-fail now leaves a dismissible note instead of silently vanishing.

- [ ] **Step 3: Fix the main catch so it never downgrades a `complete` row**

Replace the storagePath-based branch (currently `:305-323`) with a status re-read:

```ts
    // Re-read the row's CURRENT status. `storagePath` + `status='complete'` are
    // written together (step 8), so if the row already reached `complete` the
    // failure was in a trivial post-success step (adjustBackendUsage / lifecycle
    // log / audit / email) — the snapshot is GOOD. Never downgrade it.
    const [currentRow] = await db
      .select({ status: cubeSnapshots.status })
      .from(cubeSnapshots)
      .where(eq(cubeSnapshots.id, snapshotId))
      .limit(1);
    if (currentRow && currentRow.status !== "complete") {
      await failCreate(snapshotId, snapshot.kind);
    } else {
      console.log(
        `[snapshot-create] snapshot ${snapshotId} already complete — post-success step failed, leaving it complete`
      );
    }
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (No unused-import errors; `failCreate` is referenced at every exit.)

- [ ] **Step 5: Commit**

```bash
git add lib/worker/handlers/snapshot-create.ts
git commit -m "fix(snapshots): create-failures route through policy; never downgrade a complete snapshot"
```

---

## Task 3: Restore handler — guard on the cube, normalize snapshot to complete, reset cube on connect-fail

**Files:**
- Modify: `lib/worker/handlers/snapshot-restore.ts`

- [ ] **Step 1: Change the idempotency guard to the cube claim**

Replace the snapshot-status guard (currently `:29-43`) so it accepts a `complete` (or, for deploy-boundary in-flight jobs, `restoring`) snapshot and defers the real claim check to the cube:

```ts
  // 1. Load snapshot — it must be a usable, complete snapshot. (Under the new
  //    model restore never flips it to `restoring`; the `restoring` allowance
  //    here only covers a job already in flight across the deploy that changed
  //    this contract.) The REAL claim is the cube being `stopping` (step 2).
  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, snapshotId),
  });
  if (
    !snapshot ||
    (snapshot.status !== "complete" && snapshot.status !== "restoring")
  ) {
    console.log(
      `[snapshot-restore] snapshot ${snapshotId} not complete (status=${snapshot?.status}), skipping`
    );
    return;
  }
  if (!snapshot.storagePath) {
    throw new Error(
      `Snapshot ${snapshotId} has no restic snapshot id (storagePath)`
    );
  }
```

- [ ] **Step 2: Add the cube-stopping claim check right after the cube is loaded**

After the `if (!cube) { throw ... }` block (currently `:61-63`), insert:

```ts
  // The restore action atomically set the cube to `stopping` before enqueuing.
  // That `stopping` state IS the restore lock (it replaced the snapshot
  // `restoring` flag). A pg-boss retry after a terminal outcome sees the cube in
  // running/sleeping/error and correctly skips — no double-restore.
  if (cube.status !== "stopping") {
    console.log(
      `[snapshot-restore] cube ${cubeId} not stopping (status=${cube.status}) — restore not claimed or already resolved, skipping`
    );
    return;
  }
```

- [ ] **Step 3: On the guarded-connect failure, normalize snapshot to complete AND reset the cube**

Replace the connect-fail catch body (currently `:99-117`) so the snapshot ends `complete` (it was never touched) and the cube is returned to its pre-restore state instead of being stranded in `stopping`:

```ts
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[snapshot-restore] connect failed snapshotId=${snapshotId}: ${reason}`
    );
    await log.error(`Snapshot restore failed: ${reason}`);
    // The snapshot's restic data was never touched — it stays a usable,
    // re-restorable `complete` snapshot. The rootfs was never touched either,
    // so return the cube to its pre-restore state (the action set it to
    // `stopping`); leaving it `stopping` would strand it for cube.stale-check.
    await db
      .update(cubeSnapshots)
      .set({ status: "complete" })
      .where(eq(cubeSnapshots.id, snapshotId));
    await db
      .update(cubes)
      .set({
        status: wasRunning ? "running" : "sleeping",
        lastBilledAt: wasRunning ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(cubes.id, cubeId));
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Snapshot restore failed: ${reason} (cube unchanged)`,
    });
    return;
  }
```

- [ ] **Step 4: Keep the success-path snapshot write as `complete` (normalization)**

The success update (currently `:348-351`) already sets `status: "complete"`. Leave it — it normalizes any deploy-boundary `restoring` row back to `complete`. No change.

- [ ] **Step 5: In the main catch, normalize snapshot to complete instead of failed**

Replace the snapshot write in the main catch (currently `:500-503`):

```ts
    // The snapshot's restic data is intact regardless of how the restore ended
    // (restore only READS the repo) — it stays a usable, re-restorable
    // `complete` snapshot. The OPERATION's failure is recorded on the cube
    // (error/recovered) + lifecycle log + audit below, not on the snapshot.
    await db
      .update(cubeSnapshots)
      .set({ status: "complete" })
      .where(eq(cubeSnapshots.id, snapshotId));
```

Leave the surrounding lifecycle log, `triggerCubeLifecycleEvent`, and `audit` calls untouched (they describe the operation; the Pusher `snapshotStatus: "failed"` payload is a transient UI signal, not the row's status).

- [ ] **Step 6: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/worker/handlers/snapshot-restore.ts
git commit -m "fix(snapshots): restore claims the cube + keeps the snapshot complete on every outcome"
```

---

## Task 4: Dashboard restore action stops writing `restoring`

**Files:**
- Modify: `app/actions/snapshots.ts` (`restoreSnapshot`, the claim transaction ~`:246-277`)

- [ ] **Step 1: Remove the snapshot → restoring write inside the claim transaction**

Delete the snapshot update inside the `db.transaction` (currently `:271-274`) so the transaction only claims the cube → `stopping`:

```ts
    const claimed = await db.transaction(async (tx) => {
      const [updatedCube] = await tx
        .update(schema.cubes)
        .set({ status: "stopping", updatedAt: new Date() })
        .where(
          and(
            eq(schema.cubes.id, cubeId),
            eq(schema.cubes.spaceId, spaceId),
            ne(schema.cubes.status, "deleted"),
            ne(schema.cubes.status, "stopping"),
            ne(schema.cubes.status, "error"),
            ne(schema.cubes.status, "pending"),
            ne(schema.cubes.status, "booting"),
            eq(schema.cubes.transferState, "idle")
          )
        )
        .returning();
      // The cube `stopping` claim IS the restore lock now — the snapshot stays
      // `complete` for its whole life (a failed restore must not brick it).
      return Boolean(updatedCube);
    });
```

The existing `if (snapshot.status !== "complete")` gate above (`:239-243`) is unchanged and remains correct.

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/actions/snapshots.ts
git commit -m "fix(snapshots): restore action claims only the cube, never marks the snapshot restoring"
```

---

## Task 5: v1 API restore claims the cube (fixes latent no-op)

The v1 path enqueues `SNAPSHOT_RESTORE` without ever claiming the cube, so under the new cube-`stopping` guard it would no-op (it already no-ops today under the old guard). Add the same atomic claim as the dashboard.

**Files:**
- Modify: `lib/cube-actions/snapshots.ts` (restore handler, the enqueue at ~`:347`)

- [ ] **Step 1: Insert an atomic cube → stopping claim before the enqueue**

Immediately before `await enqueueJob(JOB_NAMES.SNAPSHOT_RESTORE, {` (currently `:347`), add:

```ts
  // Atomically claim the cube (status → stopping). This claim IS the restore
  // lock the worker guards on; without it the SNAPSHOT_RESTORE handler skips.
  const [claimedCube] = await db
    .update(schema.cubes)
    .set({ status: "stopping", updatedAt: new Date() })
    .where(
      and(
        eq(schema.cubes.id, cubeId),
        eq(schema.cubes.spaceId, spaceId),
        ne(schema.cubes.status, "deleted"),
        ne(schema.cubes.status, "stopping"),
        ne(schema.cubes.status, "error"),
        ne(schema.cubes.status, "pending"),
        ne(schema.cubes.status, "booting"),
        eq(schema.cubes.transferState, "idle")
      )
    )
    .returning({ id: schema.cubes.id });
  if (!claimedCube) {
    return {
      ok: false,
      status: 409,
      error: "Cube is no longer in a valid state for snapshot restore",
    };
  }
```

Confirm `ne` is imported from `drizzle-orm` in this file; if not, add it to the existing `import { and, eq } from "drizzle-orm";`.

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/cube-actions/snapshots.ts
git commit -m "fix(snapshots): v1 restore atomically claims the cube (was a silent no-op)"
```

---

## Task 6: `deleteSnapshot` — direct-delete a failed note + cube-based mid-restore guard

**Files:**
- Modify: `app/actions/snapshots.ts` (`deleteSnapshot`, ~`:325-438`)

- [ ] **Step 1: Replace the stuck-`restoring` branch with a cube-state guard**

Replace the `if (snapshot.status === "restoring") { ... }` block (currently `:369-387`) with a cube-state check (a snapshot no longer goes `restoring`; an active restore shows on the cube as `stopping`/`booting`):

```ts
    // An active restore/boot holds the cube's rootfs; refuse to delete a
    // snapshot of that cube until it settles. (Snapshots no longer carry a
    // `restoring` status — the cube is the source of truth.)
    const cubeForGuard = await db.query.cubes.findFirst({
      where: eq(schema.cubes.id, cubeId),
      columns: { status: true },
    });
    if (
      cubeForGuard &&
      (cubeForGuard.status === "stopping" || cubeForGuard.status === "booting")
    ) {
      return {
        error:
          "This Cube is currently restarting (e.g. a restore in progress). Try again once it settles.",
      };
    }
```

- [ ] **Step 2: Add a direct-delete fast path for a failed note (no restic job)**

Immediately after the `kind === "auto"` guard (currently `:388-393`), before the `enqueueJob(JOB_NAMES.SNAPSHOT_DELETE, ...)` block, add:

```ts
    // A `failed` snapshot is a dismissible note that holds no restic data
    // (storagePath is null). "Dismiss" = delete the row directly — there is
    // nothing in the repo to forget, so we skip the SNAPSHOT_DELETE worker job.
    if (snapshot.status === "failed" && !snapshot.storagePath) {
      await db
        .delete(schema.cubeSnapshots)
        .where(eq(schema.cubeSnapshots.id, snapshotId));
      await db.insert(schema.lifecycleLogs).values({
        entityType: "cube" as const,
        entityId: cubeId,
        message: `Dismissed failed snapshot note "${snapshot.name}"`,
      });
      const reqCtxFailed = extractRequestContext(await headers());
      audit({
        action: "snapshot.delete",
        category: "cube",
        actorType: "user",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `Dismissed failed snapshot "${snapshot.name}"`,
        metadata: { snapshotId, dismissed: true },
        ...reqCtxFailed,
      });
      return { success: true };
    }
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/actions/snapshots.ts
git commit -m "fix(snapshots): dismiss a failed note via direct row delete; guard delete on cube state"
```

---

## Task 7: UI — Retry on a failed manual note

The component already renders a **Delete** button on `failed` rows (= Dismiss). Add a **Retry** that re-runs create and clears the old note on success. The "Restoring" per-row badge is intentionally dropped (the snapshot stays `complete`; the cube's own status badge + the Restore button auto-hiding during `stopping` already convey an in-progress restore).

**Files:**
- Modify: `components/cube-snapshots.tsx`

- [ ] **Step 1: Add a Retry handler**

Add this function next to `handleDeleteConfirm` (after `:238`):

```tsx
  function handleRetryFailed(snapshot: Snapshot) {
    startTransition(async () => {
      const result = await createSnapshot(spaceId, cubeId, snapshot.name);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Clear the old failed note now that a fresh attempt is queued.
      await deleteSnapshot(spaceId, cubeId, snapshot.id).catch(() => {});
      toast.success(`Retrying snapshot "${snapshot.name}"…`);
      router.refresh();
    });
  }
```

- [ ] **Step 2: Render the Retry button for failed manual rows**

Inside `renderSnapshotActions`, add a Retry button just before the `canDeleteRow` Delete button (after `:376`, before the `{canDeleteRow && (` block):

```tsx
        {canManage && s.status === "failed" && (
          <Button
            disabled={isPending || !canCreate}
            onClick={() => handleRetryFailed(s)}
            size="sm"
            variant="ghost"
          >
            <CameraIcon className="size-4" />
            Retry
          </Button>
        )}
```

- [ ] **Step 3: Soften the failed-row helper copy**

In `renderSnapshotActions`, the `hasAnyAction` fall-through note (`:307-315`) is unaffected (failed rows now always have Retry/Delete actions, so they never hit the muted note). No change needed; verify by reading.

- [ ] **Step 4: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/cube-snapshots.tsx
git commit -m "feat(snapshots): Retry action on a failed manual snapshot note"
```

---

## Task 8: One-shot data heal script

**Files:**
- Create: `scripts/heal-snapshot-status.ts`
- Modify: `package.json` (add `snapshots:heal-status`)

- [ ] **Step 1: Add the package.json script entry**

Next to `"snapshots:cleanup-stuck": "tsx scripts/cleanup-stuck-snapshots.ts",` add:

```json
    "snapshots:heal-status": "tsx scripts/heal-snapshot-status.ts",
```

- [ ] **Step 2: Write the heal script**

```ts
// scripts/heal-snapshot-status.ts
//
// One-shot heal for cube_snapshots rows wrongly left in `failed`/`restoring`.
// A snapshot's status should describe only the snapshot — a failed RESTORE (a
// read-only op on the snapshot) used to brick it. This un-bricks intact rows
// and clears auto-snapshot noise. Dry-run by default; pass --apply to commit.
//
//   pnpm snapshots:heal-status            # dry-run, prints per-bucket counts
//   pnpm snapshots:heal-status --apply    # commit
//
// Bounded + idempotent (Rule 40): re-running after --apply is a no-op.
import { inArray } from "drizzle-orm";
import { cubeSnapshots } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { classifySnapshotForHeal } from "@/lib/snapshots/failure-policy";

const APPLY = process.argv.includes("--apply");
const CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function main() {
  const rows = await db
    .select({
      id: cubeSnapshots.id,
      status: cubeSnapshots.status,
      kind: cubeSnapshots.kind,
      storagePath: cubeSnapshots.storagePath,
    })
    .from(cubeSnapshots)
    .where(inArray(cubeSnapshots.status, ["failed", "restoring"]));

  const healIds: string[] = [];
  const deleteIds: string[] = [];
  let leftAlone = 0;

  for (const row of rows) {
    const action = classifySnapshotForHeal(row);
    if (action === "heal-to-complete") {
      healIds.push(row.id);
    } else if (action === "delete") {
      deleteIds.push(row.id);
    } else {
      leftAlone += 1;
    }
  }

  console.log(`[heal-snapshot-status] scanned ${rows.length} failed/restoring rows`);
  console.log(`  → heal to complete (intact data): ${healIds.length}`);
  console.log(`  → delete (auto noise, no data):    ${deleteIds.length}`);
  console.log(`  → leave (manual failed notes):     ${leftAlone}`);

  if (!APPLY) {
    console.log("\nDry-run. Re-run with --apply to commit.");
    process.exit(0);
  }

  for (const ids of chunk(healIds, CHUNK)) {
    await db
      .update(cubeSnapshots)
      .set({ status: "complete" })
      .where(inArray(cubeSnapshots.id, ids));
  }
  for (const ids of chunk(deleteIds, CHUNK)) {
    await db.delete(cubeSnapshots).where(inArray(cubeSnapshots.id, ids));
  }

  audit({
    action: "snapshot.heal_status",
    category: "cube",
    actorType: "system",
    entityType: "system",
    entityId: "snapshots",
    description: `Healed snapshot statuses: ${healIds.length} → complete, ${deleteIds.length} deleted, ${leftAlone} left`,
    metadata: { healed: healIds.length, deleted: deleteIds.length, leftAlone },
    source: "script",
  });

  console.log(
    `\n[heal-snapshot-status] applied: ${healIds.length} healed, ${deleteIds.length} deleted.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[heal-snapshot-status] failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Confirm the audit signature**

Run: `grep -n "actorType\|entityType\|source:" lib/audit.ts | head -20`
Expected: confirm `audit()` accepts `actorType: "system"`, `entityType: "system"`, `source: "script"` (or the project's nearest accepted values). If `source` rejects `"script"`, use the value other scripts pass (grep `scripts/*.ts` for an `audit(` call, e.g. `backfill-polar-customer-id.ts`) and match it. Adjust the call to the real signature — no guessing.

- [ ] **Step 4: Dry-run against the dev DB**

Run: `pnpm snapshots:heal-status`
Expected: prints the four count lines and "Dry-run." with no mutation.

- [ ] **Step 5: Commit**

```bash
git add scripts/heal-snapshot-status.ts package.json
git commit -m "feat(snapshots): heal-snapshot-status one-shot to un-brick wrongly-failed snapshots"
```

---

## Task 9: Full verification + spec sync

**Files:**
- Modify: `docs/superpowers/specs/2026-05-30-snapshot-status-decoupling-design.md` (note the normalize-to-complete refinement)
- Modify: `CLAUDE.md` (Rule 22 — document the new behavior + the `snapshots:heal-status` command)

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 2: Sync the spec**

In the spec's "Changes → A. Restore" section, add a sentence: the restore handler **normalizes the snapshot to `complete` on every terminal outcome** (success and failure) rather than removing the writes — the snapshot is always intact on restore failure, and this self-heals deploy-boundary rows. Keep the rest as-is.

- [ ] **Step 3: Update CLAUDE.md**

In the "Snapshots & Backups" area, add a short note that a snapshot's `status` describes only the snapshot (`pending → creating → complete`, permanent until delete); restore claims the **cube** (`stopping`) and never marks a snapshot `restoring`/`failed`; create-failures are `auto → delete` / `manual → dismissible failed note`. Add `pnpm snapshots:heal-status` to the commands table (one-shot, dry-run default, `--apply`).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-30-snapshot-status-decoupling-design.md CLAUDE.md
git commit -m "docs(snapshots): sync spec + CLAUDE.md for status decoupling"
```

---

## Manual verification checklist (post-implementation, on dev)

- [ ] Restore a snapshot with the host briefly unreachable → snapshot stays **Complete** and is re-restorable; cube returns to its prior state (not stuck `stopping`).
- [ ] Force a post-`complete` step to throw in `snapshot-create` (temporary) → snapshot stays **Complete**, not Failed.
- [ ] A manual create failure shows a **Failed** note with **Retry** + **Delete**; Retry queues a fresh snapshot and clears the note; Delete removes it with no `SNAPSHOT_DELETE` job.
- [ ] An auto create failure leaves **no row**.
- [ ] `pnpm snapshots:heal-status` dry-run shows expected counts; `--apply` heals intact rows to Complete; a second `--apply` run reports 0 healed / 0 deleted (idempotent).

## Self-review notes

- **Spec coverage:** A. Restore never touches snapshot status → Tasks 3,4,5. B. Guards that read snapshot status → Task 6 (cube-state delete guard) + Task 7 (per-row "Restoring" badge intentionally dropped). C. Create-failure policy → Task 2 (+ Task 1 helper). D. Dismiss/Retry → Task 6 (dismiss = direct delete) + Task 7 (Retry). E. Heal script → Task 8. F. No schema change → no migration task anywhere. All covered.
- **Type consistency:** `snapshotCreateFailureAction` / `classifySnapshotForHeal` signatures used identically in Tasks 1, 2, 8. `failCreate(snapshotId, kind)` consistent across Task 2 exits.
- **No schema change:** enum + status-display untouched (Task list contains no migration).
