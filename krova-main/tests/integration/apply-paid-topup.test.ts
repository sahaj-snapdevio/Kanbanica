import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { applyPaidTopup } from "@/lib/billing/apply-paid-topup";
import { db } from "@/lib/db";
import { readSpace, seedSpace } from "@/tests/integration/_seed";

// The idempotent pending→paid credit flip used by the Polar webhook + the
// reconcile cron. Against real rows: credits exactly once, second delivery is
// a no-op, unknown checkout is not_found.

async function seedPurchase(spaceId: string, amount: string) {
  const checkoutId = `chk_${createId()}`;
  await db.insert(schema.creditPurchases).values({
    id: createId(),
    spaceId,
    paymentProvider: "polar",
    amount,
    surchargeAmount: "1.0000",
    status: "pending",
    providerCheckoutId: checkoutId,
  });
  return checkoutId;
}

test("applyPaidTopup: credits once, replays as already_processed", async () => {
  const space = await seedSpace({ creditBalance: "0.0000" });
  const checkoutId = await seedPurchase(space.id, "25.0000");
  // Unique per run — provider_order_id is uniquely indexed, so a hardcoded
  // literal would collide across runs against the same DB (or a leaked test pg).
  const orderId = `ord_${createId()}`;

  const r1 = await applyPaidTopup({
    providerCheckoutId: checkoutId,
    providerOrderId: orderId,
  });
  assert.equal(r1.result, "credited");
  assert.equal((await readSpace(space.id))?.creditBalance, "25.0000");

  // ledger row written
  const events = await db
    .select()
    .from(schema.billingEvents)
    .where(
      and(
        eq(schema.billingEvents.spaceId, space.id),
        eq(schema.billingEvents.type, "credit_topup")
      )
    );
  assert.equal(events.length, 1, "exactly one credit_topup ledger row");
  assert.equal(events[0]?.amount, "25.0000");

  // purchase row flipped to paid
  const [purchase] = await db
    .select()
    .from(schema.creditPurchases)
    .where(eq(schema.creditPurchases.providerCheckoutId, checkoutId))
    .limit(1);
  assert.equal(purchase?.status, "paid");
  assert.equal(purchase?.providerOrderId, orderId);

  // second delivery is a no-op (idempotent) — balance unchanged, no 2nd ledger row
  const r2 = await applyPaidTopup({
    providerCheckoutId: checkoutId,
    providerOrderId: orderId,
  });
  assert.equal(r2.result, "already_processed");
  assert.equal((await readSpace(space.id))?.creditBalance, "25.0000");
  const eventsAfter = await db
    .select()
    .from(schema.billingEvents)
    .where(
      and(
        eq(schema.billingEvents.spaceId, space.id),
        eq(schema.billingEvents.type, "credit_topup")
      )
    );
  assert.equal(eventsAfter.length, 1, "no duplicate credit on replay");
});

test("applyPaidTopup: unknown checkout id → not_found (no throw)", async () => {
  const r = await applyPaidTopup({
    providerCheckoutId: `chk_${createId()}`,
    providerOrderId: `ord_${createId()}`,
  });
  assert.equal(r.result, "not_found");
});
