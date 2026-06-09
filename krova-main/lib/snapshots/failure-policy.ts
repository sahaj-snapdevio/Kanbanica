import type { snapshotKind, snapshotStatus } from "@/db/schema/snapshots";

export type SnapshotKind = (typeof snapshotKind.enumValues)[number];
export type SnapshotStatus = (typeof snapshotStatus.enumValues)[number];

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
