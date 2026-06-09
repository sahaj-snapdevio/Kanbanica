"use client";

import { format, formatDistanceToNow, isPast } from "date-fns";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { FilterDropdown } from "@/components/filter-dropdown";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  SUBSCRIPTION_STATUS_FILTER_OPTIONS,
  subscriptionStatusVariant,
} from "@/lib/status-display";
import { truncateId } from "@/lib/utils";

interface SubscriptionRow {
  currentPeriodEnd: Date | null;
  mrrUsd: number;
  ownerEmail: string;
  paymentProvider: string | null;
  planId: string;
  planName: string;
  polarCustomerId: string | null;
  providerSubscriptionId: string | null;
  spaceId: string;
  spaceName: string;
  status: string;
  subscriptionEventAt: Date | null;
}

export function SubscriptionsTable({
  subscriptions,
}: {
  subscriptions: SubscriptionRow[];
}) {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status");
  // Past-due dashboard card links here with ?status=past_due — surface unpaid
  // too under that same filter so both terminal-ish states group together.
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatus &&
      SUBSCRIPTION_STATUS_FILTER_OPTIONS.some((o) => o.value === initialStatus)
      ? initialStatus
      : "all"
  );

  const filtered = subscriptions.filter((s) => {
    if (statusFilter === "all") {
      return true;
    }
    if (statusFilter === "past_due") {
      return s.status === "past_due" || s.status === "unpaid";
    }
    return s.status === statusFilter;
  });

  return (
    <DataTable
      columns={[
        {
          id: "space",
          header: "Space",
          className: "font-medium",
          cell: (s) => (
            <Link
              className="text-primary hover:underline"
              href={`/orbit/spaces/${s.spaceId}`}
            >
              {s.spaceName}
            </Link>
          ),
        },
        {
          id: "owner",
          header: "Owner",
          className: "text-muted-foreground",
          cell: (s) => s.ownerEmail,
        },
        {
          id: "plan",
          header: "Plan",
          cell: (s) => (
            <Link
              className="text-primary hover:underline"
              href={`/orbit/plans/${s.planId}`}
            >
              {s.planName}
            </Link>
          ),
        },
        {
          id: "status",
          header: "Status",
          cell: (s) => (
            <Badge variant={subscriptionStatusVariant(s.status)}>
              {s.status}
            </Badge>
          ),
        },
        {
          id: "mrr",
          header: "MRR",
          numeric: true,
          cell: (s) => `$${s.mrrUsd.toFixed(2)}`,
        },
        {
          id: "period-end",
          header: "Period end",
          cell: (s) => {
            const periodEnd = s.currentPeriodEnd;
            const periodEndPast = periodEnd ? isPast(periodEnd) : false;
            return (
              <span
                className={
                  periodEndPast ? "text-destructive" : "text-muted-foreground"
                }
                title={periodEnd ? format(periodEnd, "PPpp") : undefined}
              >
                {periodEnd
                  ? formatDistanceToNow(periodEnd, { addSuffix: true })
                  : "—"}
              </span>
            );
          },
        },
        {
          id: "customer",
          header: "Customer",
          cell: (s) => (
            <div className="flex items-center gap-1">
              <span className="font-mono text-xs text-muted-foreground">
                {truncateId(s.polarCustomerId)}
              </span>
              {s.polarCustomerId && <CopyButton value={s.polarCustomerId} />}
            </div>
          ),
        },
        {
          id: "subscription",
          header: "Subscription",
          cell: (s) => (
            <div className="flex items-center gap-1">
              <span className="font-mono text-xs text-muted-foreground">
                {truncateId(s.providerSubscriptionId)}
              </span>
              {s.providerSubscriptionId && (
                <CopyButton value={s.providerSubscriptionId} />
              )}
            </div>
          ),
        },
      ]}
      data={filtered}
      emptyDescription={
        statusFilter === "all"
          ? "No spaces have an active provider subscription yet."
          : "Try adjusting your filter."
      }
      emptyTitle="No subscriptions found"
      rowKey={(s) => s.spaceId}
      searchAccessor={(s) => `${s.spaceName} ${s.ownerEmail} ${s.planName}`}
      searchPlaceholder="Search subscriptions..."
      toolbarRight={
        <FilterDropdown
          label="Status"
          onChange={setStatusFilter}
          options={[...SUBSCRIPTION_STATUS_FILTER_OPTIONS]}
          value={statusFilter}
        />
      }
    />
  );
}
