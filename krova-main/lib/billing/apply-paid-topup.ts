/**
 * The shared `order.paid` apply path — the idempotent `pending→paid` flip plus
 * the credit application, in ONE transaction. Used by the Polar webhook and by
 * the `billing.topup-reconcile` backstop. Idempotent: a second call for the
 * same order is a no-op (`already_processed`).
 */
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { applyCreditTopup } from "@/lib/billing/apply-topup";
import { db } from "@/lib/db";
import { enqueueEmailitSyncForSpaceOwner } from "@/lib/emailit/enqueue-sync";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export type ApplyPaidTopupOutcome =
  | { result: "credited"; purchaseId: string }
  | { result: "already_processed" }
  | { result: "not_found" }
  | { result: "orphaned"; purchaseId: string };

/**
 * Apply a paid top-up identified by its provider checkout id.
 * `not_found` → no `credit_purchases` row matches (caller decides whether to
 * retry). `already_processed` → the row was not `pending` (idempotent no-op).
 * `orphaned` → the space row no longer exists; the purchase is marked
 * `orphaned` and no credit is applied.
 */
export async function applyPaidTopup(opts: {
  providerCheckoutId: string;
  providerOrderId: string;
}): Promise<ApplyPaidTopupOutcome> {
  const { providerCheckoutId, providerOrderId } = opts;

  const applied = await db.transaction(async (tx) => {
    // Lock the purchase row for the life of the transaction — serializes a
    // concurrent webhook + reconcile delivery for the same checkout and keeps
    // every field used below (spaceId, amount) consistent with the flip.
    const [row] = await tx
      .select()
      .from(schema.creditPurchases)
      .where(eq(schema.creditPurchases.providerCheckoutId, providerCheckoutId))
      .for("update")
      .limit(1);

    if (!row) {
      return { result: "not_found" as const, wakeCubeIds: [] as string[] };
    }

    // Idempotent conditional flip — only a row still `pending` is credited.
    const flipped = await tx
      .update(schema.creditPurchases)
      .set({ status: "paid", providerOrderId, paidAt: new Date() })
      .where(
        and(
          eq(schema.creditPurchases.id, row.id),
          eq(schema.creditPurchases.status, "pending")
        )
      )
      .returning({ id: schema.creditPurchases.id });

    if (flipped.length === 0) {
      return {
        result: "already_processed" as const,
        wakeCubeIds: [] as string[],
      };
    }

    const credited = await applyCreditTopup({
      tx,
      spaceId: row.spaceId,
      amount: Number.parseFloat(row.amount),
      type: "credit_topup",
      description: "Credit purchase via Polar",
    });

    if (credited === null) {
      // Space was deleted between checkout and payment — mark orphaned,
      // apply no credit. The orphaned row is the operator-visible record.
      await tx
        .update(schema.creditPurchases)
        .set({ status: "orphaned" })
        .where(eq(schema.creditPurchases.id, row.id));
      return {
        result: "orphaned" as const,
        purchaseId: row.id,
        wakeCubeIds: [] as string[],
      };
    }

    return {
      result: "credited" as const,
      purchaseId: row.id,
      spaceId: row.spaceId,
      wakeCubeIds: credited.wakeCubeIds,
    };
  });

  if (applied.result === "not_found") {
    return { result: "not_found" };
  }
  if (applied.result === "already_processed") {
    return { result: "already_processed" };
  }
  if (applied.result === "orphaned") {
    return { result: "orphaned", purchaseId: applied.purchaseId };
  }

  // credited — wake zero-balance-slept cubes AFTER the transaction commits.
  for (const cubeId of applied.wakeCubeIds) {
    const [cube] = await db
      .select({ serverId: schema.cubes.serverId })
      .from(schema.cubes)
      .where(eq(schema.cubes.id, cubeId))
      .limit(1);
    if (cube) {
      await enqueueJob(JOB_NAMES.CUBE_WAKE, {
        cubeId,
        spaceId: applied.spaceId,
        serverId: cube.serverId,
      });
    }
  }
  await enqueueEmailitSyncForSpaceOwner(applied.spaceId);
  return { result: "credited", purchaseId: applied.purchaseId };
}
