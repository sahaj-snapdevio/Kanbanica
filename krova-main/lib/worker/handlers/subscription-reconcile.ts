/**
 * Hourly subscription reconcile cron. Webhooks can be dropped — this polls
 * Polar for every space that has a subscription OR a pending checkout intent
 * and heals any divergence. Also expires abandoned pending intents.
 */

import { eq, isNotNull } from "drizzle-orm";
import type { Job } from "pg-boss";
import * as schema from "@/db/schema";
import {
  expireStalePendingIntents,
  reconcileSpaceSubscription,
} from "@/lib/billing/reconcile-subscription";
import { db } from "@/lib/db";

export async function handleSubscriptionReconcile(_jobs: Job[]): Promise<void> {
  void _jobs;
  console.log("[subscription-reconcile] starting");

  // Every space that already has a subscription recorded.
  const subscribed = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(isNotNull(schema.spaces.providerSubscriptionId));

  // Every space with a still-pending checkout intent (a possibly-lost
  // activation webhook) — distinct ids.
  const pendingIntents = await db
    .selectDistinct({ id: schema.subscriptionIntents.spaceId })
    .from(schema.subscriptionIntents)
    .where(eq(schema.subscriptionIntents.status, "pending"));

  const spaceIds = new Set<string>([
    ...subscribed.map((s) => s.id),
    ...pendingIntents.map((s) => s.id),
  ]);

  let healed = 0;
  let failed = 0;
  for (const spaceId of spaceIds) {
    try {
      const outcome = await reconcileSpaceSubscription(spaceId);
      if (outcome.result === "synced") {
        healed++;
      }
    } catch (err) {
      failed++;
      console.error(
        `[subscription-reconcile] failed for space ${spaceId}:`,
        err
      );
      // Continue — one space's failure must not block the rest.
    }
  }

  const expired = await expireStalePendingIntents(24);
  console.log(
    // `errors` (not `failed`) — Dokploy's log viewer auto-colors lines
    // containing the word `failed` as red even when the count is zero.
    `[subscription-reconcile] done — ${spaceIds.size} checked, ${healed} healed, ${failed} errors, ${expired} intents expired`
  );
}
