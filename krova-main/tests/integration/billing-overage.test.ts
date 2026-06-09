import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { applyOverageCascadeTx } from "@/lib/billing/overage";
import { db } from "@/lib/db";
import { readSpace, seedSpace } from "@/tests/integration/_seed";

// The three-bucket overage cascade applied against a REAL space row inside a
// real transaction — covers the DB write path the pure overage-cascade unit
// test can't (counter UPDATE + overage_charge ledger insert + the FK).

const billedAt = new Date("2026-05-31T12:00:00.000Z");

test("overage: prepaid covers full cost — balance debited, no ledger row", async () => {
  const space = await seedSpace({ creditBalance: "10.0000" });

  const { result, overageEventId } = await db.transaction((tx) =>
    applyOverageCascadeTx({
      tx,
      billedAt,
      input: {
        space: {
          id: space.id,
          creditBalance: "10.0000",
          allowOverage: false,
          overageEnabled: false,
          overageCapUsd: "0.0000",
          thisPeriodOverageUsd: "0.0000",
          subscriptionStatus: null,
        },
        totalCost: 2.5,
      },
    })
  );

  assert.equal(result.fromPrepaid, 2.5);
  assert.equal(result.fromOverage, 0);
  assert.equal(result.refused, 0);
  assert.equal(overageEventId, null, "no overage ⇒ no billing_event row");

  const row = await readSpace(space.id);
  assert.equal(row?.creditBalance, "7.5000");
  assert.equal(row?.thisPeriodOverageUsd, "0.0000");
});

test("overage: prepaid empty + overage enabled + active sub — debits budget, writes overage_charge", async () => {
  const space = await seedSpace({
    creditBalance: "0.0000",
    overageEnabled: true,
    overageCapUsd: "20.0000",
    thisPeriodOverageUsd: "0.0000",
    subscriptionStatus: "active",
  });

  const { result, overageEventId } = await db.transaction((tx) =>
    applyOverageCascadeTx({
      tx,
      billedAt,
      input: {
        space: {
          id: space.id,
          creditBalance: "0.0000",
          allowOverage: true,
          overageEnabled: true,
          overageCapUsd: "20.0000",
          thisPeriodOverageUsd: "0.0000",
          subscriptionStatus: "active",
        },
        totalCost: 3,
      },
    })
  );

  assert.equal(result.fromPrepaid, 0);
  assert.equal(result.fromOverage, 3);
  assert.equal(result.refused, 0);
  assert.ok(overageEventId, "an overage debit must insert a billing_event");

  const row = await readSpace(space.id);
  assert.equal(row?.thisPeriodOverageUsd, "3.0000");

  const [event] = await db
    .select()
    .from(schema.billingEvents)
    .where(
      and(
        eq(schema.billingEvents.spaceId, space.id),
        eq(schema.billingEvents.type, "overage_charge")
      )
    )
    .limit(1);
  assert.ok(event, "overage_charge row exists");
  assert.equal(event?.amount, "3.0000");
  assert.equal(
    event?.polarMeterReportedAt,
    null,
    "freshly-inserted overage row is not yet meter-reported"
  );
});

test("overage: overage disabled — unfunded cost is refused, no ledger row", async () => {
  const space = await seedSpace({ creditBalance: "1.0000" });

  const { result, overageEventId } = await db.transaction((tx) =>
    applyOverageCascadeTx({
      tx,
      billedAt,
      input: {
        space: {
          id: space.id,
          creditBalance: "1.0000",
          allowOverage: false,
          overageEnabled: false,
          overageCapUsd: "0.0000",
          thisPeriodOverageUsd: "0.0000",
          subscriptionStatus: "active",
        },
        totalCost: 4,
      },
    })
  );

  assert.equal(result.fromPrepaid, 1);
  assert.equal(result.fromOverage, 0);
  assert.equal(result.refused, 3, "the 3 unfunded ⇒ auto-sleep trigger");
  assert.equal(overageEventId, null);

  const row = await readSpace(space.id);
  assert.equal(row?.creditBalance, "0.0000");
});
