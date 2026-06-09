"use client";

import { BroomIcon } from "@phosphor-icons/react";
import { format, formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { FilterDropdown } from "@/components/filter-dropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Spinner } from "@/components/ui/spinner";
import { useMutation } from "@/hooks/use-mutation";
import {
  cloudflareStatusVariant,
  DOMAIN_STATUS_OPTIONS,
  type DomainStatus,
  domainStatusVariant,
} from "@/lib/status-display";

interface DomainRow {
  cloudflareHostnameId: string | null;
  cloudflareStatus: string | null;
  createdAt: Date;
  cubeId: string;
  cubeName: string;
  domain: string;
  id: string;
  port: number | null;
  serverHostname: string;
  spaceId: string | null;
  spaceName: string;
  status: DomainStatus;
  verificationStatus: "pending_dns" | "verified" | "failed";
}

export function DomainsTable({ domains }: { domains: DomainRow[] }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { trigger: triggerPurge } = useMutation({ revalidate: false });
  const [purgeTarget, setPurgeTarget] = useState<DomainRow | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);

  const filtered = domains.filter(
    (d) => statusFilter === "all" || d.status === statusFilter
  );

  async function handlePurgeConfirm() {
    if (!purgeTarget) {
      return;
    }
    const target = purgeTarget;
    setPurgeTarget(null);
    setPurgingId(target.id);
    const result = await triggerPurge({
      url: `/api/orbit/domains/${target.id}/purge-cache`,
      method: "POST",
      errorMessage: "Failed to clear cache",
    });
    setPurgingId(null);
    if (result !== null) {
      toast.success(`Cache clear requested for ${target.domain}`);
    }
  }

  return (
    <>
      <DataTable
        columns={[
          {
            id: "domain",
            header: "Domain",
            className: "font-mono",
            cell: (d) => d.domain,
          },
          {
            id: "cube",
            header: "Cube",
            cell: (d) => (
              <Link
                className="text-primary hover:underline"
                href={`/orbit/cubes/${d.cubeId}`}
              >
                {d.cubeName}
              </Link>
            ),
          },
          {
            id: "space",
            header: "Space",
            cell: (d) =>
              d.spaceId ? (
                <Link
                  className="text-primary hover:underline"
                  href={`/orbit/spaces/${d.spaceId}`}
                >
                  {d.spaceName}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            id: "server",
            header: "Server",
            className: "text-muted-foreground",
            cell: (d) => d.serverHostname,
          },
          {
            id: "port",
            header: "Port",
            className: "font-mono tabular-nums",
            cell: (d) => d.port ?? "—",
          },
          {
            id: "routing",
            header: "Routing",
            cell: (d) => (
              <Badge variant={domainStatusVariant(d.status)}>{d.status}</Badge>
            ),
          },
          {
            id: "cloudflare",
            header: "Cloudflare",
            cell: (d) => (
              <Badge variant={cloudflareStatusVariant(d.cloudflareStatus)}>
                {d.cloudflareStatus ?? "—"}
              </Badge>
            ),
          },
          {
            id: "added",
            header: "Added",
            className: "text-muted-foreground",
            cell: (d) => (
              <span title={format(d.createdAt, "PPpp")}>
                {formatDistanceToNow(d.createdAt, { addSuffix: true })}
              </span>
            ),
          },
          {
            id: "actions",
            header: <span className="sr-only">Actions</span>,
            className: "text-right",
            cell: (d) =>
              d.cloudflareStatus === "active" ? (
                <Button
                  disabled={purgingId === d.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPurgeTarget(d);
                  }}
                  size="sm"
                  title="Clear Cloudflare edge cache for this domain"
                  variant="ghost"
                >
                  {purgingId === d.id ? (
                    <Spinner className="size-4" />
                  ) : (
                    <BroomIcon className="size-4" />
                  )}
                  Clear cache
                </Button>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
        ]}
        data={filtered}
        emptyDescription={
          statusFilter === "all"
            ? "No customer has added a custom domain yet."
            : "Try adjusting your filter."
        }
        emptyTitle="No custom domains"
        onRowClick={(d) => router.push(`/orbit/domains/${d.id}`)}
        rowKey={(d) => d.id}
        searchAccessor={(d) =>
          `${d.domain} ${d.cubeName} ${d.spaceName} ${d.serverHostname}`
        }
        searchPlaceholder="Search domains..."
        toolbarRight={
          <FilterDropdown
            label="Status"
            onChange={setStatusFilter}
            options={DOMAIN_STATUS_OPTIONS}
            value={statusFilter}
          />
        }
      />
      <ConfirmActionDialog
        confirmLabel="Clear cache"
        description={
          <p>
            Clear the Cloudflare edge cache for{" "}
            <strong className="text-foreground">{purgeTarget?.domain}</strong>?
            Visitors get fresh content on their next request. This affects only
            this domain.
          </p>
        }
        destructive={false}
        onConfirm={handlePurgeConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setPurgeTarget(null);
          }
        }}
        open={!!purgeTarget}
        title="Clear cache"
      />
    </>
  );
}
