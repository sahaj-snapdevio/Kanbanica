/**
 * Pure cooldown math for per-domain Cloudflare cache purges.
 *
 * The purge action stamps `domain_mappings.last_cache_purge_at` at enqueue
 * and refuses another purge until the cooldown has elapsed (so a customer
 * cannot exhaust Cloudflare's zone-wide purge rate limit). No DB / no I/O —
 * unit-tested in cache-purge.test.ts.
 */

import { DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS } from "@/config/platform";

/**
 * Milliseconds remaining before another cache purge is allowed for a domain,
 * given the last purge-request time. Returns 0 when a purge is allowed now
 * (never purged, or the cooldown has fully elapsed). Clock skew where `now`
 * predates `lastPurgeAt` simply yields a full (or longer) cooldown — never a
 * negative value.
 */
export function cachePurgeCooldownRemainingMs(
  lastPurgeAt: Date | null,
  now: Date,
  cooldownSeconds: number = DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS
): number {
  if (!lastPurgeAt) {
    return 0;
  }
  const elapsedMs = now.getTime() - lastPurgeAt.getTime();
  const cooldownMs = cooldownSeconds * 1000;
  const remaining = cooldownMs - elapsedMs;
  return remaining > 0 ? remaining : 0;
}

/**
 * Whole seconds (rounded up) remaining in the cooldown — the value surfaced
 * to clients as `retryAfterSeconds`. 0 when a purge is allowed now.
 */
export function cachePurgeCooldownRemainingSeconds(
  lastPurgeAt: Date | null,
  now: Date,
  cooldownSeconds: number = DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS
): number {
  return Math.ceil(
    cachePurgeCooldownRemainingMs(lastPurgeAt, now, cooldownSeconds) / 1000
  );
}
