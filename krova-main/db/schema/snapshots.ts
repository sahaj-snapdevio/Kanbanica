import { createId } from "@paralleldrive/cuid2"
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { cubes } from "@/db/schema/cubes"
import { spaces } from "@/db/schema/spaces"
import { user } from "@/db/schema/auth"
import { storageBackends } from "@/db/schema/storage-backends"

export const snapshotStatus = pgEnum("snapshot_status", [
  "pending",
  "creating",
  "complete",
  "restoring",
  "failed",
])

/**
 * Whether the snapshot is system-managed (auto) or customer-managed
 * (manual). Auto snapshots are rotated by `snapshot.auto-prune` per the
 * plan's retention policy and CANNOT be deleted by the customer. Manual
 * snapshots count against the plan's `max_manual_snapshots_per_cube` cap
 * and ARE customer-deletable. Pinning an auto snapshot is a DB-only flip
 * from `auto` to `manual` — restic still has the snapshot tagged `auto`,
 * but the auto-prune handler passes `--keep-id <storagePath>` for every
 * pinned snapshot so restic never drops it.
 */
export const snapshotKind = pgEnum("snapshot_kind", ["auto", "manual"])

export const cubeSnapshots = pgTable(
  "cube_snapshots",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    cubeId: text("cube_id")
      .notNull()
      .references(() => cubes.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: snapshotStatus("status").notNull().default("pending"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Restic snapshot id within the per-cube repo at <env>/snapshot-repos/{cubeId}/ */
    storagePath: text("storage_path"),
    /** Which storage backend holds this snapshot. */
    storageBackendId: text("storage_backend_id").references(
      () => storageBackends.id,
      { onDelete: "set null" }
    ),
    /**
     * Customer-managed (`manual`) vs system-managed (`auto`). See
     * `snapshotKind` pgEnum doc. The pre-overhaul `is_automatic` boolean
     * was dropped in migration 0056 (the user confirmed no production
     * snapshot data existed at the time of cleanup); `kind` is now the
     * sole source of truth for this distinction.
     */
    kind: snapshotKind("kind").notNull().default("manual"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cube_snapshots_cube_id_status_idx").on(t.cubeId, t.status),
    index("cube_snapshots_cube_id_kind_status_idx").on(
      t.cubeId,
      t.kind,
      t.status
    ),
  ]
)
