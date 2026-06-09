/**
 * The `@polar-sh/sdk` client, built from env. The ONLY place the Polar SDK
 * is instantiated. `getPolarClient()` throws if Polar is not configured —
 * callers (the Polar provider) are only reached when Polar is the active
 * provider, so a missing token is a real misconfiguration.
 */
import { Polar } from "@polar-sh/sdk";

import { env } from "@/lib/env";

let cached: Polar | null = null;

export function getPolarClient(): Polar {
  if (cached) {
    return cached;
  }
  if (!env.POLAR_ACCESS_TOKEN) {
    throw new Error(
      "POLAR_ACCESS_TOKEN is not set — the Polar payment provider is not configured."
    );
  }
  cached = new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER,
  });
  return cached;
}
