import { count } from "drizzle-orm";
import { BillingOverview } from "@/components/orbit/billing-overview";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { getBillingSummary } from "@/lib/billing";
import { getCreditRates, getCreditRateTiers } from "@/lib/cost";
import { db } from "@/lib/db";

export default async function BillingPage() {
  const [summary, totalSpacesCounts] = await Promise.all([
    getBillingSummary(),
    db.select({ count: count() }).from(schema.spaces),
  ]);

  const rates = getCreditRates();
  const tiers = getCreditRateTiers();
  const totalSpacesCount = totalSpacesCounts[0];

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Billing</PageHeaderTitle>
          <PageHeaderDescription>
            Platform-wide billing overview and credit rate configuration.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <BillingOverview
        rates={rates}
        tiers={tiers}
        totalConsumed={summary.totalCharged}
        totalFreeGrants={summary.totalGrants}
        totalGranted={summary.totalCredited}
        totalPlanCredits={summary.totalPlanCredits}
        totalSpaces={totalSpacesCount?.count ?? 0}
        totalTopups={summary.totalTopups}
      />
    </div>
  );
}
