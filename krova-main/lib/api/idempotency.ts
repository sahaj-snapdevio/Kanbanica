import { createId } from "@paralleldrive/cuid2";
import { and, eq, gt } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

const TTL_HOURS = 24;
const MAX_KEY_LENGTH = 255;
// Sentinel `response_status` for a row that has been CLAIMED but whose handler
// hasn't completed yet. A concurrent request that sees this returns 409 rather
// than running the handler a second time.
const IN_FLIGHT_STATUS = 0;
// A claim placeholder expires quickly so a worker/process death mid-handler
// self-heals in minutes (a later retry re-claims) instead of blocking the key
// for the full TTL.
const IN_FLIGHT_TTL_MS = 5 * 60 * 1000;

function inProgressResponse(): Response {
  return Response.json(
    {
      error:
        "A request with this Idempotency-Key is already being processed. Retry shortly.",
    },
    { status: 409, headers: { "Idempotency-Status": "in-progress" } }
  );
}

/**
 * Wrap a v1 POST handler with idempotency deduplication.
 * Key is scoped to (idempotencyKey, spaceId) — keys don't leak across spaces.
 *
 * CLAIM-FIRST: the key row is inserted (in-flight sentinel) BEFORE the handler
 * runs, and the (idempotencyKey, spaceId) unique index makes that insert atomic.
 * A second concurrent request loses the insert and is told to retry (409) — it
 * does NOT run the handler. The old code did a check-then-act (SELECT → run →
 * cache), so two concurrent requests with the same key both missed the SELECT
 * and both ran the handler, creating TWO real, separately-billed cubes
 * (2026-05-31 audit). The dominant SEQUENTIAL-retry path is unchanged: the
 * retry arrives after completion and replays the cached response.
 */
export async function withIdempotency(
  idempotencyKey: string | null | undefined,
  spaceId: string,
  fn: () => Promise<Response>
): Promise<Response> {
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return fn();
  }

  const trimmed = idempotencyKey.trim();
  if (!trimmed || trimmed.length > MAX_KEY_LENGTH) {
    return fn();
  }

  const now = new Date();

  // Fast path: a non-expired row already exists → completed replay, or an
  // in-flight claim by a concurrent request.
  const [existing] = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.idempotencyKey, trimmed),
        eq(schema.idempotencyKeys.spaceId, spaceId),
        gt(schema.idempotencyKeys.expiresAt, now)
      )
    )
    .limit(1);

  if (existing) {
    if (existing.responseStatus === IN_FLIGHT_STATUS) {
      return inProgressResponse();
    }
    return Response.json(existing.responseBody, {
      status: existing.responseStatus,
      headers: { "Idempotency-Replayed": "true" },
    });
  }

  // Claim the key before running the handler. onConflictDoNothing + the unique
  // index means at most one concurrent request wins.
  const [claim] = await db
    .insert(schema.idempotencyKeys)
    .values({
      id: createId(),
      idempotencyKey: trimmed,
      spaceId,
      responseStatus: IN_FLIGHT_STATUS,
      responseBody: {},
      expiresAt: new Date(now.getTime() + IN_FLIGHT_TTL_MS),
    })
    .onConflictDoNothing()
    .returning({ id: schema.idempotencyKeys.id });

  if (!claim) {
    // Lost the claim race (a row appeared between our SELECT and INSERT).
    // Re-read: a completed row replays; an in-flight one returns 409.
    const [row] = await db
      .select()
      .from(schema.idempotencyKeys)
      .where(
        and(
          eq(schema.idempotencyKeys.idempotencyKey, trimmed),
          eq(schema.idempotencyKeys.spaceId, spaceId),
          gt(schema.idempotencyKeys.expiresAt, now)
        )
      )
      .limit(1);
    if (row && row.responseStatus !== IN_FLIGHT_STATUS) {
      return Response.json(row.responseBody, {
        status: row.responseStatus,
        headers: { "Idempotency-Replayed": "true" },
      });
    }
    return inProgressResponse();
  }

  // We own the claim — run the handler, then finalize the row.
  try {
    const response = await fn();
    const body =
      response.status < 500
        ? await response
            .clone()
            .json()
            .catch(() => null)
        : null;
    if (body === null) {
      // 5xx or non-JSON: do NOT cache a server error — drop the claim so a
      // later retry re-runs the handler instead of replaying a failure.
      await db
        .delete(schema.idempotencyKeys)
        .where(eq(schema.idempotencyKeys.id, claim.id))
        .catch(() => {});
    } else {
      await db
        .update(schema.idempotencyKeys)
        .set({
          responseStatus: response.status,
          responseBody: body,
          expiresAt: new Date(now.getTime() + TTL_HOURS * 60 * 60 * 1000),
        })
        .where(eq(schema.idempotencyKeys.id, claim.id));
    }
    return response;
  } catch (err) {
    // The handler threw — release the claim so a retry can re-attempt.
    await db
      .delete(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.id, claim.id))
      .catch(() => {});
    throw err;
  }
}
