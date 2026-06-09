import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { normalizePgConnectionString } from "@/lib/pg-connection";
import { ensureJobQueues } from "@/lib/worker/ensure-queues";

let boss: PgBoss | null = null;
// Mutex: store the in-flight init promise so concurrent callers wait on the same one
let initPromise: Promise<PgBoss> | null = null;

async function initBoss(): Promise<PgBoss> {
  const b = new PgBoss(normalizePgConnectionString(env.DATABASE_URL));
  await b.start();
  await ensureJobQueues(b);
  boss = b;
  return b;
}

export function getBoss(): Promise<PgBoss> {
  if (boss) {
    return Promise.resolve(boss);
  }
  if (!initPromise) {
    initPromise = initBoss().catch((err) => {
      // Reset so the next call can retry
      initPromise = null;
      boss = null;
      throw err;
    });
  }
  return initPromise;
}

export async function enqueueJob<T extends Record<string, unknown>>(
  jobName: string,
  payload: T,
  options?: {
    startAfter?: number | string | Date;
    retryLimit?: number;
    retryDelay?: number;
    /**
     * pg-boss singleton key. At most one job with this (queue, key) pair may
     * be queued/active at once — a duplicate send returns null. Used to
     * collapse repeated server.reboot-recovery enqueues per server.
     */
    singletonKey?: string;
  }
): Promise<string | null> {
  const b = await getBoss();
  const jobId = await b.send(jobName, payload, options);
  return jobId;
}
