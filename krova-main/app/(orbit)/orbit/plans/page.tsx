/**
 * Orbit Plans list page. Server component — fetches the plan catalog plus
 * subscriber counts (LEFT JOIN spaces ON plan_id) and custom-visibility
 * assignment counts (LEFT JOIN plan_space_visibility) in two grouped
 * queries, then merges into a single typed row per plan for the client list.
 *
 * Admin auth is enforced by the surrounding `(orbit)/layout.tsx` redirect
 * pattern — no further checks needed at the page level. Each server action
 * the list invokes re-checks admin server-side.
 */

import { count } from "drizzle-orm";
import {
  PlanList,
  type PlanListRow,
} from "@/app/(orbit)/orbit/plans/_components/plan-list";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  // 1. Every plan row (full catalog — including archived).
  const planRows = await db.select().from(schema.plans);

  // 2. Subscriber count per plan_id (spaces currently on that plan).
  const subscriberCounts = await db
    .select({ planId: schema.spaces.planId, n: count() })
    .from(schema.spaces)
    .groupBy(schema.spaces.planId);
  const subscriberCountMap = new Map(
    subscriberCounts.map((r) => [r.planId, Number(r.n)])
  );

  // 3. Assignment count per plan_id (only meaningful for custom plans).
  const assignmentCounts = await db
    .select({
      planId: schema.planSpaceVisibility.planId,
      n: count(),
    })
    .from(schema.planSpaceVisibility)
    .groupBy(schema.planSpaceVisibility.planId);
  const assignmentCountMap = new Map(
    assignmentCounts.map((r) => [r.planId, Number(r.n)])
  );

  const plans: PlanListRow[] = planRows.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    priceUsd: p.priceUsd,
    includedCreditUsd: p.includedCreditUsd,
    maxConcurrentCubes: p.maxConcurrentCubes,
    maxVcpus: p.maxVcpus,
    maxRamMb: p.maxRamMb,
    maxDiskGb: p.maxDiskGb,
    maxSeats: p.maxSeats,
    maxBackups: p.maxBackups,
    maxDomains: p.maxDomains,
    allowTopup: p.allowTopup,
    allowOverage: p.allowOverage,
    visibility: p.visibility,
    isDefaultForNewSpaces: p.isDefaultForNewSpaces,
    isArchived: p.isArchived,
    sortOrder: p.sortOrder,
    polarProductId: p.polarProductId,
    subscriberCount: subscriberCountMap.get(p.id) ?? 0,
    assignedSpaceCount: assignmentCountMap.get(p.id) ?? 0,
  }));

  return <PlanList plans={plans} />;
}
