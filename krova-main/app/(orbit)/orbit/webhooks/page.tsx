import { desc, eq } from "drizzle-orm";
import { WebhooksTable } from "@/app/(orbit)/orbit/webhooks/_components/webhooks-table";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrbitWebhooksPage() {
  const rows = await db
    .select({
      id: schema.outboundWebhookEndpoints.id,
      url: schema.outboundWebhookEndpoints.url,
      description: schema.outboundWebhookEndpoints.description,
      events: schema.outboundWebhookEndpoints.events,
      enabled: schema.outboundWebhookEndpoints.enabled,
      disabledReason: schema.outboundWebhookEndpoints.disabledReason,
      consecutiveFailures: schema.outboundWebhookEndpoints.consecutiveFailures,
      lastSuccessAt: schema.outboundWebhookEndpoints.lastSuccessAt,
      lastFailureAt: schema.outboundWebhookEndpoints.lastFailureAt,
      createdAt: schema.outboundWebhookEndpoints.createdAt,
      spaceId: schema.outboundWebhookEndpoints.spaceId,
      spaceName: schema.spaces.name,
    })
    .from(schema.outboundWebhookEndpoints)
    .leftJoin(
      schema.spaces,
      eq(schema.spaces.id, schema.outboundWebhookEndpoints.spaceId)
    )
    .orderBy(desc(schema.outboundWebhookEndpoints.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Webhooks</PageHeaderTitle>
          <PageHeaderDescription>
            Every customer outbound webhook endpoint across all spaces.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <WebhooksTable
        webhooks={rows.map((r) => ({
          ...r,
          spaceName: r.spaceName ?? "—",
        }))}
      />
    </div>
  );
}
