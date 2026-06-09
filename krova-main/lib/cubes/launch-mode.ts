/**
 * Decide a cube's Firecracker launch mode at (re)launch time and persist any
 * transition, applying the JAILER_ENABLED policy. The single source of truth
 * every launch/relaunch handler calls before createCube/startCube, so the
 * jailed-vs-bare decision + uid lifecycle lives in ONE place (Rule 14).
 *
 * See docs/superpowers/plans/2026-05-29-firecracker-jailer-hardening.md.
 */

import { eq } from "drizzle-orm";
import { JAILER_ENABLED, JAILER_ENABLED_CUBE_IDS } from "@/config/platform";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { allocateJailerUid, freeJailerUid } from "@/lib/server/jailer-uids";
import type { LaunchMode } from "@/lib/ssh/jailer";

type Tx = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

export interface CubeLaunchModeInput {
  id: string;
  jailerUid: number | null;
  launchMode: LaunchMode;
  /** The server the cube is about to (re)launch on — the DESTINATION server for
   *  a transfer (set the cube's serverId before calling). */
  serverId: string;
}

/**
 * Resolve the launch mode for `cube` and write any mode/uid transition to the
 * DB inside `tx`. Returns the (launchMode, jailerUid) to pass to
 * createCube/startCube.
 *
 *  - JAILER_ENABLED → "jailed": (re)allocate a per-server uid (stable on the
 *    same server, fresh on a transfer — see allocateJailerUid) and flip
 *    launch_mode to "jailed" if it wasn't already.
 *  - !JAILER_ENABLED → "bare": free the uid and flip launch_mode back to "bare"
 *    if the cube was jailed. This drains the fleet back to bare one relaunch at
 *    a time — the clean rollback path when the flag is turned off (plan D8).
 *
 * MUST run inside a transaction — allocateJailerUid takes a per-server advisory
 * lock and the mode/uid writes must commit atomically with the caller's launch.
 */
export async function ensureLaunchMode(
  tx: Tx,
  cube: CubeLaunchModeInput
): Promise<{ launchMode: LaunchMode; jailerUid?: number }> {
  // The per-cube canary allowlist forces jailed mode for specific cubes even
  // while the global flag is off — so one real cube can be validated end-to-end
  // without converting the fleet. A cube NOT (globally enabled OR allowlisted)
  // falls through to the bare/revert branch below.
  const wantJailed =
    JAILER_ENABLED || JAILER_ENABLED_CUBE_IDS.includes(cube.id);
  if (wantJailed) {
    // allocateJailerUid persists jailer_uid on the row (excluding the cube's own
    // current uid, so a same-server relaunch is stable).
    const jailerUid = await allocateJailerUid(tx, cube.serverId, cube.id);
    if (cube.launchMode !== "jailed") {
      await tx
        .update(schema.cubes)
        .set({ launchMode: "jailed" })
        .where(eq(schema.cubes.id, cube.id));
    }
    return { launchMode: "jailed", jailerUid };
  }

  if (cube.launchMode === "jailed") {
    await freeJailerUid(tx, cube.id);
    await tx
      .update(schema.cubes)
      .set({ launchMode: "bare" })
      .where(eq(schema.cubes.id, cube.id));
  }
  return { launchMode: "bare" };
}

/**
 * Convenience wrapper: run `ensureLaunchMode` in its own transaction. Use from
 * launch/relaunch handlers that are not already inside a transaction at the
 * launch point (most of them). The mode/uid transition commits before the
 * caller SSHes out to (re)launch Firecracker.
 */
export async function resolveLaunchModeForCube(
  cube: CubeLaunchModeInput
): Promise<{ launchMode: LaunchMode; jailerUid?: number }> {
  return db.transaction((tx) => ensureLaunchMode(tx, cube));
}
