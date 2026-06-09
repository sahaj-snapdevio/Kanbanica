import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { emailEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * EmailIt webhook receiver — delivery / bounce / complaint telemetry.
 *
 * EmailIt signs every delivery with HMAC-SHA256. Verification per
 * https://emailit.com/docs/webhooks/request-signature/:
 *   - headers: `X-Emailit-Signature` (hex digest), `X-Emailit-Timestamp`
 *     (Unix seconds)
 *   - signed content: `${timestamp}.${rawBody}` over the unmodified body
 *   - key: the full webhook secret string, INCLUDING the `whsec_` prefix
 *
 * The secret is created in the EmailIt dashboard (Webhooks → Webhook
 * secret) and stored as `EMAILIT_WEBHOOK_SECRET`.
 *
 * Hard rule (CLAUDE.md): respond fast. We verify the signature, persist the
 * event idempotently on EmailIt's `evt_xxx` id, and return. The full
 * payload is stored verbatim — no SSH, no heavy work, so the insert runs
 * inline rather than via a pg-boss job.
 */

/** Reject deliveries whose signing timestamp is older than this (replay guard). */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

interface EmailitEvent {
  created_at?: string;
  data?: { object?: Record<string, unknown> };
  id?: string;
  object?: string;
  type?: string;
}

/** True when the signing timestamp is within the replay-tolerance window. */
function timestampFresh(timestamp: string): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Math.abs(Date.now() / 1000 - ts) <= TIMESTAMP_TOLERANCE_SECONDS;
}

/** Constant-time HMAC check; false on any length / hex-format mismatch. */
function signatureValid(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  const computed = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  if (computed.length !== signature.length) {
    return false;
  }
  try {
    return timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

function extractRecipient(obj: Record<string, unknown>): string | null {
  const to = obj.to;
  if (typeof to === "string") {
    return to;
  }
  if (Array.isArray(to) && typeof to[0] === "string") {
    return to[0];
  }
  return null;
}

function parseOccurredAt(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(request: Request) {
  // Inert until a webhook (and its secret) has been created in EmailIt.
  const secret = env.EMAILIT_WEBHOOK_SECRET;
  if (!secret) {
    return new NextResponse("webhook not configured", { status: 503 });
  }

  const signature = request.headers.get("x-emailit-signature");
  const timestamp = request.headers.get("x-emailit-timestamp");
  if (!signature || !timestamp) {
    return new NextResponse("missing signature headers", { status: 400 });
  }
  if (!timestampFresh(timestamp)) {
    return new NextResponse("stale or invalid timestamp", { status: 401 });
  }

  // Signature is computed over the raw body — read it as text, never
  // re-serialize before verifying.
  const rawBody = await request.text();
  if (!signatureValid(rawBody, timestamp, signature, secret)) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let event: EmailitEvent;
  try {
    event = JSON.parse(rawBody) as EmailitEvent;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  if (!event.id || !event.type) {
    return new NextResponse("missing event id/type", { status: 400 });
  }

  const emailObject = event.data?.object ?? {};
  const emailitEmailId =
    typeof emailObject.id === "string" ? emailObject.id : null;

  // Idempotency: a webhook retry carries the same evt id — ON CONFLICT
  // DO NOTHING makes a re-delivery a no-op.
  await db
    .insert(emailEvents)
    .values({
      emailitEventId: event.id,
      eventType: event.type,
      emailitEmailId,
      recipient: extractRecipient(emailObject),
      payload: event as unknown as Record<string, unknown>,
      occurredAt: parseOccurredAt(event.created_at),
    })
    .onConflictDoNothing({ target: emailEvents.emailitEventId });

  return new NextResponse("ok", { status: 200 });
}
