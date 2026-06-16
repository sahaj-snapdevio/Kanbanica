import type { Job } from "pg-boss";

export async function handleScaffoldHealthcheck(
  jobs: Job<Record<string, never>>[]
) {
  for (const job of jobs) {
    console.log(`[worker] scaffold healthcheck ok (${job.id})`);
  }
}
