/**
 * Plan-usage counting — the DB queries that feed the pure guards in
 * `lib/plan/limits.ts`. Kept separate so the guards stay pure/testable.
 */

import type { InferSelectModel } from "drizzle-orm";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

/** A row from the `plans` table — the Phase 5 plan shape. */
export type Plan = InferSelectModel<typeof schema.plans>;

/** Drizzle transaction handle type — matches what db.transaction() passes to its callback. */
type TxHandle = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Cube statuses that occupy a concurrent-Cube slot. */
const ACTIVE_CUBE_STATUSES = ["pending", "booting", "running"] as const;

/**
 * Acquire a transaction-scoped PostgreSQL advisory lock keyed on the space.
 *
 * The lock is exclusive and automatically released when the surrounding
 * transaction commits or rolls back — no manual unlock needed. Concurrent
 * calls for the same spaceId block until the first transaction finishes,
 * making count + create/wake atomic per space.
 *
 * Key derivation: `hashtextextended(spaceId, 0)` maps the CUID2 string to a
 * stable int8 without manual bit-packing. Must be called inside a transaction.
 */
export async function acquireSpaceLock(
  tx: TxHandle,
  spaceId: string
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${spaceId}, 0))`
  );
}

/**
 * Per-USER transaction-scoped advisory lock. Uses hash seed `1` so its
 * keyspace is disjoint from `acquireSpaceLock` (seed `0`) — a user lock never
 * collides with a space lock. Serializes a user's space creations so the
 * once-per-user Trial-credit grant cannot be raced into multiple grants.
 */
export async function acquireUserLock(
  tx: TxHandle,
  userId: string
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 1))`
  );
}

/** Count Cubes occupying a concurrent slot (pending / booting / running). */
export async function countActiveCubes(spaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.cubes)
    .where(
      and(
        eq(schema.cubes.spaceId, spaceId),
        inArray(schema.cubes.status, [...ACTIVE_CUBE_STATUSES])
      )
    );
  return Number(row?.n ?? 0);
}

/**
 * Transaction-aware variant of countActiveCubes.
 * Use inside a locked transaction so the count is serialized with the write.
 */
export async function countActiveCubesTx(
  tx: TxHandle,
  spaceId: string
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(schema.cubes)
    .where(
      and(
        eq(schema.cubes.spaceId, spaceId),
        inArray(schema.cubes.status, [...ACTIVE_CUBE_STATUSES])
      )
    );
  return Number(row?.n ?? 0);
}

/** Count members of a space — the owner counts as a seat. */
export async function countSpaceMembers(spaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.spaceMemberships)
    .where(eq(schema.spaceMemberships.spaceId, spaceId));
  return Number(row?.n ?? 0);
}

/** Count retained backups for a space (failed backups hold no data — excluded). */
export async function countSpaceBackups(spaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.cubeBackups)
    .where(
      and(
        eq(schema.cubeBackups.spaceId, spaceId),
        ne(schema.cubeBackups.status, "failed")
      )
    );
  return Number(row?.n ?? 0);
}

/** Count custom domains across all the space's Cubes (excludes ones being removed). */
export async function countSpaceDomains(spaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.domainMappings)
    .innerJoin(schema.cubes, eq(schema.domainMappings.cubeId, schema.cubes.id))
    .where(
      and(
        eq(schema.cubes.spaceId, spaceId),
        ne(schema.domainMappings.status, "stopping")
      )
    );
  return Number(row?.n ?? 0);
}

/**
 * Transaction-aware variant of countSpaceDomains.
 * Use inside a locked transaction so the count is serialized with the insert.
 */
export async function countSpaceDomainsTx(
  tx: TxHandle,
  spaceId: string
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(schema.domainMappings)
    .innerJoin(schema.cubes, eq(schema.domainMappings.cubeId, schema.cubes.id))
    .where(
      and(
        eq(schema.cubes.spaceId, spaceId),
        ne(schema.domainMappings.status, "stopping")
      )
    );
  return Number(row?.n ?? 0);
}

/**
 * Phase 5 plan-row cache. Keyed by `plans.id` — plan rows change rarely
 * (operator edits in Orbit), but the same plan is read by every cube
 * create / wake / etc. across many spaces, so a small TTL cache avoids
 * a hot DB read on every limit check. Invalidated explicitly by Orbit
 * write paths via `invalidatePlanCache(planId)`.
 */
const PLAN_CACHE_TTL_MS = 60_000;
const planCache = new Map<string, { plan: Plan; expiresAt: number }>();

/**
 * Drop one plan cache entry (after an Orbit edit) or the entire cache
 * (after a bulk seed / re-seed). Called by Phase 5E plan-management
 * server actions; safe to call when nothing is cached.
 */
export function invalidatePlanCache(planId?: string): void {
  if (planId === undefined) {
    planCache.clear();
    return;
  }
  planCache.delete(planId);
}

function readPlanCache(planId: string): Plan | null {
  const entry = planCache.get(planId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    planCache.delete(planId);
    return null;
  }
  return entry.plan;
}

function writePlanCache(plan: Plan): void {
  planCache.set(plan.id, {
    plan,
    expiresAt: Date.now() + PLAN_CACHE_TTL_MS,
  });
}

/**
 * The plan row for a space — read via the `spaces.plan_id` FK.
 * Throws if the space is missing or the plan row cannot be resolved
 * (means the seed has not run yet, or the FK is broken — fail loud).
 */
export async function getSpacePlanRow(spaceId: string): Promise<Plan> {
  const [space] = await db
    .select({ planId: schema.spaces.planId })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);

  if (!space) {
    throw new Error(`Space not found: ${spaceId}`);
  }

  const cached = readPlanCache(space.planId);
  if (cached) {
    return cached;
  }
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, space.planId))
    .limit(1);
  if (plan) {
    writePlanCache(plan);
    return plan;
  }

  throw new Error(
    `No plan row resolved for space ${spaceId} (plan_id=${space.planId}). Have migrations 0037+ been applied?`
  );
}

/**
 * Transaction-aware variant of `getSpacePlanRow`. Same semantics, but the
 * supplied `tx` handle is used for both reads — required when the caller
 * needs the plan inside an in-flight transaction (e.g. inside
 * `applyCreditTopup`'s already-locked space update). Does NOT consult the
 * module-level plan cache: a plan row read inside a tx should reflect the
 * authoritative row at lock acquisition, not a possibly-stale snapshot.
 */
export async function getSpacePlanRowTx(
  tx: TxHandle,
  spaceId: string
): Promise<Plan> {
  const [space] = await tx
    .select({ planId: schema.spaces.planId })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);

  if (!space) {
    throw new Error(`Space not found: ${spaceId}`);
  }

  const [plan] = await tx
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, space.planId))
    .limit(1);
  if (plan) {
    return plan;
  }

  throw new Error(
    `No plan row resolved for space ${spaceId} (plan_id=${space.planId}). Have migrations 0037+ been applied?`
  );
}

/** The space columns consumed by `effectiveLimits` — the per-space overrides. */
export interface SpaceOverridesRow {
  overrideAllowOverage: boolean | null;
  overrideAllowTopup: boolean | null;
  overrideIncludedCreditUsd: string | null;
  overrideMaxBackups: number | null;
  overrideMaxConcurrentCubes: number | null;
  overrideMaxDiskGb: number | null;
  overrideMaxDomains: number | null;
  overrideMaxRamMb: number | null;
  overrideMaxSeats: number | null;
  overrideMaxVcpus: number | null;
}

/** Read the per-space override columns. Returns the all-null row if the
 *  space does not exist (the surrounding plan-row load is the real check). */
export async function getSpaceOverrides(
  spaceId: string
): Promise<SpaceOverridesRow> {
  const [row] = await db
    .select({
      overrideMaxConcurrentCubes: schema.spaces.overrideMaxConcurrentCubes,
      overrideMaxVcpus: schema.spaces.overrideMaxVcpus,
      overrideMaxRamMb: schema.spaces.overrideMaxRamMb,
      overrideMaxDiskGb: schema.spaces.overrideMaxDiskGb,
      overrideMaxSeats: schema.spaces.overrideMaxSeats,
      overrideMaxBackups: schema.spaces.overrideMaxBackups,
      overrideMaxDomains: schema.spaces.overrideMaxDomains,
      overrideIncludedCreditUsd: schema.spaces.overrideIncludedCreditUsd,
      overrideAllowTopup: schema.spaces.overrideAllowTopup,
      overrideAllowOverage: schema.spaces.overrideAllowOverage,
    })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);
  return row ?? emptyOverrides();
}

/** Transaction-aware variant of `getSpaceOverrides`. */
export async function getSpaceOverridesTx(
  tx: TxHandle,
  spaceId: string
): Promise<SpaceOverridesRow> {
  const [row] = await tx
    .select({
      overrideMaxConcurrentCubes: schema.spaces.overrideMaxConcurrentCubes,
      overrideMaxVcpus: schema.spaces.overrideMaxVcpus,
      overrideMaxRamMb: schema.spaces.overrideMaxRamMb,
      overrideMaxDiskGb: schema.spaces.overrideMaxDiskGb,
      overrideMaxSeats: schema.spaces.overrideMaxSeats,
      overrideMaxBackups: schema.spaces.overrideMaxBackups,
      overrideMaxDomains: schema.spaces.overrideMaxDomains,
      overrideIncludedCreditUsd: schema.spaces.overrideIncludedCreditUsd,
      overrideAllowTopup: schema.spaces.overrideAllowTopup,
      overrideAllowOverage: schema.spaces.overrideAllowOverage,
    })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);
  return row ?? emptyOverrides();
}

function emptyOverrides(): SpaceOverridesRow {
  return {
    overrideMaxConcurrentCubes: null,
    overrideMaxVcpus: null,
    overrideMaxRamMb: null,
    overrideMaxDiskGb: null,
    overrideMaxSeats: null,
    overrideMaxBackups: null,
    overrideMaxDomains: null,
    overrideIncludedCreditUsd: null,
    overrideAllowTopup: null,
    overrideAllowOverage: null,
  };
}

/**
 * The plan applied to brand-new spaces — the row with
 * `is_default_for_new_spaces = true`. Throws if no default is set
 * (means the seed has not run yet — fail loud so a fresh deploy
 * doesn't silently fall back to enum behavior).
 */
export async function getDefaultPlan(): Promise<Plan> {
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.isDefaultForNewSpaces, true))
    .limit(1);
  if (!plan) {
    throw new Error(
      "No default plan configured. Migration 0037 inserts the four public plans + marks Trial as default; check the migration applied cleanly."
    );
  }
  writePlanCache(plan);
  return plan;
}

/**
 * True iff the given space is the OWNER's first owned space — the only one
 * that received the default-plan included-credit at creation
 * (`app/actions/spaces.ts` grants once-per-user). Drives the billing UI label
 * so a non-first space on a free plan doesn't show a `$X one-time` credit
 * that it never actually received.
 *
 * Returns false if the space has no owner (shouldn't happen — every space is
 * created with an owner membership) or if the space isn't the owner's
 * earliest owned membership.
 */
export async function isOwnerFirstSpace(spaceId: string): Promise<boolean> {
  const [owner] = await db
    .select({ userId: schema.spaceMemberships.userId })
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.spaceId, spaceId),
        eq(schema.spaceMemberships.isOwner, true)
      )
    )
    .limit(1);
  if (!owner) {
    return false;
  }
  const [earliest] = await db
    .select({ spaceId: schema.spaceMemberships.spaceId })
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.userId, owner.userId),
        eq(schema.spaceMemberships.isOwner, true)
      )
    )
    .orderBy(asc(schema.spaceMemberships.createdAt))
    .limit(1);
  return earliest?.spaceId === spaceId;
}
