"use client";

import { format, formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { FilterDropdown } from "@/components/filter-dropdown";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  CREDIT_PURCHASE_STATUS_OPTIONS,
  type CreditPurchaseStatus,
  creditPurchaseStatusVariant,
} from "@/lib/status-display";
import { truncateId } from "@/lib/utils";

interface PurchaseRow {
  amount: number;
  createdAt: Date;
  id: string;
  initiatedByEmail: string | null;
  paidAt: Date | null;
  paymentProvider: string;
  providerCheckoutId: string | null;
  providerOrderId: string | null;
  refundedAmount: number;
  spaceId: string;
  spaceName: string;
  status: CreditPurchaseStatus;
  surchargeAmount: number;
}

export function CreditPurchasesTable({
  purchases,
}: {
  purchases: PurchaseRow[];
}) {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status");
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatus &&
      CREDIT_PURCHASE_STATUS_OPTIONS.some((o) => o.value === initialStatus)
      ? initialStatus
      : "all"
  );

  const filtered = purchases.filter(
    (p) => statusFilter === "all" || p.status === statusFilter
  );

  return (
    <DataTable
      columns={[
        {
          id: "created",
          header: "Created",
          className: "text-muted-foreground",
          cell: (p) => (
            <span title={format(p.createdAt, "PPpp")}>
              {formatDistanceToNow(p.createdAt, { addSuffix: true })}
            </span>
          ),
        },
        {
          id: "space",
          header: "Space",
          cell: (p) => (
            <Link
              className="text-primary hover:underline"
              href={`/orbit/spaces/${p.spaceId}`}
            >
              {p.spaceName}
            </Link>
          ),
        },
        {
          id: "by",
          header: "By",
          className: "text-muted-foreground",
          cell: (p) => p.initiatedByEmail ?? "—",
        },
        {
          id: "base",
          header: "Base",
          numeric: true,
          cell: (p) => `$${p.amount.toFixed(2)}`,
        },
        {
          id: "fee",
          header: "Fee",
          numeric: true,
          className: "text-muted-foreground",
          cell: (p) => `$${p.surchargeAmount.toFixed(2)}`,
        },
        {
          id: "total",
          header: "Total",
          numeric: true,
          className: "font-medium",
          cell: (p) => `$${(p.amount + p.surchargeAmount).toFixed(2)}`,
        },
        {
          id: "status",
          header: "Status",
          cell: (p) => (
            <Badge variant={creditPurchaseStatusVariant(p.status)}>
              {p.status}
            </Badge>
          ),
        },
        {
          id: "refunded",
          header: "Refunded",
          numeric: true,
          cell: (p) =>
            p.refundedAmount > 0 ? `$${p.refundedAmount.toFixed(2)}` : "—",
        },
        {
          id: "order",
          header: "Order id",
          cell: (p) => (
            <div className="flex items-center gap-1">
              <span className="font-mono text-xs text-muted-foreground">
                {truncateId(p.providerOrderId)}
              </span>
              {p.providerOrderId && <CopyButton value={p.providerOrderId} />}
            </div>
          ),
        },
      ]}
      data={filtered}
      emptyDescription={
        statusFilter === "all"
          ? "No customer has bought prepaid credit yet."
          : "Try adjusting your filter."
      }
      emptyTitle="No credit purchases"
      rowKey={(p) => p.id}
      searchAccessor={(p) =>
        `${p.spaceName} ${p.initiatedByEmail ?? ""} ${p.providerOrderId ?? ""}`
      }
      searchPlaceholder="Search purchases..."
      toolbarRight={
        <FilterDropdown
          label="Status"
          onChange={setStatusFilter}
          options={CREDIT_PURCHASE_STATUS_OPTIONS}
          value={statusFilter}
        />
      }
    />
  );
}
