import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { outboundWebhookEndpoints } from "@/db/schema";
import { requirePermission } from "@/lib/api/auth-helpers";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { encryptValue } from "@/lib/encrypt";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { WEBHOOK_EVENT_VALUES } from "@/lib/webhook-events";
import { assertSafeWebhookUrl } from "@/lib/webhook-ssrf";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const { membership } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "webhook.manage");

    const endpoints = await db
      .select({
        id: outboundWebhookEndpoints.id,
        url: outboundWebhookEndpoints.url,
        events: outboundWebhookEndpoints.events,
        enabled: outboundWebhookEndpoints.enabled,
        createdAt: outboundWebhookEndpoints.createdAt,
        updatedAt: outboundWebhookEndpoints.updatedAt,
      })
      .from(outboundWebhookEndpoints)
      .where(eq(outboundWebhookEndpoints.spaceId, spaceId));

    return Response.json({ webhooks: endpoints });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/v1/spaces/[spaceId]/webhooks error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
    if (limited) {
      return limited;
    }
    const { spaceId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "webhook.manage");

    const body = await request.json();
    const { url, events, description } = body;

    if (!url || typeof url !== "string" || url.trim().length === 0) {
      return Response.json({ error: "url is required" }, { status: 400 });
    }
    const trimmedUrl = url.trim();
    const ssrf = await assertSafeWebhookUrl(trimmedUrl);
    if (!ssrf.ok) {
      return Response.json(
        { error: ssrf.reason ?? "URL is not allowed" },
        { status: 400 }
      );
    }

    if (!Array.isArray(events) || events.length === 0) {
      return Response.json(
        {
          error: `events must be a non-empty array. Valid values: ${WEBHOOK_EVENT_VALUES.join(", ")}`,
        },
        { status: 400 }
      );
    }
    const invalidEvents = events.filter(
      (e) => !(WEBHOOK_EVENT_VALUES as readonly string[]).includes(e)
    );
    if (invalidEvents.length > 0) {
      return Response.json(
        {
          error: `Invalid event(s): ${invalidEvents.join(", ")}. Valid values: ${WEBHOOK_EVENT_VALUES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const rawSecret = randomBytes(32).toString("hex");
    const encryptedSecret = encryptValue(rawSecret);

    const [endpoint] = await db
      .insert(outboundWebhookEndpoints)
      .values({
        spaceId,
        url: trimmedUrl,
        description:
          typeof description === "string" && description.trim().length > 0
            ? description.trim()
            : null,
        encryptedSecret,
        events,
        enabled: true,
      })
      .returning({
        id: outboundWebhookEndpoints.id,
        url: outboundWebhookEndpoints.url,
        description: outboundWebhookEndpoints.description,
        events: outboundWebhookEndpoints.events,
        enabled: outboundWebhookEndpoints.enabled,
        createdAt: outboundWebhookEndpoints.createdAt,
        updatedAt: outboundWebhookEndpoints.updatedAt,
      });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "webhook.create",
      category: "webhook",
      actorType: "user",
      actorId: apiKeyId,
      actorEmail: null,
      entityType: "webhook",
      entityId: endpoint.id,
      spaceId,
      description: `Created webhook endpoint for ${trimmedUrl}`,
      metadata: { url: trimmedUrl, events },
      source: "api",
      ...reqCtx,
    });

    return Response.json(
      { webhook: { ...endpoint, secret: rawSecret } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/v1/spaces/[spaceId]/webhooks error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
