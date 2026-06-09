/**
 * Per-server allocation of the unprivileged uid the Firecracker jailer drops
 * to for a cube. Mirrors lib/server/ports.ts: instead of a uid table we track
 * only the uids currently in use (cubes.jailer_uid on a given server) and
 * derive the next free one from JAILER_UID_BASE upward.
 *
 * uids are host-local, so they only need to be unique among CO-LOCATED cubes —
 * we scope the in-use set to one server (or BOTH servers mid-transfer).
 * Concurrency: a per-server advisory lock (disjoint seed `2`; acquireSpaceLock
 * uses 0, the per-user lock uses 1) serializes allocation on a host, so two
 * cubes provisioning at the same time can never pick the same uid. A transfer
 * reads the source server's in-use set too, so it acquires BOTH servers' locks
 * (in sorted order — deadlock-free) before reading; otherwise a concurrent
 * relaunch on the source could steal the chosen uid between read and write.
 * The `cubes_server_id_jailer_uid_uniq` constraint is a belt-and-suspenders
 * backstop. We PREVENT the conflict (advisory lock) rather than retry through
 * it, because a unique violation inside a transaction poisons the whole
 * transaction.
 */

import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { JAILER_UID_BASE } from "@/config/platform";
import * as schema from "@/db/schema";

type Tx = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

/** Pure: the lowest uid >= base that is not already in `inUse`. */
export function lowestFreeUid(base: number, inUse: number[]): number {
  const used = new Set(inUse);
  let uid = base;
  while (used.has(uid)) {
    uid++;
  }
  return uid;
}

/**
 * Allocate the next free jailer uid for `serverId` (the server the cube will RUN
 * on) and persist it on the cube row. Must be called inside a transaction.
 *
 * The cube's OWN current uid is excluded from the in-use set, so a same-server
 * relaunch re-picks its existing uid (stable, no churn).
 *
 * TRANSFER SAFETY: the uid is written to the cube row, and the
 * `UNIQUE(server_id, jailer_uid)` constraint is evaluated against the row's
 * CURRENT server_id — which during a transfer is still the SOURCE (cube.serverId
 * flips to the destination only after a successful boot). So we pick a uid free
 * on BOTH `serverId` (the destination) AND the cube's current server_id;
 * otherwise a destination-free uid could collide with a co-located cube on the
 * source at write time (the 2026-05-30 transfer failure). For a same-server
 * relaunch the two are identical → the union is a no-op.
 */
export async function allocateJailerUid(
  tx: Tx,
  serverId: string,
  cubeId: string
): Promise<number> {
  // Determine the lock/in-use scope FIRST: the target server plus the cube's
  // CURRENT server (they differ only mid-transfer, where serverId is the
  // destination and the row still carries the source until the atomic flip).
  // Reading serverId here is safe — a cube's server_id never changes
  // concurrently (transfer is singleton-keyed; relaunch leaves it untouched).
  const [current] = await tx
    .select({ serverId: schema.cubes.serverId })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, cubeId))
    .limit(1);
  const scopeServerIds =
    current && current.serverId !== serverId
      ? [serverId, current.serverId]
      : [serverId];

  // Serialize uid allocation against EVERY server in scope (see file header).
  // A transfer reads the source server's in-use uids too, so it MUST hold the
  // source's lock as well — otherwise a concurrent relaunch of a co-located
  // cube on the source can grab the same uid between this read and the write,
  // and the UNIQUE(server_id, jailer_uid) constraint rejects the write because
  // the row still carries the source server_id (the 2026-05-31 transfer
  // `jailer_uid = 100000` collision). Acquire the locks in a deterministic
  // (sorted) order so two transfers over the same server pair can never
  // deadlock by grabbing them in opposite order. Auto-released at tx end.
  for (const lockServerId of [...scopeServerIds].sort()) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`jailer_uid:${lockServerId}`}, 2))`
    );
  }

  const rows = await tx
    .select({ uid: schema.cubes.jailerUid })
    .from(schema.cubes)
    .where(
      and(
        inArray(schema.cubes.serverId, scopeServerIds),
        ne(schema.cubes.id, cubeId),
        isNotNull(schema.cubes.jailerUid)
      )
    );

  const uid = lowestFreeUid(
    JAILER_UID_BASE,
    rows.map((r) => r.uid as number)
  );

  await tx
    .update(schema.cubes)
    .set({ jailerUid: uid })
    .where(eq(schema.cubes.id, cubeId));

  return uid;
}

/** Free a cube's jailer uid (on delete / transfer-out). Idempotent. */
export async function freeJailerUid(tx: Tx, cubeId: string): Promise<void> {
  await tx
    .update(schema.cubes)
    .set({ jailerUid: null })
    .where(eq(schema.cubes.id, cubeId));
}
