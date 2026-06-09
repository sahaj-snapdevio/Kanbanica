/**
 * Pure cost calculation utilities — no DB imports, safe for client components.
 * Server-side code should import from "@/lib/cost" which re-exports these.
 *
 * ── Billing Model Overview ──────────────────────────────────────────────
 *
 * Krova uses a credit-based billing system with per-hour charges:
 *
 *   Hourly cost = (vCPU cost + RAM cost + Disk cost) × tier multiplier
 *
 * Where:
 *   - vCPU cost  = vcpus × vcpuRate
 *   - RAM cost   = (ramMb / 1024) × ramRate
 *   - Disk cost  = diskGb × diskRate
 *   - Tier multiplier = volume discount based on vCPU count (see CREDIT_RATE_TIERS in config/platform.ts)
 *
 * Concrete rate values live in config/platform.ts (VCPU_RATE, RAM_RATE,
 * DISK_RATE) and flow through getCreditRates() — never duplicate them here.
 *
 * Two billing triggers:
 *
 *   1. **Hourly billing** (`billing.hourly` scheduled job, every hour)
 *      - Charges all running cubes for elapsed time since lastBilledAt
 *      - Capped at 1 hour max per cycle to prevent runaway charges
 *      - Charges backup storage: sizeBytes × backup_storage_rate / 730 per hour
 *      - Charges sleep storage on every cube with `status='sleeping'` at
 *        DISK_RATE × diskLimitGb × tier multiplier per hour — same per-GB
 *        rate as the running-disk component, billed on the FULL disk size
 *        the cube allocated on the host (vCPU + RAM are NOT charged while
 *        Firecracker is paused / killed). Independent of `lastBilledAt`
 *        (every sleeping cube joins the rotation each tick).
 *
 *   2. **Prorated billing** (`chargeProratedUsage()` in lib/cost.ts)
 *      - Triggered when a cube stops being billable for running compute
 *        (sleep, delete, state-sync → sleeping)
 *      - Charges the fractional running-compute hour since lastBilledAt
 *      - Skips charges < 1 minute to avoid micro-charges from rapid state changes
 *      - If space balance < charge amount, caps the charge at remaining balance
 *      - Does NOT charge sleep storage — that's a separate hourly pass on
 *        the full disk size and doesn't prorate (same pattern as backup
 *        storage).
 *
 * Both billing paths use the same `calculateHourlyCost()` formula below
 * for running compute, ensuring consistent pricing regardless of how the
 * charge is triggered. Sleep storage uses its own formula above.
 *
 * The `lastBilledAt` timestamp on each cube is the running-compute clock:
 *   - Set to `now` when a cube starts running (boot, wake, restore)
 *   - Updated to `now` after each successful hourly charge
 *   - Cleared to `null` when a cube stops running (sleep, state-sync → sleeping).
 *     A null `lastBilledAt` does NOT mean the cube is non-billable overall —
 *     sleep-storage billing still applies. It only means the running-compute
 *     billing clock is stopped.
 *   - Prevents double-charging: both billing paths lock the cube row in a transaction
 * ────────────────────────────────────────────────────────────────────────
 */

export interface CreditRates {
  /** Cost per GB of disk per hour. Source: DISK_RATE. */
  diskRate: number;
  /** Cost per GB of RAM per hour — ramMb is divided by 1024 before applying. Source: RAM_RATE. */
  ramRate: number;
  /** Cost per vCPU per hour. Source: VCPU_RATE in config/platform.ts. */
  vcpuRate: number;
}

export interface CreditRateTier {
  id: string;
  label: string | null;
  /** Maximum vCPU count for this tier (inclusive), null = unlimited */
  maxVcpus: number | null;
  /** Minimum vCPU count for this tier (inclusive) */
  minVcpus: number;
  /** Multiplier applied to the total hourly cost (e.g., 0.85 = 15% discount) */
  multiplier: number;
  sortOrder: number;
}

/**
 * Find the tier multiplier for a given vCPU count.
 * Tiers provide volume discounts — higher vCPU cubes get a lower multiplier.
 * Returns 1.0 (no discount) if no tiers configured or no matching tier.
 */
export function getTierMultiplier(
  vcpus: number,
  tiers: CreditRateTier[]
): number {
  if (tiers.length === 0) {
    return 1.0;
  }
  const tier = tiers.find(
    (t) => vcpus >= t.minVcpus && (t.maxVcpus === null || vcpus <= t.maxVcpus)
  );
  return tier?.multiplier ?? 1.0;
}

/**
 * Calculate the hourly cost for a Cube given its resources, credit rates,
 * and optional tier multiplier.
 *
 * Formula:  hourly = (vcpus × vcpuRate + ramGb × ramRate + diskGb × diskRate) × multiplier
 *
 * Disk is billed on the FULL allocated size — every GB the customer
 * provisions occupies a real byte on the host, so the customer pays for
 * every GB. Rate values come from config/platform.ts via getCreditRates().
 */
export function calculateHourlyCost(
  resources: { vcpus: number; ramMb: number; diskLimitGb: number },
  rates: CreditRates,
  multiplier = 1.0
): number {
  // Round each term to 4 decimal places before summing to prevent floating-point accumulation
  const vcpuCost =
    Math.round(resources.vcpus * rates.vcpuRate * multiplier * 10_000) / 10_000;
  const ramCost =
    Math.round((resources.ramMb / 1024) * rates.ramRate * multiplier * 10_000) /
    10_000;
  const diskCost =
    Math.round(resources.diskLimitGb * rates.diskRate * multiplier * 10_000) /
    10_000;
  return Math.round((vcpuCost + ramCost + diskCost) * 10_000) / 10_000;
}

/**
 * Hourly disk-only cost for a SLEEPING cube — `DISK_RATE × diskLimitGb ×
 * multiplier` per hour. **NO vCPU cost and NO RAM cost** while sleeping —
 * Firecracker is paused or killed and the host pool has reclaimed those
 * resources. Only the rootfs's on-host disk footprint is billed.
 *
 * Same per-GB rate and full-disk basis as the running-disk component of
 * `calculateHourlyCost` — they share the formula because a sleeping cube's
 * rootfs occupies the same bytes on the host filesystem as a running one.
 *
 * The `multiplier` arg is the cube's tier discount (resolved from its vCPU
 * count via `getTierMultiplier`); the caller passes it explicitly so this
 * function stays pure (no dependency on the tier table). Setting
 * `DISK_RATE = 0` in config/platform.ts is the only way to disable sleep
 * storage — it also disables running-disk billing in lockstep.
 *
 * Charged hourly by `billing.hourly` on every `status='sleeping'` cube.
 * Independent of `lastBilledAt` — every sleeping cube joins the rotation each
 * tick.
 */
export function calculateSleepHourlyCost(
  resources: { diskLimitGb: number },
  rates: Pick<CreditRates, "diskRate">,
  multiplier = 1.0
): number {
  return (
    Math.round(resources.diskLimitGb * rates.diskRate * multiplier * 10_000) /
    10_000
  );
}
