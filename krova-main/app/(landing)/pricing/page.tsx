import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  CpuIcon,
  HardDriveIcon,
  MemoryIcon,
  ScalesIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Reveal } from "@/components/landing/reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CUBE_IMAGES,
  DISK_RATE,
  PRODUCT_NAME,
  RAM_RATE,
  VCPU_RATE,
} from "@/config/platform";
import * as schema from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  EXAMPLE_HOURLY,
  EXAMPLE_MONTHLY,
  MAX_SAVINGS,
  PRESET_SAVINGS,
  PRICING_PRESETS,
  PRICING_TIERS,
  priceMonthly,
  SIZING_CATALOG,
} from "@/lib/landing/pricing-data";
import { getDefaultPlan } from "@/lib/plan/usage";
import { breadcrumbJsonLd, JsonLd } from "@/lib/seo/jsonld";
import { pageOpenGraph, pageTwitter } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Custom-sized Cubes billed by the minute, real 1:1 RAM & disk (no overselling) — up to ${MAX_SAVINGS}% less than Lightsail, DigitalOcean, Vultr & Linode.`,
  alternates: { canonical: "/pricing" },
  openGraph: pageOpenGraph({
    url: "/pricing",
    title: `Pricing — ${PRODUCT_NAME}`,
    description: `Custom-sized Cubes billed by the minute, real 1:1 RAM & disk — up to ${MAX_SAVINGS}% less than AWS Lightsail, DigitalOcean, Vultr, and Linode.`,
  }),
  twitter: pageTwitter({
    title: `Pricing — ${PRODUCT_NAME}`,
    description: `Billed by the minute, real 1:1 RAM & disk — up to ${MAX_SAVINGS}% less than the big VPS providers.`,
  }),
};

export default async function PricingPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  const defaultPlan = await getDefaultPlan();
  const creditGrant = Number.parseFloat(defaultPlan.includedCreditUsd);
  const primaryHref = session ? "/post-auth" : "/signup";

  const publicPlansRows = await db
    .select()
    .from(schema.plans)
    .where(
      and(
        eq(schema.plans.visibility, "public"),
        eq(schema.plans.isArchived, false)
      )
    )
    .orderBy(asc(schema.plans.sortOrder), asc(schema.plans.priceUsd));
  const publicPlans = publicPlansRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceUsd: Number.parseFloat(p.priceUsd),
    includedCreditUsd: Number.parseFloat(p.includedCreditUsd),
    maxConcurrentCubes: p.maxConcurrentCubes,
    maxVcpus: p.maxVcpus,
    maxRamMb: p.maxRamMb,
    maxDiskGb: p.maxDiskGb,
    maxSeats: p.maxSeats,
    maxBackups: p.maxBackups,
    maxDomains: p.maxDomains,
    allowTopup: p.allowTopup,
    allowOverage: p.allowOverage,
    isDefaultForNewSpaces: p.isDefaultForNewSpaces,
  }));

  const productName = PRODUCT_NAME;

  return (
    <div>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ])}
      />

      {/* Header */}
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
          <Badge className="mb-4" variant="secondary">
            Pricing
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Less than half the price. Every size.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Same class of hardware — ECC RAM, mirrored enterprise NVMe, real 1:1
            resources — for up to {MAX_SAVINGS}% less. Custom-sized, billed by
            the minute. Every GB of RAM and disk is sold 1:1 with the host: no
            overselling, ever.
          </p>
        </div>
      </section>

      {/* Price comparison */}
      <section>
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="overflow-x-auto border bg-card">
            <table className="w-full min-w-160 text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium sm:p-4">
                    Configuration
                  </th>
                  <th className="p-3 text-right font-bold text-primary sm:p-4">
                    {productName}
                  </th>
                  <th className="hidden p-3 text-right font-medium text-muted-foreground sm:table-cell sm:p-4">
                    AWS Lightsail
                  </th>
                  <th className="p-3 text-right font-medium text-muted-foreground sm:p-4">
                    DO / Vultr / Linode
                  </th>
                  <th className="p-3 text-right font-medium sm:p-4">
                    You save
                  </th>
                </tr>
              </thead>
              <tbody>
                {PRICING_PRESETS.map((preset, idx) => {
                  const krova = priceMonthly(
                    preset.vcpus,
                    preset.ramGb,
                    preset.diskGb
                  );
                  return (
                    <tr
                      className="border-b last:border-0"
                      key={`${preset.vcpus}-${preset.ramGb}-${preset.diskGb}`}
                    >
                      <td className="p-3 font-medium sm:p-4">
                        {preset.vcpus} vCPU · {preset.ramGb} GB RAM ·{" "}
                        {preset.diskGb} GB
                      </td>
                      <td className="p-3 text-right font-mono font-semibold text-primary sm:p-4">
                        ${krova.toFixed(2)}
                      </td>
                      <td className="hidden p-3 text-right font-mono text-muted-foreground sm:table-cell sm:p-4">
                        ${preset.lightsail.toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-mono text-muted-foreground sm:p-4">
                        ${preset.competitor.toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-bold text-primary sm:p-4">
                        {PRESET_SAVINGS[idx]}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            All prices in USD per month, running 24/7 at competitors&apos;
            current published list prices. {productName} caps disk at 100 GB —
            competitors include 160–640 GB on larger plans, but most workloads
            use under 50 GB. Every competitor assigns each instance a public
            IPv4; a Cube has none.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <PitchCard
              body="No VPCs, no security groups, no IAM policies. Create a Cube, get an SSH connection, and you're done."
              title="Skip AWS complexity"
            />
            <PitchCard
              body="Hourly rates, billed by the minute. Run a Cube for 5 minutes and you pay for 5 minutes — never rounded up to the hour. Sleep it and only disk keeps billing."
              title="Pay by the minute"
            />
            <PitchCard
              body="Node.js APIs, AI agents, automation, side projects — sustained workloads, not just bursty serverless."
              title="Built for real workloads"
            />
          </div>
        </div>
      </section>

      <div className="border-t" />

      {/* Plans */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Plans
            </h2>
            <p className="mt-4 text-muted-foreground">
              Start free. Subscribe to a plan for monthly credit and higher
              limits. Pay only while your Cubes are running — billed by the
              minute.
            </p>
          </div>

          {publicPlans.length > 0 && (
            <div
              className={`mx-auto mt-12 grid gap-4 ${
                publicPlans.length === 1
                  ? "max-w-sm"
                  : publicPlans.length === 2
                    ? "max-w-3xl sm:grid-cols-2"
                    : publicPlans.length === 3
                      ? "max-w-5xl sm:grid-cols-2 lg:grid-cols-3"
                      : "sm:grid-cols-2 lg:grid-cols-4"
              }`}
            >
              {publicPlans.map((plan) => (
                <PlanTierCard
                  key={plan.id}
                  plan={plan}
                  signedIn={!!session}
                  signupHref={primaryHref}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="border-t" />

      {/* Per-hour rates */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Per-hour usage rates
            </h2>
            <p className="mt-4 text-sm text-muted-foreground">
              Whichever plan you&apos;re on, this is how each running Cube
              consumes credit.
            </p>
          </div>

          <div className="mx-auto mt-8 max-w-xl">
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="text-xl">Per-Hour Rates</CardTitle>
                <CardDescription>
                  Quoted per hour, billed by the minute. Sleeping Cubes stop
                  accruing compute charges (no vCPU, no RAM) — only disk
                  continues, at the same per-GB rate on the full disk size.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="-mx-6 overflow-x-auto px-6">
                  <Table className="min-w-100">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Resource</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <CpuIcon
                              className="h-4 w-4 text-muted-foreground"
                              weight="duotone"
                            />
                            vCPU
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${VCPU_RATE.toFixed(4)}/hr per vCPU
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <MemoryIcon
                              className="h-4 w-4 text-muted-foreground"
                              weight="duotone"
                            />
                            RAM
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${RAM_RATE.toFixed(4)}/hr per GB
                          <span className="block text-xs text-muted-foreground">
                            Sold 1:1 with host RAM — no overselling
                          </span>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <HardDriveIcon
                              className="h-4 w-4 text-muted-foreground"
                              weight="duotone"
                            />
                            Disk
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${DISK_RATE.toFixed(4)}/hr per GB
                          <span className="block text-xs text-muted-foreground">
                            Sold 1:1 with host SSD — no overselling
                          </span>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <Separator />

                <div className="bg-muted/50 p-4">
                  <p className="text-sm font-medium text-muted-foreground">
                    Example: 1 vCPU + 2 GB RAM + 20 GB disk
                  </p>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="font-mono text-2xl font-bold">
                      ${EXAMPLE_HOURLY.toFixed(3)}
                    </span>
                    <span className="text-sm text-muted-foreground">/hr</span>
                  </div>
                  <p className="mt-1 font-mono text-sm text-muted-foreground">
                    ~${EXAMPLE_MONTHLY.toFixed(2)}/mo running 24/7
                  </p>
                </div>

                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <ShieldCheckIcon
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      weight="duotone"
                    />
                    <span>
                      ${creditGrant} free credit on sign-up — no card required
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ClockIcon
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      weight="duotone"
                    />
                    <span>
                      Billed by the minute — run 5 minutes, pay 5 minutes
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sizing catalog */}
          <div className="mx-auto mt-16 max-w-4xl">
            <div className="text-center">
              <h3 className="text-xl font-semibold tracking-tight">
                Common Cube sizes
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Custom-sized — pick any vCPU, RAM, and disk combination. Here
                are the popular presets, with the volume-tier discount applied
                automatically.
              </p>
            </div>
            <div className="mt-6 overflow-x-auto border bg-card">
              <Table className="min-w-160">
                <TableHeader>
                  <TableRow>
                    <TableHead>Size</TableHead>
                    <TableHead>vCPU</TableHead>
                    <TableHead>RAM</TableHead>
                    <TableHead>Disk</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Per hour</TableHead>
                    <TableHead className="text-right">Per month</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SIZING_CATALOG.map((p) => {
                    const tier = PRICING_TIERS.find(
                      (t) =>
                        p.vcpus >= t.minVcpus &&
                        (t.maxVcpus === null || p.vcpus <= t.maxVcpus)
                    );
                    const monthly = priceMonthly(p.vcpus, p.ramGb, p.diskGb);
                    const hourly = monthly / 730;
                    return (
                      <TableRow
                        key={`${p.vcpus}-${p.ramGb}-${p.diskGb}-${p.label}`}
                      >
                        <TableCell className="font-medium">{p.label}</TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {p.vcpus}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {p.ramGb} GB
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {p.diskGb} GB
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {tier?.label ?? "—"}
                          {tier && tier.multiplier < 1
                            ? ` (${Math.round((1 - tier.multiplier) * 100)}% off)`
                            : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          ${hourly.toFixed(4)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums text-primary">
                          ${monthly.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Per-month estimate = hourly rate × 730 hours, running 24/7. Sleep
              a Cube and disk continues at the same per-GB rate while vCPU + RAM
              stop billing entirely. {CUBE_IMAGES.length} OS images available.
            </p>
          </div>
        </div>
      </section>

      <div className="border-t" />

      {/* No overselling */}
      <section className="bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <Reveal>
            <div className="border bg-card p-8 sm:p-10">
              <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start sm:gap-8">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-primary/10">
                  <ScalesIcon
                    className="h-6 w-6 text-primary"
                    weight="duotone"
                  />
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                    No overselling. Ever.
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    Most cheap VPS providers oversell — they sell more RAM and
                    disk than the host actually has, betting customers
                    won&apos;t use all of it. When workloads spike, you pay the
                    price: thrashed RAM, evicted pages, throttled I/O, and your
                    app slows to a crawl right when you need it most.
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {productName} is different. Every GB of RAM and every GB of
                    disk you provision is reserved 1:1 on the bare-metal host.
                    Your 4 GB Cube has 4 GB of physical ECC RAM dedicated to it.
                    Your 40 GB disk allocation occupies 40 GB of real
                    enterprise-grade NVMe — no thin provisioning, no surprise
                    out-of-disk errors.
                  </p>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="border bg-background p-4">
                      <MemoryIcon
                        className="h-5 w-5 text-primary"
                        weight="duotone"
                      />
                      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-primary">
                        RAM
                      </p>
                      <p className="mt-1 text-sm text-foreground">
                        Sold 1:1 with host ECC RAM. Dedicated to your Cube.
                        Never oversold.
                      </p>
                    </div>
                    <div className="border bg-background p-4">
                      <HardDriveIcon
                        className="h-5 w-5 text-primary"
                        weight="duotone"
                      />
                      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-primary">
                        Disk
                      </p>
                      <p className="mt-1 text-sm text-foreground">
                        Sold 1:1 with host NVMe. Real bytes on real disk. Never
                        oversold.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 sm:py-24 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Start free. Pay by the minute.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            ${creditGrant} of credit on sign-up, no card required. Launch a Cube
            and SSH in within a minute.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={primaryHref}>
                {session
                  ? "Go to Dashboard"
                  : `Start with $${creditGrant} free`}
                <ArrowRightIcon className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/security">How isolation works</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PitchCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="border bg-card p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

interface PublicPlan {
  allowOverage: boolean;
  allowTopup: boolean;
  description: string | null;
  id: string;
  includedCreditUsd: number;
  isDefaultForNewSpaces: boolean;
  maxBackups: number | null;
  maxConcurrentCubes: number | null;
  maxDiskGb: number;
  maxDomains: number | null;
  maxRamMb: number;
  maxSeats: number | null;
  maxVcpus: number;
  name: string;
  priceUsd: number;
}

function PlanTierCard({
  plan,
  signupHref,
  signedIn,
}: {
  plan: PublicPlan;
  signupHref: string;
  signedIn: boolean;
}) {
  const fmt = (n: number | null, suffix = "") =>
    n === null ? "Unlimited" : `${n}${suffix}`;
  const ramGb = Math.round((plan.maxRamMb / 1024) * 10) / 10;
  const featured = plan.isDefaultForNewSpaces;
  return (
    <Card
      className={`flex h-full flex-col ${
        featured ? "border-primary/60 shadow-md ring-1 ring-primary/30" : ""
      }`}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{plan.name}</CardTitle>
          {featured && (
            <Badge className="text-[10px]" variant="secondary">
              Start here
            </Badge>
          )}
        </div>
        <CardDescription>
          {plan.description ??
            (plan.priceUsd === 0
              ? "Try Krova free — no card required."
              : "Monthly credit + room to grow.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-3xl font-bold">
              ${plan.priceUsd.toFixed(plan.priceUsd % 1 === 0 ? 0 : 2)}
            </span>
            <span className="text-sm text-muted-foreground">/mo</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {plan.priceUsd === 0
              ? `$${plan.includedCreditUsd.toFixed(0)} free starter credit, then pay-as-you-go`
              : `$${plan.includedCreditUsd.toFixed(0)} credit included each month`}
          </p>
        </div>

        <ul className="space-y-2 text-sm">
          <PlanFeatureRow
            label="Cubes running at once"
            value={fmt(plan.maxConcurrentCubes)}
          />
          <PlanFeatureRow
            label="Max Cube size"
            value={`${plan.maxVcpus} vCPU · ${ramGb} GB RAM · ${plan.maxDiskGb} GB disk`}
          />
          <PlanFeatureRow label="Team seats" value={fmt(plan.maxSeats)} />
          <PlanFeatureRow label="Backups" value={fmt(plan.maxBackups)} />
          <PlanFeatureRow label="Custom domains" value={fmt(plan.maxDomains)} />
          <PlanFeatureRow
            label="Top up & overage"
            value={
              plan.allowTopup && plan.allowOverage
                ? "Included"
                : plan.allowTopup
                  ? "Top up only"
                  : "Not available"
            }
          />
        </ul>

        <Button
          asChild
          className="mt-auto w-full"
          variant={featured ? "default" : "outline"}
        >
          <Link href={signupHref}>
            {signedIn
              ? "Go to Dashboard"
              : plan.priceUsd === 0
                ? "Start free"
                : `Choose ${plan.name}`}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function PlanFeatureRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-start gap-2">
      <CheckIcon
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
        weight="bold"
      />
      <span className="flex-1 text-muted-foreground">
        <span className="text-foreground">{value}</span> {label.toLowerCase()}
      </span>
    </li>
  );
}
