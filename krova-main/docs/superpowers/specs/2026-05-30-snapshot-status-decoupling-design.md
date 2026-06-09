# Snapshot status decoupling — "a snapshot is a snapshot"

- **Date:** 2026-05-30
- **Status:** Approved (design) — pending implementation plan
- **Scope chosen:** Behavior fix + data heal (no schema change; enum left intact)
- **Author:** pairing session

## Problem

A transient failure during a snapshot **restore** permanently bricks a
perfectly intact snapshot. The customer can never restore that snapshot again,
even though its data in restic was never touched.

The customer's framing: a snapshot is a captured point-in-time artifact. If an
_operation_ (restore, import, create) fails, the failure belongs to the
operation — not to the snapshot. "A snapshot should never be marked as a failed
snapshot. A snapshot is a snapshot."

## Root cause

`cube_snapshots.status` ([db/schema/snapshots.ts:16-22](../../../db/schema/snapshots.ts#L16-L22))
is a single column doing two unrelated jobs:

1. **Artifact lifecycle** — does this snapshot exist and is it usable?
2. **Operation state** — what is happening to/with it right now?

Restore is **read-only on the snapshot** — [snapshot-restore.ts](../../../lib/worker/handlers/snapshot-restore.ts)
only reads the restic repo and writes the cube's live rootfs; it never modifies
the snapshot's restic data. Yet:

- The restore action flips the snapshot to `restoring`
  ([app/actions/snapshots.ts:271-274](../../../app/actions/snapshots.ts#L271-L274)).
- If restore fails — including a 30-second host-unreachable blip at the guarded
  connect ([snapshot-restore.ts:107-110](../../../lib/worker/handlers/snapshot-restore.ts#L107-L110))
  or any error in the body ([:500-503](../../../lib/worker/handlers/snapshot-restore.ts#L500-L503))
  — it stamps the snapshot `failed`.
- Restore then permanently rejects anything that is not `complete`
  ([app/actions/snapshots.ts:239-243](../../../app/actions/snapshots.ts#L239-L243),
  v1 mirror [lib/cube-actions/snapshots.ts:321-325](../../../lib/cube-actions/snapshots.ts#L321-L325)).

So a transient blip → `failed` → permanently un-restorable. The data is 100%
intact in restic.

### Related latent bug (create path)

The create catch ([snapshot-create.ts:318-322](../../../lib/worker/handlers/snapshot-create.ts#L318-L322))
can downgrade a row that **already reached `complete`** (valid `storagePath`)
back to `failed` if a trivial post-success step throws (`adjustBackendUsage`,
a lifecycle-log insert, the audit call, the email). `storagePath` is only ever
written together with `status='complete'`
([:221-230](../../../lib/worker/handlers/snapshot-create.ts#L221-L230)), so any
failure reaching the `else`/failed branch with a non-null `storagePath` is by
definition a **post-complete** failure of a good snapshot — and marking it
`failed` bricks it the same way.

## Design principle

**A snapshot's `status` describes only the snapshot.** Once `complete`, it stays
`complete` for the rest of its life until it is deleted. No operation performed
_with_ a snapshot (restore, clone, export, promote) ever changes its status.

The only path a real snapshot follows is:

```
pending → creating → complete        (and complete is permanent until delete)
```

`failed` survives in the enum but is written **only** by a create that never
produced a usable artifact, and **only** for `kind='manual'` — a non-blocking,
dismissible note that holds no data. `restoring` stops being written by
anything. Neither enum value is removed (scope decision — keep the change
surgical and production-safe; a follow-up enum cleanup is explicitly out of
scope).

## Changes

### A. Restore never touches snapshot status

**[app/actions/snapshots.ts](../../../app/actions/snapshots.ts) — `restoreSnapshot`**

- Remove the `tx.update(cubeSnapshots).set({ status: "restoring" })`
  ([:271-274](../../../app/actions/snapshots.ts#L271-L274)). The atomic cube
  claim (`status → 'stopping'`, [:248-266](../../../app/actions/snapshots.ts#L248-L266))
  is the real lock; the snapshot flag was redundant.
- The `status !== "complete"` gate ([:239-243](../../../app/actions/snapshots.ts#L239-L243))
  stays — it is correct (you can only restore a usable snapshot). After this
  change a restore failure leaves the snapshot `complete`, so the gate stops
  being a one-way trap.
- Mirror the same removal in the v1 path
  ([lib/cube-actions/snapshots.ts](../../../lib/cube-actions/snapshots.ts)) if it
  sets `restoring`.

**[lib/worker/handlers/snapshot-restore.ts](../../../lib/worker/handlers/snapshot-restore.ts)**

- Change the idempotency guard ([:33-38](../../../lib/worker/handlers/snapshot-restore.ts#L33-L38))
  from `snapshot.status !== "restoring"` to the **cube** claim:
  proceed only if `cube.status === "stopping"`. (The action set the cube to
  `stopping`; a pg-boss retry after a terminal failure sees the cube in
  `error`/`running`/`sleeping` and correctly skips. `retryLimit: 2` on
  `SNAPSHOT_RESTORE` — confirmed [ensure-queues.ts:207-211](../../../lib/worker/ensure-queues.ts#L207-L211).)
- Remove the `set({ status: "failed" })` at the guarded-connect path
  ([:107-110](../../../lib/worker/handlers/snapshot-restore.ts#L107-L110)) **and**
  in the main catch ([:500-503](../../../lib/worker/handlers/snapshot-restore.ts#L500-L503)).
  The snapshot stays `complete`.
- Remove the success `set({ status: "complete" })`
  ([:348-351](../../../lib/worker/handlers/snapshot-restore.ts#L348-L351)) — a
  no-op now (it never left `complete`).
- **Bonus fix:** the guarded-connect failure currently returns without resetting
  the cube, leaving it stuck in `stopping` (the action set it). The rootfs was
  never touched, so reset the cube to its pre-restore state
  (`wasRunning ? "running" : "sleeping"`, `lastBilledAt` per Rule 52) on that
  path. The main catch already does running/sleeping recovery or `error`.
- The Pusher `snapshotStatus: "failed"`/`"restored"` events and the
  `snapshot.restore_failed`/`restore_complete` audits stay — they describe the
  **operation**, not the snapshot row, and the UI uses them transiently.

### B. Guards that used to read snapshot status

**[app/actions/snapshots.ts](../../../app/actions/snapshots.ts) — `deleteSnapshot`**

- The stuck-`restoring` branch ([:369-387](../../../app/actions/snapshots.ts#L369-L387))
  is now dead for new data (snapshots never go `restoring`). Replace the
  "is this snapshot mid-restore?" check with a **cube-state** check: refuse delete
  while the cube is `stopping` or `booting` (an active restore/boot holds the
  rootfs). Keep it simple and cube-driven.

**[components/cube-snapshots.tsx](../../../components/cube-snapshots.tsx)**

- The "Restoring" badge derives from **cube status** (cube is `stopping`/booting
  during a restore), not the snapshot row. Read this file during planning to wire
  precisely.

### C. Create-failure policy (manual → note, auto → delete)

**[lib/worker/handlers/snapshot-create.ts](../../../lib/worker/handlers/snapshot-create.ts)**

Introduce one local helper used by every failure exit so the policy lives in one
place (Rule 14):

```
failSnapshotCreate(snapshot, reason):
  if kind === "auto":  DELETE the row            // scheduler retries next cadence
  else (manual):       UPDATE status='failed', storagePath=null   // dismissible note, holds no data
```

Apply it at every current failure exit:

- cube not running/sleeping ([:48-55](../../../lib/worker/handlers/snapshot-create.ts#L48-L55))
- cube mid-transfer ([:65-77](../../../lib/worker/handlers/snapshot-create.ts#L65-L77))
- backend resolution failed ([:101-117](../../../lib/worker/handlers/snapshot-create.ts#L101-L117))
- guarded-connect failure ([:140-162](../../../lib/worker/handlers/snapshot-create.ts#L140-L162))
- the main catch ([:293-323](../../../lib/worker/handlers/snapshot-create.ts#L293-L323))

**Fix the post-complete downgrade:** in the main catch, re-read the row; if it is
**already `complete`** (a post-success step threw), leave it `complete` — log +
audit the secondary failure but never downgrade. Only non-complete rows go
through `failSnapshotCreate`.

Result: auto failures never appear in the list; manual failures show as a
dismissible note that holds no data, never blocks restore of other snapshots,
and (already) never counts against the manual cap
([snapshot-limits.ts:73-87](../../../lib/plan/snapshot-limits.ts#L73-L87), excludes
`failed`).

### D. Dismiss / Retry (manual failed notes)

- **Dismiss** = delete the failed row. A `failed` manual snapshot has no
  `storagePath`, so short-circuit `deleteSnapshot` to a **direct DB row delete**
  (no `SNAPSHOT_DELETE` job — there is nothing in restic to clean). Existing
  `deleteSnapshot` already allows a `failed` row through its guards
  ([:364-393](../../../app/actions/snapshots.ts#L364-L393)); add the
  `status === "failed" && !storagePath` direct-delete fast path.
- **Retry** = enqueue a fresh create (identical to clicking Create again,
  re-running the plan-cap check). No new worker job — reuse `createSnapshot`.
- UI: render manual `failed` rows as "Couldn't be created — [Retry] [Dismiss]"
  in [components/cube-snapshots.tsx](../../../components/cube-snapshots.tsx).

### E. Heal existing data — `pnpm snapshots:heal-status`

One-shot script ([scripts/heal-snapshot-status.ts](../../../scripts/heal-snapshot-status.ts)),
dry-run by default, `--apply` to commit. Follows the existing backfill-script
convention (Rule 6 — a script, **not** a migration file; Rule 40 — bounded +
idempotent). The `cube_snapshots` table is small, so a single bounded UPDATE per
rule is safe.

Rules (idempotent — re-running is a no-op):

1. `status IN ('failed','restoring') AND storage_path IS NOT NULL` → `complete`
   — un-bricks intact snapshots wrongly marked by a failed restore or a
   post-complete create downgrade. (A `restoring` row always had `storage_path`,
   since restore requires `complete`.)
2. `kind = 'auto' AND status IN ('failed','restoring') AND storage_path IS NULL`
   → **delete** — clears auto-snapshot noise.
3. Manual `failed`/`restoring` with `storage_path IS NULL` → **leave** as the
   dismissible note.

Audit-logged; prints a per-rule count in dry-run.

### F. No schema change

The `snapshot_status` enum and [lib/status-display.ts](../../../lib/status-display.ts)
are untouched (status-display derives from `snapshotStatus.enumValues`). `failed`
still renders; `restoring` simply stops occurring. A future migration to drop
`restoring`/`failed` from the enum is explicitly **out of scope** here.

## Files touched

| File | Change |
| --- | --- |
| `app/actions/snapshots.ts` | restore: drop `restoring` write; deleteSnapshot: cube-based mid-restore guard + `failed`+null direct-delete fast path |
| `lib/cube-actions/snapshots.ts` | v1 restore: drop `restoring` write if present |
| `lib/worker/handlers/snapshot-restore.ts` | guard on cube `stopping`; remove both `failed` writes + redundant `complete` write; reset cube on connect-fail |
| `lib/worker/handlers/snapshot-create.ts` | `failSnapshotCreate` helper (manual→note / auto→delete); never downgrade a `complete` row |
| `components/cube-snapshots.tsx` | Restoring badge from cube status; failed-note Retry/Dismiss UI |
| `scripts/heal-snapshot-status.ts` (new) | one-shot data heal |
| `package.json` | `snapshots:heal-status` script entry |

## Verification

- `pnpm typecheck` + `pnpm lint` green.
- Manual restore failure (simulate host-down) leaves the snapshot `complete` and
  re-restorable; the cube returns to its pre-restore state (not stuck `stopping`).
- A post-`complete` create step throwing does not downgrade the snapshot.
- A manual create failure shows a dismissible note; Dismiss removes the row
  without a restic job; Retry creates a fresh snapshot.
- An auto create failure leaves no row.
- `pnpm snapshots:heal-status` dry-run reports the expected counts; `--apply`
  heals intact rows to `complete` and is a no-op on a second run.

## Implementation notes (as-built, 2026-05-31)

Refinements made during implementation, consistent with the design's intent:

- **Restore normalizes the snapshot to `complete` on EVERY terminal outcome**
  (success and both failure paths) rather than "removing the failed writes."
  The snapshot's restic data is always intact on a restore failure (restore only
  READS the repo), so `complete` is correct — and this also self-heals any row a
  job left mid-flight across the deploy that changed the contract.
- **Guarded-connect failure preserves `lastBilledAt` for a was-running cube.**
  On that path the VM was never stopped (connect fails before the kill) and no
  prorated charge ran, so the running clock is unbroken — writing a fresh `now`
  would drop the unbilled window (free compute, Rule 51). Only the sleeping case
  nulls it (Rule 52).
- **The restore handler RETURNS (not throws) after handling its own failure.**
  The cube recovery moves the cube off `stopping`, so a pg-boss retry would skip
  anyway; returning closes a narrow race where a stale/duplicate restore job
  could ride a *different* flow's later `stopping`. Worker-killed re-entry is
  preserved separately via job expiry while the cube is still `stopping`.
- **v1 API restore now atomically claims the cube** (`status → stopping`). It
  previously enqueued `SNAPSHOT_RESTORE` without any claim, so under the new
  cube-`stopping` worker guard it would no-op — and it already no-op'd under the
  old snapshot-`restoring` guard. This fixes that latent bug.
- **`pnpm snapshots:heal-status` alias deferred.** `package.json` had unrelated
  uncommitted dependency bumps in the working tree at implementation time, so the
  script entry was not committed to avoid entangling them. The script is fully
  runnable as `tsx scripts/heal-snapshot-status.ts [--apply]`; the one-line
  `package.json` alias can be added once the dep-bumps are resolved.

## Out of scope

- Removing `restoring`/`failed` from the `snapshot_status` enum (future migration).
- Any change to export / clone / promote-to-backup (already correct — they read
  the immutable restic repo and never touch the source snapshot row).
- Cube `import` (`cube.import-rootfs`) — a `cube_imports` flow, unrelated to
  `cube_snapshots`.
