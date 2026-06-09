/**
 * Orbit plan-detail page. Server component — loads the plan row, its
 * assigned-space rows (custom plans only), and a candidate list of spaces
 * not yet assigned (also custom only) for the "Add space" sheet. Edit is
 * driven from the page header action bar (`<PlanActionsBar />`) which opens
 * the same `<PlanFormSheet />` the create flow uses.
 *
 * Admin auth is enforced by the surrounding `(orbit)/layout.tsx` redirect.
 */

import { and, count, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignedSpacesCard } from "@/app/(orbit)/orbit/plans/[planId]/_components/assigned-spaces-card";
import { PlanActionsBar } from "@/app/(orbit)/orbit/plans/[planId]/_components/plan-actions-bar";
import { paymentBreakdown } from "@/components/billing/topup-math";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import * as schema from "@/db/schema";
import { formatRam } from "@/lib/cube-options";
import { db } from "@/lib/db";
import { getPlanStatus } from "@/lib/plan-status";
import { getPlatformSettings } from "@/lib/platform-settings";

export const dynamic = "force-dynamic";

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .limit(1);
  if (!plan) {
    notFound();
  }

  const priceUsd = Number.parseFloat(plan.priceUsd);
  const includedUsd = Number.parseFloat(plan.includedCreditUsd);
  const settings = await getPlatformSettings();
  const breakdown =
    priceUsd > 0
      ? paymentBreakdown(priceUsd, {
          percent: settings.paymentFeePercent,
          flatUsd: settings.paymentFeeFlatUsd,
        })
      : null;

  // Active subscriber count for this plan. Used by the edit form's price-
  // change pre-confirm dialog (Polar grandfathers existing subs at the old
  // price — operator needs to see the impact count before saving).
  const [{ n: subscriberCount }] = await db
    .select({ n: count() })
    .from(schema.spaces)
    .where(
      and(
        eq(schema.spaces.planId, planId),
        isNotNull(schema.spaces.providerSubscriptionId)
      )
    );

  // Assigned spaces — only meaningful for custom plans. Always queried; the
  // UI hides the card for public plans regardless of any (legacy) rows.
  const assignmentRows = await db
    .select({
      spaceId: schema.planSpaceVisibility.spaceId,
    })
    .from(schema.planSpaceVisibility)
    .where(eq(schema.planSpaceVisibility.planId, planId));
  const assignedSpaceIds = assignmentRows.map((r) => r.spaceId);

  const assignedSpaceRows =
    assignedSpaceIds.length === 0
      ? []
      : await db
          .select({
            id: schema.spaces.id,
            name: schema.spaces.name,
          })
          .from(schema.spaces)
          .where(inArray(schema.spaces.id, assignedSpaceIds));

  const assignedOwners =
    assignedSpaceIds.length === 0
      ? []
      : await db
          .select({
            spaceId: schema.spaceMemberships.spaceId,
            email: schema.user.email,
          })
          .from(schema.spaceMemberships)
          .innerJoin(
            schema.user,
            eq(schema.user.id, schema.spaceMemberships.userId)
          )
          .where(inArray(schema.spaceMemberships.spaceId, assignedSpaceIds));
  const ownerMap = new Map<string, string>();
  for (const row of assignedOwners) {
    if (!ownerMap.has(row.spaceId)) {
      ownerMap.set(row.spaceId, row.email);
    }
  }
  const assigned = assignedSpaceRows.map((s) => ({
    id: s.id,
    name: s.name,
    ownerEmail: ownerMap.get(s.id) ?? null,
  }));

  // Candidate list for the "Add space" sheet: every space NOT already
  // assigned. Only loaded for custom plans (the card is hidden for public
  // plans, and the query is unnecessary work).
  const availableSpaceRows =
    plan.visibility === "custom"
      ? assignedSpaceIds.length === 0
        ? await db
            .select({ id: schema.spaces.id, name: schema.spaces.name })
            .from(schema.spaces)
        : await db
            .select({ id: schema.spaces.id, name: schema.spaces.name })
            .from(schema.spaces)
            .where(notInArray(schema.spaces.id, assignedSpaceIds))
      : [];

  const availableSpaceIds = availableSpaceRows.map((s) => s.id);
  const availableOwners =
    availableSpaceIds.length === 0
      ? []
      : await db
          .select({
            spaceId: schema.spaceMemberships.spaceId,
            email: schema.user.email,
          })
          .from(schema.spaceMemberships)
          .innerJoin(
            schema.user,
            eq(schema.user.id, schema.spaceMemberships.userId)
          )
          .where(inArray(schema.spaceMemberships.spaceId, availableSpaceIds));
  const availableOwnerMap = new Map<string, string>();
  for (const row of availableOwners) {
    if (!availableOwnerMap.has(row.spaceId)) {
      availableOwnerMap.set(row.spaceId, row.email);
    }
  }
  const availableSpaces = availableSpaceRows
    .map((s) => ({
      id: s.id,
      name: s.name,
      ownerEmail: availableOwnerMap.get(s.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            className="transition-colors hover:text-foreground"
            href="/orbit/plans"
          >
            Plans
          </Link>
          <span>/</span>
          <span>{plan.name}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {plan.name}
            </h1>
            {(() => {
              // Single status pill — precedence + classes live in
              // `lib/plan-status.ts` so the plans list page stays in sync.
              const status = getPlanStatus({
                isArchived: plan.isArchived,
                isDefaultForNewSpaces: plan.isDefaultForNewSpaces,
                visibility: plan.visibility,
                priceUsd,
                polarProductId: plan.polarProductId,
              });
              return (
                <Badge className={status.className} variant="outline">
                  {status.label}
                </Badge>
              );
            })()}
          </div>
          <PlanActionsBar
            plan={{
              id: plan.id,
              name: plan.name,
              slug: plan.slug,
              description: plan.description,
              priceUsd: plan.priceUsd,
              includedCreditUsd: plan.includedCreditUsd,
              maxConcurrentCubes: plan.maxConcurrentCubes,
              maxVcpus: plan.maxVcpus,
              maxRamMb: plan.maxRamMb,
              maxDiskGb: plan.maxDiskGb,
              maxSeats: plan.maxSeats,
              maxBackups: plan.maxBackups,
              maxDomains: plan.maxDomains,
              allowTopup: plan.allowTopup,
              allowOverage: plan.allowOverage,
              autoSnapshotCadenceHours: plan.autoSnapshotCadenceHours,
              autoSnapshotKeepLast: plan.autoSnapshotKeepLast,
              autoSnapshotKeepDaily: plan.autoSnapshotKeepDaily,
              autoSnapshotKeepWeekly: plan.autoSnapshotKeepWeekly,
              maxManualSnapshotsPerCube: plan.maxManualSnapshotsPerCube,
              visibility: plan.visibility,
              sortOrder: plan.sortOrder,
              isDefaultForNewSpaces: plan.isDefaultForNewSpaces,
              isArchived: plan.isArchived,
              polarProductId: plan.polarProductId,
            }}
            subscriberCount={subscriberCount}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>
              {plan.description ?? "No description provided."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="Slug"
              value={<span className="font-mono">{plan.slug}</span>}
            />
            <Row
              label="Price"
              value={
                priceUsd === 0 ? (
                  "Free"
                ) : (
                  <span className="font-mono">
                    ${priceUsd.toFixed(2)} / month
                  </span>
                )
              }
            />
            {breakdown && (
              <Row
                label="Customer charge (incl. service fee)"
                value={
                  <span className="font-mono">
                    ${breakdown.totalUsd.toFixed(2)}
                  </span>
                }
              />
            )}
            <Row
              label="Included credit"
              value={
                <span className="font-mono">${includedUsd.toFixed(2)}</span>
              }
            />
            <Row label="Visibility" value={plan.visibility} />
            <Row label="Sort order" value={plan.sortOrder.toString()} />
            <Separator />
            <Row
              label="Polar product"
              value={
                plan.polarProductId ? (
                  <span className="font-mono text-xs">
                    {plan.polarProductId}
                  </span>
                ) : priceUsd > 0 ? (
                  <span className="text-destructive">Not provisioned</span>
                ) : (
                  <span className="text-muted-foreground">N/A (free plan)</span>
                )
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Limits</CardTitle>
            <CardDescription>
              The per-Cube ceilings and per-space caps applied to subscribers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Max vCPUs / Cube" value={plan.maxVcpus.toString()} />
            <Row label="Max RAM / Cube" value={formatRam(plan.maxRamMb)} />
            <Row label="Max disk / Cube" value={`${plan.maxDiskGb} GB`} />
            <Separator />
            <Row
              label="Max concurrent Cubes"
              value={nullableLabel(plan.maxConcurrentCubes)}
            />
            <Row label="Max seats" value={nullableLabel(plan.maxSeats)} />
            <Row label="Max backups" value={nullableLabel(plan.maxBackups)} />
            <Row
              label="Max custom domains"
              value={nullableLabel(plan.maxDomains)}
            />
            <Separator />
            <Row label="Allow top-up" value={plan.allowTopup ? "Yes" : "No"} />
            <Row
              label="Allow overage"
              value={plan.allowOverage ? "Yes" : "No"}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Snapshots</CardTitle>
          <CardDescription>
            Auto-snapshot cadence + retention buckets + manual cap. Auto cadence
            NULL disables auto-snapshots for this plan; pinned snapshots count
            against the manual cap.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row
            label="Auto cadence"
            value={
              plan.autoSnapshotCadenceHours == null
                ? "Disabled"
                : `Every ${plan.autoSnapshotCadenceHours}h`
            }
          />
          <Row label="Keep last" value={plan.autoSnapshotKeepLast.toString()} />
          <Row
            label="Keep daily"
            value={plan.autoSnapshotKeepDaily.toString()}
          />
          <Row
            label="Keep weekly"
            value={plan.autoSnapshotKeepWeekly.toString()}
          />
          <Separator />
          <Row
            label="Max manual / Cube"
            value={plan.maxManualSnapshotsPerCube.toString()}
          />
        </CardContent>
      </Card>

      {plan.visibility === "custom" && (
        <AssignedSpacesCard
          assigned={assigned}
          availableSpaces={availableSpaces}
          planId={plan.id}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  // Fixed label-column width so both side-by-side cards (Overview + Limits)
  // align vertically — previously the column shifted with each label's
  // intrinsic width which caused the right-aligned values to jitter between
  // cards (audit finding #15).
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-3">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function nullableLabel(value: number | null): string {
  if (value === null) {
    return "Unlimited";
  }
  return value.toString();
}
