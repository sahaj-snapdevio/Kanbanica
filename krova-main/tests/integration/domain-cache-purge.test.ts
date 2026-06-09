import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  adminPurgeDomainCacheAction,
  purgeDomainCacheAction,
} from "@/lib/cube-actions/domains";
import { db } from "@/lib/db";
import { getBoss } from "@/lib/worker/enqueue";
import {
  seedApiKey,
  seedCube,
  seedServer,
  seedSpace,
} from "@/tests/integration/_seed";

// The purge action enqueues a real pg-boss job (getBoss). pg-boss keeps an
// open pool + maintenance timers that would hang `node --test` at the end —
// stop it once these tests finish (mirrors double-fire.test.ts).
after(async () => {
  const boss = await getBoss();
  await boss.stop().catch(() => {});
});

const REQ = { ipAddress: null, userAgent: null };

async function seedActiveDomain(
  cubeId: string,
  overrides: Partial<typeof schema.domainMappings.$inferInsert> = {}
) {
  const [row] = await db
    .insert(schema.domainMappings)
    .values({
      id: createId(),
      cubeId,
      domain: `itest-${createId().slice(0, 10)}.example.com`,
      port: 80,
      status: "active",
      verificationStatus: "verified",
      cloudflareHostnameId: `ch_${createId().slice(0, 12)}`,
      cloudflareStatus: "active",
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("seedActiveDomain: insert returned no row");
  }
  return row;
}

async function readMapping(id: string) {
  const [row] = await db
    .select()
    .from(schema.domainMappings)
    .where(eq(schema.domainMappings.id, id))
    .limit(1);
  return row ?? null;
}

test("admin purge: stamps cooldown + a second call within the window is 429", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const cube = await seedCube(space.id, server.id, { status: "running" });
  const mapping = await seedActiveDomain(cube.id);

  const first = await adminPurgeDomainCacheAction({
    mappingId: mapping.id,
    actor: { userId: "admin-itest", userEmail: "admin@itest.dev" },
    reqCtx: REQ,
  });
  assert.equal(first.ok, true, "first purge should be accepted");
  if (first.ok) {
    assert.equal(first.data.cooldownSeconds, 60);
  }

  // The cooldown was stamped.
  const afterFirst = await readMapping(mapping.id);
  assert.ok(afterFirst?.lastCachePurgeAt, "lastCachePurgeAt must be stamped");

  // A second purge immediately after is refused with 429 + retryAfterSeconds.
  const second = await adminPurgeDomainCacheAction({
    mappingId: mapping.id,
    actor: { userId: "admin-itest", userEmail: "admin@itest.dev" },
    reqCtx: REQ,
  });
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.status, 429);
    const retry = (
      second.errorMeta as { retryAfterSeconds?: number } | undefined
    )?.retryAfterSeconds;
    assert.ok(
      typeof retry === "number" && retry > 0 && retry <= 60,
      `retryAfterSeconds should be in (0, 60], got ${retry}`
    );
  }
});

test("admin purge: allowed again once the cooldown has elapsed", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const cube = await seedCube(space.id, server.id, { status: "running" });
  // Last purge was 2 minutes ago — outside the 60s cooldown.
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
  const mapping = await seedActiveDomain(cube.id, {
    lastCachePurgeAt: twoMinAgo,
  });

  const result = await adminPurgeDomainCacheAction({
    mappingId: mapping.id,
    actor: { userId: "admin-itest", userEmail: "admin@itest.dev" },
    reqCtx: REQ,
  });
  assert.equal(result.ok, true, "purge after cooldown should be accepted");

  const after2 = await readMapping(mapping.id);
  assert.ok(
    after2?.lastCachePurgeAt && after2.lastCachePurgeAt > twoMinAgo,
    "lastCachePurgeAt should advance to now"
  );
});

test("purge refused (422) until the domain is active on Cloudflare", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const cube = await seedCube(space.id, server.id, { status: "running" });

  // Registered on Cloudflare but routing still pending.
  const pending = await seedActiveDomain(cube.id, { status: "pending" });
  const r1 = await adminPurgeDomainCacheAction({
    mappingId: pending.id,
    actor: { userId: "admin-itest", userEmail: "admin@itest.dev" },
    reqCtx: REQ,
  });
  assert.equal(r1.ok, false);
  if (!r1.ok) {
    assert.equal(r1.status, 422);
  }

  // Active routing but never registered on Cloudflare (no hostname id).
  const noCf = await seedActiveDomain(cube.id, { cloudflareHostnameId: null });
  const r2 = await adminPurgeDomainCacheAction({
    mappingId: noCf.id,
    actor: { userId: "admin-itest", userEmail: "admin@itest.dev" },
    reqCtx: REQ,
  });
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.equal(r2.status, 422);
  }

  // Neither write should have stamped a cooldown.
  assert.equal((await readMapping(pending.id))?.lastCachePurgeAt, null);
  assert.equal((await readMapping(noCf.id))?.lastCachePurgeAt, null);
});

test("customer purge: mapping is scoped to its cube (wrong cube → 404)", async () => {
  const { spaceId, membershipId } = await seedApiKey();
  const server = await seedServer();
  const cubeA = await seedCube(spaceId, server.id, { status: "running" });
  const cubeB = await seedCube(spaceId, server.id, { status: "running" });
  const mapping = await seedActiveDomain(cubeA.id);

  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(eq(schema.spaceMemberships.id, membershipId))
    .limit(1);
  assert.ok(membership);

  const actor = {
    kind: "session" as const,
    userId: "u-itest",
    userEmail: "u@itest.dev",
  };

  // Mapping lives on cubeA — requesting it under cubeB must 404.
  const wrong = await purgeDomainCacheAction({
    actor,
    membership,
    spaceId,
    cubeId: cubeB.id,
    mappingId: mapping.id,
    reqCtx: REQ,
  });
  assert.equal(wrong.ok, false);
  if (!wrong.ok) {
    assert.equal(wrong.status, 404);
  }

  // Correct cube → accepted.
  const right = await purgeDomainCacheAction({
    actor,
    membership,
    spaceId,
    cubeId: cubeA.id,
    mappingId: mapping.id,
    reqCtx: REQ,
  });
  assert.equal(right.ok, true);
});

test("purge refused (422) for a wildcard / catch-all domain", async () => {
  const space = await seedSpace();
  const server = await seedServer();
  const cube = await seedCube(space.id, server.id, { status: "running" });
  // validateDomain rejects wildcards at add-time, so seed the row directly to
  // exercise the action's defense-in-depth guard (Cloudflare purge-by-hostname
  // cannot purge "*").
  const wildcard = await seedActiveDomain(cube.id, {
    domain: `*.itest-${createId().slice(0, 8)}.example.com`,
  });

  const result = await adminPurgeDomainCacheAction({
    mappingId: wildcard.id,
    actor: { userId: "admin-itest", userEmail: "admin@itest.dev" },
    reqCtx: REQ,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 422);
  }
  // No cooldown stamped — it never reached the claim.
  assert.equal((await readMapping(wildcard.id))?.lastCachePurgeAt, null);
});
