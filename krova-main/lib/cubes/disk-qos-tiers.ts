/**
 * Resolve the EFFECTIVE per-tier disk QoS caps, merging the operator's
 * Orbit-edited overrides (stored in `platform_settings.disk_qos_tiers`) onto the
 * `DISK_RATE_LIMITER_TIERS` defaults in config/platform.ts.
 *
 * Design invariants:
 *  - The vCPU BANDS (`minVcpus`/`maxVcpus`/`label`) ALWAYS come from config —
 *    they mirror the billing tiers and must never drift. The operator only edits
 *    the CAPS (`bandwidthMbps`/`iops`/`burstMultiplier`).
 *  - Any missing / malformed / out-of-bounds override falls back to that tier's
 *    config default, per-tier — bad data can NEVER produce an invalid limiter
 *    (the never-brick-a-boot boundary; the launch builders also null-guard).
 *  - `getDiskQosTiers()` reads via the 60s-cached `getPlatformSettings()`, so the
 *    cube launch hot path does not hit the DB per cube. Edits apply on each
 *    cube's NEXT cold boot.
 */

import {
  DISK_QOS_CAP_BOUNDS,
  DISK_RATE_LIMITER_TIERS,
  type DiskRateLimiterTier,
} from "@/config/platform";

function inBounds(
  v: unknown,
  b: { readonly min: number; readonly max: number }
): v is number {
  return (
    typeof v === "number" && Number.isFinite(v) && v >= b.min && v <= b.max
  );
}

/** A `null` cap = UNLIMITED on that axis (a non-null cap must be within bounds). */
function validCap(
  v: unknown,
  b: { readonly min: number; readonly max: number }
): boolean {
  return v === null || inBounds(v, b);
}

/**
 * The operator-editable cap fields a single tier override carries. `null` on
 * `bandwidthMbps` / `iops` means UNLIMITED on that axis.
 */
export type DiskQosCapOverride = {
  label: string;
  bandwidthMbps: number | null;
  iops: number | null;
  burstMultiplier: number;
};

/**
 * True iff an override is well-formed: a string label, each cap either `null`
 * (unlimited) or within bounds, and a valid burst multiplier.
 */
export function validDiskQosOverride(o: unknown): o is DiskQosCapOverride {
  if (!o || typeof o !== "object") {
    return false;
  }
  const t = o as Record<string, unknown>;
  return (
    typeof t.label === "string" &&
    validCap(t.bandwidthMbps, DISK_QOS_CAP_BOUNDS.bandwidthMbps) &&
    validCap(t.iops, DISK_QOS_CAP_BOUNDS.iops) &&
    inBounds(t.burstMultiplier, DISK_QOS_CAP_BOUNDS.burstMultiplier)
  );
}

/**
 * Merge per-tier overrides onto the config defaults: bands from config, caps
 * from a matching (by `label`) valid override, else the config caps. Pure +
 * always returns a complete, valid tier set — testable without the DB.
 */
export function resolveDiskQosTiers(
  overrides: readonly unknown[] | null | undefined
): DiskRateLimiterTier[] {
  return DISK_RATE_LIMITER_TIERS.map((cfg) => {
    const o = (overrides ?? []).find(
      (x) => validDiskQosOverride(x) && x.label === cfg.label
    ) as DiskQosCapOverride | undefined;
    if (!o) {
      return cfg;
    }
    return {
      ...cfg,
      bandwidthMbps: o.bandwidthMbps,
      iops: o.iops,
      burstMultiplier: o.burstMultiplier,
    };
  });
}

/**
 * The effective tier set for the running system (DB overrides + config defaults).
 * Cached via getPlatformSettings (60s). On any DB error, falls back to the config
 * defaults rather than throwing — a settings hiccup must never block a launch.
 */
export async function getDiskQosTiers(): Promise<DiskRateLimiterTier[]> {
  try {
    // Dynamic import keeps this module (and its pure resolver) free of the DB
    // layer at import time, so the unit tests stay DB-less.
    const { getPlatformSettings } = await import("@/lib/platform-settings");
    const settings = await getPlatformSettings();
    return resolveDiskQosTiers(settings.diskQosTiers);
  } catch {
    return [...DISK_RATE_LIMITER_TIERS];
  }
}
