/**
 * Plan-limit guards — the single source of feature-limit enforcement.
 *
 * Built around a `Plan` row (from the `plans` table) plus per-space override
 * columns on `spaces`. Every guard is PURE: it takes an `EffectiveLimits`
 * (plan defaults merged with the space's overrides) plus the already-counted
 * current usage and returns an allow/deny. The DB counting lives in
 * `lib/plan/usage.ts`. Callers run the count, then the guard.
 */

import { formatRam, type PlanCubeLimits } from "@/lib/cube-options";
import type { db } from "@/lib/db";
import {
  countActiveCubes,
  countSpaceBackups,
  countSpaceDomains,
  countSpaceMembers,
  getSpaceOverrides,
  getSpaceOverridesTx,
  getSpacePlanRow,
  getSpacePlanRowTx,
  type Plan,
  type SpaceOverridesRow,
} from "@/lib/plan/usage";

/** A Drizzle transaction handle — same shape as `lib/billing/apply-topup.ts`'s `Tx`. */
type TxHandle = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Result of a limit check. */
export type LimitCheck = { ok: true } | { ok: false; error: string };

export interface PlanFitResult {
  ok: boolean;
  /** Human-readable reasons the space exceeds the target plan. */
  violations: string[];
}

/**
 * The merged per-space effective limits — what every guard actually checks
 * against. Computed by `effectiveLimits(plan, space)`: for each field, the
 * space's override wins if set, otherwise the plan's value applies.
 */
export interface EffectiveLimits {
  allowOverage: boolean;
  allowTopup: boolean;
  /**
   * Auto-snapshot cadence in hours. NULL = auto-snapshots disabled for
   * this plan (e.g. Trial). The `snapshot.scheduler` cron skips any cube
   * whose plan returns NULL here.
   */
  autoSnapshotCadenceHours: number | null;
  autoSnapshotKeepDaily: number;
  autoSnapshotKeepLast: number;
  autoSnapshotKeepWeekly: number;
  includedCreditUsd: number;
  /** Plan label used in error messages (the plan `name`). */
  label: string;
  maxBackups: number | null;
  maxConcurrentCubes: number | null;
  maxDiskGb: number;
  maxDomains: number | null;
  /**
   * Hard cap on user-created (manual) snapshots per cube. 0 = customer
   * cannot create manual snapshots on this plan (e.g. Trial). No
   * per-space override is exposed yet — operators raise the cap by
   * moving the space to a different plan.
   */
  maxManualSnapshotsPerCube: number;
  maxRamMb: number;
  maxSeats: number | null;
  maxVcpus: number;
}

/** Subset of `spaces` columns consumed by `effectiveLimits`. Re-exported
 *  from `lib/plan/usage.ts` so the read helper + the merge helper agree. */
export type SpaceOverrides = SpaceOverridesRow;

/**
 * Merge a plan row with a space's per-space overrides into the
 * `EffectiveLimits` shape every Phase 5 guard takes.
 *
 * For each field: `space.override_X ?? plan.X`. Numeric `includedCreditUsd`
 * comes back from the DB as a `numeric(12,4)` string, so it is parsed once
 * here so guard callers can just compare numbers. Boolean overrides (`allow*`)
 * follow the same `?? plan` pattern — null means "no override, use plan".
 */
export function effectiveLimits(
  plan: Plan,
  overrides: SpaceOverrides
): EffectiveLimits {
  const includedCreditSource =
    overrides.overrideIncludedCreditUsd ?? plan.includedCreditUsd;
  return {
    label: plan.name,
    maxConcurrentCubes:
      overrides.overrideMaxConcurrentCubes ?? plan.maxConcurrentCubes,
    maxVcpus: overrides.overrideMaxVcpus ?? plan.maxVcpus,
    maxRamMb: overrides.overrideMaxRamMb ?? plan.maxRamMb,
    maxDiskGb: overrides.overrideMaxDiskGb ?? plan.maxDiskGb,
    maxSeats: overrides.overrideMaxSeats ?? plan.maxSeats,
    maxBackups: overrides.overrideMaxBackups ?? plan.maxBackups,
    maxDomains: overrides.overrideMaxDomains ?? plan.maxDomains,
    allowTopup: overrides.overrideAllowTopup ?? plan.allowTopup,
    allowOverage: overrides.overrideAllowOverage ?? plan.allowOverage,
    // Snapshot fields are plan-only — no per-space override (yet). Operators
    // change the snapshot config for a single space by moving the space to
    // a different plan, or by editing the plan row itself.
    autoSnapshotCadenceHours: plan.autoSnapshotCadenceHours,
    autoSnapshotKeepLast: plan.autoSnapshotKeepLast,
    autoSnapshotKeepDaily: plan.autoSnapshotKeepDaily,
    autoSnapshotKeepWeekly: plan.autoSnapshotKeepWeekly,
    maxManualSnapshotsPerCube: plan.maxManualSnapshotsPerCube,
    includedCreditUsd: Number.parseFloat(includedCreditSource),
  };
}

/** Phase 5 — `EffectiveLimits`-based variant of `assertCubeWithinSize`. */
export function assertCubeWithinSizeV2(
  limits: EffectiveLimits,
  size: { vcpus: number; ramMb: number; diskGb: number }
): LimitCheck {
  if (size.vcpus > limits.maxVcpus) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${limits.maxVcpus} vCPU per Cube. Upgrade your plan for larger Cubes.`,
    };
  }
  if (size.ramMb > limits.maxRamMb) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${formatRam(limits.maxRamMb)} RAM per Cube. Upgrade your plan for larger Cubes.`,
    };
  }
  if (size.diskGb > limits.maxDiskGb) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${limits.maxDiskGb} GB disk per Cube. Upgrade your plan for larger Cubes.`,
    };
  }
  return { ok: true };
}

/** Phase 5 — `EffectiveLimits`-based variant of `assertCanCreateCube`. */
export function assertCanCreateCubeV2(
  limits: EffectiveLimits,
  activeCubeCount: number,
  size: { vcpus: number; ramMb: number; diskGb: number }
): LimitCheck {
  const sizeCheck = assertCubeWithinSizeV2(limits, size);
  if (!sizeCheck.ok) {
    return sizeCheck;
  }

  if (
    limits.maxConcurrentCubes !== null &&
    activeCubeCount >= limits.maxConcurrentCubes
  ) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${limits.maxConcurrentCubes} running Cube${limits.maxConcurrentCubes === 1 ? "" : "s"} at a time. Sleep or delete a Cube, or upgrade your plan.`,
    };
  }
  return { ok: true };
}

/** Phase 5 — `EffectiveLimits`-based variant of `assertCanWakeCube`. */
export function assertCanWakeCubeV2(
  limits: EffectiveLimits,
  activeCubeCount: number
): LimitCheck {
  if (
    limits.maxConcurrentCubes !== null &&
    activeCubeCount >= limits.maxConcurrentCubes
  ) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${limits.maxConcurrentCubes} running Cube${limits.maxConcurrentCubes === 1 ? "" : "s"} at a time. Sleep another Cube, or upgrade your plan.`,
    };
  }
  return { ok: true };
}

/** Phase 5 — `EffectiveLimits`-based variant of `assertCanInviteMember`. */
export function assertCanInviteMemberV2(
  limits: EffectiveLimits,
  currentSeatCount: number
): LimitCheck {
  if (limits.maxSeats !== null && currentSeatCount >= limits.maxSeats) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${limits.maxSeats} member${limits.maxSeats === 1 ? "" : "s"} per space. Upgrade your plan to add more.`,
    };
  }
  return { ok: true };
}

/** Phase 5 — `EffectiveLimits`-based variant of `assertCanKeepBackup`. */
export function assertCanKeepBackupV2(
  limits: EffectiveLimits,
  currentBackupCount: number
): LimitCheck {
  if (limits.maxBackups !== null && currentBackupCount >= limits.maxBackups) {
    return {
      ok: false,
      error:
        limits.maxBackups === 0
          ? `The ${limits.label} plan does not include Cube backups. Upgrade your plan to keep a backup, or delete this Cube without one.`
          : `The ${limits.label} plan allows at most ${limits.maxBackups} backup${limits.maxBackups === 1 ? "" : "s"}. Delete an existing backup, or delete this Cube without keeping one.`,
    };
  }
  return { ok: true };
}

/** Phase 5 — `EffectiveLimits`-based variant of `assertCanAddDomain`. */
export function assertCanAddDomainV2(
  limits: EffectiveLimits,
  currentDomainCount: number
): LimitCheck {
  if (limits.maxDomains !== null && currentDomainCount >= limits.maxDomains) {
    return {
      ok: false,
      error:
        limits.maxDomains === 0
          ? `The ${limits.label} plan does not include custom domains. Upgrade your plan to add one.`
          : `The ${limits.label} plan allows at most ${limits.maxDomains} custom domain${limits.maxDomains === 1 ? "" : "s"}. Upgrade your plan to add more.`,
    };
  }
  return { ok: true };
}

/**
 * Project the four per-Cube size ceilings out of an `EffectiveLimits` into a
 * client-safe shape (`PlanCubeLimits` in `lib/cube-options.ts`). Used by
 * RSC pages to thread limits into client components — the wider
 * `EffectiveLimits` carries fields (`allowOverage`, `includedCreditUsd`,
 * etc.) that don't belong on the client.
 */
export function toClientLimits(effective: EffectiveLimits): PlanCubeLimits {
  return {
    planName: effective.label,
    maxVcpus: effective.maxVcpus,
    maxRamMb: effective.maxRamMb,
    maxDiskGb: effective.maxDiskGb,
  };
}

/**
 * Phase 5 convenience: load the space's plan row + override columns and
 * return the merged `EffectiveLimits`. The two reads run in parallel.
 * Use inside server actions / API routes where the caller does not need the
 * plan or overrides individually.
 */
export async function loadEffectiveLimits(
  spaceId: string
): Promise<EffectiveLimits> {
  const [plan, overrides] = await Promise.all([
    getSpacePlanRow(spaceId),
    getSpaceOverrides(spaceId),
  ]);
  return effectiveLimits(plan, overrides);
}

/** Transaction-aware variant of `loadEffectiveLimits`. */
export async function loadEffectiveLimitsTx(
  tx: TxHandle,
  spaceId: string
): Promise<EffectiveLimits> {
  const plan = await getSpacePlanRowTx(tx, spaceId);
  const overrides = await getSpaceOverridesTx(tx, spaceId);
  return effectiveLimits(plan, overrides);
}

/**
 * Phase 5 — `EffectiveLimits`-based variant of `checkSpaceFitsPlan`. Checks
 * whether `spaceId` currently fits within the supplied `targetLimits`'s
 * COUNT limits — concurrent Cubes, team seats, retained backups, custom
 * domains. Cube SIZE is intentionally excluded (size limits are
 * create/resize-time only and are never enforced retroactively — foundation
 * design). Used to UI-block a downgrade until the customer has reduced usage.
 */
export async function checkSpaceFitsPlanV2(
  spaceId: string,
  targetLimits: EffectiveLimits
): Promise<PlanFitResult> {
  const [cubes, members, backups, domains] = await Promise.all([
    countActiveCubes(spaceId),
    countSpaceMembers(spaceId),
    countSpaceBackups(spaceId),
    countSpaceDomains(spaceId),
  ]);
  const violations: string[] = [];
  if (
    targetLimits.maxConcurrentCubes !== null &&
    cubes > targetLimits.maxConcurrentCubes
  ) {
    violations.push(
      `Running Cubes: ${cubes} (max ${targetLimits.maxConcurrentCubes}) — sleep or delete ${cubes - targetLimits.maxConcurrentCubes}.`
    );
  }
  if (targetLimits.maxSeats !== null && members > targetLimits.maxSeats) {
    violations.push(
      `Team members: ${members} (max ${targetLimits.maxSeats}) — remove ${members - targetLimits.maxSeats}.`
    );
  }
  if (targetLimits.maxBackups !== null && backups > targetLimits.maxBackups) {
    violations.push(
      `Backups: ${backups} (max ${targetLimits.maxBackups}) — delete ${backups - targetLimits.maxBackups}.`
    );
  }
  if (targetLimits.maxDomains !== null && domains > targetLimits.maxDomains) {
    violations.push(
      `Custom domains: ${domains} (max ${targetLimits.maxDomains}) — remove ${domains - targetLimits.maxDomains}.`
    );
  }
  return { ok: violations.length === 0, violations };
}
