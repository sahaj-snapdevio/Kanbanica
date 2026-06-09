import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { applyPlanCredit } from "@/lib/billing/apply-plan-credit";
import { db } from "@/lib/db";
import { readSpace, seedSpace } from "@/tests/integration/_seed";

// Plan included-credit grant idempotency — the UNIQUE(provider_subscription_id,
// period_end) guarantee that a billing period grants credit AT MOST ONCE, plus
// the activation anti-abuse cooldown. applyPlanCredit is tx-scoped (no
// enqueue/email at this layer), so it runs against real rows directly.

async function paidIncludedCredit(): Promise<{ planId: string; usd: number }> {
  const [plan] = await db
    .select({ id: schema.plans.id, c: schema.plans.includedCreditUsd })
    .from(schema.plans)
    .where(eq(schema.plans.id, "plan_pro"))
    .limit(1);
  assert.ok(plan, "migration 0037 seeds plan_pro");
  const usd = Number.parseFloat(plan.c);
  assert.ok(usd > 0, "plan_pro must include credit for this test");
  return { planId: plan.id, usd };
}

const periodStart = new Date("2026-05-01T00:00:00.000Z");
const periodEnd = new Date("2026-06-01T00:00:00.000Z");

test("applyPlanCredit: grants once, second delivery for the same period is a no-op", async () => {
  const { planId, usd } = await paidIncludedCredit();
  const space = await seedSpace({ creditBalance: "0.0000" });
  const subId = `sub_${createId()}`;

  const r1 = await db.transaction((tx) =>
    applyPlanCredit({
      tx,
      spaceId: space.id,
      planId,
      providerSubscriptionId: subId,
      periodStart,
      periodEnd,
      reason: "renewal",
    })
  );
  assert.equal(r1.result, "granted");
  assert.equal((await readSpace(space.id))?.creditBalance, usd.toFixed(4));

  // exactly one grant row + one plan_credit ledger row
  const grants = await db
    .select()
    .from(schema.subscriptionCreditGrants)
    .where(eq(schema.subscriptionCreditGrants.providerSubscriptionId, subId));
  assert.equal(grants.length, 1);

  // redelivery of the SAME (subId, periodEnd) → period conflict → no-op
  const r2 = await db.transaction((tx) =>
    applyPlanCredit({
      tx,
      spaceId: space.id,
      planId,
      providerSubscriptionId: subId,
      periodStart,
      periodEnd,
      reason: "renewal",
    })
  );
  assert.equal(r2.result, "skipped_period_already_granted");
  assert.equal(
    (await readSpace(space.id))?.creditBalance,
    usd.toFixed(4),
    "no double credit on redelivery"
  );
});

test("applyPlanCredit: a zero-credit period inserts a marker row but grants nothing", async () => {
  // Every seeded plan includes some credit, so reach the zero-credit branch the
  // realistic way: a per-space override that zeroes the included credit. The
  // override wins over the plan value in applyPlanCredit.
  const { planId } = await paidIncludedCredit();
  const space = await seedSpace({
    creditBalance: "0.0000",
    overrideIncludedCreditUsd: "0.0000",
  });
  const subId = `sub_${createId()}`;
  const r = await db.transaction((tx) =>
    applyPlanCredit({
      tx,
      spaceId: space.id,
      planId,
      providerSubscriptionId: subId,
      periodStart,
      periodEnd,
      reason: "activation",
    })
  );
  assert.equal(r.result, "skipped_zero_credit");
  assert.equal((await readSpace(space.id))?.creditBalance, "0.0000");
  const [grant] = await db
    .select()
    .from(schema.subscriptionCreditGrants)
    .where(eq(schema.subscriptionCreditGrants.providerSubscriptionId, subId))
    .limit(1);
  assert.equal(
    grant?.reason,
    "skipped_zero_credit",
    "marker row present for idempotency"
  );
});

test("applyPlanCredit: activation cooldown blocks a second grant within the window", async () => {
  const { planId } = await paidIncludedCredit();
  // lastPlanCreditGrantAt = now → an activation grant for a NEW period is
  // inside the cooldown and must be skipped (anti subscribe/cancel/resub abuse).
  const space = await seedSpace({
    creditBalance: "0.0000",
    lastPlanCreditGrantAt: new Date(),
  });
  const r = await db.transaction((tx) =>
    applyPlanCredit({
      tx,
      spaceId: space.id,
      planId,
      providerSubscriptionId: `sub_${createId()}`,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      reason: "activation",
    })
  );
  assert.equal(r.result, "skipped_cooldown");
  assert.equal(
    (await readSpace(space.id))?.creditBalance,
    "0.0000",
    "cooldown blocked the credit"
  );
});
