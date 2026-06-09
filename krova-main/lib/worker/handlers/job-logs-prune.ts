/**
 * Daily prune for the `job_logs` table.
 *
 * The table grows unboundedly otherwise — every setup phase, every Cube boot,
 * every snapshot writes rows here. We apply two policies:
 *
 *  1. Differential time-based retention by level:
 *     - errors  → 90 days (forensics & post-mortems)
 *     - info/warn → 30 days
 *
 *  2. Per-entity cap: keep at most ENTITY_CAP rows per (entityType, entityId).
 *     Bounds storage even for entities with extremely chatty job histories
 *     (e.g. a long-running Cube that's been booted/slept thousands of times).
 *
 * Scheduled via pg-boss cron in boss.ts at 03:00 UTC daily.
 */

import { and, count, desc, eq, gt, lt, ne, notInArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

const INFO_RETENTION_DAYS = 30;
const ERROR_RETENTION_DAYS = 90;
const ENTITY_CAP = 5000;
const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;

export async function handleJobLogsPrune(): Promise<void> {
  const now = Date.now();
  const infoCutoff = new Date(now - INFO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const errorCutoff = new Date(
    now - ERROR_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  // 1. Time-based prune. Errors stick around longer than info/warn so root-cause
  //    diagnostics for old incidents stay reachable.
  const infoDeleted = await db
    .delete(schema.jobLogs)
    .where(
      and(
        ne(schema.jobLogs.level, "error"),
        lt(schema.jobLogs.createdAt, infoCutoff)
      )
    )
    .returning({ id: schema.jobLogs.id });
  const errorDeleted = await db
    .delete(schema.jobLogs)
    .where(
      and(
        eq(schema.jobLogs.level, "error"),
        lt(schema.jobLogs.createdAt, errorCutoff)
      )
    )
    .returning({ id: schema.jobLogs.id });

  // 2. Per-entity cap. Find any (entityType, entityId) bucket exceeding the
  //    cap, then delete the surplus rows (oldest first) for that entity only.
  const overCap = await db
    .select({
      entityType: schema.jobLogs.entityType,
      entityId: schema.jobLogs.entityId,
      total: count(),
    })
    .from(schema.jobLogs)
    .groupBy(schema.jobLogs.entityType, schema.jobLogs.entityId)
    .having(gt(count(), ENTITY_CAP));

  let capDeleted = 0;
  for (const row of overCap) {
    const keep = await db
      .select({ id: schema.jobLogs.id })
      .from(schema.jobLogs)
      .where(
        and(
          eq(schema.jobLogs.entityType, row.entityType),
          eq(schema.jobLogs.entityId, row.entityId)
        )
      )
      .orderBy(desc(schema.jobLogs.createdAt), desc(schema.jobLogs.sequence))
      .limit(ENTITY_CAP);
    const keepIds = keep.map((k) => k.id);
    if (keepIds.length === 0) {
      continue;
    }

    const deleted = await db
      .delete(schema.jobLogs)
      .where(
        and(
          eq(schema.jobLogs.entityType, row.entityType),
          eq(schema.jobLogs.entityId, row.entityId),
          notInArray(schema.jobLogs.id, keepIds)
        )
      )
      .returning({ id: schema.jobLogs.id });
    capDeleted += deleted.length;
  }

  // 3. Webhook delivery retention: delete deliveries older than 30 days.
  const deliveryCutoff = new Date(
    now - WEBHOOK_DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const deliveriesDeleted = await db
    .delete(schema.outboundWebhookDeliveries)
    .where(lt(schema.outboundWebhookDeliveries.createdAt, deliveryCutoff))
    .returning({ id: schema.outboundWebhookDeliveries.id });

  console.log(
    `[job-logs-prune] removed ${infoDeleted.length} info/warn (>${INFO_RETENTION_DAYS}d) + ${errorDeleted.length} errors (>${ERROR_RETENTION_DAYS}d) + ${capDeleted} cap-trim + ${deliveriesDeleted.length} webhook deliveries (>${WEBHOOK_DELIVERY_RETENTION_DAYS}d)`
  );
}
