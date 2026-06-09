"use server";

import { createId } from "@paralleldrive/cuid2";
import { randomBytes } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import * as schema from "@/db/schema";
import { requireActionMembershipAndPermission } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptValue } from "@/lib/encrypt";
import { WEBHOOK_EVENT_VALUES } from "@/lib/webhook-events";
import { assertSafeWebhookUrl } from "@/lib/webhook-ssrf";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

async function getActor(spaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" as const };
  }
  const permResult = await requireActionMembershipAndPermission(
    session.user.id,
    spaceId,
    "webhook.manage"
  );
  if ("error" in permResult) {
    return { error: permResult.error };
  }
  return { session, membership: permResult.membership };
}

function validateUrlAndEvents(
  url: string,
  events: unknown
): { trimmedUrl: string; events: string[] } | { error: string } {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { error: "URL is required" };
  }
  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { error: "URL must use http or https" };
    }
  } catch {
    return { error: "URL is not a valid URL" };
  }
  if (!Array.isArray(events) || events.length === 0) {
    return { error: "Select at least one event" };
  }
  const invalid = (events as string[]).filter(
    (e) => !(WEBHOOK_EVENT_VALUES as readonly string[]).includes(e)
  );
  if (invalid.length > 0) {
    return { error: `Unknown event(s): ${invalid.join(", ")}` };
  }
  return { trimmedUrl, events: events as string[] };
}

export async function createWebhook(
  spaceId: string,
  url: string,
  events: string[],
  description?: string | null
) {
  const ctx = await getActor(spaceId);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  const validation = validateUrlAndEvents(url, events);
  if ("error" in validation) {
    return { error: validation.error };
  }

  const ssrf = await assertSafeWebhookUrl(validation.trimmedUrl);
  if (!ssrf.ok) {
    return { error: ssrf.reason ?? "URL is not allowed" };
  }

  const rawSecret = randomBytes(32).toString("hex");
  const encryptedSecret = encryptValue(rawSecret);

  const [endpoint] = await db
    .insert(schema.outboundWebhookEndpoints)
    .values({
      spaceId,
      url: validation.trimmedUrl,
      description: description?.trim() || null,
      encryptedSecret,
      events: validation.events,
      enabled: true,
    })
    .returning({
      id: schema.outboundWebhookEndpoints.id,
      url: schema.outboundWebhookEndpoints.url,
      description: schema.outboundWebhookEndpoints.description,
      events: schema.outboundWebhookEndpoints.events,
      enabled: schema.outboundWebhookEndpoints.enabled,
      createdAt: schema.outboundWebhookEndpoints.createdAt,
    });

  const reqCtx = extractRequestContext(await headers());
  audit({
    action: "webhook.create",
    category: "webhook",
    actorType: "user",
    actorId: ctx.session.user.id,
    actorEmail: ctx.session.user.email,
    entityType: "webhook",
    entityId: endpoint.id,
    spaceId,
    description: `Created webhook endpoint for ${validation.trimmedUrl}`,
    metadata: { url: validation.trimmedUrl, events: validation.events },
    source: "web",
    ...reqCtx,
  });

  return { endpoint: { ...endpoint, secret: rawSecret } };
}

export async function updateWebhook(
  spaceId: string,
  endpointId: string,
  input: { url?: string; events?: string[]; description?: string | null }
) {
  const ctx = await getActor(spaceId);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  const patch: {
    url?: string;
    events?: string[];
    description?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (input.url !== undefined || input.events !== undefined) {
    const validation = validateUrlAndEvents(
      input.url ?? "",
      input.events ?? []
    );
    if ("error" in validation) {
      return { error: validation.error };
    }
    if (input.url !== undefined) {
      const ssrf = await assertSafeWebhookUrl(validation.trimmedUrl);
      if (!ssrf.ok) {
        return { error: ssrf.reason ?? "URL is not allowed" };
      }
      patch.url = validation.trimmedUrl;
    }
    if (input.events !== undefined) {
      patch.events = validation.events;
    }
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }

  const [updated] = await db
    .update(schema.outboundWebhookEndpoints)
    .set(patch)
    .where(
      and(
        eq(schema.outboundWebhookEndpoints.id, endpointId),
        eq(schema.outboundWebhookEndpoints.spaceId, spaceId)
      )
    )
    .returning({
      id: schema.outboundWebhookEndpoints.id,
      url: schema.outboundWebhookEndpoints.url,
      description: schema.outboundWebhookEndpoints.description,
      events: schema.outboundWebhookEndpoints.events,
      enabled: schema.outboundWebhookEndpoints.enabled,
    });

  if (!updated) {
    return { error: "Webhook not found" };
  }

  const reqCtx = extractRequestContext(await headers());
  audit({
    action: "webhook.update",
    category: "webhook",
    actorType: "user",
    actorId: ctx.session.user.id,
    actorEmail: ctx.session.user.email,
    entityType: "webhook",
    entityId: endpointId,
    spaceId,
    description: `Updated webhook endpoint ${updated.url}`,
    metadata: { url: updated.url, events: updated.events },
    source: "web",
    ...reqCtx,
  });

  return { endpoint: updated };
}

export async function setWebhookEnabled(
  spaceId: string,
  endpointId: string,
  enabled: boolean
) {
  const ctx = await getActor(spaceId);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  const [updated] = await db
    .update(schema.outboundWebhookEndpoints)
    .set({
      enabled,
      // Re-enabling clears the auto-disable failure counter so flap protection
      // restarts from zero. Manual disable records the customer intent so the
      // forensic breadcrumb survives.
      ...(enabled
        ? { consecutiveFailures: 0, disabledReason: null }
        : { disabledReason: "customer" }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.outboundWebhookEndpoints.id, endpointId),
        eq(schema.outboundWebhookEndpoints.spaceId, spaceId)
      )
    )
    .returning({
      id: schema.outboundWebhookEndpoints.id,
      url: schema.outboundWebhookEndpoints.url,
    });

  if (!updated) {
    return { error: "Webhook not found" };
  }

  const reqCtx = extractRequestContext(await headers());
  audit({
    action: enabled ? "webhook.enable" : "webhook.disable",
    category: "webhook",
    actorType: "user",
    actorId: ctx.session.user.id,
    actorEmail: ctx.session.user.email,
    entityType: "webhook",
    entityId: endpointId,
    spaceId,
    description: `${enabled ? "Enabled" : "Disabled"} webhook ${updated.url}`,
    metadata: { url: updated.url },
    source: "web",
    ...reqCtx,
  });

  return { success: true as const };
}

export async function rotateWebhookSecret(spaceId: string, endpointId: string) {
  const ctx = await getActor(spaceId);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  const rawSecret = randomBytes(32).toString("hex");
  const encryptedSecret = encryptValue(rawSecret);

  const [updated] = await db
    .update(schema.outboundWebhookEndpoints)
    .set({ encryptedSecret, updatedAt: new Date() })
    .where(
      and(
        eq(schema.outboundWebhookEndpoints.id, endpointId),
        eq(schema.outboundWebhookEndpoints.spaceId, spaceId)
      )
    )
    .returning({
      id: schema.outboundWebhookEndpoints.id,
      url: schema.outboundWebhookEndpoints.url,
    });

  if (!updated) {
    return { error: "Webhook not found" };
  }

  const reqCtx = extractRequestContext(await headers());
  audit({
    action: "webhook.rotate_secret",
    category: "webhook",
    actorType: "user",
    actorId: ctx.session.user.id,
    actorEmail: ctx.session.user.email,
    entityType: "webhook",
    entityId: endpointId,
    spaceId,
    description: `Rotated signing secret for webhook ${updated.url}`,
    metadata: { url: updated.url },
    source: "web",
    ...reqCtx,
  });

  return { secret: rawSecret };
}

export async function deleteWebhook(spaceId: string, endpointId: string) {
  const ctx = await getActor(spaceId);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  const [deleted] = await db
    .delete(schema.outboundWebhookEndpoints)
    .where(
      and(
        eq(schema.outboundWebhookEndpoints.id, endpointId),
        eq(schema.outboundWebhookEndpoints.spaceId, spaceId)
      )
    )
    .returning({
      id: schema.outboundWebhookEndpoints.id,
      url: schema.outboundWebhookEndpoints.url,
    });

  if (!deleted) {
    return { error: "Webhook not found" };
  }

  const reqCtx = extractRequestContext(await headers());
  audit({
    action: "webhook.delete",
    category: "webhook",
    actorType: "user",
    actorId: ctx.session.user.id,
    actorEmail: ctx.session.user.email,
    entityType: "webhook",
    entityId: endpointId,
    spaceId,
    description: `Deleted webhook endpoint ${deleted.url}`,
    metadata: { url: deleted.url },
    source: "web",
    ...reqCtx,
  });

  return { success: true as const };
}

export async function listWebhookDeliveries(
  spaceId: string,
  endpointId: string,
  limit = 50
) {
  const ctx = await getActor(spaceId);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  const [endpoint] = await db
    .select({ id: schema.outboundWebhookEndpoints.id })
    .from(schema.outboundWebhookEndpoints)
    .where(
      and(
        eq(schema.outboundWebhookEndpoints.id, endpointId),
        eq(schema.outboundWebhookEndpoints.spaceId, spaceId)
      )
    )
    .limit(1);

  if (!endpoint) {
    return { error: "Webhook not found" as const };
  }

  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const deliveries = await db
    .select({
      id: schema.outboundWebhookDeliveries.id,
      event: schema.outboundWebhookDeliveries.event,
      status: schema.outboundWebhookDeliveries.status,
      attempts: schema.outboundWebhookDeliveries.attempts,
      lastAttemptAt: schema.outboundWebhookDeliveries.lastAttemptAt,
      responseStatus: schema.outboundWebhookDeliveries.responseStatus,
      createdAt: schema.outboundWebhookDeliveries.createdAt,
    })
    .from(schema.outboundWebhookDeliveries)
    .where(eq(schema.outboundWebhookDeliveries.endpointId, endpointId))
    .orderBy(desc(schema.outboundWebhookDeliveries.createdAt))
    .limit(cappedLimit);

  return { deliveries };
}

export async function testFireWebhook(spaceId: string, endpointId: string) {
  const ctx = await getActor(spaceId);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  const [endpoint] = await db
    .select()
    .from(schema.outboundWebhookEndpoints)
    .where(
      and(
        eq(schema.outboundWebhookEndpoints.id, endpointId),
        eq(schema.outboundWebhookEndpoints.spaceId, spaceId)
      )
    )
    .limit(1);
  if (!endpoint) {
    return { error: "Webhook not found" };
  }

  // Use the first event the endpoint subscribes to so the delivery passes the
  // "endpoint subscribes to this event" filter in the deliver handler.
  const event = endpoint.events[0];
  if (!event) {
    return { error: "Webhook has no subscribed events" };
  }

  const deliveryId = createId();
  const payload = {
    id: createId(),
    event,
    createdAt: new Date().toISOString(),
    spaceId,
    test: true,
    data: {
      message: "This is a test delivery from Krova.",
    },
  };
  await db.insert(schema.outboundWebhookDeliveries).values({
    id: deliveryId,
    endpointId,
    event,
    payload,
  });
  await enqueueJob(JOB_NAMES.OUTBOUND_WEBHOOK_DELIVER, { deliveryId });

  audit({
    action: "webhook.test_fire",
    category: "webhook",
    actorType: "user",
    actorId: ctx.session.user.id,
    actorEmail: ctx.session.user.email,
    entityType: "webhook",
    entityId: endpointId,
    spaceId,
    description: `Test-fired webhook ${endpoint.url}`,
    metadata: { event, deliveryId },
    source: "web",
  });

  return { deliveryId };
}

export async function redeliverWebhookDelivery(
  spaceId: string,
  endpointId: string,
  deliveryId: string
) {
  const ctx = await getActor(spaceId);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  const [delivery] = await db
    .select({
      id: schema.outboundWebhookDeliveries.id,
      endpointId: schema.outboundWebhookDeliveries.endpointId,
      event: schema.outboundWebhookDeliveries.event,
      payload: schema.outboundWebhookDeliveries.payload,
    })
    .from(schema.outboundWebhookDeliveries)
    .innerJoin(
      schema.outboundWebhookEndpoints,
      eq(
        schema.outboundWebhookDeliveries.endpointId,
        schema.outboundWebhookEndpoints.id
      )
    )
    .where(
      and(
        eq(schema.outboundWebhookDeliveries.id, deliveryId),
        eq(schema.outboundWebhookDeliveries.endpointId, endpointId),
        eq(schema.outboundWebhookEndpoints.spaceId, spaceId)
      )
    )
    .limit(1);
  if (!delivery) {
    return { error: "Delivery not found" };
  }

  const newDeliveryId = createId();
  await db.insert(schema.outboundWebhookDeliveries).values({
    id: newDeliveryId,
    endpointId,
    event: delivery.event,
    payload: delivery.payload,
  });
  await enqueueJob(JOB_NAMES.OUTBOUND_WEBHOOK_DELIVER, {
    deliveryId: newDeliveryId,
  });

  audit({
    action: "webhook.redeliver",
    category: "webhook",
    actorType: "user",
    actorId: ctx.session.user.id,
    actorEmail: ctx.session.user.email,
    entityType: "webhook",
    entityId: endpointId,
    spaceId,
    description: `Re-queued delivery ${deliveryId}`,
    metadata: { originalDeliveryId: deliveryId, newDeliveryId },
    source: "web",
  });

  return { deliveryId: newDeliveryId };
}
