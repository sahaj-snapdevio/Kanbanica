// Lightweight in-memory fixed-window rate limiter.
//
// Suitable for a single app instance — the project's current deployment model
// (see DEPLOYMENT.md / ARCHITECTURE.md). For a multi-instance deployment this
// should be backed by a shared store (e.g. Redis), the same way the SSE
// registry would need to be. Pinned to globalThis so Turbopack module
// duplication across route handlers/actions shares one map.

interface Bucket {
  count: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as unknown as {
  __rateLimitBuckets?: Map<string, Bucket>;
};

const buckets: Map<string, Bucket> =
  globalForRateLimit.__rateLimitBuckets ?? new Map();
globalForRateLimit.__rateLimitBuckets = buckets;

export interface RateLimitResult {
  /** True when the request is allowed. */
  ok: boolean;
  /** Seconds until the window resets (for a `Retry-After` header). */
  retryAfter: number;
}

/**
 * Fixed-window rate limit. Returns `{ ok: false }` once `limit` requests for
 * `key` have been made within `windowMs`.
 *
 * @param key      A stable identifier for the caller + action (e.g. `avatar:<userId>`).
 * @param limit    Max requests allowed per window.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}

// Opportunistically drop expired buckets so the map can't grow unbounded.
// Runs at most once per minute, guarded so it never throws into a request path.
let lastSweep = 0;
export function sweepRateLimitBuckets(now: number = Date.now()): void {
  if (now - lastSweep < 60_000) {
    return;
  }
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}
