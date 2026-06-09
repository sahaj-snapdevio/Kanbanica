/**
 * EmailIt transactional email sending.
 *
 * Endpoint: POST /v2/emails — https://emailit.com/docs/api-reference/
 */

import { emailitRequest } from "@/lib/emailit/client";
import { env } from "@/lib/env";

export interface EmailitSendInput {
  html: string;
  /**
   * Forwarded as `Idempotency-Key` on the API call. EmailIt v2 honours
   * this header with a 24-hour dedup window — duplicate keys within
   * that window return the same email rather than sending a new one.
   * The constraint is `max 256 chars, alphanumeric + dash + underscore`
   * — a UUID (36 chars, [a-f0-9-]) satisfies this. See
   * https://emailit.com/docs/api-reference/emails/send.
   */
  idempotencyKey?: string;
  /**
   * Forwarded as the `meta` body field — arbitrary string-keyed metadata
   * stored alongside the email and surfaced on EmailIt webhook events.
   * Used to attach our `email_outbox` row id so webhook deliveries are
   * traceable back to the source enqueue.
   */
  meta?: Record<string, string>;
  replyTo?: string;
  subject: string;
  text?: string;
  to: string | string[];
}

/** Subset of the EmailIt email object we care about. */
export interface EmailitSendResult {
  id: string;
  message_id: string;
  object: "email";
  status: string;
  token: string;
}

/**
 * Sends a single transactional email through the EmailIt API.
 * The `from` address is fixed to `EMAILIT_FROM` (must be on a domain
 * verified in the EmailIt workspace).
 */
export async function sendEmailViaApi(
  input: EmailitSendInput
): Promise<EmailitSendResult> {
  return emailitRequest<EmailitSendResult>("/emails", {
    method: "POST",
    body: {
      from: env.EMAILIT_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: input.replyTo,
      meta: input.meta,
    },
    extraHeaders: input.idempotencyKey
      ? { "Idempotency-Key": input.idempotencyKey }
      : undefined,
  });
}
