import type { PgBoss } from "pg-boss";
import { JOB_NAMES, type JobName } from "@/lib/worker/job-types";

type QueuePolicy = "standard" | "short" | "singleton" | "stately" | "exclusive";

// Exhaustive Record — adding a job to JOB_NAMES without an entry here is a
// compile-time error, so a new queue can never silently fall back to pg-boss
// defaults. If a job genuinely wants defaults, add an explicit `{}` entry.
export const QUEUE_OPTIONS: Record<
  JobName,
  {
    retryLimit?: number;
    retryDelay?: number;
    expireInSeconds?: number;
    policy?: QueuePolicy;
  }
> = {
  // send-email: fire-and-forget SMTP send. retryLimit 3 covers transient
  // connection failures. exclusive + per-recipient singletonKey (set at
  // enqueue time) prevents duplicate sends on double-click.
  [JOB_NAMES.SEND_EMAIL]: {
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 600,
    policy: "exclusive",
  },
};

const JOB_QUEUES: JobName[] = Object.values(JOB_NAMES);

function isQueueAlreadyExistsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("already exists") || msg.includes("duplicate key");
}

export async function ensureJobQueues(boss: PgBoss): Promise<void> {
  for (const queue of JOB_QUEUES) {
    try {
      await boss.createQueue(queue, QUEUE_OPTIONS[queue]);
    } catch (err) {
      if (!isQueueAlreadyExistsError(err)) throw err;
    }
  }
}
