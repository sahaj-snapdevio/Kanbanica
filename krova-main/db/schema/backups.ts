import { createId } from "@paralleldrive/cuid2"
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { spaces } from "@/db/schema/spaces"
import { user } from "@/db/schema/auth"
import { storageBackends } from "@/db/schema/storage-backends"

export const backupStatus = pgEnum("backup_status", [
  "pending",
  "creating",
  "complete",
  "failed",
])

/**
 * Pre-deletion backups preserve a Cube's disk state and full configuration
 * so the customer can redeploy an identical Cube later.
 *
 * Unlike `cubeSnapshots`, backups:
 * - Survive cube deletion (no FK cascade on cubeId)
 * - Store the full cube config (CPU, RAM, disk, image, region, domains, TCP mappings)
 * - Cannot be auto-deleted by the system — only manual deletion by the customer
 * - Are billed based on disk storage consumed (hourly, same rate as disk)
 */
export const cubeBackups = pgTable(
  "cube_backups",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: backupStatus("status").notNull().default("pending"),

    /** Original cube ID — NOT a FK since the cube is deleted. Stored for reference only. */
    originalCubeId: text("original_cube_id").notNull(),
    /** Denormalized original cube name for display. */
    originalCubeName: text("original_cube_name").notNull(),

    /**
     * Full cube configuration snapshot as JSONB:
     * { vcpus, ramMb, diskLimitGb, imageId, regionId, regionName,
     *   domainMappings: [{ domain, port }],
     *   tcpMappings: [{ cubePort, label }] }
     */
    cubeConfig: jsonb("cube_config").notNull(),

    /** Compressed size in bytes. */
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** S3 object key: <env>/backups/{spaceId}/{backupId}.cube (plain tar
     *  bundling manifest.json + rootfs.ext4.zst + checksums.txt). */
    storagePath: text("storage_path"),
    /** Which storage backend holds this backup. */
    storageBackendId: text("storage_backend_id").references(
      () => storageBackends.id,
      { onDelete: "set null" }
    ),

    /** Original disk size in GB — used for storage billing. */
    diskSizeGb: integer("disk_size_gb").notNull(),

    /** User who initiated the backup (created via the delete dialog). */
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),

    /** When the backup completed successfully. */
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** Set when the backup is redeployed, but backup itself persists. */
    redeployedCubeId: text("redeployed_cube_id"),

    /** Optional reason for why the backup was redeployed. */
    redeployReason: text("redeploy_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cube_backups_space_id_idx").on(t.spaceId),
    index("cube_backups_space_id_status_idx").on(t.spaceId, t.status),
  ]
)

/** Type for the JSONB cubeConfig column. */
export interface CubeBackupConfig {
  vcpus: number
  ramMb: number
  diskLimitGb: number
  imageId: string
  regionId: string
  regionName: string
  domainMappings: { domain: string; port: number }[]
  tcpMappings: {
    cubePort: number
    label: string | null
    whitelistedCidrs: string[]
  }[]
}
