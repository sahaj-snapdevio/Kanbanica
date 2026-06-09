/**
 * Cloudflare API v4 — low-level request core.
 *
 * All Cloudflare API access in Krova goes through `cfRequest`. It reads the
 * token + zone id from `lib/env`, sends a Bearer-authenticated JSON request,
 * and throws `CloudflareError` on any non-success response.
 *
 * Scripts (standalone `tsx`) must dynamically import this module AFTER
 * `process.loadEnvFile()` — see docs/superpowers/specs/2026-05-16-cloudflare-for-saas-design.md.
 */

import { CLOUDFLARE_API_BASE_URL } from "@/config/platform";
import { env } from "@/lib/env";

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cfErrors: { code: number; message: string }[] = []
  ) {
    super(
      cfErrors.length > 0
        ? `${message}: ${cfErrors.map((e) => `[${e.code}] ${e.message}`).join("; ")}`
        : message
    );
    this.name = "CloudflareError";
  }
}

type CfEnvelope<T> = {
  success: boolean;
  result: T;
  errors: { code: number; message: string }[];
};

/** The Cloudflare zone id, or throw if not configured. */
export function cloudflareZoneId(): string {
  const zone = env.CLOUDFLARE_ZONE_ID;
  if (!zone) {
    throw new CloudflareError("CLOUDFLARE_ZONE_ID is not set", 0);
  }
  return zone;
}

/**
 * Send a Cloudflare API request and return `result`. Throws `CloudflareError`
 * on a transport failure or any non-success response.
 */
export async function cfRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new CloudflareError("CLOUDFLARE_API_TOKEN is not set", 0);
  }

  let res: Response;
  try {
    res = await fetch(`${CLOUDFLARE_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new CloudflareError(
      `Cloudflare ${method} ${path} request failed: ${(e as Error).message}`,
      0
    );
  }

  const envelope = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
  if (!res.ok || !envelope?.success) {
    throw new CloudflareError(
      `Cloudflare ${method} ${path} returned HTTP ${res.status}`,
      res.status,
      envelope?.errors ?? []
    );
  }
  return envelope.result;
}
