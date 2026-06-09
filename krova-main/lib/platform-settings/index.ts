/**
 * Read path for the `platform_settings` singleton row. The row is the
 * operator-tweakable source of truth for processing-fee + bounds + cooldown
 * constants that previously lived as hard-coded values in `config/platform.ts`.
 *
 * Cached in module memory for 60 seconds — short enough that a fresh deploy or
 * an Orbit save (which calls `invalidatePlatformSettingsCache()`) propagates
 * quickly, long enough that hot paths (every checkout, every billing-hourly
 * tick) do not hit the DB per-call.
 *
 * Numeric columns come back from `node-postgres` as strings (Drizzle preserves
 * driver behavior for `numeric`); parseFloat once at the read boundary so
 * downstream callers get the client-friendly `number` shape.
 */
import { eq } from "drizzle-orm";
import type { DiskRateLimiterTier } from "@/config/platform";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export interface PlatformSettings {
  /**
   * Per-GB-month rate for backup storage (cube_backups rows with
   * status='complete'). Operator-tunable in Orbit → Platform settings.
   * Default $0.01/GB/mo. Billed hourly by billing-hourly.ts as
   * `(sizeBytes/1024^3 || diskSizeGb) × rate / 730` per backup row.
   * Distinct from `DISK_RATE` in config/platform.ts (which drives
   * running-disk + sleep-storage billing).
   */
  backupStorageRatePerGbPerMonth: number;
  creditTopupDefaultUsd: number;
  creditTopupMaxUsd: number;
  creditTopupMinUsd: number;
  /**
   * Operator-edited per-tier disk QoS caps, or `null` to use the
   * `DISK_RATE_LIMITER_TIERS` defaults. Resolve via `getDiskQosTiers()` (which
   * applies the fallback + validation) — never read this raw field for sizing.
   */
  diskQosTiers: DiskRateLimiterTier[] | null;
  lowBalanceThresholdDefaultUsd: number;
  lowBalanceThresholdMinUsd: number;
  overageCapMaxUsd: number;
  overageCapMinUsd: number;
  overageDefaultCapMultiplier: number;
  paymentFeeFlatUsd: number;
  paymentFeePercent: number;
  planCreditGrantCooldownDays: number;
  /** Polar's one-shot credit top-up product id. Null = top-up inert. */
  polarCreditProductId: string | null;
  /** Polar's overage meter id (`krova_overage_usd`). Null = overage reporting inert. */
  polarOverageMeterId: string | null;
}

const CACHE_TTL_MS = 60_000;

let cached: { value: PlatformSettings; expiresAt: number } | null = null;

/** Drop the cached settings — called by `updatePlatformSettings` after a write. */
export function invalidatePlatformSettingsCache(): void {
  cached = null;
}

/**
 * Load the singleton row (id = 1). Throws a clear error if the row is missing
 * (Migration 0037 seeds it; missing-row means a broken environment, not a
 * runtime condition the caller can recover from).
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const [row] = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, 1))
    .limit(1);

  if (!row) {
    throw new Error(
      "platform_settings singleton row is missing. Migration 0037 must run before any platform-settings read."
    );
  }

  const value: PlatformSettings = {
    backupStorageRatePerGbPerMonth: Number.parseFloat(
      row.backupStorageRatePerGbPerMonth
    ),
    paymentFeePercent: Number.parseFloat(row.paymentFeePercent),
    paymentFeeFlatUsd: Number.parseFloat(row.paymentFeeFlatUsd),
    creditTopupMinUsd: Number.parseFloat(row.creditTopupMinUsd),
    creditTopupMaxUsd: Number.parseFloat(row.creditTopupMaxUsd),
    creditTopupDefaultUsd: Number.parseFloat(row.creditTopupDefaultUsd),
    diskQosTiers: row.diskQosTiers ?? null,
    overageCapMinUsd: Number.parseFloat(row.overageCapMinUsd),
    overageCapMaxUsd: Number.parseFloat(row.overageCapMaxUsd),
    overageDefaultCapMultiplier: Number.parseFloat(
      row.overageDefaultCapMultiplier
    ),
    planCreditGrantCooldownDays: row.planCreditGrantCooldownDays,
    lowBalanceThresholdDefaultUsd: Number.parseFloat(
      row.lowBalanceThresholdDefaultUsd
    ),
    lowBalanceThresholdMinUsd: Number.parseFloat(row.lowBalanceThresholdMinUsd),
    polarCreditProductId: row.polarCreditProductId,
    polarOverageMeterId: row.polarOverageMeterId,
  };

  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}
