/**
 * Plan over-limit reconcile. After a downgrade / cancel drops a space to a
 * lower tier, Cubes beyond the new tier's maxConcurrentCubes are auto-slept —
 * COUNT limit only (never the size cap). Most-recently-started Cubes
 * (cubes.last_started_at DESC) are slept first; data is preserved; the
 * customer can wake them after re-subscribing. Idempotent.
 *
 * Phase 5C — takes `planId` (FK to `plans`) instead of the legacy `PlanTier`.
 * Loads the plan row + the space's overrides at runtime so a per-space
 * `override_max_concurrent_cubes` (set in Orbit) wins over the plan default.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { effectiveLimits } from "@/lib/plan/limits";
import { getSpaceOverrides } from "@/lib/plan/usage";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/** Cube status that occupies a concurrent slot for reconcile purposes. */
const RUNNING_STATUS = "running" as const;

/**
 * Sleep runtime Cubes that exceed the resolved plan's concurrent-Cube cap.
 * `planId` is the post-downgrade `plans.id` the space now sits on (read off
 * the just-updated `spaces.plan_id`). Returns the ids slept (empty if within
 * limits or the resolved cap is null/unlimited).
 */
export async function reconcileSpaceCubeCount(
  spaceId: string,
  planId: string
): Promise<string[]> {
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .limit(1);
  if (!plan) {
    return []; // plan missing — nothing safe to reconcile against
  }

  const overrides = await getSpaceOverrides(spaceId);
  const limits = effectiveLimits(plan, overrides);
  const cap = limits.maxConcurrentCubes;
  if (cap === null) {
    return []; // unlimited — nothing to reconcile
  }

  const running = await db
    .select({ id: schema.cubes.id, serverId: schema.cubes.serverId })
    .from(schema.cubes)
    .where(
      and(
        eq(schema.cubes.spaceId, spaceId),
        eq(schema.cubes.status, RUNNING_STATUS)
      )
    )
    .orderBy(desc(schema.cubes.lastStartedAt));

  if (running.length <= cap) {
    return [];
  }

  // Keep the first `cap` (most-recently-started); sleep the rest.
  const toSleep = running.slice(cap);
  const ids = toSleep.map((c) => c.id);

  await db
    .update(schema.cubes)
    .set({ updatedAt: new Date() })
    .where(inArray(schema.cubes.id, ids));

  await db.insert(schema.lifecycleLogs).values(
    toSleep.map((c) => ({
      entityType: "cube" as const,
      entityId: c.id,
      message: "Cube slept — over the plan's concurrent-Cube limit",
    }))
  );

  // Audit each forced sleep (Rule 9 — a significant system-driven mutation).
  for (const c of toSleep) {
    audit({
      action: "plan.over_limit_sleep",
      category: "billing",
      actorType: "system",
      entityType: "cube",
      entityId: c.id,
      spaceId,
      description: `Cube auto-slept — over the ${plan.name} plan's concurrent-Cube limit`,
      metadata: {
        spaceId,
        cubeId: c.id,
        planId: plan.id,
        planSlug: plan.slug,
        cap,
      },
      source: "worker",
    });
  }

  await Promise.all(
    toSleep.map((c) =>
      enqueueJob(JOB_NAMES.CUBE_SLEEP, {
        cubeId: c.id,
        spaceId,
        serverId: c.serverId,
      })
    )
  );

  return ids;
}
