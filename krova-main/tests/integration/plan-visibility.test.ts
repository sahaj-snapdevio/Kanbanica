import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { visiblePlansForSpace } from "@/lib/plan/visibility";
import { seedSpace } from "@/tests/integration/_seed";

// Which plans a space may subscribe to — an access-control path: a custom/VIP
// plan must be visible ONLY to spaces it is explicitly assigned to (plus public
// plans + the space's own current plan).

/** Clone the seeded plan_trial into a fresh custom (non-public) plan so all
 *  required plan columns are valid without hand-listing them. */
async function seedCustomPlan(): Promise<string> {
  const [trial] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, "plan_trial"))
    .limit(1);
  assert.ok(trial, "migration 0037 seeds plan_trial");
  const id = createId();
  await db.insert(schema.plans).values({
    ...trial,
    id,
    slug: `custom-${createId().slice(0, 8)}`,
    name: "Custom VIP",
    visibility: "custom",
    isArchived: false,
    isDefaultForNewSpaces: false, // partial-unique index allows only one true
  });
  return id;
}

test("a custom plan is visible only to spaces it is assigned to", async () => {
  const customId = await seedCustomPlan();
  const assigned = await seedSpace();
  const other = await seedSpace();

  await db
    .insert(schema.planSpaceVisibility)
    .values({ planId: customId, spaceId: assigned.id });

  const visAssigned = await visiblePlansForSpace(assigned.id);
  const visOther = await visiblePlansForSpace(other.id);

  assert.ok(
    visAssigned.some((p) => p.id === customId),
    "assigned space sees the custom plan"
  );
  assert.ok(
    !visOther.some((p) => p.id === customId),
    "unassigned space must NOT see the custom plan"
  );
});

test("public plans + the space's own current plan are always visible", async () => {
  const space = await seedSpace(); // on plan_trial
  const visible = await visiblePlansForSpace(space.id);
  const ids = visible.map((p) => p.id);

  // own current plan
  assert.ok(ids.includes("plan_trial"), "current plan always present");
  // the seeded public plans
  for (const pub of ["plan_starter", "plan_pro", "plan_business"]) {
    assert.ok(ids.includes(pub), `public plan ${pub} should be visible`);
  }
});

test("the result is sorted by sortOrder then price (stable, cheapest-first)", async () => {
  const space = await seedSpace();
  const visible = await visiblePlansForSpace(space.id);
  for (let i = 1; i < visible.length; i++) {
    const prev = visible[i - 1];
    const cur = visible[i];
    const ordered =
      prev.sortOrder < cur.sortOrder ||
      (prev.sortOrder === cur.sortOrder &&
        Number.parseFloat(prev.priceUsd) <= Number.parseFloat(cur.priceUsd));
    assert.ok(ordered, `out-of-order at ${i}: ${prev.slug} before ${cur.slug}`);
  }
});
