/**
 * Dead-letter monitoring for critical job queues.
 * Wraps handlers to detect when a job has exhausted all retries and audit-logs the failure.
 * This ensures permanent failures are visible to admins rather than silently lost.
 */

import type { Job, JobWithMetadata } from "pg-boss";
import { audit } from "@/lib/audit";

/**
 * Wraps a pg-boss handler to audit-log when a job is on its last retry attempt.
 * pg-boss increments `retryCount` on each retry; when it equals `retryLimit`,
 * the current attempt is the final one — if it fails, the job goes to "failed" state.
 *
 * IMPORTANT (pg-boss v12): `retryCount` / `retryLimit` live ONLY on
 * `JobWithMetadata<T>`, and pg-boss delivers metadata ONLY when the queue's
 * `boss.work()` is registered with `{ includeMetadata: true }`. The plain
 * `Job<T>` delivered by a 2-arg `boss.work(name, handler)` has NEITHER field,
 * and the fields are camelCase, not the old lowercase `retrycount`/`retrylimit`.
 * Register monitored queues via `workMonitored()` in boss.ts (which sets
 * `includeMetadata: true`) — otherwise both reads are `undefined`, `0 >= 0` is
 * always true, and EVERY transient first-attempt failure is mislabeled a
 * "permanent failure", flooding the audit log + the Orbit alarm. (2026-05-31
 * worker audit; regression from the pg-boss v12 upgrade.)
 */
export function withDeadLetterMonitoring<T>(
  queueName: string,
  handler: (jobs: Job<T>[]) => Promise<void>,
  // Injectable for unit testing; defaults to the real fire-and-forget audit().
  auditFn: typeof audit = audit
): (jobs: JobWithMetadata<T>[]) => Promise<void> {
  return async (jobs: JobWithMetadata<T>[]) => {
    try {
      await handler(jobs);
    } catch (err) {
      // Check if any job in this batch is on its final retry
      for (const job of jobs) {
        const retryCount = job.retryCount ?? 0;
        const retryLimit = job.retryLimit ?? 0;

        if (retryCount >= retryLimit) {
          // This is the last attempt — job will be permanently failed
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(
            `[worker] PERMANENT FAILURE: ${queueName} job ${job.id} failed on final retry (${retryCount}/${retryLimit}): ${errorMsg}`
          );
          auditFn({
            action: "worker.job_permanently_failed",
            category: "app",
            actorType: "system",
            entityType: "job",
            entityId: job.id,
            description: `CRITICAL: Job ${queueName} permanently failed after ${retryLimit} retries — requires manual intervention`,
            metadata: {
              queue: queueName,
              jobId: job.id,
              retryCount,
              retryLimit,
              payload: job.data,
              error: errorMsg,
            },
            source: "worker",
          });
        }
      }

      // Re-throw so pg-boss still marks the job as failed/retryable
      throw err;
    }
  };
}
