/**
 * Per-cube restic repository password — lazy generate + persist.
 *
 * Restic encrypts every chunk it stores with this password. Without it
 * the repo is unreadable; lose the password (or `APP_SECRET`, since
 * we encrypt at rest with it) and every snapshot for that cube is
 * permanently gone.
 *
 * Storage: `cubes.snapshot_repo_password_enc` — text, nullable,
 * AES-256-GCM ciphertext (via `lib/encrypt.ts`).
 *
 * Lifecycle:
 *   - First `restic init` for a cube: `getOrCreateRepoPasswordForCube`
 *     generates a 128-bit random hex string (32 hex chars from 16
 *     `randomBytes`), encrypts with `APP_SECRET`, persists, returns the
 *     plaintext to the caller.
 *   - Subsequent ops: same function decrypts the stored ciphertext.
 *   - Cube delete: the row is deleted (cascade), the column goes with
 *     it; the repo objects on S3 are then unreadable even if a copy
 *     somehow survives elsewhere.
 *
 * The generated password is 32 hex chars (128 bits of cryptographic
 * randomness) with no special characters — safely passable as a
 * `RESTIC_PASSWORD` env var without shell-escape concerns. 128 bits is
 * the right strength for a symmetric key on a restic repo.
 */

import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { cubes } from "@/db/schema";
import { db } from "@/lib/db";
import { decryptValue, encryptValue } from "@/lib/encrypt";

/**
 * Return the plaintext restic password for `cubeId`, generating +
 * persisting one if the cube doesn't have one yet.
 *
 * Concurrent callers (e.g. snapshot.create + the prune cron racing for
 * the same cube on first init) both run the same generate path; the
 * one that loses the UPDATE WHERE password IS NULL race reads back the
 * winner's value via SELECT. Net effect: exactly-one password per cube
 * for life.
 */
export async function getOrCreateRepoPasswordForCube(
  cubeId: string
): Promise<string> {
  // Fast path: already provisioned.
  const existing = await db.query.cubes.findFirst({
    where: eq(cubes.id, cubeId),
    columns: { snapshotRepoPasswordEnc: true },
  });
  if (!existing) {
    throw new Error(`cube ${cubeId} not found`);
  }
  if (existing.snapshotRepoPasswordEnc) {
    return decryptValue(existing.snapshotRepoPasswordEnc);
  }

  // Slow path: generate + persist. 32 hex chars from 16 random bytes
  // (128 bits). Restic accepts any UTF-8 string as a password and
  // doesn't require minimum length, but 128-bit symmetric keys are
  // the right strength for a restic repo.
  const plaintext = randomBytes(16).toString("hex");
  const ciphertext = encryptValue(plaintext);

  // Race-safe atomic claim: only set the column if it's still NULL.
  // Two concurrent first-init callers can both reach this point; the
  // one whose UPDATE acquires the row-level write lock first wins,
  // the other's `.where(... IS NULL)` predicate no longer matches
  // and the `RETURNING` is empty. The loser falls through to a
  // re-read and uses the winner's password — exactly one password
  // per cube for life.
  const [winner] = await db
    .update(cubes)
    .set({ snapshotRepoPasswordEnc: ciphertext, updatedAt: new Date() })
    .where(and(eq(cubes.id, cubeId), isNull(cubes.snapshotRepoPasswordEnc)))
    .returning({ snapshotRepoPasswordEnc: cubes.snapshotRepoPasswordEnc });

  if (winner?.snapshotRepoPasswordEnc) {
    return plaintext;
  }

  // We lost the race. Re-read the row to pick up the other caller's
  // persisted password.
  const reread = await db.query.cubes.findFirst({
    where: eq(cubes.id, cubeId),
    columns: { snapshotRepoPasswordEnc: true },
  });
  if (!reread?.snapshotRepoPasswordEnc) {
    throw new Error(
      `cube ${cubeId} has no snapshot repo password after race-lost UPDATE — should be impossible`
    );
  }
  return decryptValue(reread.snapshotRepoPasswordEnc);
}
