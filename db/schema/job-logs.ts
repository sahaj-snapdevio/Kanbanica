import { createId } from "@paralleldrive/cuid2";
import { index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const jobLogLevel = pgEnum("job_log_level", ["info", "warn", "error"]);

export const jobLogs = pgTable(
  "job_logs",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    jobId: text("job_id").notNull(),
    jobName: text("job_name").notNull(),
    entityType: text("entity_type").notNull().default("system"),
    entityId: text("entity_id").notNull().default("system"),
    sequence: integer("sequence").notNull().default(0),
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
);
