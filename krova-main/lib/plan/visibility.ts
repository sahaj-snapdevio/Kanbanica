/**
 * Phase 5 plan visibility — which plans a given space can subscribe to.
 *
 * A plan is visible to a space iff:
 *   - It is `visibility = 'public'` and not archived, OR
 *   - It is `visibility = 'custom'`, not archived, AND has a row in
 *     `plan_space_visibility` for this `(planId, spaceId)`, OR
 *   - It IS the space's current plan (regardless of visibility, archive
 *     state, or assignment row). The current plan is always merged in so a
 *     customer whose custom plan was unassigned by an operator — or whose
 *     plan was archived after they subscribed — can still see their own
 *     plan card and Cancel the subscription. Without this, the
 *     `<PlanSelectionSheet />` derives `currentPlan` from this list and
 *     loses the Cancel button when the plan drops out of visibility.
 *
 * Result is sorted by `sort_order` ASC, then `price_usd` ASC so the
 * customer plan-selection UI gets a stable, cheapest-first ordering
 * within each sort bucket.
 */

import { and, eq, inArray } from "drizzle-orm";

import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import type { Plan } from "@/lib/plan/usage";
import { getSpacePlanRow } from "@/lib/plan/usage";

export async function visiblePlansForSpace(spaceId: string): Promise<Plan[]> {
  // 1. Every public, non-archived plan.
  const publicPlans = await db
    .select()
    .from(schema.plans)
    .where(
      and(
        eq(schema.plans.visibility, "public"),
        eq(schema.plans.isArchived, false)
      )
    );

  // 2. Every custom plan explicitly assigned to this space.
  const customAssignments = await db
    .select({ planId: schema.planSpaceVisibility.planId })
    .from(schema.planSpaceVisibility)
    .where(eq(schema.planSpaceVisibility.spaceId, spaceId));
  const customPlanIds = customAssignments.map((r) => r.planId);
  const customPlans =
    customPlanIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.plans)
          .where(
            and(
              eq(schema.plans.visibility, "custom"),
              eq(schema.plans.isArchived, false),
              inArray(schema.plans.id, customPlanIds)
            )
          );

  // 3. The space's CURRENT plan — always included, even if archived or
  //    custom-but-unassigned. The customer needs to see + cancel it.
  const currentPlan = await getSpacePlanRow(spaceId);

  const merged: Plan[] = [...publicPlans, ...customPlans];
  if (!merged.some((p) => p.id === currentPlan.id)) {
    merged.push(currentPlan);
  }

  // Sort (sort_order asc, then price_usd asc).
  return merged.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return Number.parseFloat(a.priceUsd) - Number.parseFloat(b.priceUsd);
  });
}
