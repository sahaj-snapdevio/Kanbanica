import {
  ArchiveIcon,
  CameraIcon,
  ClockIcon,
  DatabaseIcon,
  DesktopIcon,
  GlobeIcon,
  HardDriveIcon,
  LightningIcon,
  MoonIcon,
  PackageIcon,
  ReceiptIcon,
  UserIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { and, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import Link from "next/link";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrbitDashboardPage() {
  // Query all metrics in parallel so the dashboard render isn't gated on
  // the slowest count. Every count is bounded — no group-by, no scan.
  const [
    userCount,
    spaceCount,
    cubeCount,
    serverCount,
    backupCount,
    storageBackendCount,
    snapshotCount,
    activeSubscriptionCount,
    pastDueSubscriptionCount,
    pendingTopupCount,
    runningCubeCount,
    sleepingCubeCount,
    errorCubeCount,
    customDomainCount,
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(schema.user)
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.spaces)
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.cubes)
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.servers)
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.cubeBackups)
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.storageBackends)
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.cubeSnapshots)
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.spaces)
      .where(eq(schema.spaces.subscriptionStatus, "active"))
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.spaces)
      .where(inArray(schema.spaces.subscriptionStatus, ["past_due", "unpaid"]))
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.creditPurchases)
      .where(eq(schema.creditPurchases.status, "pending"))
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.cubes)
      .where(eq(schema.cubes.status, "running"))
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.cubes)
      .where(eq(schema.cubes.status, "sleeping"))
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.cubes)
      .where(eq(schema.cubes.status, "error"))
      .then((res) => Number(res[0]?.count ?? 0)),
    db
      .select({ count: count() })
      .from(schema.domainMappings)
      .then((res) => Number(res[0]?.count ?? 0)),
  ]);

  // Unreported overage backlog — only meaningful when > 0. Surfaces stale
  // `polar_meter_reported_at IS NULL` rows older than 5 minutes that the
  // `polar.meter-reconcile` cron hasn't picked up yet. Reused below as the
  // optional 13th card when it's non-zero.
  const [meterBacklogRow] = await db
    .select({ count: count() })
    .from(schema.billingEvents)
    .where(
      and(
        eq(schema.billingEvents.type, "overage_charge"),
        isNull(schema.billingEvents.polarMeterReportedAt),
        lt(schema.billingEvents.createdAt, sql`now() - interval '5 minutes'`)
      )
    );
  const meterBacklog = Number(meterBacklogRow?.count ?? 0);

  const metrics: {
    label: string;
    value: number;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    warn?: boolean;
  }[] = [
    {
      label: "Users",
      value: userCount,
      href: "/orbit/users",
      icon: UserIcon,
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    {
      label: "Spaces",
      value: spaceCount,
      href: "/orbit/spaces",
      icon: DatabaseIcon,
      color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    },
    {
      label: "Cubes",
      value: cubeCount,
      href: "/orbit/cubes",
      icon: PackageIcon,
      color: "bg-green-500/10 text-green-600 dark:text-green-400",
    },
    {
      label: "Running cubes",
      value: runningCubeCount,
      href: "/orbit/cubes?status=running",
      icon: LightningIcon,
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Sleeping cubes",
      value: sleepingCubeCount,
      href: "/orbit/cubes?status=sleeping",
      icon: MoonIcon,
      color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    },
    {
      label: "Error cubes",
      value: errorCubeCount,
      href: "/orbit/cubes?status=error",
      icon: WarningCircleIcon,
      color:
        errorCubeCount > 0
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-slate-500/10 text-slate-600 dark:text-slate-400",
      warn: errorCubeCount > 0,
    },
    {
      label: "Servers",
      value: serverCount,
      href: "/orbit/servers",
      icon: DesktopIcon,
      color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    },
    {
      label: "Storage backends",
      value: storageBackendCount,
      href: "/orbit/storage",
      icon: HardDriveIcon,
      color: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
    },
    {
      label: "Backups",
      value: backupCount,
      href: "/orbit/backups",
      icon: ArchiveIcon,
      color: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    },
    {
      label: "Snapshots",
      value: snapshotCount,
      href: "/orbit/snapshots",
      icon: CameraIcon,
      color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    },
    {
      label: "Active subscriptions",
      value: activeSubscriptionCount,
      href: "/orbit/subscriptions?status=active",
      icon: ReceiptIcon,
      color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    },
    {
      label: "Past-due subscriptions",
      value: pastDueSubscriptionCount,
      href: "/orbit/subscriptions?status=past_due",
      icon: WarningCircleIcon,
      color:
        pastDueSubscriptionCount > 0
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-slate-500/10 text-slate-600 dark:text-slate-400",
      warn: pastDueSubscriptionCount > 0,
    },
    {
      label: "Pending top-ups",
      value: pendingTopupCount,
      href: "/orbit/credit-purchases?status=pending",
      icon: ClockIcon,
      color:
        pendingTopupCount > 0
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-slate-500/10 text-slate-600 dark:text-slate-400",
      warn: pendingTopupCount > 0,
    },
    {
      label: "Custom domains",
      value: customDomainCount,
      href: "/orbit/domains",
      icon: GlobeIcon,
      color: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
    },
  ];

  // Health-signal card — only renders when the meter-reconcile backlog is
  // non-zero, so the dashboard stays calm under normal conditions.
  if (meterBacklog > 0) {
    metrics.push({
      label: "Unreported overage",
      value: meterBacklog,
      href: "/orbit/queues",
      icon: WarningCircleIcon,
      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      warn: true,
    });
  }

  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle className="text-3xl">Dashboard</PageHeaderTitle>
          <PageHeaderDescription>
            System overview and key metrics.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Link className="group" href={metric.href} key={metric.label}>
              <div
                className={`cursor-pointer rounded-lg border bg-card p-6 transition-shadow hover:shadow-md ${
                  metric.warn
                    ? "border-amber-500/40 dark:border-amber-400/50"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {metric.label}
                    </p>
                    <p className="mt-2 text-3xl font-bold">{metric.value}</p>
                  </div>
                  <div className={`rounded-lg p-3 ${metric.color}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
