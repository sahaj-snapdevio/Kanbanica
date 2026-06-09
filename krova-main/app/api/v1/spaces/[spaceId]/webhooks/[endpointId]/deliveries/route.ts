import { and, desc, eq } from "drizzle-orm";
import {
  outboundWebhookDeliveries,
  outboundWebhookEndpoints,
} from "@/db/schema";
import { requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { db } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; endpointId: string }> }
) {
  try {
    const { spaceId, endpointId } = await params;
    const { membership } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "webhook.manage");

    // Verify the endpoint belongs to this space
    const [endpoint] = await db
      .select({ id: outboundWebhookEndpoints.id })
      .from(outboundWebhookEndpoints)
      .where(
        and(
          eq(outboundWebhookEndpoints.id, endpointId),
          eq(outboundWebhookEndpoints.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!endpoint) {
      return Response.json({ error: "Webhook not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 100);

    const deliveries = await db
      .select({
        id: outboundWebhookDeliveries.id,
        event: outboundWebhookDeliveries.event,
        status: outboundWebhookDeliveries.status,
        attempts: outboundWebhookDeliveries.attempts,
        lastAttemptAt: outboundWebhookDeliveries.lastAttemptAt,
        responseStatus: outboundWebhookDeliveries.responseStatus,
        createdAt: outboundWebhookDeliveries.createdAt,
      })
      .from(outboundWebhookDeliveries)
      .where(eq(outboundWebhookDeliveries.endpointId, endpointId))
      .orderBy(desc(outboundWebhookDeliveries.createdAt))
      .limit(limit);

    return Response.json({ deliveries });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "GET /api/v1/spaces/[spaceId]/webhooks/[endpointId]/deliveries error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
