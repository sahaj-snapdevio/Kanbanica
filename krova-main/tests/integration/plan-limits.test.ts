import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import {
  assertCanCreateCubeV2,
  assertCubeWithinSizeV2,
  loadEffectiveLimits,
} from "@/lib/plan/limits";
import { invalidatePlanCache } from "@/lib/plan/usage";
import { seedSpace } from "@/tests/integration/_seed";

// Plan-limit enforcement against the REAL migration-seeded plan_trial row +
// the per-space override columns merged by effectiveLimits/loadEffectiveLimits.

test("plan limits: a space on plan_trial inherits the plan's ceilings", async () => {
  const space = await seedSpace();
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, "plan_trial"))
    .limit(1);
  assert.ok(plan, "migration 0037 seeds plan_trial");

  const limits = await loadEffectiveLimits(space.id);
  assert.equal(limits.maxVcpus, plan?.maxVcpus);
  assert.equal(limits.maxRamMb, plan?.maxRamMb);
  assert.equal(limits.maxDiskGb, plan?.maxDiskGb);
  assert.equal(limits.maxConcurrentCubes, plan?.maxConcurrentCubes);
});

test("plan limits: a per-space override wins over the plan value", async () => {
  const space = await seedSpace({ overrideMaxConcurrentCubes: 99 });
  invalidatePlanCache();
  const limits = await loadEffectiveLimits(space.id);
  assert.equal(
    limits.maxConcurrentCubes,
    99,
    "override_max_concurrent_cubes overrides the plan cap"
  );
});

test("plan limits: assertCubeWithinSizeV2 rejects an over-cap Cube", async () => {
  const space = await seedSpace();
  const limits = await loadEffectiveLimits(space.id);

  const tooBig = assertCubeWithinSizeV2(limits, {
    vcpus: limits.maxVcpus + 1,
    ramMb: limits.maxRamMb,
    diskGb: limits.maxDiskGb,
  });
  assert.equal(tooBig.ok, false, "vcpus over the plan cap is rejected");

  const fits = assertCubeWithinSizeV2(limits, {
    vcpus: limits.maxVcpus,
    ramMb: limits.maxRamMb,
    diskGb: limits.maxDiskGb,
  });
  assert.equal(fits.ok, true, "the max size itself fits");
});

test("plan limits: assertCanCreateCubeV2 blocks at the concurrent cap", async () => {
  const space = await seedSpace();
  const limits = await loadEffectiveLimits(space.id);
  const size = {
    vcpus: limits.maxVcpus,
    ramMb: limits.maxRamMb,
    diskGb: limits.maxDiskGb,
  };

  // count 0 → allowed.
  assert.equal(assertCanCreateCubeV2(limits, 0, size).ok, true);

  if (limits.maxConcurrentCubes !== null) {
    // count at the cap → blocked.
    const atCap = assertCanCreateCubeV2(
      limits,
      limits.maxConcurrentCubes,
      size
    );
    assert.equal(atCap.ok, false, "creating beyond the concurrent cap fails");
  }
});
