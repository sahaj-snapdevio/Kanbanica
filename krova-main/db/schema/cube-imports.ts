import { createId } from "@paralleldrive/cuid2"
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { user } from "@/db/schema/auth"
import { cubes } from "@/db/schema/cubes"
import { regions } from "@/db/schema/regions"
import { spaces } from "@/db/schema/spaces"
import { storageBackends } from "@/db/schema/storage-backends"

/**
 * Lifecycle of a customer-initiated `.cube` import.
 *
 *   uploading    — multipart upload initiated, customer streaming parts
 *                  to S3 directly; row holds the UploadId so the reaper
 *                  can abort an abandoned upload.
 *   finalizing   — customer called /complete, worker is calling
 *                  CompleteMultipartUpload on S3 (transient state).
 *   provisioning — `cube.import-rootfs` worker job is running:
 *                  downloading the .cube, extracting, decompressing,
 *                  booting the new cube.
 *   complete     — new cube booted, archive removed from S3.
 *   failed       — terminal; `error` column has the reason.
 *   expired      — terminal; reaper detected an abandoned upload
 *                  >24h old and aborted the multipart upload.
 */
export const cubeImportStatus = pgEnum("cube_import_status", [
  "uploading",
  "finalizing",
  "provisioning",
  "complete",
  "failed",
  "expired",
])

/**
 * One row per customer-initiated `.cube` import.
 *
 * Created at `POST /cubes/imports` time, before the customer's first
 * byte hits S3 — that way the reaper can recover from any stage
 * (browser closed mid-upload, worker crashed mid-provision, etc.).
 *
 * The `.cube` archive lives at
 *   <env>/imports/<spaceId>/<importId>.cube
 * during provisioning, and is deleted from S3 on successful
 * completion (the new cube's rootfs supersedes the archive).
 */
export const cubeImports = pgTable(
  "cube_imports",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /** Target cube name supplied by the customer at initiate time. */
    name: text("name").notNull(),
    status: cubeImportStatus("status").notNull().default("uploading"),

    /** Backend holding the upload. Pinned at initiate time so the
     *  reaper + complete handler talk to the same backend even if
     *  selectBackend()'s default shifts. */
    storageBackendId: text("storage_backend_id")
      .notNull()
      .references(() => storageBackends.id, { onDelete: "restrict" }),
    /** S3 object key, e.g. "production/imports/<spaceId>/<importId>.cube". */
    s3Key: text("s3_key").notNull(),
    /** S3 multipart UploadId. Held until the upload is completed or
     *  aborted. */
    s3UploadId: text("s3_upload_id").notNull(),
    /** Customer-declared archive size in bytes, used at initiate time
     *  to compute the part count + pre-flight plan/storage checks.
     *  Verified against the actual ContentLength on /complete. */
    expectedSizeBytes: bigint("expected_size_bytes", { mode: "number" }).notNull(),
    /** Chunk size in bytes (matches the part-count math). */
    chunkSizeBytes: integer("chunk_size_bytes").notNull(),

    /**
     * How the worker should handle SSH keys when booting the imported
     * cube.
     *   - "replace" (default) — mount the rootfs and overwrite
     *     /root/.ssh/authorized_keys with `sshPublicKey`. Matches
     *     createCube + backup.redeploy behavior.
     *   - "keep"   — do not touch the rootfs's existing keys. The
     *     customer is responsible for having the matching private key.
     */
    sshKeyMode: text("ssh_key_mode").notNull().default("replace"),
    /** Required when sshKeyMode='replace'; null when 'keep'. */
    sshPublicKey: text("ssh_public_key"),

    /** Optional destination region. Falls back to selectServer's
     *  default if null. */
    regionId: text("region_id").references(() => regions.id, {
      onDelete: "set null",
    }),
    /** Optional cloud-init user_data. Recorded on the new cube row
     *  for metadata parity with createCube; not re-applied to the
     *  imported rootfs (cloud-init's state file already says it ran). */
    userData: text("user_data"),
    /** Optional resize overrides applied during provisioning. */
    vcpusOverride: integer("vcpus_override"),
    ramMbOverride: integer("ram_mb_override"),
    diskGbOverride: integer("disk_gb_override"),

    /** New cube id, set when provisioning starts. */
    cubeId: text("cube_id").references(() => cubes.id, {
      onDelete: "set null",
    }),
    /** Populated on terminal `failed`/`expired` status. */
    error: text("error"),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("cube_imports_space_id_idx").on(t.spaceId),
    index("cube_imports_status_idx").on(t.status, t.createdAt),
  ]
)

export type CubeImportSshKeyMode = "replace" | "keep"
