/**
 * Orbit Platform Settings page. Server component — loads the singleton row
 * from `platform_settings` and hands the parsed values to the client form.
 *
 * Admin auth is enforced by the surrounding `(orbit)/layout.tsx` redirect.
 * The `updatePlatformSettings` server action re-checks admin server-side.
 */

import { eq } from "drizzle-orm";
import { DiskQosTiersForm } from "@/app/(orbit)/orbit/platform-settings/_components/disk-qos-tiers-form";
import { PlatformSettingsForm } from "@/app/(orbit)/orbit/platform-settings/_components/platform-settings-form";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import { DISK_RATE_LIMITER_TIERS } from "@/config/platform";
import * as schema from "@/db/schema";
import { getDiskQosTiers } from "@/lib/cubes/disk-qos-tiers";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PlatformSettingsPage() {
  const [row] = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, 1))
    .limit(1);

  if (!row) {
    return (
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Platform settings</PageHeaderTitle>
          <PageHeaderDescription className="text-destructive">
            The platform_settings singleton row is missing. Migration 0037 must
            run before this page can load.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
    );
  }

  const qosTiers = await getDiskQosTiers();

  return (
    <div className="space-y-6">
      <PlatformSettingsForm
        initial={{
          paymentFeePercent: Number.parseFloat(row.paymentFeePercent),
          paymentFeeFlatUsd: Number.parseFloat(row.paymentFeeFlatUsd),
          creditTopupMinUsd: Number.parseFloat(row.creditTopupMinUsd),
          creditTopupMaxUsd: Number.parseFloat(row.creditTopupMaxUsd),
          creditTopupDefaultUsd: Number.parseFloat(row.creditTopupDefaultUsd),
          overageCapMinUsd: Number.parseFloat(row.overageCapMinUsd),
          overageCapMaxUsd: Number.parseFloat(row.overageCapMaxUsd),
          overageDefaultCapMultiplier: Number.parseFloat(
            row.overageDefaultCapMultiplier
          ),
          planCreditGrantCooldownDays: row.planCreditGrantCooldownDays,
          lowBalanceThresholdDefaultUsd: Number.parseFloat(
            row.lowBalanceThresholdDefaultUsd
          ),
          lowBalanceThresholdMinUsd: Number.parseFloat(
            row.lowBalanceThresholdMinUsd
          ),
          polarCreditProductId: row.polarCreditProductId,
          polarOverageMeterId: row.polarOverageMeterId,
          backupStorageRatePerGbPerMonth: Number.parseFloat(
            row.backupStorageRatePerGbPerMonth
          ),
          updatedAt: row.updatedAt,
        }}
      />
      <DiskQosTiersForm defaults={DISK_RATE_LIMITER_TIERS} initial={qosTiers} />
    </div>
  );
}
