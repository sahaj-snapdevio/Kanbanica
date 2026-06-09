import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "@/lib/auth";

/**
 * Returns the current Better Auth session, deduplicated per request via
 * React.cache(). Calling this from both a layout and its child page costs
 * only one DB round-trip (session + user lookup) instead of two.
 */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() })
);
