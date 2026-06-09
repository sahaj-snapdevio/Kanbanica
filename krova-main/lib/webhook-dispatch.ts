import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { isValidWebhookEvent, type WebhookEvent } from "@/lib/webhook-events";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Wire-format envelope for every outbound webhook delivery.
 *
 * The `data` shape varies per event — consumers should switch on `event` and
 * use the matching payload-builder helpers in `lib/webhook-payloads.ts`.
 */
export interface WebhookEventEnvelope {
  createdAt: string;
  data: Record<string, unknown>;
  event: WebhookEvent;
  id: string;
  spaceId: string;
}

/**
 * Fan-out a webhook event to every enabled endpoint in the space that
 * subscribes to it. Fire-and-forget: never throws, swallows DB errors.
 *
 * Called from worker handlers, server actions, and webhook routes — must be
 * safe to call from any code path including pre-commit and post-commit phases.
 */
export async function dispatchWebhookEvent(
  spaceId: string,
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  if (!isValidWebhookEvent(event)) {
    console.error(`[webhook-dispatch] unknown event: ${event}`);
    return;
  }

  try {
    const endpoints = await db
      .select()
      .from(schema.outboundWebhookEndpoints)
      .where(
        and(
          eq(schema.outboundWebhookEndpoints.spaceId, spaceId),
          eq(schema.outboundWebhookEndpoints.enabled, true)
        )
      );

    const matching = endpoints.filter((ep) => ep.events.includes(event));
    if (matching.length === 0) {
      return;
    }

    const envelope: WebhookEventEnvelope = {
      createdAt: new Date().toISOString(),
      data,
      event,
      id: createId(),
      spaceId,
    };

    await Promise.all(
      matching.map(async (ep) => {
        const deliveryId = createId();
        await db.insert(schema.outboundWebhookDeliveries).values({
          endpointId: ep.id,
          event,
          id: deliveryId,
          payload: envelope,
        });
        await enqueueJob(JOB_NAMES.OUTBOUND_WEBHOOK_DELIVER, { deliveryId });
      })
    );
  } catch (err) {
    console.error(`[webhook-dispatch] dispatch ${event} failed:`, err);
  }
}
