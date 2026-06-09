/**
 * Simple in-memory rate limiter using a fixed window counter.
 * Suitable for single-process deployments. For multi-process,
 * replace with Redis-backed implementation.
 */

const store = new Map<string, { count: number; resetAt: number }>();

// Cleanup stale entries every 5 minutes to prevent memory leaks
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000) {
    return;
  }
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

/** Pre-configured rate limit for expensive mutations (cube create, delete, snapshot, etc). */
export const RATE_LIMIT_MUTATION: RateLimitConfig = {
  limit: 10,
  windowSeconds: 60,
};

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Apply rate limiting to a request. Returns a 429 Response if exceeded, or null if allowed.
 *
 * Usage:
 * ```
 * const limited = applyRateLimit(request, RATE_LIMIT_MUTATION)
 * if (limited) return limited
 * ```
 */
export function applyRateLimit(
  request: Request,
  config: RateLimitConfig
): Response | null {
  cleanup();

  const ip = getClientIp(request);
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const entry = store.get(ip);

  if (!entry || entry.resetAt <= now) {
    store.set(ip, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > config.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return Response.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  return null;
}
