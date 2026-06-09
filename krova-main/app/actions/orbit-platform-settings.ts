"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";

import { DISK_QOS_CAP_BOUNDS } from "@/config/platform";
import * as schema from "@/db/schema";
import { requireActionAdmin } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { invalidatePlatformSettingsCache } from "@/lib/platform-settings";

/**
 * Orbit-only server action for the `platform_settings` singleton row.
 * `requireActionAdmin` is shared from `lib/actions/auth-helpers.ts` — defense
 * in depth re-checks role + ban status against the DB. The cache is
 * invalidated after a successful write so the next read returns the new
 * values.
 */

// ---------------------------------------------------------------------------
// Validation schema — sane platform-wide bounds. Cross-field invariants
// (default-between-min-and-max, min < max) are checked in `superRefine`.
// ---------------------------------------------------------------------------

const inputSchema = z
  .object({
    paymentFeePercent: z
      .number()
      .min(0, "Must be 0 or greater")
      .max(0.1, "Must be 10% or less"),
    paymentFeeFlatUsd: z
      .number()
      .min(0, "Must be 0 or greater")
      .max(5, "Must be $5 or less"),
    creditTopupMinUsd: z
      .number()
      .min(1, "Must be at least $1")
      .max(100, "Must be at most $100"),
    creditTopupMaxUsd: z
      .number()
      .min(100, "Must be at least $100")
      .max(10_000, "Must be at most $10,000"),
    creditTopupDefaultUsd: z
      .number()
      .min(1, "Must be at least $1")
      .max(10_000, "Must be at most $10,000"),
    overageCapMinUsd: z
      .number()
      .min(1, "Must be at least $1")
      .max(100, "Must be at most $100"),
    overageCapMaxUsd: z
      .number()
      .min(100, "Must be at least $100")
      .max(10_000, "Must be at most $10,000"),
    overageDefaultCapMultiplier: z
      .number()
      .min(1, "Must be 1 or greater")
      .max(10, "Must be 10 or less"),
    planCreditGrantCooldownDays: z
      .number()
      .int("Must be a whole number")
      .min(0, "Must be 0 or greater")
      .max(365, "Must be at most 365"),
    lowBalanceThresholdDefaultUsd: z
      .number()
      .min(1, "Must be at least $1")
      .max(100, "Must be at most $100"),
    lowBalanceThresholdMinUsd: z
      .number()
      .min(1, "Must be at least $1")
      .max(100, "Must be at most $100"),
    polarCreditProductId: z
      .string()
      .trim()
      .max(128, "Too long")
      .nullable()
      .transform((s) => (s === null || s === "" ? null : s)),
    polarOverageMeterId: z
      .string()
      .trim()
      .max(128, "Too long")
      .nullable()
      .transform((s) => (s === null || s === "" ? null : s)),
    // Backup storage billing rate. 0 effectively disables backup billing.
    // Capped at $10/GB/mo as a sanity ceiling — well above any reasonable
    // platform pricing, but stops a typo like "100" from charging customers
    // 1000× the intended rate.
    backupStorageRatePerGbPerMonth: z
      .number()
      .min(0, "Must be 0 or greater")
      .max(10, "Must be at most $10/GB/month"),
  })
  .superRefine((val, ctx) => {
    if (val.creditTopupDefaultUsd < val.creditTopupMinUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditTopupDefaultUsd"],
        message: "Default must be at least the minimum top-up",
      });
    }
    if (val.creditTopupDefaultUsd > val.creditTopupMaxUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditTopupDefaultUsd"],
        message: "Default must be at most the maximum top-up",
      });
    }
    if (val.creditTopupMaxUsd <= val.creditTopupMinUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditTopupMaxUsd"],
        message: "Maximum must be greater than the minimum",
      });
    }
    if (val.overageCapMaxUsd <= val.overageCapMinUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overageCapMaxUsd"],
        message: "Maximum must be greater than the minimum",
      });
    }
  });

export type UpdatePlatformSettingsInput = z.infer<typeof inputSchema>;

// Numeric (currency / percent) columns are stored as `numeric(precision, scale)`.
// We keep the precision the same as the schema defaults — 4 for money / cap
// multiplier, 5 for the percent (which needs to express 0.04000 cleanly).
function toMoney(n: number): string {
  return n.toFixed(4);
}
function toPercent(n: number): string {
  return n.toFixed(5);
}
function toMultiplier(n: number): string {
  return n.toFixed(4);
}

/**
 * Update the `platform_settings` singleton. Validates ranges, writes the row,
 * invalidates the in-process cache, and audits each changed field (so the log
 * shows the exact before/after the operator committed).
 */
export async function updatePlatformSettings(
  rawInput: unknown
): Promise<{ success: true } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const parsed = inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid platform settings",
      };
    }
    const input = parsed.data;

    const [existing] = await db
      .select()
      .from(schema.platformSettings)
      .where(eq(schema.platformSettings.id, 1))
      .limit(1);
    if (!existing) {
      return {
        error:
          "platform_settings row is missing. Migration 0037 must run before the settings can be saved.",
      };
    }

    // Diff for audit log — only fields the operator actually changed.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const compareNumeric = (
      key: keyof UpdatePlatformSettingsInput,
      existingRaw: string
    ) => {
      const oldVal = Number.parseFloat(existingRaw);
      const newVal = input[key] as number;
      if (oldVal !== newVal) {
        changes[key] = { from: oldVal, to: newVal };
      }
    };
    compareNumeric("paymentFeePercent", existing.paymentFeePercent);
    compareNumeric("paymentFeeFlatUsd", existing.paymentFeeFlatUsd);
    compareNumeric("creditTopupMinUsd", existing.creditTopupMinUsd);
    compareNumeric("creditTopupMaxUsd", existing.creditTopupMaxUsd);
    compareNumeric("creditTopupDefaultUsd", existing.creditTopupDefaultUsd);
    compareNumeric("overageCapMinUsd", existing.overageCapMinUsd);
    compareNumeric("overageCapMaxUsd", existing.overageCapMaxUsd);
    compareNumeric(
      "overageDefaultCapMultiplier",
      existing.overageDefaultCapMultiplier
    );
    compareNumeric(
      "lowBalanceThresholdDefaultUsd",
      existing.lowBalanceThresholdDefaultUsd
    );
    compareNumeric(
      "lowBalanceThresholdMinUsd",
      existing.lowBalanceThresholdMinUsd
    );
    compareNumeric(
      "backupStorageRatePerGbPerMonth",
      existing.backupStorageRatePerGbPerMonth
    );
    if (
      existing.planCreditGrantCooldownDays !== input.planCreditGrantCooldownDays
    ) {
      changes.planCreditGrantCooldownDays = {
        from: existing.planCreditGrantCooldownDays,
        to: input.planCreditGrantCooldownDays,
      };
    }
    if (existing.polarCreditProductId !== input.polarCreditProductId) {
      changes.polarCreditProductId = {
        from: existing.polarCreditProductId,
        to: input.polarCreditProductId,
      };
    }
    if (existing.polarOverageMeterId !== input.polarOverageMeterId) {
      changes.polarOverageMeterId = {
        from: existing.polarOverageMeterId,
        to: input.polarOverageMeterId,
      };
    }

    await db
      .update(schema.platformSettings)
      .set({
        paymentFeePercent: toPercent(input.paymentFeePercent),
        paymentFeeFlatUsd: toMoney(input.paymentFeeFlatUsd),
        creditTopupMinUsd: toMoney(input.creditTopupMinUsd),
        creditTopupMaxUsd: toMoney(input.creditTopupMaxUsd),
        creditTopupDefaultUsd: toMoney(input.creditTopupDefaultUsd),
        overageCapMinUsd: toMoney(input.overageCapMinUsd),
        overageCapMaxUsd: toMoney(input.overageCapMaxUsd),
        overageDefaultCapMultiplier: toMultiplier(
          input.overageDefaultCapMultiplier
        ),
        planCreditGrantCooldownDays: input.planCreditGrantCooldownDays,
        lowBalanceThresholdDefaultUsd: toMoney(
          input.lowBalanceThresholdDefaultUsd
        ),
        lowBalanceThresholdMinUsd: toMoney(input.lowBalanceThresholdMinUsd),
        // Backup storage rate stores with 6 decimal precision — toMoney is
        // (12,4) and would round off the trailing zeroes that humans read as
        // "0.01" but matter at $ per GB-month scale on big fleets.
        backupStorageRatePerGbPerMonth:
          input.backupStorageRatePerGbPerMonth.toFixed(6),
        polarCreditProductId: input.polarCreditProductId,
        polarOverageMeterId: input.polarOverageMeterId,
        updatedAt: new Date(),
      })
      .where(eq(schema.platformSettings.id, 1));

    invalidatePlatformSettingsCache();

    if (Object.keys(changes).length > 0) {
      const reqCtx = extractRequestContext(await headers());
      audit({
        action: "platform_settings.update",
        category: "platform",
        actorType: "admin",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "platform_settings",
        entityId: "1",
        description: `Updated platform settings (${Object.keys(changes).join(", ")})`,
        metadata: { changes },
        ...reqCtx,
      });
    }

    return { success: true as const };
  } catch (error) {
    console.error("updatePlatformSettings error:", error);
    return { error: "Something went wrong saving platform settings." };
  }
}

// ---------------------------------------------------------------------------
// Disk QoS tier caps — operator-editable per-cube disk rate_limiter + io.max
// sizing. Stored in `platform_settings.disk_qos_tiers` (null = config defaults).
// The vCPU bands/labels mirror the billing tiers and are NOT edited here — only
// the three caps. On save we reconstruct the FULL tier objects from the config
// bands + the submitted caps, so the stored bands can never drift.
// ---------------------------------------------------------------------------

// A `null` cap = UNLIMITED on that axis (the customer uses the full disk).
const qosTierSchema = z.object({
  label: z.string().trim().min(1),
  bandwidthMbps: z
    .number()
    .min(DISK_QOS_CAP_BOUNDS.bandwidthMbps.min, "Must be at least 1 MB/s")
    .max(DISK_QOS_CAP_BOUNDS.bandwidthMbps.max, "Must be at most 100000 MB/s")
    .nullable(),
  iops: z
    .number()
    .int("Must be a whole number")
    .min(DISK_QOS_CAP_BOUNDS.iops.min, "Must be at least 1 IOPS")
    .max(DISK_QOS_CAP_BOUNDS.iops.max, "Must be at most 10000000 IOPS")
    .nullable(),
  burstMultiplier: z
    .number()
    .min(DISK_QOS_CAP_BOUNDS.burstMultiplier.min, "Must be 1 or greater")
    .max(DISK_QOS_CAP_BOUNDS.burstMultiplier.max, "Must be 100 or less"),
});

const qosInputSchema = z.object({
  reset: z.boolean().optional(),
  tiers: z.array(qosTierSchema).optional(),
});

export type UpdateDiskQosTiersInput = z.infer<typeof qosInputSchema>;

export async function updateDiskQosTiers(
  rawInput: unknown
): Promise<{ success: true } | { error: string }> {
  try {
    const sessionResult = await requireActionAdmin();
    if ("error" in sessionResult) {
      return sessionResult;
    }
    const session = sessionResult;

    const parsed = qosInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid disk QoS caps",
      };
    }

    // The config tiers are the band/label source of truth.
    const { DISK_RATE_LIMITER_TIERS } = await import("@/config/platform");

    let nextValue: (typeof DISK_RATE_LIMITER_TIERS)[number][] | null;
    if (parsed.data.reset || !parsed.data.tiers) {
      nextValue = null; // → config defaults via getDiskQosTiers()
    } else {
      const submitted = parsed.data.tiers;
      // Reconstruct the full tiers from config BANDS + submitted caps (so the
      // stored bands can never drift). Every config tier must be present; a
      // missing label means a stale form — surface a clean retry, never throw.
      const rebuilt: (typeof DISK_RATE_LIMITER_TIERS)[number][] = [];
      for (const cfg of DISK_RATE_LIMITER_TIERS) {
        const o = submitted.find((s) => s.label === cfg.label);
        if (!o) {
          return {
            error: "Tier caps are incomplete — reload the page and try again.",
          };
        }
        rebuilt.push({
          ...cfg,
          bandwidthMbps: o.bandwidthMbps,
          iops: o.iops,
          burstMultiplier: o.burstMultiplier,
        });
      }
      nextValue = rebuilt;
    }

    await db
      .update(schema.platformSettings)
      .set({ diskQosTiers: nextValue, updatedAt: new Date() })
      .where(eq(schema.platformSettings.id, 1));

    invalidatePlatformSettingsCache();

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "platform_settings.disk_qos_update",
      category: "platform",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "platform_settings",
      entityId: "1",
      description: nextValue
        ? `Updated disk QoS caps (${nextValue.map((t) => `${t.label}:${t.bandwidthMbps ?? "unlimited"}MB/s/${t.iops ?? "unlimited"}iops`).join(", ")})`
        : "Reset disk QoS caps to platform defaults",
      metadata: { tiers: nextValue },
      ...reqCtx,
    });

    return { success: true as const };
  } catch (error) {
    // Log the real error; return a generic message so internal DB/system error
    // text never leaks to the client (mirrors updatePlatformSettings). The only
    // user-actionable failure — incomplete tiers — is returned explicitly above.
    console.error("updateDiskQosTiers error:", error);
    return { error: "Something went wrong saving disk QoS caps." };
  }
}
