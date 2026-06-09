/**
 * Postpaid overage helpers — the three-bucket cascade (prepaid → overage →
 * sleep) and the post-commit Polar meter reporter. The hourly worker calls
 * `applyOverageCascadeTx()` inside its per-space tx; the caller then awaits
 * `reportOverageEventNow()` after the tx commits.
 */
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Tx } from "@/lib/billing/apply-topup";
import {
  type CascadeInput,
  type CascadeResult,
  computeOverageCascade,
} from "@/lib/billing/overage-cascade";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";

// The pure cascade math lives in ./overage-cascade (import-safe, unit-tested).
// Re-export so existing importers (lib/cost.ts) keep their import path.
export {
  type CascadeInput,
  type CascadeResult,
  computeOverageCascade,
} from "@/lib/billing/overage-cascade";

/**
 * Apply the cascade inside an open transaction. Writes the two `spaces`
 * counters and inserts the `overage_charge` ledger row (if any overage was
 * consumed). Returns the inserted billing_event id so the post-commit
 * reporter can target it.
 */
export async function applyOverageCascadeTx(opts: {
  tx: Tx;
  input: CascadeInput;
  billedAt: Date;
}): Promise<{ result: CascadeResult; overageEventId: string | null }> {
  const { tx, input, billedAt } = opts;
  const result = computeOverageCascade(input);

  await tx
    .update(schema.spaces)
    .set({
      creditBalance: result.newCreditBalance,
      thisPeriodOverageUsd: result.newThisPeriodOverageUsd,
      updatedAt: billedAt,
    })
    .where(eq(schema.spaces.id, input.space.id));

  if (result.fromOverage <= 0) {
    return { result, overageEventId: null };
  }

  const [row] = await tx
    .insert(schema.billingEvents)
    .values({
      spaceId: input.space.id,
      amount: result.fromOverage.toFixed(4),
      type: "overage_charge",
      description: `Overage debit ($${result.fromOverage.toFixed(4)}) — this period $${result.newThisPeriodOverageUsd} of $${input.space.overageCapUsd}`,
    })
    .returning({ id: schema.billingEvents.id });

  return { result, overageEventId: row.id };
}

/**
 * Post-commit: report an overage event to Polar and back-fill
 * `polar_meter_reported_at`. Best-effort — a failure leaves the row for the
 * `polar.meter-reconcile` cron to retry. Returns true on successful report.
 */
export async function reportOverageEventNow(
  billingEventId: string
): Promise<boolean> {
  const [row] = await db
    .select({
      id: schema.billingEvents.id,
      spaceId: schema.billingEvents.spaceId,
      amount: schema.billingEvents.amount,
      createdAt: schema.billingEvents.createdAt,
      polarMeterReportedAt: schema.billingEvents.polarMeterReportedAt,
    })
    .from(schema.billingEvents)
    .where(eq(schema.billingEvents.id, billingEventId))
    .limit(1);
  if (!row || row.polarMeterReportedAt) {
    return true; // already done
  }

  try {
    const result = await getPaymentProvider().reportMeterEvents([
      {
        eventId: row.id,
        spaceId: row.spaceId,
        amountCents: Math.round(Number.parseFloat(row.amount) * 100),
        occurredAt: row.createdAt,
      },
    ]);
    // Defense in depth: only back-fill `polarMeterReportedAt` when Polar
    // acknowledged the event (inserted OR duplicate). A {0,0} return for a
    // 1-event call means the provider silently dropped it — leave NULL so
    // the reconcile cron retries.
    if (result.inserted + result.duplicates < 1) {
      console.warn(
        `[overage] reportMeterEvents returned no acknowledgement for ${billingEventId} — leaving NULL for retry`
      );
      return false;
    }
    await db
      .update(schema.billingEvents)
      .set({ polarMeterReportedAt: new Date() })
      .where(eq(schema.billingEvents.id, billingEventId));
    return true;
  } catch (err) {
    console.error(
      `[overage] failed to report event ${billingEventId} to Polar — reconcile will retry`,
      err
    );
    return false;
  }
}

/**
 * Batch-report a set of unreported `overage_charge` rows. Used by the
 * reconcile cron. Returns the count successfully reported.
 */
export async function reportUnreportedOverageBatch(opts: {
  olderThanMinutes: number;
  limit: number;
}): Promise<{ reported: number; deduped: number; failed: number }> {
  const cutoff = new Date(Date.now() - opts.olderThanMinutes * 60 * 1000);
  const rows = await db
    .select({
      id: schema.billingEvents.id,
      spaceId: schema.billingEvents.spaceId,
      amount: schema.billingEvents.amount,
      createdAt: schema.billingEvents.createdAt,
    })
    .from(schema.billingEvents)
    .where(
      and(
        eq(schema.billingEvents.type, "overage_charge"),
        isNull(schema.billingEvents.polarMeterReportedAt),
        lt(schema.billingEvents.createdAt, cutoff)
      )
    )
    .limit(opts.limit);
  if (rows.length === 0) {
    return { reported: 0, deduped: 0, failed: 0 };
  }

  try {
    const ids = rows.map((r) => r.id);
    const result = await getPaymentProvider().reportMeterEvents(
      rows.map((r) => ({
        eventId: r.id,
        spaceId: r.spaceId,
        amountCents: Math.round(Number.parseFloat(r.amount) * 100),
        occurredAt: r.createdAt,
      }))
    );
    // Defense in depth: only back-fill `polarMeterReportedAt` when Polar
    // actually acknowledged every event in the batch (inserted + duplicates
    // == count). If a provider implementation ever returns a partial-success
    // shape, the unacknowledged rows stay NULL for the next cron tick.
    if (result.inserted + result.duplicates < rows.length) {
      console.warn(
        `[overage.reconcile] partial batch ack: ${result.inserted + result.duplicates}/${rows.length} — leaving the rest NULL for retry`
      );
      return {
        reported: result.inserted,
        deduped: result.duplicates,
        failed: rows.length - (result.inserted + result.duplicates),
      };
    }
    // Mark every row reported (Polar dedupes on eventId — whether it was an
    // insert or a duplicate, our copy is now consistent with Polar).
    await db
      .update(schema.billingEvents)
      .set({ polarMeterReportedAt: new Date() })
      .where(
        and(
          eq(schema.billingEvents.type, "overage_charge"),
          isNull(schema.billingEvents.polarMeterReportedAt),
          inArray(schema.billingEvents.id, ids)
        )
      );
    return {
      reported: result.inserted,
      deduped: result.duplicates,
      failed: 0,
    };
  } catch (err) {
    console.error("[overage.reconcile] batch failed:", err);
    return { reported: 0, deduped: 0, failed: rows.length };
  }
}
