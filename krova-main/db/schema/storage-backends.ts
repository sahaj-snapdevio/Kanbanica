import { createId } from "@paralleldrive/cuid2"
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

/**
 * S3-compatible object-storage backends for snapshot and backup storage.
 *
 * Each row is one bucket. Credentials are AES-256-GCM encrypted via
 * `lib/encrypt.ts`. Capacity is operator-configured (`capacityGb`);
 * `usedBytes` is incremented on upload and decremented on delete so
 * `selectBackend()` can pick the bucket with the most free space.
 *
 * Multiple active backends are supported for capacity scaling. Selection
 * is by most-free-space first.
 */
export const storageBackends = pgTable(
  "storage_backends",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    name: text("name").notNull(),

    /** Full S3 endpoint URL, e.g. https://s3.eu-central-1.idrivee2.com. */
    endpoint: text("endpoint").notNull(),
    /** S3 region code, e.g. eu-central-1, us-west-2. */
    region: text("region").notNull(),
    /** Bucket name. Object keys are written under `<env>/...` prefixes. */
    bucket: text("bucket").notNull(),

    /** AES-256-GCM encrypted access key id and secret. */
    accessKeyIdEnc: text("access_key_id_enc").notNull(),
    secretAccessKeyEnc: text("secret_access_key_enc").notNull(),

    /** Operator-configured plan capacity in GB. Null = treat as unlimited. */
    capacityGb: integer("capacity_gb"),
    /** Sum of object sizes uploaded by us. Adjusted on upload/delete. */
    usedBytes: bigint("used_bytes", { mode: "number" })
      .notNull()
      .default(0),

    isActive: boolean("is_active").notNull().default(true),
    lastHealthCheck: timestamp("last_health_check", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("storage_backends_is_active_idx").on(t.isActive)]
)
