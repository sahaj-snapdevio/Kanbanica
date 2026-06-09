/**
 * Per-server `bridge_subnet` (S) allocation. S is GLOBALLY unique (one per
 * server) so both cube address families derive globally-unique addresses
 * (spec: Helpers §). This file holds the PURE picker plus the DB-bound
 * `allocateBridgeSubnet(tx)` (advisory lock seed 3 + servers query).
 *
 * Unlike lib/server/jailer-uids.ts `lowestFreeUid` (which has NO ceiling),
 * this MUST throw on exhaustion rather than hand out an out-of-range subnet
 * (audit finding N-L1).
 */

import { isNotNull, sql } from "drizzle-orm";
import {
  CUBE_BRIDGE_SUBNET_MAX,
  CUBE_BRIDGE_SUBNET_MIN,
} from "@/config/platform";
import * as schema from "@/db/schema";

type Tx = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

/** Lowest integer in [min, max] not present in `inUse`. Throws if none free. */
export function lowestFreeSubnet(
  min: number,
  max: number,
  inUse: Iterable<number>
): number {
  const used = new Set(inUse);
  for (let s = min; s <= max; s++) {
    if (!used.has(s)) {
      return s;
    }
  }
  throw new Error(
    `bridge_subnet space exhausted: no free subnet in [${min}, ${max}]`
  );
}

/**
 * Allocate the next free globally-unique bridge_subnet (S) for a NEW server.
 * Serializes on a single GLOBAL advisory lock (disjoint seed 3 — seeds 0/1/2
 * are taken by acquireSpaceLock / per-user / jailer-uid). The tx holds ONLY
 * this lock (never `servers FOR UPDATE`) to avoid deadlock ordering. MIN=1 so
 * S=0 is never auto-issued.
 */
export async function allocateBridgeSubnet(tx: Tx): Promise<number> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${"bridge_subnet_alloc"}, 3))`
  );
  const rows = await tx
    .select({ s: schema.servers.bridgeSubnet })
    .from(schema.servers)
    .where(isNotNull(schema.servers.bridgeSubnet));
  const inUse = rows.map((r) => r.s).filter((s): s is number => s !== null);
  return lowestFreeSubnet(
    CUBE_BRIDGE_SUBNET_MIN,
    CUBE_BRIDGE_SUBNET_MAX,
    inUse
  );
}
