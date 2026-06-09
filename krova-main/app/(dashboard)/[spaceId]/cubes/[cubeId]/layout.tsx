import { CubeDetailShell } from "@/components/cube-detail-shell";
import { DISK_RATE, RAM_RATE, VCPU_RATE } from "@/config/platform";
import {
  calculateHourlyCost,
  calculateSleepHourlyCost,
  getCreditRateTiers,
  getTierMultiplier,
} from "@/lib/cost";
import { loadCubeContext } from "@/lib/cubes/load-cube-context";
import { loadEffectiveLimits, toClientLimits } from "@/lib/plan/limits";
import { getPlatformSettings } from "@/lib/platform-settings";
import { serverConnectDomain } from "@/lib/server/server-hostnames";
import { getStorageCapabilities } from "@/lib/storage/capabilities";

// Cube state changes via the worker (pending → booting → running). Without
// force-dynamic, Next.js can serve a cached snapshot of this layout on
// router.refresh() and the operator sees stale state until full reload.
export const dynamic = "force-dynamic";

export default async function CubeDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ spaceId: string; cubeId: string }>;
}) {
  const { spaceId, cubeId } = await params;
  const ctx = await loadCubeContext(spaceId, cubeId);
  const effective = await loadEffectiveLimits(spaceId);
  const planLimits = toClientLimits(effective);
  // Trial (maxBackups=0) hides the "Preserve backup" checkbox; paid plans
  // default it checked. `null` (unlimited) on Business still allows
  // backups.
  const planAllowsBackups =
    effective.maxBackups === null || effective.maxBackups > 0;
  const storageCapabilities = await getStorageCapabilities();

  const tiers = getCreditRateTiers();
  const multiplier = getTierMultiplier(ctx.cube.vcpus, tiers);

  // Per-status hourly cost. A SLEEPING cube doesn't pay vCPU/RAM and pays
  // on the FULL disk size (Rule 53). A RUNNING cube pays the full compute
  // formula. ERROR / pending / booting / stopping cubes pay nothing right
  // now — we show the rate they WOULD pay once running so the customer
  // knows what to expect. The sidebar picks the displayed value + label
  // off `cube.status`.
  const runningHourlyCost = calculateHourlyCost(
    {
      vcpus: ctx.cube.vcpus,
      ramMb: ctx.cube.ramMb,
      diskLimitGb: ctx.cube.diskLimitGb,
    },
    {
      vcpuRate: VCPU_RATE,
      ramRate: RAM_RATE,
      diskRate: DISK_RATE,
    },
    multiplier
  );
  const sleepHourlyCost = calculateSleepHourlyCost(
    { diskLimitGb: ctx.cube.diskLimitGb },
    { diskRate: DISK_RATE },
    multiplier
  );

  // Backup-storage estimate for the "Preserve backup before deleting"
  // dialog — uses the backup-storage rate (NOT the compute disk rate) on
  // the FULL disk size. This is an upper-bound estimate: actual billing
  // uses the compressed `.cube` `sizeBytes` which is typically 30-50% of
  // `diskLimitGb`, so the real cost lands lower.
  const platformSettings = await getPlatformSettings();
  const backupStorageCostPerHour =
    (ctx.cube.diskLimitGb * platformSettings.backupStorageRatePerGbPerMonth) /
    730;

  return (
    <CubeDetailShell
      backupStorageCostPerHour={backupStorageCostPerHour}
      cube={{
        ...ctx.cube,
        createdAt: ctx.cube.createdAt.toISOString(),
        updatedAt: ctx.cube.updatedAt.toISOString(),
        lastReachabilityAt: ctx.cube.lastReachabilityAt?.toISOString() ?? null,
      }}
      permissions={ctx.permissions}
      planAllowsBackups={planAllowsBackups}
      planLimits={planLimits}
      region={ctx.region}
      runningHourlyCost={runningHourlyCost}
      server={
        ctx.server
          ? {
              hostname: ctx.server.hostname,
              serverDomain: serverConnectDomain(ctx.server.hostname),
              publicIp: ctx.server.publicIp,
              currentKernelVersion: ctx.server.currentKernelVersion,
            }
          : null
      }
      sleepHourlyCost={sleepHourlyCost}
      spaceId={spaceId}
      storageCapabilities={storageCapabilities}
    >
      {children}
    </CubeDetailShell>
  );
}
