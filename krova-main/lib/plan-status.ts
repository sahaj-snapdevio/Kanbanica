/**
 * Single source of truth for the plan-status pill rendered on Orbit's
 * plan list + plan detail pages.
 *
 * The status is a computed precedence ladder over four plan fields, not a
 * stored enum — `Archived > Not provisioned > Default > Custom > Public`.
 * Both consumer pages used to inline an identical 5-branch ternary; per
 * Rule 14 that's now centralised here.
 *
 * Each pill includes a `dark:` background + border variant so the colored
 * tint actually shows on the dark card surface (the bare `bg-*-500/10`
 * patterns were imperceptible against `oklch(0.205)`).
 */

export type PlanStatusInput = {
  isArchived: boolean;
  isDefaultForNewSpaces: boolean;
  visibility: "public" | "custom";
  priceUsd: number;
  polarProductId: string | null;
};

export type PlanStatusLabel =
  | "Archived"
  | "Not provisioned"
  | "Default"
  | "Custom"
  | "Public";

export type PlanStatus = {
  label: PlanStatusLabel;
  className: string;
};

export function getPlanStatus(plan: PlanStatusInput): PlanStatus {
  if (plan.isArchived) {
    return {
      label: "Archived",
      className:
        "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:border-slate-400/30 dark:bg-slate-500/15 dark:text-slate-400",
    };
  }
  if (plan.priceUsd > 0 && !plan.polarProductId) {
    return {
      label: "Not provisioned",
      className:
        "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-400",
    };
  }
  if (plan.isDefaultForNewSpaces) {
    return {
      label: "Default",
      className:
        "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-400",
    };
  }
  if (plan.visibility === "custom") {
    return {
      label: "Custom",
      className:
        "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-400",
    };
  }
  return {
    label: "Public",
    className:
      "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/15 dark:text-blue-400",
  };
}
