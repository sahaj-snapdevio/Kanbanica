import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { decryptValue } from "@/lib/encrypt";
import { env } from "@/lib/env";
import { assertSafeWebhookUrl } from "@/lib/webhook-ssrf";
import type { OutboundWebhookDeliverPayload } from "@/lib/worker/job-types";

/**
 * Flap-protection threshold. After N consecutive failed deliveries the
 * endpoint auto-disables and the space owner gets a one-shot email so they can
 * fix the receiver and re-enable from the dashboard.
 */
const AUTO_DISABLE_FAILURE_THRESHOLD = 50;

async function deliverOne(
  job: Job<OutboundWebhookDeliverPayload>
): Promise<void> {
  const { deliveryId } = job.data;

  const [delivery] = await db
    .select()
    .from(schema.outboundWebhookDeliveries)
    .where(eq(schema.outboundWebhookDeliveries.id, deliveryId))
    .limit(1);

  if (!delivery) {
    return;
  }
  if (delivery.status === "delivered") {
    return;
  }

  const [endpoint] = await db
    .select()
    .from(schema.outboundWebhookEndpoints)
    .where(eq(schema.outboundWebhookEndpoints.id, delivery.endpointId))
    .limit(1);

  if (!endpoint?.enabled) {
    await db
      .update(schema.outboundWebhookDeliveries)
      .set({ status: "failed", lastAttemptAt: new Date() })
      .where(eq(schema.outboundWebhookDeliveries.id, deliveryId));
    return;
  }

  // Defense-in-depth SSRF check at delivery time — DNS records can change
  // between endpoint create and the first delivery.
  const safety = await assertSafeWebhookUrl(endpoint.url);
  if (!safety.ok) {
    await db
      .update(schema.outboundWebhookEndpoints)
      .set({
        enabled: false,
        disabledReason: "ssrf_blocked",
        updatedAt: new Date(),
      })
      .where(eq(schema.outboundWebhookEndpoints.id, endpoint.id));
    await db
      .update(schema.outboundWebhookDeliveries)
      .set({
        status: "failed",
        lastAttemptAt: new Date(),
        responseBody: safety.reason ?? "ssrf_blocked",
      })
      .where(eq(schema.outboundWebhookDeliveries.id, deliveryId));
    audit({
      action: "webhook.disabled_ssrf",
      category: "webhook",
      actorType: "system",
      entityType: "webhook",
      entityId: endpoint.id,
      spaceId: endpoint.spaceId,
      description: `Webhook ${endpoint.url} auto-disabled: ${safety.reason}`,
      metadata: { url: endpoint.url, reason: safety.reason },
      source: "worker",
    });
    return;
  }

  const secret = decryptValue(endpoint.encryptedSecret);
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(signed).digest("hex");

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let succeeded = false;

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Krova-Signature": `t=${timestamp},v1=${sig}`,
        "X-Krova-Event": delivery.event,
        "X-Krova-Delivery": deliveryId,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    responseBody = (await res.text()).slice(0, 1000);
    succeeded = res.ok;
  } catch {
    // Network error or timeout
  }

  const now = new Date();
  if (succeeded) {
    await db
      .update(schema.outboundWebhookDeliveries)
      .set({
        attempts: delivery.attempts + 1,
        lastAttemptAt: now,
        ...(responseStatus === null ? {} : { responseStatus }),
        ...(responseBody === null ? {} : { responseBody }),
        status: "delivered",
      })
      .where(eq(schema.outboundWebhookDeliveries.id, deliveryId));
    await db
      .update(schema.outboundWebhookEndpoints)
      .set({
        consecutiveFailures: 0,
        lastSuccessAt: now,
        updatedAt: now,
      })
      .where(eq(schema.outboundWebhookEndpoints.id, endpoint.id));
    return;
  }

  // Failure path — bump consecutive_failures, maybe auto-disable, then throw
  // so pg-boss retries up to retryLimit.
  const [bumped] = await db
    .update(schema.outboundWebhookEndpoints)
    .set({
      consecutiveFailures: sql`${schema.outboundWebhookEndpoints.consecutiveFailures} + 1`,
      lastFailureAt: now,
      updatedAt: now,
    })
    .where(eq(schema.outboundWebhookEndpoints.id, endpoint.id))
    .returning({
      consecutiveFailures: schema.outboundWebhookEndpoints.consecutiveFailures,
    });

  await db
    .update(schema.outboundWebhookDeliveries)
    .set({
      attempts: delivery.attempts + 1,
      lastAttemptAt: now,
      ...(responseStatus === null ? {} : { responseStatus }),
      ...(responseBody === null ? {} : { responseBody }),
    })
    .where(eq(schema.outboundWebhookDeliveries.id, deliveryId));

  if (
    bumped &&
    bumped.consecutiveFailures >= AUTO_DISABLE_FAILURE_THRESHOLD &&
    endpoint.enabled
  ) {
    await db
      .update(schema.outboundWebhookEndpoints)
      .set({
        enabled: false,
        disabledReason: "consecutive_failures",
        updatedAt: now,
      })
      .where(eq(schema.outboundWebhookEndpoints.id, endpoint.id));
    audit({
      action: "webhook.auto_disabled",
      category: "webhook",
      actorType: "system",
      entityType: "webhook",
      entityId: endpoint.id,
      spaceId: endpoint.spaceId,
      description: `Webhook ${endpoint.url} auto-disabled after ${bumped.consecutiveFailures} consecutive failures`,
      metadata: { url: endpoint.url, failures: bumped.consecutiveFailures },
      source: "worker",
    });
    try {
      const owner = await getSpaceOwner(endpoint.spaceId);
      if (owner) {
        const settingsUrl = `${env.NEXT_PUBLIC_APP_URL}/${endpoint.spaceId}/webhooks`;
        const { webhookAutoDisabledEmailTemplate } = await import(
          "@/lib/email/templates/webhook-auto-disabled"
        );
        const { html, text } = await webhookAutoDisabledEmailTemplate({
          spaceName: owner.spaceName,
          url: endpoint.url,
          failures: bumped.consecutiveFailures,
          settingsUrl,
          userName: owner.name,
        });
        await enqueueEmail({
          to: owner.email,
          subject: `Webhook disabled — ${owner.spaceName}`,
          html,
          text,
        });
      }
    } catch (err) {
      console.error(
        `[outbound-webhook-deliver] failed to send auto-disable email for endpoint ${endpoint.id}:`,
        err
      );
    }
  }

  throw new Error(
    `Webhook delivery failed: HTTP ${responseStatus ?? "network error"}`
  );
}

export async function handleOutboundWebhookDeliver(
  jobs: Job<OutboundWebhookDeliverPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await deliverOne(job);
  }
}
