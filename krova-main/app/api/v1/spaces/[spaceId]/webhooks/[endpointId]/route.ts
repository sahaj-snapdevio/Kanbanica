import { and, eq } from "drizzle-orm";
import { outboundWebhookEndpoints } from "@/db/schema";
import { requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; endpointId: string }> }
) {
  try {
    const { spaceId, endpointId } = await params;
    const { membership } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "webhook.manage");

    const [endpoint] = await db
      .select({
        id: outboundWebhookEndpoints.id,
        url: outboundWebhookEndpoints.url,
        description: outboundWebhookEndpoints.description,
        events: outboundWebhookEndpoints.events,
        enabled: outboundWebhookEndpoints.enabled,
        createdAt: outboundWebhookEndpoints.createdAt,
        updatedAt: outboundWebhookEndpoints.updatedAt,
      })
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

    return Response.json({ webhook: endpoint });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "GET /api/v1/spaces/[spaceId]/webhooks/[endpointId] error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; endpointId: string }> }
) {
  try {
    const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
    if (limited) {
      return limited;
    }
    const { spaceId, endpointId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "webhook.manage");

    const [deleted] = await db
      .delete(outboundWebhookEndpoints)
      .where(
        and(
          eq(outboundWebhookEndpoints.id, endpointId),
          eq(outboundWebhookEndpoints.spaceId, spaceId)
        )
      )
      .returning({
        id: outboundWebhookEndpoints.id,
        url: outboundWebhookEndpoints.url,
      });

    if (!deleted) {
      return Response.json({ error: "Webhook not found" }, { status: 404 });
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "webhook.delete",
      category: "webhook",
      actorType: "user",
      actorId: apiKeyId,
      actorEmail: null,
      entityType: "webhook",
      entityId: endpointId,
      spaceId,
      description: `Deleted webhook endpoint ${deleted.url}`,
      metadata: { url: deleted.url },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "DELETE /api/v1/spaces/[spaceId]/webhooks/[endpointId] error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
