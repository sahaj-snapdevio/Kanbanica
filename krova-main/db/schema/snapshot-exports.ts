import { createId } from "@paralleldrive/cuid2"
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { user } from "@/db/schema/auth"
import { cubeSnapshots } from "@/db/schema/snapshots"
import { spaces } from "@/db/schema/spaces"
import { storageBackends } from "@/db/schema/storage-backends"

/**
 * Lifecycle of a customer-initiated snapshot export:
 *   pending       — row inserted, pg-boss job enqueued, worker has not claimed yet
 *   materializing — worker has SSHed to the source cube's host, restic-dumping
 *   ready         — `.cube` uploaded to S3, presigned URL emailed, expiresAt set
 *   failed        — handler errored; failureReason captured
 *   expired       — `expiresAt` passed, reaper deleted the S3 object
 */
export const snapshotExportStatus = pgEnum("snapshot_export_status", [
  "pending",
  "materializing",
  "ready",
  "failed",
  "expired",
])

/**
 * One row per customer-initiated snapshot export-as-`.cube`. The worker
 * builds the archive on the source cube's host (restic dump | zstd | tar),
 * uploads to `<env-prefix>/exports/{spaceId}/{exportId}.cube`, and emails
 * the space owner a 24h presigned link. The `snapshot.export-reap` cron
 * deletes the S3 object once `expiresAt` has passed and flips the row to
 * `expired`; failed rows older than 7 days are hard-deleted.
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
    /** S3 object key under the chosen backend's bucket. */
    storagePath: text("storage_path"),
    storageBackendId: text("storage_backend_id").references(
      () => storageBackends.id,
      { onDelete: "set null" }
    ),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /**
     * Presigned URL emailed to the customer. Stored so a re-send action
     * can replay the existing URL without re-materializing (provided the
     * URL itself has not yet expired).
     */
    presignedUrl: text("presigned_url"),
    /**
     * Wall-clock expiry. The reaper considers `status='ready' AND expiresAt < now()`
     * eligible for deletion. The server action that creates the row writes a
     * placeholder (now + 25h) so a handler crash before completion still leaves
     * the row reapable on a future tick; the handler overwrites with the true
     * `now + TTL` when the upload completes.
     */
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
