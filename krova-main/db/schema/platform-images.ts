import { createId } from "@paralleldrive/cuid2"
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const platformImageKind = pgEnum("platform_image_kind", [
  "kernel",
  "rootfs",
])

/**
 * Built kernel + rootfs images stored on the Dokploy host's local filesystem.
 * Single-slot per name — re-running `pnpm build:images` overwrites the row.
 * The server-pull-images setup phase reads `path` from the worker container's
 * filesystem (via the `/opt/krova-build:/opt/krova-build` bind mount) and
 * SFTPs the bytes directly to /var/lib/krova/images/ on the bare-metal server.
 */
export const platformImages = pgTable(
  "platform_images",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    /** Stable identifier matching config/platform.ts imageOptions value (rootfs) or "kernel". */
    name: text("name").notNull(),
    kind: platformImageKind("kind").notNull(),
    /** Absolute path on the Dokploy host (= worker container, via bind mount).
     *  e.g. "/opt/krova-build/images/ubuntu-24.04.ext4.zst". */
    path: text("path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    /**
     * Monotonic version number, incremented by `pnpm build:images` whenever the
     * artifact's sha256 changes (i.e. the kernel was rebuilt with new options,
     * or the rootfs got a security update). A rebuild that produces an
     * identical sha256 does NOT bump the version.
     *
     * Used to detect drift between the latest image and what a Cube actually
     * cold-booted with: cube.bootedKernelVersion < platform_images.version
     * means the Cube needs a cold-restart to pick up the new kernel.
     */
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("platform_images_name_key").on(t.name),
    index("platform_images_kind_idx").on(t.kind),
  ]
)
