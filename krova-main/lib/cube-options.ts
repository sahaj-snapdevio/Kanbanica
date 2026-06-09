import type { RangeConfig } from "@/config/platform";

export type { RangeConfig } from "@/config/platform";

/** Check whether a value fits within a min/max/step range. */
export function isValidRangeValue(value: number, range: RangeConfig): boolean {
  if (typeof value !== "number" || !isFinite(value)) {
    return false;
  }
  if (value < range.min || value > range.max) {
    return false;
  }
  // Use rounding to avoid floating-point precision issues (e.g. 0.5 steps)
  const steps = (value - range.min) / range.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) {
    return false;
  }
  return true;
}

/** Human-readable description of a range for error messages. */
export function describeRange(range: RangeConfig): string {
  return `${range.min}–${range.max} (step ${range.step})`;
}

/**
 * Enumerate every discrete value in a range as an array. Used to populate
 * Select dropdowns. Rounds away float drift accumulated by repeated `+= step`.
 */
export function rangeValues(range: RangeConfig): number[] {
  const out: number[] = [];
  const decimals = (() => {
    const s = String(range.step);
    const dot = s.indexOf(".");
    return dot === -1 ? 0 : s.length - dot - 1;
  })();
  for (let v = range.min; v <= range.max + 1e-9; v += range.step) {
    out.push(decimals === 0 ? v : Number(v.toFixed(decimals)));
  }
  return out;
}

/** Format RAM in MB to a human-readable label. */
export function formatRam(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

/**
 * The shape of cubeOptions passed from server pages to client components.
 * Kept in one place so every consumer agrees on the type.
 */
export interface CubeOptions {
  cpuOptions: RangeConfig;
  diskOptions: RangeConfig;
  imageOptions: { value: string; label: string }[];
  ramOptions: RangeConfig;
}

/**
 * Client-safe view of the per-Cube size ceilings from the space's effective
 * plan limits (`lib/plan/limits.ts` `EffectiveLimits`). Server pages compute
 * `effectiveLimits(plan, overrides)` and pass these four fields into client
 * components that need to clamp resource pickers to the plan's allowance.
 */
export interface PlanCubeLimits {
  maxDiskGb: number;
  maxRamMb: number;
  maxVcpus: number;
  planName: string;
}
