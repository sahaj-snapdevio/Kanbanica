"use client";

import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { FilterDropdown } from "@/components/filter-dropdown";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  SUBSCRIPTION_STATUS_FILTER_OPTIONS,
  subscriptionStatusVariant,
} from "@/lib/status-display";

interface SpaceRow {
  createdAt: Date;
  creditBalance: number;
  cubeCount: number;
  id: string;
  name: string;
  ownerEmail: string;
  planId: string;
  planName: string;
  subscriptionStatus: string | null;
}

export function SpacesTable({ spaces }: { spaces: SpaceRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialStatus = searchParams.get("status");
  const [subscriptionFilter, setSubscriptionFilter] = useState<string>(
    initialStatus &&
      SUBSCRIPTION_STATUS_FILTER_OPTIONS.some((o) => o.value === initialStatus)
      ? initialStatus
      : "all"
  );
  const initialPlan = searchParams.get("plan");
  const [planFilter, setPlanFilter] = useState<string>(initialPlan ?? "all");

  const planOptions = [
    { value: "all", label: "All plans" },
    ...Array.from(
      new Map(spaces.map((s) => [s.planId, s.planName])).entries()
    ).map(([id, name]) => ({ value: id, label: name })),
  ];

  const filtered = spaces.filter((s) => {
    if (subscriptionFilter !== "all") {
      // Matches the Orbit dashboard's past_due chip semantics: the meta-value
      // includes both `past_due` and `unpaid` rows.
      if (subscriptionFilter === "past_due") {
        if (
          s.subscriptionStatus !== "past_due" &&
          s.subscriptionStatus !== "unpaid"
        ) {
          return false;
        }
      } else if (s.subscriptionStatus !== subscriptionFilter) {
        return false;
      }
    }
    if (planFilter !== "all" && s.planId !== planFilter) {
      return false;
    }
    return true;
  });

  const hasActiveFilters = subscriptionFilter !== "all" || planFilter !== "all";

  return (
    <DataTable
      columns={[
        {
          id: "name",
          header: "Name",
          className: "font-medium",
          cell: (space) => space.name,
        },
        {
          id: "owner",
          header: "Owner",
          className: "text-muted-foreground",
          cell: (space) => space.ownerEmail,
        },
        {
          id: "plan",
          header: "Plan",
          className: "text-muted-foreground",
          cell: (space) => space.planName,
        },
        {
          id: "subscription",
          header: "Subscription",
          cell: (space) =>
            space.subscriptionStatus ? (
              <Badge
                variant={subscriptionStatusVariant(space.subscriptionStatus)}
              >
                {space.subscriptionStatus}
              </Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        },
        {
          id: "credits",
          header: "Credits",
          numeric: true,
          cell: (space) => space.creditBalance.toFixed(2),
        },
        {
          id: "cubes",
          header: "Cubes",
          numeric: true,
          cell: (space) => space.cubeCount,
        },
        {
          id: "created",
          header: "Created",
          className: "text-muted-foreground",
          cell: (space) => format(space.createdAt, "MMM d, yyyy"),
        },
      ]}
      data={filtered}
      emptyDescription={
        hasActiveFilters
          ? "Try adjusting your filters."
          : "No spaces exist yet."
      }
      emptyTitle="No spaces found"
      onRowClick={(space) => router.push(`/orbit/spaces/${space.id}`)}
      rowKey={(space) => space.id}
      searchAccessor={(space) =>
        `${space.name} ${space.ownerEmail} ${space.planName}`
      }
      searchPlaceholder="Search spaces..."
      toolbarRight={
        <>
          <FilterDropdown
            label="Subscription"
            onChange={setSubscriptionFilter}
            options={[...SUBSCRIPTION_STATUS_FILTER_OPTIONS]}
            value={subscriptionFilter}
          />
          <FilterDropdown
            label="Plan"
            onChange={setPlanFilter}
            options={planOptions}
            value={planFilter}
          />
        </>
      }
    />
  );
}
