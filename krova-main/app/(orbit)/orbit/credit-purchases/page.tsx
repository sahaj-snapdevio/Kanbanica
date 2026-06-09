import { desc, eq } from "drizzle-orm";
import { CreditPurchasesTable } from "@/app/(orbit)/orbit/credit-purchases/_components/credit-purchases-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrbitCreditPurchasesPage() {
  const rows = await db
    .select({
      id: schema.creditPurchases.id,
      spaceId: schema.creditPurchases.spaceId,
      spaceName: schema.spaces.name,
      amount: schema.creditPurchases.amount,
      surchargeAmount: schema.creditPurchases.surchargeAmount,
      refundedAmount: schema.creditPurchases.refundedAmount,
      status: schema.creditPurchases.status,
      paymentProvider: schema.creditPurchases.paymentProvider,
      providerCheckoutId: schema.creditPurchases.providerCheckoutId,
      providerOrderId: schema.creditPurchases.providerOrderId,
      createdAt: schema.creditPurchases.createdAt,
      paidAt: schema.creditPurchases.paidAt,
      initiatedByUserId: schema.creditPurchases.initiatedByUserId,
    })
    .from(schema.creditPurchases)
    .leftJoin(
      schema.spaces,
      eq(schema.spaces.id, schema.creditPurchases.spaceId)
    )
    .orderBy(desc(schema.creditPurchases.createdAt))
    .limit(200);

  // Initiator email for the optional "by" column.
  const initiatorIds = Array.from(
    new Set(
      rows.map((r) => r.initiatedByUserId).filter((v): v is string => !!v)
    )
  );
  const initiators = initiatorIds.length
    ? await db
        .select({ id: schema.user.id, email: schema.user.email })
        .from(schema.user)
    : [];
  const initiatorMap = new Map(initiators.map((u) => [u.id, u.email]));

  const purchases = rows.map((r) => ({
    id: r.id,
    spaceId: r.spaceId,
    spaceName: r.spaceName ?? "—",
    amount: Number.parseFloat(r.amount),
    surchargeAmount: Number.parseFloat(r.surchargeAmount),
    refundedAmount: Number.parseFloat(r.refundedAmount),
    status: r.status,
    paymentProvider: r.paymentProvider,
    providerOrderId: r.providerOrderId,
    providerCheckoutId: r.providerCheckoutId,
    createdAt: r.createdAt,
    paidAt: r.paidAt,
    initiatedByEmail: r.initiatedByUserId
      ? (initiatorMap.get(r.initiatedByUserId) ?? null)
      : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Credit purchases</PageHeaderTitle>
          <PageHeaderDescription>
            Every prepaid credit top-up. Limited to the 200 most recent.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <CreditPurchasesTable purchases={purchases} />
    </div>
  );
}
