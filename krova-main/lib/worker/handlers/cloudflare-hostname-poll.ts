import { and, eq, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { cubes, domainMappings } from "@/db/schema";
import { getCustomHostname, summarizeCloudflareStatus } from "@/lib/cloudflare";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildDomainPayload } from "@/lib/webhook-payloads";

/** Re-check an ALREADY-active hostname at most this often, so a regressed /
 *  expired cert is detected without re-polling every active hostname each
 *  1-min tick (Cloudflare API cost). */
const ACTIVE_RECHECK_MS = 30 * 60 * 1000;

/**
 * cloudflare-hostname-poll — every minute, refreshes `cloudflareStatus`.
 * Non-active hostnames are polled every tick (fast feedback while a cert is
 * still validating). Already-`active` hostnames are RE-checked on a slower
 * ~30-min cadence (via `cloudflareCheckedAt`) so a regressed / expired cert
 * flips its badge back instead of showing a stale "active" forever — Cloudflare
 * CAN move a hostname out of `active` (cert expiry, the customer changing their
 * DNS, re-validation), so "active" is not terminal. Emits a Pusher
 * `domain.update` whenever the status changes so the UI flips live.
 *
 * Idempotent: each tick is a fresh read of Cloudflare's current state. Every
 * polled row stamps `cloudflareCheckedAt`, so an unchanged active row is not
 * re-polled until the next 30-min window.
 */
export async function handleCloudflareHostnamePoll(): Promise<void> {
  const now = new Date();
  const activeRecheckCutoff = new Date(now.getTime() - ACTIVE_RECHECK_MS);
  const pending = await db
    .select({
      id: domainMappings.id,
      cubeId: domainMappings.cubeId,
      domain: domainMappings.domain,
      cloudflareHostnameId: domainMappings.cloudflareHostnameId,
      cloudflareStatus: domainMappings.cloudflareStatus,
    })
    .from(domainMappings)
    .where(
      and(
        isNotNull(domainMappings.cloudflareHostnameId),
        or(
          // Not yet active → poll every tick.
          isNull(domainMappings.cloudflareStatus),
          ne(domainMappings.cloudflareStatus, "active"),
          // Active → re-check only when it's been >30 min since the last poll
          // (or never polled), to catch a cert that regressed out of `active`.
          isNull(domainMappings.cloudflareCheckedAt),
          lt(domainMappings.cloudflareCheckedAt, activeRecheckCutoff)
        )
      )
    );
  if (pending.length === 0) {
    return;
  }

  for (const row of pending) {
    if (!row.cloudflareHostnameId) {
      continue;
    }
    try {
      const ch = await getCustomHostname(row.cloudflareHostnameId);
      const next = summarizeCloudflareStatus(ch);
      const changed = next !== row.cloudflareStatus;
      // Always stamp cloudflareCheckedAt (even when unchanged) so an active row
      // drops out of the WHERE for the next ~30 min instead of being re-polled
      // every tick. Update the status + bump updatedAt only on an actual change.
      await db
        .update(domainMappings)
        .set({
          cloudflareCheckedAt: now,
          ...(changed ? { cloudflareStatus: next, updatedAt: now } : {}),
        })
        .where(eq(domainMappings.id, row.id));
      if (!changed) {
        continue;
      }
      await triggerEvent(`private-cube-${row.cubeId}`, "domain.update", {
        mappingId: row.id,
        domain: row.domain,
        cloudflareStatus: next,
      });

      if (next === "active") {
        const [updatedRow] = await db
          .select()
          .from(domainMappings)
          .where(eq(domainMappings.id, row.id))
          .limit(1);
        const [cube] = await db
          .select({ spaceId: cubes.spaceId })
          .from(cubes)
          .where(eq(cubes.id, row.cubeId))
          .limit(1);
        if (updatedRow && cube?.spaceId) {
          dispatchWebhookEvent(cube.spaceId, "domain.active", {
            domain: buildDomainPayload(updatedRow),
          });
        }
      }
    } catch (err) {
      console.error(
        `[cloudflare-hostname-poll] poll failed for ${row.domain}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[cloudflare-hostname-poll] checked ${pending.length} hostname(s)`
  );
}
