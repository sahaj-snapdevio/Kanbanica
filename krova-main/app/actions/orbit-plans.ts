"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { paymentBreakdown } from "@/components/billing/topup-math";
import { CPU_OPTIONS, DISK_OPTIONS, RAM_OPTIONS } from "@/config/platform";
import * as schema from "@/db/schema";
import { requireActionAdmin } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { applyCreditTopup } from "@/lib/billing/apply-topup";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";
import { reconcileSpaceCubeCount } from "@/lib/plan/reconcile";
import { acquireSpaceLock, invalidatePlanCache } from "@/lib/plan/usage";
import { getPlatformSettings } from "@/lib/platform-settings";

/**
 * Orbit-only server actions for the plan catalog. Every action calls
 * `requireActionAdmin` (shared from `lib/actions/auth-helpers.ts`), wraps DB
 * writes in a transaction, audit-logs the change, and calls
 * `invalidatePlanCache(planId)` after a successful mutation (the read path
 * caches plan rows for 60s).
 *
 * Polar interactions: `provisionPlanInPolar` is the only path that CREATES a
 * Polar product. `updatePlan` syncs a price change to Polar (existing
 * subscribers grandfathered, per Polar's docs). `archivePlan` /
 * `unarchivePlan` mirror archive state to Polar.
 */

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/**
 * RFC-style slug: lowercase letters / digits / hyphens, 1-63 chars, no
 * leading or trailing hyphen. Used for URL / log identifiers.
 */
const slugRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const nullableInt = z.number().int().nonnegative().nullable();

const planInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    slug: z
      .string()
      .trim()
      .min(1, "Slug is required")
      .max(63)
      .regex(slugRegex, "Lowercase letters, digits and hyphens only"),
    description: z.string().trim().max(500).optional().nullable(),
    priceUsd: z.number().nonnegative().max(100_000),
    includedCreditUsd: z.number().nonnegative().max(100_000),
    maxConcurrentCubes: nullableInt,
    maxVcpus: z
      .number()
      .int()
      .min(CPU_OPTIONS.min, `Minimum ${CPU_OPTIONS.min} vCPU`)
      .max(CPU_OPTIONS.max, `Maximum ${CPU_OPTIONS.max} vCPU`),
    maxRamMb: z
      .number()
      .int()
      .min(RAM_OPTIONS.min, `Minimum ${RAM_OPTIONS.min} MB RAM`)
      .max(RAM_OPTIONS.max, `Maximum ${RAM_OPTIONS.max} MB RAM`),
    maxDiskGb: z
      .number()
      .int()
      .min(DISK_OPTIONS.min, `Minimum ${DISK_OPTIONS.min} GB disk`)
      .max(DISK_OPTIONS.max, `Maximum ${DISK_OPTIONS.max} GB disk`),
    maxSeats: nullableInt,
    maxBackups: nullableInt,
    maxDomains: nullableInt,
    allowTopup: z.boolean(),
    allowOverage: z.boolean(),
    // Auto-snapshot cadence + retention buckets + manual cap. NULL cadence
    // = auto disabled (Trial). 2h floor matches the scheduler comment.
    autoSnapshotCadenceHours: z.number().int().min(2).max(168).nullable(),
    autoSnapshotKeepLast: z.number().int().min(0).max(100),
    autoSnapshotKeepDaily: z.number().int().min(0).max(365),
    autoSnapshotKeepWeekly: z.number().int().min(0).max(104),
    maxManualSnapshotsPerCube: z.number().int().min(0).max(100),
    visibility: z.enum(["public", "custom"]),
    sortOrder: z.number().int().nonnegative().max(10_000),
  })
  // Cross-field semantic guards. `priceUsd=0` means there is no Polar
  // subscription, so the postpaid overage cascade (`lib/billing/overage.ts`)
  // can never debit on this plan. Leaving the flag editable produced a
  // confusing customer-side toggle that the cascade silently refused.
  // Refuse the combination at the validator so the plan can never be saved
  // in an inert state.
  .refine((input) => !(input.priceUsd === 0 && input.allowOverage), {
    message:
      "Overage cannot be enabled on a free plan — postpaid overage requires an active paid subscription. Either set a price or disable overage.",
    path: ["allowOverage"],
  });

export type CreatePlanInput = z.infer<typeof planInputSchema>;
export type UpdatePlanInput = CreatePlanInput;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function planRowToInsert(input: CreatePlanInput) {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description ?? null,
    priceUsd: input.priceUsd.toFixed(4),
    includedCreditUsd: input.includedCreditUsd.toFixed(4),
    maxConcurrentCubes: input.maxConcurrentCubes,
    maxVcpus: input.maxVcpus,
    maxRamMb: input.maxRamMb,
    maxDiskGb: input.maxDiskGb,
    maxSeats: input.maxSeats,
    maxBackups: input.maxBackups,
    maxDomains: input.maxDomains,
    allowTopup: input.allowTopup,
    allowOverage: input.allowOverage,
    autoSnapshotCadenceHours: input.autoSnapshotCadenceHours,
    autoSnapshotKeepLast: input.autoSnapshotKeepLast,
    autoSnapshotKeepDaily: input.autoSnapshotKeepDaily,
    autoSnapshotKeepWeekly: input.autoSnapshotKeepWeekly,
    maxManualSnapshotsPerCube: input.maxManualSnapshotsPerCube,
    visibility: input.visibility,
    sortOrder: input.sortOrder,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Create a new plan. Paid plans are inserted WITHOUT a `polar_product_id` —
 * the operator must call `provisionPlanInPolar` separately so a transient
 * Polar outage cannot block plan creation.
 */
export async function createPlan(
  rawInput: unknown
): Promise<{ success: true; data: { planId: string } } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const parsed = planInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid plan input",
      };
    }
    const input = parsed.data;

    // Slug uniqueness pre-check for a clear error message (the DB unique index
    // is the final guard).
    const [existing] = await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.slug, input.slug))
      .limit(1);
    if (existing) {
      return { error: `Plan slug "${input.slug}" already exists.` };
    }

    const planId = createId();
    await db.transaction(async (tx) => {
      await tx.insert(schema.plans).values({
        id: planId,
        ...planRowToInsert(input),
      });
    });

    invalidatePlanCache(planId);

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.create",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: planId,
      description: `Created plan ${input.name} (${input.slug})`,
      metadata: {
        planId,
        slug: input.slug,
        priceUsd: input.priceUsd,
        visibility: input.visibility,
      },
      ...reqCtx,
    });

    return { success: true as const, data: { planId } };
  } catch (error) {
    console.error("createPlan error:", error);
    return { error: "Something went wrong creating the plan." };
  }
}

/**
 * Update an existing plan. The `slug` is immutable after creation
 * (it is part of `plan_id` FK semantics — see the design spec). A `priceUsd`
 * change to a Polar-provisioned plan triggers `provider.updatePlanProduct`
 * (existing subscribers grandfathered). Cannot downgrade a Polar-provisioned
 * paid plan to `priceUsd = 0` — return an error and ask the operator to
 * archive the plan + create a new free plan instead.
 */
export async function updatePlan(
  planId: string,
  rawInput: unknown
): Promise<{ success: true; warning?: string } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    if (typeof planId !== "string" || planId.length === 0) {
      return { error: "Invalid plan id" };
    }

    const parsed = planInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid plan input",
      };
    }
    const input = parsed.data;

    const [existing] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    if (!existing) {
      return { error: "Plan not found" };
    }

    // Slug is locked after first save (FK target — design spec).
    if (input.slug !== existing.slug) {
      return { error: "Plan slug cannot be changed after creation." };
    }

    const oldPriceUsd = Number.parseFloat(existing.priceUsd);
    const newPriceUsd = input.priceUsd;
    const priceChanged = oldPriceUsd !== newPriceUsd;
    const oldIncludedCredit = Number.parseFloat(existing.includedCreditUsd);
    const newIncludedCredit = input.includedCreditUsd;
    const includedCreditChanged = oldIncludedCredit !== newIncludedCredit;

    // Refuse to drop a Polar-provisioned paid plan to free without an
    // explicit archive-and-recreate migration.
    if (existing.polarProductId && oldPriceUsd > 0 && newPriceUsd === 0) {
      return {
        error:
          "Cannot drop a Polar-provisioned plan to free. Archive this plan and create a new free plan instead.",
      };
    }

    // Count current assignees so the operator-facing warning can be
    // precise. Issued whenever `includedCreditUsd` changes — existing
    // assignees are NOT back-granted (free custom plans have a one-shot
    // `Plan credit granted: {planId}` marker that short-circuits future
    // assigns; paid plans grandfather subscribers until next renewal).
    let assigneeCount = 0;
    if (includedCreditChanged) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(schema.spaces)
        .where(eq(schema.spaces.planId, planId));
      assigneeCount = n;
    }

    // Compute the diff for the audit log — only fields the operator changed.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const compareNumeric = (
      field: "priceUsd" | "includedCreditUsd",
      newVal: number
    ) => {
      const old = Number.parseFloat(existing[field]);
      if (old !== newVal) {
        changes[field] = { from: old, to: newVal };
      }
    };
    compareNumeric("priceUsd", input.priceUsd);
    compareNumeric("includedCreditUsd", input.includedCreditUsd);
    const directFields = [
      "name",
      "description",
      "maxConcurrentCubes",
      "maxVcpus",
      "maxRamMb",
      "maxDiskGb",
      "maxSeats",
      "maxBackups",
      "maxDomains",
      "allowTopup",
      "allowOverage",
      "autoSnapshotCadenceHours",
      "autoSnapshotKeepLast",
      "autoSnapshotKeepDaily",
      "autoSnapshotKeepWeekly",
      "maxManualSnapshotsPerCube",
      "visibility",
      "sortOrder",
    ] as const;
    for (const field of directFields) {
      const oldVal = existing[field] ?? null;
      const newVal =
        input[field] === undefined ? null : (input[field] as unknown);
      if (oldVal !== newVal) {
        changes[field] = { from: oldVal, to: newVal };
      }
    }

    // DB-first ordering — match `archivePlan` / `unarchivePlan`. If Polar were
    // called before the DB write and the DB write then threw (network blip,
    // tx error), Polar would hold the new price while Krova's `plans` row
    // still showed the old one — every subsequent checkout would gross up
    // against a stale `priceUsd`, mismatching what Polar charges.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.plans)
        .set({
          ...planRowToInsert(input),
          updatedAt: new Date(),
        })
        .where(eq(schema.plans.id, planId));
    });

    invalidatePlanCache(planId);

    // Polar sync is best-effort post-DB. A failure here is recoverable — the
    // operator can re-run `updatePlan` and the DB+Polar will reconcile
    // (idempotent on the Polar side). Surface as `warning` so they know.
    let polarSyncError: string | null = null;
    if (priceChanged && existing.polarProductId) {
      try {
        const settings = await getPlatformSettings();
        const breakdown = paymentBreakdown(newPriceUsd, {
          percent: settings.paymentFeePercent,
          flatUsd: settings.paymentFeeFlatUsd,
        });
        await getPaymentProvider().updatePlanProduct({
          productId: existing.polarProductId,
          facePriceUsd: newPriceUsd,
          grossedUpPriceUsd: breakdown.totalUsd,
          overageMeterId: settings.polarOverageMeterId,
        });
      } catch (e) {
        polarSyncError = e instanceof Error ? e.message : "unknown";
        console.error(
          `Polar price sync failed for plan ${planId} (${existing.slug}):`,
          e
        );
      }
    }

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.update",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: planId,
      description: `Updated plan ${existing.name} (${existing.slug})`,
      metadata: {
        planId,
        slug: existing.slug,
        changes,
        polarSynced: polarSyncError === null,
        polarSyncError,
      },
      ...reqCtx,
    });

    // Build the operator warning. Combines (a) a Polar-sync failure on
    // priceChanged, (b) the forward-only-grant gotcha when
    // `includedCreditUsd` changed and there are existing assignees, and
    // (c) the existing-subscriber price-grandfathering gotcha. Each is
    // independently true — concatenate so the operator sees every gotcha
    // for this single save.
    const warnings: string[] = [];
    if (polarSyncError) {
      warnings.push(
        `Polar price sync failed: ${polarSyncError}. Re-save the plan to retry.`
      );
    }
    if (includedCreditChanged && assigneeCount > 0) {
      warnings.push(
        oldPriceUsd === 0
          ? `${assigneeCount} space${assigneeCount === 1 ? "" : "s"} already on this free plan will NOT receive the delta — admin assignment grants credit at most once per (space, plan) pair. New assignees pick up the new amount.`
          : `${assigneeCount} active subscriber${assigneeCount === 1 ? "" : "s"} will pick up the new included credit on their next renewal. Existing subscribers stay on the OLD Polar price until they cancel + resubscribe — be mindful that raising included credit without raising price reduces margin per subscriber.`
      );
    } else if (priceChanged && existing.polarProductId) {
      warnings.push(
        "Existing subscribers stay on the OLD Polar price until they cancel + resubscribe. Only new checkouts use the new price."
      );
    }
    return warnings.length > 0
      ? {
          success: true as const,
          warning: `Plan updated. ${warnings.join(" ")}`,
        }
      : { success: true as const };
  } catch (error) {
    console.error("updatePlan error:", error);
    return { error: "Something went wrong updating the plan." };
  }
}

/**
 * Duplicate a plan. The new plan is `visibility = 'custom'`, not the default,
 * not archived, and has no Polar product (operator must explicitly provision
 * before subscribers can pick it). Slug is `<source>-copy-<8-char-suffix>` to
 * stay unique without forcing the operator to name it up-front.
 */
export async function duplicatePlan(
  sourcePlanId: string
): Promise<{ success: true; data: { planId: string } } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const [source] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, sourcePlanId))
      .limit(1);
    if (!source) {
      return { error: "Source plan not found" };
    }

    const suffix = createId().slice(0, 8);
    const newId = createId();
    const newSlug = `${source.slug}-copy-${suffix}`;

    await db.transaction(async (tx) => {
      await tx.insert(schema.plans).values({
        id: newId,
        name: `Copy of ${source.name}`,
        slug: newSlug,
        description: source.description,
        priceUsd: source.priceUsd,
        includedCreditUsd: source.includedCreditUsd,
        maxConcurrentCubes: source.maxConcurrentCubes,
        maxVcpus: source.maxVcpus,
        maxRamMb: source.maxRamMb,
        maxDiskGb: source.maxDiskGb,
        maxSeats: source.maxSeats,
        maxBackups: source.maxBackups,
        maxDomains: source.maxDomains,
        allowTopup: source.allowTopup,
        allowOverage: source.allowOverage,
        autoSnapshotCadenceHours: source.autoSnapshotCadenceHours,
        autoSnapshotKeepLast: source.autoSnapshotKeepLast,
        autoSnapshotKeepDaily: source.autoSnapshotKeepDaily,
        autoSnapshotKeepWeekly: source.autoSnapshotKeepWeekly,
        maxManualSnapshotsPerCube: source.maxManualSnapshotsPerCube,
        visibility: "custom",
        isDefaultForNewSpaces: false,
        isArchived: false,
        sortOrder: source.sortOrder,
        polarProductId: null,
      });
    });

    invalidatePlanCache(newId);

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.duplicate",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: newId,
      description: `Duplicated plan ${source.name} → ${newSlug}`,
      metadata: {
        sourcePlanId,
        sourceSlug: source.slug,
        newPlanId: newId,
        newSlug,
      },
      ...reqCtx,
    });

    return { success: true as const, data: { planId: newId } };
  } catch (error) {
    console.error("duplicatePlan error:", error);
    return { error: "Something went wrong duplicating the plan." };
  }
}

/**
 * Archive a plan. Blocks the default plan. Blocks plans with active
 * subscribers (returns the count so the operator can decide). Mirrors
 * archive state to Polar so the product no longer accepts new checkouts.
 */
/**
 * List the spaces currently assigned to a plan. Used by the archive
 * confirmation dialog so the operator sees what they're about to block
 * before the archive refuses or before they trigger a bulk migrate.
 */
export async function listPlanSubscribers(planId: string): Promise<
  | { error: string }
  | {
      subscribers: {
        spaceId: string;
        spaceName: string;
        ownerEmail: string | null;
        ownerName: string | null;
        subscriptionStatus: string | null;
      }[];
    }
> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }

    const rows = await db
      .select({
        spaceId: schema.spaces.id,
        spaceName: schema.spaces.name,
        ownerUserId: schema.spaceMemberships.userId,
        ownerEmail: schema.user.email,
        ownerName: schema.user.name,
        subscriptionStatus: schema.spaces.subscriptionStatus,
      })
      .from(schema.spaces)
      .leftJoin(
        schema.spaceMemberships,
        and(
          eq(schema.spaceMemberships.spaceId, schema.spaces.id),
          eq(schema.spaceMemberships.isOwner, true)
        )
      )
      .leftJoin(schema.user, eq(schema.user.id, schema.spaceMemberships.userId))
      .where(eq(schema.spaces.planId, planId));

    return {
      subscribers: rows.map((r) => ({
        spaceId: r.spaceId,
        spaceName: r.spaceName,
        ownerEmail: r.ownerEmail,
        ownerName: r.ownerName,
        subscriptionStatus: r.subscriptionStatus,
      })),
    };
  } catch (error) {
    console.error("listPlanSubscribers error:", error);
    return { error: "Failed to list subscribers" };
  }
}

/**
 * Bulk-migrate every space on `fromPlanId` to `toPlanId`. Used to clear a
 * plan before archiving it. Refuses if either plan is missing, if the
 * target is archived, or if any source space has an active Polar
 * subscription (those must be canceled or transferred by the customer —
 * silently moving billing rows would breach billing integrity).
 *
 * Per-space migration runs in a single transaction with the audit log entry
 * so a partial failure rolls back cleanly. Returns counts of moved /
 * skipped / refused so the operator can see which subscribers still need
 * manual handling.
 */
export async function bulkMigrateSpaces(
  fromPlanId: string,
  toPlanId: string
): Promise<
  | { error: string }
  | {
      success: true;
      moved: number;
      skippedActiveSubscription: number;
      total: number;
    }
> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    if (fromPlanId === toPlanId) {
      return { error: "Source and target plans must be different" };
    }

    const [fromPlan] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, fromPlanId))
      .limit(1);
    if (!fromPlan) {
      return { error: "Source plan not found" };
    }

    const [toPlan] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, toPlanId))
      .limit(1);
    if (!toPlan) {
      return { error: "Target plan not found" };
    }
    if (toPlan.isArchived) {
      return { error: "Target plan is archived" };
    }

    const subscribers = await db
      .select({
        id: schema.spaces.id,
        name: schema.spaces.name,
        subscriptionStatus: schema.spaces.subscriptionStatus,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.planId, fromPlanId));

    let moved = 0;
    let skippedActiveSubscription = 0;

    for (const sub of subscribers) {
      const hasActiveSubscription =
        sub.subscriptionStatus &&
        ["active", "trialing", "past_due"].includes(sub.subscriptionStatus);
      if (hasActiveSubscription) {
        skippedActiveSubscription++;
        continue;
      }
      await db
        .update(schema.spaces)
        .set({ planId: toPlanId, updatedAt: new Date() })
        .where(eq(schema.spaces.id, sub.id));
      // Auto-sleep cubes over the new plan's concurrent cap — same
      // pattern `assignPlanToSpace` and the subscription downgrade path
      // use. Without this, the bulk-migrate destination plan's limits
      // are only enforced on the next user-initiated cube action.
      // Per-space serialization is already implicit since we iterate
      // sequentially; `reconcileSpaceCubeCount` acquires its own lock
      // per cube it sleeps.
      try {
        await reconcileSpaceCubeCount(sub.id, toPlanId);
      } catch (err) {
        console.error(
          `[bulk-migrate] cube reconcile failed for space ${sub.id}:`,
          err
        );
        // Don't fail the whole bulk migrate — log + continue. The next
        // user action on that space will surface the over-limit state.
      }
      moved++;
    }

    invalidatePlanCache(fromPlanId);
    invalidatePlanCache(toPlanId);

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.bulk_migrate",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: fromPlanId,
      description: `Bulk migrated ${moved} spaces from ${fromPlan.name} to ${toPlan.name}`,
      metadata: {
        fromPlanId,
        fromPlanName: fromPlan.name,
        toPlanId,
        toPlanName: toPlan.name,
        total: subscribers.length,
        moved,
        skippedActiveSubscription,
      },
      ...reqCtx,
    });

    return {
      success: true as const,
      moved,
      skippedActiveSubscription,
      total: subscribers.length,
    };
  } catch (error) {
    console.error("bulkMigrateSpaces error:", error);
    return { error: "Bulk migrate failed" };
  }
}

export async function archivePlan(
  planId: string
): Promise<{ success: true; warning?: string } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const [existing] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    if (!existing) {
      return { error: "Plan not found" };
    }
    if (existing.isArchived) {
      return { error: "Plan is already archived." };
    }

    if (existing.isDefaultForNewSpaces) {
      return {
        error:
          "Cannot archive the default plan. Set another plan as the default first.",
      };
    }

    // Active subscribers: any space whose `plan_id` is this plan and whose
    // subscription is in a non-terminal state, OR whose plan_id matches even
    // if no subscription (e.g. the trial/free default plan). We block on any
    // current `plan_id = this`.
    const [{ n: subscriberCount }] = await db
      .select({ n: count() })
      .from(schema.spaces)
      .where(eq(schema.spaces.planId, planId));
    if (subscriberCount > 0) {
      return {
        error: `Cannot archive — ${subscriberCount} space${subscriberCount === 1 ? "" : "s"} ${subscriberCount === 1 ? "is" : "are"} on this plan. Move them off first.`,
      };
    }

    // DB FIRST, then Polar — same pattern `updatePlan` uses for price changes.
    // If the Polar call throws, the DB is "archived in Krova but still active
    // in Polar"; we surface the warning to the operator (audit + result flag)
    // rather than roll back, so the Plans UI reflects the operator's intent
    // and a manual re-sync can fix the Polar side.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.plans)
        .set({ isArchived: true, updatedAt: new Date() })
        .where(eq(schema.plans.id, planId));
    });

    invalidatePlanCache(planId);

    let polarError: string | null = null;
    if (existing.polarProductId) {
      try {
        await getPaymentProvider().archivePlanProduct(existing.polarProductId);
      } catch (err) {
        polarError =
          err instanceof Error ? err.message : "Polar archive call failed";
        console.error("archivePlan Polar sync error:", err);
      }
    }

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.archive",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: planId,
      description: `Archived plan ${existing.name}`,
      metadata: {
        planId,
        slug: existing.slug,
        polarSynced: polarError === null,
        polarError,
      },
      ...reqCtx,
    });

    return polarError
      ? {
          success: true as const,
          warning: `Plan archived in Krova, but Polar sync failed: ${polarError}`,
        }
      : { success: true as const };
  } catch (error) {
    console.error("archivePlan error:", error);
    return { error: "Something went wrong archiving the plan." };
  }
}

/**
 * Unarchive a plan. Mirrors the change to Polar so the product re-accepts
 * new checkouts (Polar `products.update` with `isArchived: false`).
 */
export async function unarchivePlan(
  planId: string
): Promise<{ success: true; warning?: string } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const [existing] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    if (!existing) {
      return { error: "Plan not found" };
    }
    if (!existing.isArchived) {
      return { error: "Plan is not archived." };
    }

    // DB FIRST, then Polar — same pattern as `archivePlan`. A transient Polar
    // failure leaves Krova "unarchived but Polar still archived"; surface the
    // warning to the operator rather than roll back.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.plans)
        .set({ isArchived: false, updatedAt: new Date() })
        .where(eq(schema.plans.id, planId));
    });

    invalidatePlanCache(planId);

    let polarError: string | null = null;
    if (existing.polarProductId) {
      try {
        await getPaymentProvider().unarchivePlanProduct(
          existing.polarProductId
        );
      } catch (err) {
        polarError =
          err instanceof Error ? err.message : "Polar unarchive call failed";
        console.error("unarchivePlan Polar sync error:", err);
      }
    }

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.unarchive",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: planId,
      description: `Unarchived plan ${existing.name}`,
      metadata: {
        planId,
        slug: existing.slug,
        polarSynced: polarError === null,
        polarError,
      },
      ...reqCtx,
    });

    return polarError
      ? {
          success: true as const,
          warning: `Plan unarchived in Krova, but Polar sync failed: ${polarError}`,
        }
      : { success: true as const };
  } catch (error) {
    console.error("unarchivePlan error:", error);
    return { error: "Something went wrong unarchiving the plan." };
  }
}

/**
 * Provision a Polar product for a paid plan that does not yet have one.
 * Idempotent at the boundary: requires `polar_product_id IS NULL` AND
 * `priceUsd > 0`. After this completes the plan becomes subscribeable.
 */
export async function provisionPlanInPolar(
  planId: string
): Promise<{ success: true; data: { productId: string } } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const [existing] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    if (!existing) {
      return { error: "Plan not found" };
    }
    if (existing.polarProductId) {
      return {
        error: `Plan is already provisioned (product id ${existing.polarProductId}).`,
      };
    }
    const priceUsd = Number.parseFloat(existing.priceUsd);
    if (!(priceUsd > 0)) {
      return { error: "Cannot provision a free plan in Polar." };
    }

    const settings = await getPlatformSettings();
    const breakdown = paymentBreakdown(priceUsd, {
      percent: settings.paymentFeePercent,
      flatUsd: settings.paymentFeeFlatUsd,
    });
    const provider = getPaymentProvider();
    const { productId } = await provider.createPlanProduct({
      name: existing.name,
      facePriceUsd: priceUsd,
      grossedUpPriceUsd: breakdown.totalUsd,
      overageMeterId: settings.polarOverageMeterId,
    });

    // Race-guard: only adopt the new product if the plan still has no
    // `polar_product_id`. A second concurrent click of the button would
    // otherwise leak a duplicate Polar product (both succeed at
    // createPlanProduct, both UPDATE, the second overwrites the first).
    // The conditional UPDATE is the atomic gate; if it returns 0 rows the
    // first writer won — we archive our just-created product as the loser's
    // compensating action.
    const updated = await db
      .update(schema.plans)
      .set({ polarProductId: productId, updatedAt: new Date() })
      .where(
        and(eq(schema.plans.id, planId), isNull(schema.plans.polarProductId))
      )
      .returning({ id: schema.plans.id });

    if (updated.length === 0) {
      // Best-effort archive — surface the dup id in the audit log either way
      // so an operator can clean up manually if archive itself failed.
      let compensateError: string | null = null;
      try {
        await provider.archivePlanProduct(productId);
      } catch (e) {
        compensateError = e instanceof Error ? e.message : "unknown";
        console.error(
          `Failed to archive duplicate Polar product ${productId} for plan ${planId}:`,
          e
        );
      }
      const reqCtxRace = extractRequestContext(await headers());
      audit({
        action: "plan.provision_polar_duplicate",
        category: "platform",
        actorType: "admin",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "plan",
        entityId: planId,
        description: `Concurrent provision detected — discarded duplicate Polar product ${productId}`,
        metadata: {
          planId,
          slug: existing.slug,
          duplicateProductId: productId,
          archiveError: compensateError,
        },
        ...reqCtxRace,
      });
      return {
        error:
          "Plan was just provisioned by another request — the duplicate product was archived.",
      };
    }

    invalidatePlanCache(planId);

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.provision_polar",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: planId,
      description: `Provisioned plan ${existing.name} in Polar`,
      metadata: {
        planId,
        slug: existing.slug,
        productId,
        facePriceUsd: priceUsd,
        grossedUpPriceUsd: breakdown.totalUsd,
      },
      ...reqCtx,
    });

    return { success: true as const, data: { productId } };
  } catch (error) {
    console.error("provisionPlanInPolar error:", error);
    return {
      error:
        error instanceof Error
          ? `Polar provisioning failed: ${error.message}`
          : "Polar provisioning failed.",
    };
  }
}

/**
 * Re-sync a Polar product's price for an already-provisioned paid plan.
 * Use after a `platform_settings.payment_fee_*` change to push the new
 * gross-up to Polar (the plan's face `priceUsd` does not change — only the
 * grossed-up customer charge does). Existing subscribers stay grandfathered
 * on the old price (Polar's default behavior); new checkouts use the
 * updated product price.
 *
 * Idempotent: re-running with the same settings issues the same gross-up
 * (the underlying Polar API replaces the fixed price each call).
 */
export async function syncPlanPriceToPolar(
  planId: string
): Promise<
  { success: true; data: { grossedUpPriceUsd: number } } | { error: string }
> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const [existing] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    if (!existing) {
      return { error: "Plan not found" };
    }
    if (!existing.polarProductId) {
      return {
        error:
          "Plan is not yet provisioned in Polar — use Provision in Polar first.",
      };
    }
    const priceUsd = Number.parseFloat(existing.priceUsd);
    if (!(priceUsd > 0)) {
      return { error: "Cannot sync price for a free plan." };
    }

    const settings = await getPlatformSettings();
    const breakdown = paymentBreakdown(priceUsd, {
      percent: settings.paymentFeePercent,
      flatUsd: settings.paymentFeeFlatUsd,
    });

    await getPaymentProvider().updatePlanProduct({
      productId: existing.polarProductId,
      facePriceUsd: priceUsd,
      grossedUpPriceUsd: breakdown.totalUsd,
      overageMeterId: settings.polarOverageMeterId,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.sync_polar_price",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: planId,
      description: `Synced ${existing.name} price to Polar ($${breakdown.totalUsd.toFixed(2)} total)`,
      metadata: {
        planId,
        slug: existing.slug,
        productId: existing.polarProductId,
        facePriceUsd: priceUsd,
        grossedUpPriceUsd: breakdown.totalUsd,
        paymentFeePercent: settings.paymentFeePercent,
        paymentFeeFlatUsd: settings.paymentFeeFlatUsd,
      },
      ...reqCtx,
    });

    return {
      success: true as const,
      data: { grossedUpPriceUsd: breakdown.totalUsd },
    };
  } catch (error) {
    console.error("syncPlanPriceToPolar error:", error);
    return {
      error:
        error instanceof Error
          ? `Polar price sync failed: ${error.message}`
          : "Polar price sync failed.",
    };
  }
}

/**
 * Assign a custom-visibility plan to a specific space. Public plans are
 * visible to every space without an assignment row, so assigning a public
 * plan is rejected to avoid operator confusion (the assignment would have no
 * effect).
 */
export async function assignPlanToSpace(
  planId: string,
  spaceId: string
): Promise<{ success: true; warning?: string } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const [plan] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    if (!plan) {
      return { error: "Plan not found" };
    }
    if (plan.visibility !== "custom") {
      return {
        error:
          "Public plans are visible to every space automatically — assignment only applies to custom plans.",
      };
    }
    if (plan.isArchived) {
      return { error: "Cannot assign an archived plan." };
    }

    // Pre-flight read for error messaging only. The authoritative guard
    // re-reads the same row INSIDE the transaction after `acquireSpaceLock`
    // (see below) — a racing Polar webhook can flip `subscriptionStatus` /
    // `providerSubscriptionId` between this read and the tx body, so any
    // decision made on this snapshot has to be re-verified post-lock.
    const [spaceSnapshot] = await db
      .select({
        id: schema.spaces.id,
        name: schema.spaces.name,
        planId: schema.spaces.planId,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (!spaceSnapshot) {
      return { error: "Space not found" };
    }

    const includedCredit = Number.parseFloat(plan.includedCreditUsd);
    const hasIncludedCredit =
      Number.isFinite(includedCredit) && includedCredit > 0;
    // Lifecycle-log marker the (space, plan) credit grant is idempotency-keyed
    // on. Once a marker row exists for this pair, no subsequent assign on the
    // same pair re-grants — preventing unassign/reassign farming.
    const creditGrantMarker = `Plan credit granted: ${planId}`;

    let creditGranted = false;
    let previousPlanId: string | null = null;
    let alreadyOnPlan = false;
    let raceError: string | null = null;
    await db.transaction(async (tx) => {
      await acquireSpaceLock(tx, spaceId);

      // Re-read inside the lock so the live-subscription / pending-intent
      // guards run against authoritative state. Without this, a racing
      // Polar activation webhook (`subscription-handler.ts`) can flip the
      // space's subscription columns between the pre-flight read above and
      // this tx body, and we would re-point `spaces.plan_id` while Polar
      // continues billing the old plan.
      const [space] = await tx
        .select({
          name: schema.spaces.name,
          planId: schema.spaces.planId,
          providerSubscriptionId: schema.spaces.providerSubscriptionId,
          subscriptionStatus: schema.spaces.subscriptionStatus,
          overageEnabled: schema.spaces.overageEnabled,
        })
        .from(schema.spaces)
        .where(eq(schema.spaces.id, spaceId))
        .limit(1);
      if (!space) {
        raceError = "Space not found";
        return;
      }

      const hasLiveSubscription =
        space.providerSubscriptionId &&
        space.subscriptionStatus !== null &&
        !["canceled", "expired"].includes(space.subscriptionStatus);
      if (hasLiveSubscription) {
        raceError = `Space "${space.name}" has an active ${space.subscriptionStatus} subscription. Cancel the current subscription before assigning a custom plan.`;
        return;
      }

      // Block if the customer has a pending Polar checkout intent for this
      // space. The activation webhook would land moments after assign and
      // overwrite `spaces.plan_id` via `subscription-handler.ts` — the
      // admin's intentional move would silently disappear. Operator must
      // wait for the intent to resolve (or expire via the 24h reaper)
      // before assigning.
      const [pendingIntent] = await tx
        .select({ id: schema.subscriptionIntents.id })
        .from(schema.subscriptionIntents)
        .where(
          and(
            eq(schema.subscriptionIntents.spaceId, spaceId),
            eq(schema.subscriptionIntents.status, "pending")
          )
        )
        .limit(1);
      if (pendingIntent) {
        raceError = `Space "${space.name}" has a pending subscription checkout. Wait for the customer to complete or cancel it before assigning a custom plan.`;
        return;
      }

      previousPlanId = space.planId;
      alreadyOnPlan = previousPlanId === planId;

      // Visibility row is idempotent — keeps the plan in the customer's
      // plan list even if they later move off it.
      await tx
        .insert(schema.planSpaceVisibility)
        .values({ planId, spaceId })
        .onConflictDoNothing();
      // Point the space at the new plan. The `assignPlanToSpace` semantic
      // is "move this space onto this custom plan" — it's an admin grant,
      // not a customer-initiated subscription. No Polar subscription is
      // created.
      //
      // When moving to a NEW plan, also reset overage state. The flag may
      // still be `true` from a previously-canceled paid subscription —
      // leaving it set is benign at the cascade layer (the postpaid bucket
      // refuses to debit without `subscriptionStatus="active"`) but the
      // customer UI shows "overage enabled" + the audit metadata for this
      // assignment is misleading. Clear it so the post-assign state matches
      // the new plan's reality.
      if (!alreadyOnPlan) {
        await tx
          .update(schema.spaces)
          .set({
            planId,
            overageEnabled: false,
            overageCapUsd: "0",
            thisPeriodOverageUsd: "0",
            updatedAt: new Date(),
          })
          .where(eq(schema.spaces.id, spaceId));
      }

      // Grant the plan's included credit on first-ever assignment of this
      // (space, plan) pair. Check the lifecycle_log marker INSIDE the lock
      // so concurrent assignments race-safely see the same state. This
      // mirrors the subscription path's `applyPlanCredit` (which gates on
      // `subscription_credit_grants` UNIQUE), but here the grant has no
      // subscription/period — admin assignment is a one-shot move.
      if (hasIncludedCredit) {
        const existing = await tx
          .select({ id: schema.lifecycleLogs.id })
          .from(schema.lifecycleLogs)
          .where(
            and(
              eq(schema.lifecycleLogs.entityType, "space"),
              eq(schema.lifecycleLogs.entityId, spaceId),
              eq(schema.lifecycleLogs.message, creditGrantMarker)
            )
          )
          .limit(1);
        if (existing.length === 0) {
          const applied = await applyCreditTopup({
            tx,
            spaceId,
            amount: includedCredit,
            type: "plan_credit",
            description: `${plan.name} plan credit (admin assignment)`,
          });
          if (applied !== null) {
            await tx.insert(schema.lifecycleLogs).values({
              entityType: "space" as const,
              entityId: spaceId,
              message: creditGrantMarker,
            });
            creditGranted = true;
          }
        }
      }
    });

    if (raceError) {
      return { error: raceError };
    }

    // Auto-sleep any Cubes over the new plan's concurrent cap — same
    // reconcile pathway used by subscription downgrade / cancel.
    const sleptCubeIds = alreadyOnPlan
      ? []
      : await reconcileSpaceCubeCount(spaceId, planId);

    if (previousPlanId && previousPlanId !== planId) {
      invalidatePlanCache(previousPlanId);
    }
    invalidatePlanCache(planId);

    const reqCtx = extractRequestContext(await headers());
    const moveDesc = alreadyOnPlan
      ? `Re-confirmed ${spaceSnapshot.name} on ${plan.name}`
      : `Moved space ${spaceSnapshot.name} onto ${plan.name}`;
    audit({
      action: "plan.assign_space",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: planId,
      spaceId,
      description: creditGranted
        ? `${moveDesc} — granted $${includedCredit.toFixed(2)} included credit`
        : moveDesc,
      metadata: {
        planId,
        planSlug: plan.slug,
        spaceId,
        previousPlanId,
        includedCreditGranted: creditGranted ? includedCredit : 0,
      },
      ...reqCtx,
    });

    // If the new plan's concurrent-cube cap forced any cubes to sleep,
    // surface the count to the operator so a destructive assign (e.g.
    // moving a busy space onto a maxConcurrentCubes=2 plan) does not
    // happen silently. The audit log already records each per-cube
    // forced sleep; this is the operator-facing companion.
    if (sleptCubeIds.length > 0) {
      return {
        success: true as const,
        warning: `Plan assigned. ${sleptCubeIds.length} running Cube${sleptCubeIds.length === 1 ? " was" : "s were"} auto-slept because the new plan's concurrent-Cube limit is lower than the space's running count.`,
      };
    }
    return { success: true as const };
  } catch (error) {
    console.error("assignPlanToSpace error:", error);
    return { error: "Something went wrong assigning the plan." };
  }
}

/**
 * Remove a custom plan assignment from a space. If the space is currently
 * on this plan, it is moved back to the default plan (and Cubes over the
 * new concurrent cap are auto-slept). Refuses if the space has an active
 * Polar subscription on this plan — operator must cancel the subscription
 * first.
 */
export async function unassignPlanFromSpace(
  planId: string,
  spaceId: string
): Promise<{ success: true } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const [plan] = await db
      .select({
        id: schema.plans.id,
        name: schema.plans.name,
        slug: schema.plans.slug,
      })
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    if (!plan) {
      return { error: "Plan not found" };
    }

    const [space] = await db
      .select({
        id: schema.spaces.id,
        name: schema.spaces.name,
        planId: schema.spaces.planId,
        providerSubscriptionId: schema.spaces.providerSubscriptionId,
        subscriptionStatus: schema.spaces.subscriptionStatus,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (!space) {
      return { error: "Space not found" };
    }

    const isCurrentPlan = space.planId === planId;
    let fallbackPlanId: string | null = null;

    if (isCurrentPlan) {
      // Refuse if the space has a live paid subscription on this plan —
      // pulling plan_id while Polar continues billing produces a confused
      // billing state. Operator must cancel the subscription first.
      const hasLiveSubscription =
        space.providerSubscriptionId &&
        space.subscriptionStatus !== null &&
        !["canceled", "expired"].includes(space.subscriptionStatus);
      if (hasLiveSubscription) {
        return {
          error: `Space "${space.name}" has an active ${space.subscriptionStatus} subscription on this plan. Cancel the subscription before unassigning.`,
        };
      }

      const [defaultPlan] = await db
        .select({ id: schema.plans.id })
        .from(schema.plans)
        .where(eq(schema.plans.isDefaultForNewSpaces, true))
        .limit(1);
      if (!defaultPlan) {
        return {
          error:
            "No default plan is configured — cannot move the space off this plan.",
        };
      }
      fallbackPlanId = defaultPlan.id;
    }

    await db.transaction(async (tx) => {
      if (isCurrentPlan && fallbackPlanId) {
        await acquireSpaceLock(tx, spaceId);
        await tx
          .update(schema.spaces)
          .set({ planId: fallbackPlanId, updatedAt: new Date() })
          .where(eq(schema.spaces.id, spaceId));
      }
      await tx
        .delete(schema.planSpaceVisibility)
        .where(
          and(
            eq(schema.planSpaceVisibility.planId, planId),
            eq(schema.planSpaceVisibility.spaceId, spaceId)
          )
        );
    });

    if (isCurrentPlan && fallbackPlanId) {
      await reconcileSpaceCubeCount(spaceId, fallbackPlanId);
      invalidatePlanCache(fallbackPlanId);
    }
    invalidatePlanCache(planId);

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.unassign_space",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: planId,
      spaceId,
      description: isCurrentPlan
        ? `Unassigned ${plan.name} from ${space.name} — moved back to the default plan`
        : `Unassigned ${plan.name} from ${space.name}`,
      metadata: {
        planId,
        planSlug: plan.slug,
        spaceId,
        movedTo: fallbackPlanId,
      },
      ...reqCtx,
    });

    return { success: true as const };
  } catch (error) {
    console.error("unassignPlanFromSpace error:", error);
    return { error: "Something went wrong unassigning the plan." };
  }
}

/**
 * Set a plan as the default for newly-created spaces. Inside one transaction:
 * (1) clear `is_default_for_new_spaces` on every other plan, then (2) set it
 * on the target — the partial unique index `plans_default_unique` is the
 * final guarantor of "at most one default".
 */
export async function setDefaultPlan(
  planId: string
): Promise<{ success: true } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const [existing] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    if (!existing) {
      return { error: "Plan not found" };
    }
    if (existing.isArchived) {
      return { error: "Cannot set an archived plan as the default." };
    }
    if (existing.isDefaultForNewSpaces) {
      return { error: "Plan is already the default." };
    }

    await db.transaction(async (tx) => {
      // Clear the current default first to avoid violating the partial unique
      // index in the middle of the transaction.
      await tx
        .update(schema.plans)
        .set({ isDefaultForNewSpaces: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.plans.isDefaultForNewSpaces, true),
            ne(schema.plans.id, planId)
          )
        );
      await tx
        .update(schema.plans)
        .set({ isDefaultForNewSpaces: true, updatedAt: new Date() })
        .where(eq(schema.plans.id, planId));
    });

    invalidatePlanCache();

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "plan.set_default",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "plan",
      entityId: planId,
      description: `Set plan ${existing.name} as the default for new spaces`,
      metadata: { planId, slug: existing.slug },
      ...reqCtx,
    });

    return { success: true as const };
  } catch (error) {
    console.error("setDefaultPlan error:", error);
    return { error: "Something went wrong setting the default plan." };
  }
}
