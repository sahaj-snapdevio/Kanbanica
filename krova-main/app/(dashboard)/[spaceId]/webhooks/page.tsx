import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  type DeliveryRow,
  type WebhookRow,
  WebhooksPage,
} from "@/components/webhooks-page";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server/session";

export default async function WebhooksRoute({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.userId, session.user.id),
        eq(schema.spaceMemberships.spaceId, spaceId)
      )
    )
    .limit(1);
  if (!membership) {
    redirect("/");
  }

  if (!membership.isOwner) {
    const [perm] = await db
      .select()
      .from(schema.memberPermissions)
      .where(
        and(
          eq(schema.memberPermissions.membershipId, membership.id),
          eq(schema.memberPermissions.permission, "webhook.manage")
        )
      )
      .limit(1);
    if (!perm) {
      redirect(`/${spaceId}`);
    }
  }

  const webhooks: WebhookRow[] = await db
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
    })
    .from(schema.outboundWebhookEndpoints)
    .where(eq(schema.outboundWebhookEndpoints.spaceId, spaceId))
    .orderBy(desc(schema.outboundWebhookEndpoints.createdAt));

  const deliveriesByEndpoint: Record<string, DeliveryRow[]> = {};
  if (webhooks.length > 0) {
    const ids = webhooks.map((w) => w.id);
    const rows = await db
      .select({
        id: schema.outboundWebhookDeliveries.id,
        endpointId: schema.outboundWebhookDeliveries.endpointId,
        event: schema.outboundWebhookDeliveries.event,
        status: schema.outboundWebhookDeliveries.status,
        attempts: schema.outboundWebhookDeliveries.attempts,
        lastAttemptAt: schema.outboundWebhookDeliveries.lastAttemptAt,
        responseStatus: schema.outboundWebhookDeliveries.responseStatus,
        createdAt: schema.outboundWebhookDeliveries.createdAt,
      })
      .from(schema.outboundWebhookDeliveries)
      .where(inArray(schema.outboundWebhookDeliveries.endpointId, ids))
      .orderBy(desc(schema.outboundWebhookDeliveries.createdAt));
    for (const row of rows) {
      if (!deliveriesByEndpoint[row.endpointId]) {
        deliveriesByEndpoint[row.endpointId] = [];
      }
      if (deliveriesByEndpoint[row.endpointId].length < 10) {
        const { endpointId, ...rest } = row;
        void endpointId;
        deliveriesByEndpoint[row.endpointId].push(rest);
      }
    }
  }

  return (
    <WebhooksPage
      deliveriesByEndpoint={deliveriesByEndpoint}
      initialWebhooks={webhooks}
      spaceId={spaceId}
    />
  );
}
