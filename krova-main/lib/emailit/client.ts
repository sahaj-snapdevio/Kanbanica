/**
 * Shared EmailIt HTTP API client.
 *
 * EmailIt API v2 — https://emailit.com/docs/api-reference/
 * Base URL: https://api.emailit.com/v2
 * Auth: Authorization: Bearer <EMAILIT_API_KEY>
 *
 * All EmailIt feature modules (emails, contacts, …) go through
 * `emailitRequest()` so auth, JSON handling, and error shaping live
 * in one place.
 */

import { env } from "@/lib/env";

const EMAILIT_API_BASE = "https://api.emailit.com/v2";

/** Thrown when the EmailIt API returns a non-2xx response. */
export class EmailitError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "EmailitError";
  }
}

interface EmailitRequestInit {
  body?: unknown;
  /**
   * Extra headers merged on top of the auth + content-type defaults.
   * Used by `sendEmailViaApi` to pass `Idempotency-Key` (the
   * email-outbox row's UUID) — EmailIt v2 honours the standard
   * `Idempotency-Key` header with a 24-hour dedup window. See
   * https://emailit.com/docs/api-reference/emails/send.
   */
  extraHeaders?: Record<string, string>;
  method: "GET" | "POST" | "DELETE";
}

/**
 * Performs an authenticated request against the EmailIt API and returns
 * the parsed JSON response. Throws `EmailitError` on a non-2xx status.
 */
export async function emailitRequest<T>(
  path: string,
  init: EmailitRequestInit
): Promise<T> {
  // Only set Content-Type when we actually send a body. EmailIt's Fastify
  // server returns 400 "Body cannot be empty when content-type is set to
  // 'application/json'" for body-less requests (e.g. DELETE /contacts/:id)
  // if the header is present.
  const hasBody = init.body !== undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.EMAILIT_API_KEY}`,
    Accept: "application/json",
    ...(init.extraHeaders ?? {}),
  };
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${EMAILIT_API_BASE}${path}`, {
    method: init.method,
    headers,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });

  const raw = await res.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!res.ok) {
    throw new EmailitError(
      `EmailIt API ${init.method} ${path} failed with ${res.status}`,
      res.status,
      parsed
    );
  }

  return parsed as T;
}
