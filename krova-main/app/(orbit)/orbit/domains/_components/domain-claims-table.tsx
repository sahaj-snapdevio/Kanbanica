"use client";

import Link from "next/link";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  type DomainClaimStatus,
  domainClaimStatusVariant,
} from "@/lib/status-display";

interface ClaimRow {
  createdAt: string;
  domain: string;
  id: string;
  spaceId: string | null;
  spaceName: string;
  status: DomainClaimStatus;
  verifiedAt: string | null;
}

export function DomainClaimsTable({ claims }: { claims: ClaimRow[] }) {
  return (
    <DataTable
      columns={[
        {
          id: "domain",
          header: "Domain",
          className: "font-mono",
          cell: (c) => c.domain,
        },
        {
          id: "space",
          header: "Space",
          cell: (c) =>
            c.spaceId ? (
              <Link
                className="text-primary hover:underline"
                href={`/orbit/spaces/${c.spaceId}`}
              >
                {c.spaceName}
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        },
        {
          id: "status",
          header: "Status",
          cell: (c) => (
            <Badge variant={domainClaimStatusVariant(c.status)}>
              {c.status}
            </Badge>
          ),
        },
        {
          id: "verified",
          header: "Verified",
          className: "text-muted-foreground",
          cell: (c) =>
            c.verifiedAt ? (
              <LocalDate iso={c.verifiedAt} mode="relative" />
            ) : (
              "—"
            ),
        },
        {
          id: "created",
          header: "Created",
          className: "text-muted-foreground",
          cell: (c) => <LocalDate iso={c.createdAt} mode="relative" />,
        },
      ]}
      data={claims}
      emptyDescription="No space has locked a domain yet."
      emptyTitle="No domain claims"
      rowKey={(c) => c.id}
      searchAccessor={(c) => `${c.domain} ${c.spaceName}`}
      searchPlaceholder="Search claims..."
    />
  );
}
