"use client";

import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ClockIcon,
  CpuIcon,
  CubeIcon,
  CurrencyDollarIcon,
  HardDriveIcon,
  MemoryIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  UsersIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import { isBillingDebit } from "@/lib/billing-events";
import { fmtUsd } from "@/lib/format";

interface SpaceDashboardProps {
  canCreate: boolean;
  creditBalance: number;
  cubeStats: {
    total: number;
    running: number;
    sleeping: number;
    error: number;
  };
  hourlyBurn: number;
  memberCount: number;
  recentEvents: {
    id: string;
    type: string;
    amount: number;
    description: string | null;
    createdAt: string;
  }[];
  resources: {
    vcpus: number;
    ramMb: number;
    diskGb: number;
  };
  spaceId: string;
  spaceName: string;
}

export function SpaceDashboard({
  spaceId,
  creditBalance,
  hourlyBurn,
  cubeStats,
  resources,
  recentEvents,
  canCreate,
  memberCount,
}: SpaceDashboardProps) {
  const monthlyBurn = hourlyBurn * 730;
  const daysRemaining =
    hourlyBurn > 0 ? Math.floor(creditBalance / (hourlyBurn * 24)) : null;

  const creditColor =
    creditBalance > 5
      ? "text-green-600 dark:text-green-400"
      : creditBalance >= 1
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";

  const ramDisplay =
    resources.ramMb >= 1024
      ? `${(resources.ramMb / 1024).toFixed(resources.ramMb % 1024 === 0 ? 0 : 1)} GB`
      : `${resources.ramMb} MB`;

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Dashboard</PageHeaderTitle>
          <PageHeaderDescription>Overview of your space.</PageHeaderDescription>
        </PageHeaderContent>
        {canCreate && (
          <PageHeaderActions>
            <Button asChild>
              <Link href={`/${spaceId}/cubes/new`}>
                <PlusIcon className="size-4" />
                Create Cube
              </Link>
            </Button>
          </PageHeaderActions>
        )}
      </PageHeader>

      {/* Top stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Credit Balance */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Credit Balance
            </CardTitle>
            <CurrencyDollarIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold tabular-nums ${creditColor}`}>
              ${fmtUsd(creditBalance)}
            </div>
            {daysRemaining !== null && (
              <p className="mt-1 text-xs text-muted-foreground">
                ~{daysRemaining} day{daysRemaining === 1 ? "" : "s"} remaining
              </p>
            )}
          </CardContent>
        </Card>

        {/* Cubes */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cubes
            </CardTitle>
            <CubeIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cubeStats.total}</div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              {cubeStats.running > 0 && (
                <span className="flex items-center gap-1">
                  <PlayIcon className="size-3 text-green-500" weight="fill" />
                  {cubeStats.running} running
                </span>
              )}
              {cubeStats.sleeping > 0 && (
                <span className="flex items-center gap-1">
                  <MoonIcon className="size-3 text-yellow-500" weight="fill" />
                  {cubeStats.sleeping} sleeping
                </span>
              )}
              {cubeStats.error > 0 && (
                <span className="flex items-center gap-1">
                  <WarningCircleIcon
                    className="size-3 text-red-500"
                    weight="fill"
                  />
                  {cubeStats.error} error
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Monthly Burn */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Monthly Estimate
            </CardTitle>
            <ClockIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              ${fmtUsd(monthlyBurn)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              ${fmtUsd(hourlyBurn, { precision: "rate" })}/hr
            </p>
          </CardContent>
        </Card>

        {/* Members */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Members
            </CardTitle>
            <UsersIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{memberCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {memberCount === 1 ? "Owner only" : `${memberCount} people`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bottom section: Resources + Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Resource Usage */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Resource Usage</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href={`/${spaceId}/cubes`}>
                View Cubes
                <ArrowRightIcon className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {cubeStats.running === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No running Cubes. Resources are shown for active Cubes only.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <ResourceCard
                  icon={<CpuIcon className="size-5" />}
                  label="vCPUs"
                  subtitle={`${resources.vcpus} vCPU${resources.vcpus === 1 ? "" : "s"} allocated`}
                  value={`${resources.vcpus}`}
                />
                <ResourceCard
                  icon={<MemoryIcon className="size-5" />}
                  label="RAM"
                  subtitle="allocated"
                  value={ramDisplay}
                />
                <ResourceCard
                  icon={<HardDriveIcon className="size-5" />}
                  label="Disk"
                  subtitle="allocated"
                  value={`${resources.diskGb} GB`}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Activity</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href={`/${spaceId}/billing`}>
                View All
                <ArrowRightIcon className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No billing events yet.
              </p>
            ) : (
              <div className="space-y-0">
                {recentEvents.map((event) => {
                  const isCharge = isBillingDebit(event.type);
                  return (
                    <div
                      className="flex items-center gap-3 border-b py-3 last:border-0"
                      key={event.id}
                    >
                      <div
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                          isCharge
                            ? "bg-red-500/10 text-red-500"
                            : "bg-green-500/10 text-green-500"
                        }`}
                      >
                        {isCharge ? (
                          <ArrowDownIcon className="size-3.5" weight="bold" />
                        ) : (
                          <ArrowUpIcon className="size-3.5" weight="bold" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {event.description ?? event.type.replace(/_/g, " ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(event.createdAt), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-medium tabular-nums ${
                          isCharge ? "text-red-500" : "text-green-500"
                        }`}
                      >
                        {isCharge ? "−" : "+"}$
                        {Math.abs(event.amount).toFixed(
                          event.amount < 0.01 ? 4 : 2
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResourceCard({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border bg-muted/30 p-4 text-center">
      <div className="mb-2 text-muted-foreground">{icon}</div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
