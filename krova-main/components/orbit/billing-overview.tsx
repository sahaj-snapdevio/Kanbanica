"use client";

import {
  CoinsIcon,
  CreditCardIcon,
  CurrencyDollarIcon,
  GiftIcon,
  ReceiptIcon,
  StackIcon,
} from "@phosphor-icons/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CreditRateTier } from "@/lib/cost-shared";

interface BillingOverviewProps {
  rates: {
    vcpuRate: number;
    ramRate: number;
    diskRate: number;
  };
  tiers: CreditRateTier[];
  totalConsumed: number;
  totalFreeGrants: number;
  totalGranted: number;
  totalPlanCredits: number;
  totalSpaces: number;
  totalTopups: number;
}

export function BillingOverview({
  totalGranted,
  totalConsumed,
  totalFreeGrants,
  totalPlanCredits,
  totalTopups,
  totalSpaces,
  rates,
  tiers,
}: BillingOverviewProps) {
  const exampleHourly =
    rates.vcpuRate * 2 + rates.ramRate * 2 + 20 * rates.diskRate;

  return (
    <div className="space-y-8">
      {/* Overview stat strip */}
      <StatGrid columns={3}>
        <Stat
          icon={<CoinsIcon />}
          label="Credits Granted"
          sublabel="Lifetime, all spaces"
          tone="success"
          value={`$${totalGranted.toFixed(2)}`}
        />
        <Stat
          icon={<CurrencyDollarIcon />}
          label="Credits Consumed"
          sublabel="Lifetime hourly + prorated charges"
          value={`$${totalConsumed.toFixed(2)}`}
        />
        <Stat
          icon={<StackIcon />}
          label="Active Spaces"
          sublabel={
            totalSpaces === 1
              ? "1 space billed"
              : `${totalSpaces} spaces billed`
          }
          value={totalSpaces}
        />
      </StatGrid>

      {/* Credit sources */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Credit sources</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Breakdown of where the granted credits came from.
          </p>
        </div>
        <StatGrid columns={3}>
          <Stat
            icon={<GiftIcon />}
            label="Free grants"
            sublabel="Issued by Krova (Orbit admin)"
            value={`$${totalFreeGrants.toFixed(2)}`}
          />
          <Stat
            icon={<ReceiptIcon />}
            label="Plan credits"
            sublabel="Included with paid subscriptions"
            value={`$${totalPlanCredits.toFixed(2)}`}
          />
          <Stat
            icon={<CreditCardIcon />}
            label="Paid top-ups"
            sublabel="Customer credit purchases"
            tone="success"
            value={`$${totalTopups.toFixed(2)}`}
          />
        </StatGrid>
      </section>

      {/* Credit rates */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Credit rates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Hourly rates charged per resource unit. Configured in{" "}
            <code className="text-xs">config/platform.ts</code>.
          </p>
        </div>
        <StatGrid columns={3}>
          <Stat
            label="vCPU"
            sublabel="per vCPU / hour"
            value={`$${rates.vcpuRate.toFixed(4)}`}
          />
          <Stat
            label="RAM"
            sublabel="per GB / hour · sold 1:1, never oversold"
            value={`$${rates.ramRate.toFixed(4)}`}
          />
          <Stat
            label="Disk"
            sublabel="per GB / hour · sold 1:1, never oversold"
            value={`$${rates.diskRate.toFixed(4)}`}
          />
        </StatGrid>
        <Card className="bg-muted/30">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Example: a Cube with{" "}
              <span className="font-mono text-foreground">2 vCPU</span>,{" "}
              <span className="font-mono text-foreground">2 GB RAM</span>, and{" "}
              <span className="font-mono text-foreground">20 GB disk</span>{" "}
              costs{" "}
              <span className="font-mono font-medium text-foreground">
                ${exampleHourly.toFixed(4)}
              </span>{" "}
              per hour. Every allocated GB of RAM and disk is billed — no
              overselling.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Volume discount tiers */}
      {tiers.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Volume discount tiers</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Discount multipliers applied based on a Cube&apos;s vCPU count.
              Configured in <code className="text-xs">config/platform.ts</code>.
            </p>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>vCPU range</TableHead>
                    <TableHead className="text-right">Multiplier</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead className="text-right">Effective</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((tier) => (
                    <TableRow
                      key={`${tier.minVcpus}-${tier.maxVcpus ?? "max"}`}
                    >
                      <TableCell className="font-mono tabular-nums">
                        {tier.minVcpus}
                        {tier.maxVcpus === null ? "+" : `–${tier.maxVcpus}`}{" "}
                        vCPU
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {tier.multiplier}×
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {tier.label}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {tier.multiplier === 1
                          ? "—"
                          : tier.multiplier < 1
                            ? `${Math.round((1 - tier.multiplier) * 100)}% off`
                            : `${Math.round((tier.multiplier - 1) * 100)}% surcharge`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

// Card descriptors retained for any callers that still pull them from this
// module surface even though the rewrite no longer uses them directly.
export type { BillingOverviewProps };
export { Card, CardContent, CardDescription, CardHeader, CardTitle };
