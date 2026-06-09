import { shellEscape } from "@/lib/ssh/utils";

/**
 * Pure builder for the args of the daily auto-prune `restic forget` command.
 * Extracted from the handler (which eagerly imports `@/lib/db`) so this logic
 * is unit-testable without a configured env — mirrors `lib/snapshots/
 * failure-policy.ts`'s pure-fn isolation.
 */

export interface RetentionBuckets {
  autoSnapshotKeepDaily: number;
  autoSnapshotKeepLast: number;
  autoSnapshotKeepWeekly: number;
}

/**
 * Build the args portion of a `restic forget` command from a plan's retention
 * buckets, SCOPED to the cube's auto snapshots.
 *
 * IMPORTANT — restic has NO `--keep-id` flag. `--keep-id` is a `rustic`-only
 * flag; verified against restic 0.18.1 source (`cmd/restic/cmd_forget.go`
 * registers only `--keep-last/-hourly/-daily/-weekly/-monthly/-yearly`,
 * `--keep-within*`, `--keep-tag`) and the 0.18.1 forget docs. An unknown flag
 * makes `restic forget` exit non-zero, which threw inside the cron for every
 * cube with a pinned/manual snapshot — auto-prune silently no-op'd and those
 * repos grew unbounded.
 *
 * The correct mechanism: every snapshot is tagged in restic with its own
 * `cube_snapshots.id` (attached at backup time — see `resticBackup`). To apply
 * the policy to EXACTLY the auto snapshots, we pass each auto snapshot's id as
 * a separate `--tag`. restic ORs repeated `--tag` flags and **leaves snapshots
 * whose tag is not in the list completely untouched** (verified against the
 * 0.18.1 forget docs), so manual/pinned snapshots are never forget candidates —
 * with no dependency on a shared `auto` tag (none exists; the tag is the unique
 * per-snapshot DB id). A pinned auto→manual snapshot is `kind='manual'` in the
 * DB, so it is simply absent from `autoTagIds` and thus protected.
 *
 * Returns null — caller MUST skip the prune — when EITHER:
 *  - every retention bucket is 0 (no retention configured), OR
 *  - `autoTagIds` is empty. This second guard is a HARD SAFETY REQUIREMENT: a
 *    `forget --keep-* --prune` with NO `--tag` filter applies the policy to the
 *    WHOLE repo, including manual/pinned snapshots, and could forget a pinned
 *    snapshot. Never emit a tag-less retention forget.
 */
export function buildResticForgetArgs(
  buckets: RetentionBuckets,
  autoTagIds: string[]
): string | null {
  const policy: string[] = [];
  if (buckets.autoSnapshotKeepLast > 0) {
    policy.push(`--keep-last ${buckets.autoSnapshotKeepLast}`);
  }
  if (buckets.autoSnapshotKeepDaily > 0) {
    policy.push(`--keep-daily ${buckets.autoSnapshotKeepDaily}`);
  }
  if (buckets.autoSnapshotKeepWeekly > 0) {
    policy.push(`--keep-weekly ${buckets.autoSnapshotKeepWeekly}`);
  }
  if (policy.length === 0) {
    return null;
  }
  if (autoTagIds.length === 0) {
    // No auto snapshots to consider. Critically, we must NOT emit a tag-less
    // forget — it would apply the policy to manual/pinned snapshots too.
    return null;
  }
  const tagFilter = autoTagIds.map((id) => `--tag ${shellEscape(id)}`);
  return [...tagFilter, ...policy].join(" ");
}
