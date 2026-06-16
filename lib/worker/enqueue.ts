import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { normalizePgConnectionString } from "@/lib/pg-connection";
import { ensureJobQueues } from "@/lib/worker/ensure-queues";
import type { JobName, JobPayloads } from "@/lib/worker/job-types";

let boss: PgBoss | null = null;
let initPromise: Promise<PgBoss> | null = null;

async function initBoss() {
  const instance = new PgBoss({
    connectionString: normalizePgConnectionString(env.DATABASE_URL),
    schedule: false,
    supervise: false,
  });

  await instance.start();
  await ensureJobQueues(instance);
  boss = instance;
  return instance;
}

export function getBoss() {
  if (boss) {
    return Promise.resolve(boss);
  }

  if (!initPromise) {
    initPromise = initBoss().catch((error) => {
      boss = null;
      initPromise = null;
      throw error;
    });
  }

  return initPromise;
}

export async function enqueueJob<TName extends JobName>(
  jobName: TName,
  payload: JobPayloads[TName],
  options?: {
    singletonKey?: string;
    startAfter?: Date | number | string;
  }
) {
  const instance = await getBoss();
  return instance.send(jobName, payload, options);
}
