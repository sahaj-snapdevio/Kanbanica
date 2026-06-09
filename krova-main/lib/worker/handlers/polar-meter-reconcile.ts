/**
 * Cron — re-reports any `overage_charge` row whose Polar meter event has not
 * been confirmed. Runs every 10 minutes; targets rows older than 5 minutes
 * (the hourly worker's inline report has had a chance to succeed). Hard
 * deadline: every overage event MUST land in Polar's meter before the
 * customer's subscription period ends, or the invoice will under-bill.
 */
import type { Job } from "pg-boss";

import { reportUnreportedOverageBatch } from "@/lib/billing/overage";

export async function handlePolarMeterReconcile(_jobs: Job[]): Promise<void> {
  void _jobs;
  console.log("[polar.meter-reconcile] starting");
  const r = await reportUnreportedOverageBatch({
    olderThanMinutes: 5,
    limit: 500,
  });
  // Use `errors` rather than `failed` in the summary string — Dokploy's log
  // viewer auto-colors any line containing the word `failed` as red, even
  // when the counter is zero. Misclassifying a clean tick as an error is
  // alarm-fatigue noise.
  console.log(
    `[polar.meter-reconcile] done — reported=${r.reported} deduped=${r.deduped} errors=${r.failed}`
  );
}
