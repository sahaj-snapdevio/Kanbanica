/**
 * Per-step structured logger for pg-boss job handlers.
 *
 * Each handler instantiates one `JobLogger` and calls `info`/`warn`/`error`
 * for ad-hoc messages, or `step(label, fn)` to wrap a discrete unit of work
 * with start/end timestamps + duration.
 *
 * Each call writes a row to `job_logs` and emits a `job.log` Pusher event on
 * the entity's private channel (e.g. `private-server-{serverId}`) so the UI
 * can append entries live. DB write and Pusher push are independent —
 * a Pusher outage doesn't drop the persisted log.
 *
 * Sequence numbers are monotonic per JobLogger instance; do not share an
 * instance across concurrent steps.
 */

import { jobLogs } from "@/db/schema";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";

export type JobEntityType = "server" | "cube" | "snapshot" | "backup";
export type JobLogLevel = "info" | "warn" | "error";

interface WriteOpts {
  stderr?: string;
  stdout?: string;
}

// 20 KB safety net for stdout/stderr blobs persisted on a log row.
const STDIO_LIMIT = 20_000;

export class JobLogger {
  private seq = 0;

  constructor(
    public readonly jobId: string,
    public readonly jobName: string,
    public readonly entityType: JobEntityType,
    public readonly entityId: string
  ) {}

  info(message: string, opts?: WriteOpts): Promise<void> {
    return this.write("info", message, opts);
  }

  warn(message: string, opts?: WriteOpts): Promise<void> {
    return this.write("warn", message, opts);
  }

  error(message: string, opts?: WriteOpts): Promise<void> {
    return this.write("error", message, opts);
  }

  /**
   * Run a labeled async step.
   *
   * Persists TWO rows: a "▶ {label}" start marker at the beginning, then a
   * final "{label}" row with duration at the end (or an error row on throw).
   * The start marker means the UI knows a step is in flight even if the
   * inner work takes minutes — without it, long steps look frozen between
   * the completion of step N and the completion of step N+1.
   *
   * On thrown error, records as `error` level with the error message and
   * rethrows so the handler's outer catch still fires.
   */
  async step<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = new Date();
    const startSeq = ++this.seq;
    await this.persist({
      sequence: startSeq,
      level: "info",
      message: `▶ ${label}`,
      startedAt,
    });

    try {
      const result = await fn();
      const finishedAt = new Date();
      const endSeq = ++this.seq;
      await this.persist({
        sequence: endSeq,
        level: "info",
        message: label,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
      return result;
    } catch (err) {
      const finishedAt = new Date();
      const errSeq = ++this.seq;
      const msg = err instanceof Error ? err.message : String(err);
      await this.persist({
        sequence: errSeq,
        level: "error",
        message: `${label}: ${msg}`,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        stderr: msg,
      });
      throw err;
    }
  }

  private async write(
    level: JobLogLevel,
    message: string,
    opts?: WriteOpts
  ): Promise<void> {
    const sequence = ++this.seq;
    await this.persist({
      sequence,
      level,
      message,
      stdout: opts?.stdout,
      stderr: opts?.stderr,
    });
  }

  private async persist(row: {
    sequence: number;
    level: JobLogLevel;
    message: string;
    stdout?: string;
    stderr?: string;
    startedAt?: Date;
    finishedAt?: Date;
    durationMs?: number;
  }): Promise<void> {
    const stdout = row.stdout ? row.stdout.slice(-STDIO_LIMIT) : null;
    const stderr = row.stderr ? row.stderr.slice(-STDIO_LIMIT) : null;

    try {
      await db.insert(jobLogs).values({
        jobId: this.jobId,
        jobName: this.jobName,
        entityType: this.entityType,
        entityId: this.entityId,
        sequence: row.sequence,
        level: row.level,
        message: row.message,
        stdout,
        stderr,
        startedAt: row.startedAt ?? null,
        finishedAt: row.finishedAt ?? null,
        durationMs: row.durationMs ?? null,
      });
    } catch (err) {
      console.error("[JobLogger] db insert failed", err);
    }

    try {
      await triggerEvent(
        `private-${this.entityType}-${this.entityId}`,
        "job.log",
        {
          jobId: this.jobId,
          jobName: this.jobName,
          sequence: row.sequence,
          level: row.level,
          message: row.message,
          durationMs: row.durationMs,
          hasStdout: !!stdout,
          hasStderr: !!stderr,
        }
      );
    } catch (err) {
      console.error("[JobLogger] pusher push failed", err);
    }
  }
}
