import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRam } from "@/lib/cube-options";
import { effectiveLimits } from "@/lib/plan/limits";
import type { Plan, SpaceOverridesRow } from "@/lib/plan/usage";

/** Render a limit value — `null` means unlimited, `0` means not included. */
function fmtLimit(n: number | null): string {
  if (n === null) {
    return "Unlimited";
  }
  if (n === 0) {
    return "None";
  }
  return String(n);
}

/**
 * Read-only summary of the space's current plan and its EFFECTIVE feature
 * limits — the plan defaults merged with any per-space overrides. Phase 5 —
 * consumes a `Plan` row + a `SpaceOverridesRow` instead of the legacy enum.
 */
export function PlanCard({
  plan,
  overrides,
}: {
  plan: Plan;
  overrides: SpaceOverridesRow;
}) {
  const limits = effectiveLimits(plan, overrides);
  const priceUsd = Number.parseFloat(plan.priceUsd);
  const isFree = priceUsd <= 0;

  const rows: { label: string; value: string }[] = [
    {
      label: "Included credit",
      value: isFree
        ? `$${limits.includedCreditUsd} (one-time)`
        : `$${limits.includedCreditUsd}/mo`,
    },
    { label: "Concurrent Cubes", value: fmtLimit(limits.maxConcurrentCubes) },
    {
      label: "Max Cube size",
      value: `${limits.maxVcpus} vCPU · ${formatRam(limits.maxRamMb)} · ${limits.maxDiskGb} GB disk`,
    },
    { label: "Team seats", value: fmtLimit(limits.maxSeats) },
    { label: "Backups", value: fmtLimit(limits.maxBackups) },
    { label: "Custom domains", value: fmtLimit(limits.maxDomains) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Plan</span>
          <Badge variant="secondary">
            {plan.name}
            {isFree ? "" : ` · $${priceUsd}/mo`}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <div className="flex justify-between gap-4 text-sm" key={r.label}>
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
