import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { generateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";

/**
 * Shared seeding helpers for the integration suite. The throwaway DB already
 * has the migration-seeded plans (migration 0037: plan_trial / plan_starter /
 * plan_pro / plan_business), so a minimal space just needs a name + planId.
 * The DB is destroyed after the run, but tests use unique ids so they stay
 * independent of one another.
 */

/** Insert a minimal space on the seeded `plan_trial`. Pass overrides for the
 *  billing / overage columns a test needs. Returns the inserted row. */
export async function seedSpace(
  overrides: Partial<typeof schema.spaces.$inferInsert> = {}
): Promise<typeof schema.spaces.$inferSelect> {
  const [row] = await db
    .insert(schema.spaces)
    .values({
      id: createId(),
      name: `itest-${createId().slice(0, 10)}`,
      planId: "plan_trial",
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("seedSpace: insert returned no row");
  }
  return row;
}

/** Read a space's billing columns back (for asserting cascade side effects). */
export async function readSpace(id: string) {
  const [row] = await db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.id, id))
    .limit(1);
  return row ?? null;
}

/** A region (FK target for servers). */
export async function seedRegion(): Promise<
  typeof schema.regions.$inferSelect
> {
  const slug = `itest-${createId().slice(0, 10)}`;
  const [row] = await db
    .insert(schema.regions)
    .values({ id: createId(), name: slug, slug })
    .returning();
  if (!row) {
    throw new Error("seedRegion: insert returned no row");
  }
  return row;
}

/** An ssh_keys row (FK target for servers). Values are placeholders — no
 *  integration test performs a real SSH connection. */
export async function seedSshKey(): Promise<
  typeof schema.sshKeys.$inferSelect
> {
  const [row] = await db
    .insert(schema.sshKeys)
    .values({
      id: createId(),
      name: `itest-${createId().slice(0, 8)}`,
      encryptedPrivateKey: "itest-enc",
      publicKey: "ssh-ed25519 AAAA itest",
      fingerprint: createId(),
    })
    .returning();
  if (!row) {
    throw new Error("seedSshKey: insert returned no row");
  }
  return row;
}

/** A server, with its region + ssh key auto-seeded. Pass overrides for
 *  bridgeSubnet / capacity columns a test needs. */
export async function seedServer(
  overrides: Partial<typeof schema.servers.$inferInsert> = {}
): Promise<typeof schema.servers.$inferSelect> {
  const region = await seedRegion();
  const key = await seedSshKey();
  const [row] = await db
    .insert(schema.servers)
    .values({
      id: createId(),
      hostname: `itest-${createId().slice(0, 10)}`,
      publicIp: "203.0.113.1",
      regionId: region.id,
      sshKeyId: key.id,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("seedServer: insert returned no row");
  }
  return row;
}

/** A cube on a (space, server). Required cube columns only — everything else
 *  defaults. Pass overrides for jailerUid / status / vcpus etc. */
export async function seedCube(
  spaceId: string,
  serverId: string,
  overrides: Partial<typeof schema.cubes.$inferInsert> = {}
): Promise<typeof schema.cubes.$inferSelect> {
  const [row] = await db
    .insert(schema.cubes)
    .values({
      id: createId(),
      spaceId,
      serverId,
      name: `itest-${createId().slice(0, 8)}`,
      vcpus: 1,
      ramMb: 1024,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("seedCube: insert returned no row");
  }
  return row;
}

/** A user + (owner) space membership + a v1 API key. Returns the RAW key for
 *  the `x-api-key` header. Owner membership ⇒ passes every requirePermission. */
export async function seedApiKey(
  opts: { spaceId?: string; isOwner?: boolean } = {}
): Promise<{
  fullKey: string;
  spaceId: string;
  membershipId: string;
  apiKeyId: string;
  userId: string;
}> {
  const userId = createId();
  await db.insert(schema.user).values({
    id: userId,
    email: `itest-${createId().slice(0, 12)}@example.com`,
    name: "itest",
  });
  const spaceId = opts.spaceId ?? (await seedSpace()).id;
  const [membership] = await db
    .insert(schema.spaceMemberships)
    .values({
      id: createId(),
      userId,
      spaceId,
      isOwner: opts.isOwner ?? true,
    })
    .returning();
  if (!membership) {
    throw new Error("seedApiKey: membership insert returned no row");
  }
  const { fullKey, keyPrefix, keyHash } = generateApiKey();
  const [key] = await db
    .insert(schema.apiKeys)
    .values({
      id: createId(),
      spaceId,
      membershipId: membership.id,
      name: "itest-key",
      keyPrefix,
      keyHash,
    })
    .returning();
  if (!key) {
    throw new Error("seedApiKey: api key insert returned no row");
  }
  return {
    fullKey,
    spaceId,
    membershipId: membership.id,
    apiKeyId: key.id,
    userId,
  };
}
