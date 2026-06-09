import { createId } from "@paralleldrive/cuid2"
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export const jobLogLevel = pgEnum("job_log_level", ["info", "warn", "error"])

export const jobLogEntityType = pgEnum("job_log_entity_type", [
  "server",
  "cube",
  "snapshot",
  "backup",
])

/**
 * Per-step log entries for background jobs. Lets the UI replay or live-watch
 * what each pg-boss handler is doing — server setup, Cube provisioning, etc.
 *
 * `sequence` is monotonically increasing per-job (set by the JobLogger helper)
 * so the UI can render entries in order without relying on createdAt resolution.
 */
export const jobLogs = pgTable(
  "job_logs",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    jobId: text("job_id").notNull(),
    jobName: text("job_name").notNull(),
    entityType: jobLogEntityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    sequence: integer("sequence").notNull(),
    level: jobLogLevel("level").notNull().default("info"),
    message: text("message").notNull(),
    stdout: text("stdout"),
    stderr: text("stderr"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("job_logs_job_id_seq_idx").on(t.jobId, t.sequence),
    index("job_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt),
  ]
)
