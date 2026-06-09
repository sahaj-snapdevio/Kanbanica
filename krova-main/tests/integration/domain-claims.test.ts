import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { addDomainAction } from "@/lib/cube-actions/domains";
import { db } from "@/lib/db";
import {
  createClaim,
  findCrossSpaceLock,
  releaseClaim,
  verifyClaim,
} from "@/lib/domains/claim-service";
import {
  seedApiKey,
  seedCube,
  seedServer,
  seedSpace,
} from "@/tests/integration/_seed";

const ACTOR = {
  actorType: "user" as const,
  actorId: "u-itest",
  actorEmail: "u@itest.dev",
  ipAddress: null,
  userAgent: null,
};
const YES = async () => true;
const NO = async () => false;

function uniqueDomain() {
  return `itest-${createId().slice(0, 10)}.example.com`;
}

async function seedVerifiedClaim(spaceId: string, domain: string) {
  const [row] = await db
    .insert(schema.spaceDomainClaims)
    .values({
      spaceId,
      domain,
      token: createId(),
      status: "verified",
      verifiedAt: new Date(),
    })
    .returning();
  return row;
}

async function seedActiveMapping(cubeId: string, domain: string) {
  await db.insert(schema.domainMappings).values({
    id: createId(),
    cubeId,
    domain,
    port: 80,
    status: "active",
    verificationStatus: "verified",
  });
}

test("findCrossSpaceLock: a verified claim locks other spaces, not the owner", async () => {
  const owner = await seedSpace();
  const other = await seedSpace();
  const domain = uniqueDomain();
  await seedVerifiedClaim(owner.id, domain);

  // Another space is locked out of the domain + its subdomains.
  assert.ok(await findCrossSpaceLock(domain, other.id));
  assert.ok(await findCrossSpaceLock(`app.${domain}`, other.id));
  // The owning space is NOT locked.
  assert.equal(await findCrossSpaceLock(`app.${domain}`, owner.id), null);
  // An unrelated hostname is unaffected.
  assert.equal(await findCrossSpaceLock(uniqueDomain(), other.id), null);
});

test("createClaim: refused when it overlaps another space's verified claim", async () => {
  const owner = await seedSpace();
  const other = await seedSpace();
  const domain = uniqueDomain();
  await seedVerifiedClaim(owner.id, domain);

  // exact domain + a subdomain are both blocked for the other space
  const exact = await createClaim(other.id, domain, ACTOR);
  assert.equal(exact.ok, false);
  if (!exact.ok) {
    assert.equal(exact.status, 409);
  }
  const sub = await createClaim(other.id, `app.${domain}`, ACTOR);
  assert.equal(sub.ok, false);

  // an unrelated domain is allowed
  const ok = await createClaim(other.id, uniqueDomain(), ACTOR);
  assert.equal(ok.ok, true);
});

test("createClaim: rejects wildcard / invalid domains", async () => {
  const space = await seedSpace();
  const wild = await createClaim(space.id, "*.acme.com", ACTOR);
  assert.equal(wild.ok, false);
  if (!wild.ok) {
    assert.equal(wild.status, 400);
  }
});

test("verifyClaim: TXT present flips pending→verified; absent stays pending", async () => {
  const space = await seedSpace();
  const domain = uniqueDomain();
  const created = await createClaim(space.id, domain, ACTOR);
  assert.ok(created.ok);
  const claimId = created.ok ? created.data.claim.id : "";

  // TXT absent → fail-closed, stays pending
  const miss = await verifyClaim(space.id, claimId, ACTOR, NO);
  assert.equal(miss.ok, false);
  if (!miss.ok) {
    assert.equal(miss.status, 422);
  }
  const [stillPending] = await db
    .select()
    .from(schema.spaceDomainClaims)
    .where(eq(schema.spaceDomainClaims.id, claimId));
  assert.equal(stillPending?.status, "pending");

  // TXT present → verified
  const hit = await verifyClaim(space.id, claimId, ACTOR, YES);
  assert.equal(hit.ok, true);
  const [verified] = await db
    .select()
    .from(schema.spaceDomainClaims)
    .where(eq(schema.spaceDomainClaims.id, claimId));
  assert.equal(verified?.status, "verified");
});

test("verifyClaim: a second space cannot verify a domain another space already locked", async () => {
  const a = await seedSpace();
  const b = await seedSpace();
  const domain = uniqueDomain();

  // Both create pending claims BEFORE anyone verifies (allowed — pending doesn't lock).
  const aClaim = await createClaim(a.id, domain, ACTOR);
  const bClaim = await createClaim(b.id, domain, ACTOR);
  assert.ok(aClaim.ok && bClaim.ok);

  // A verifies first → locked to A.
  const aVerify = await verifyClaim(
    a.id,
    aClaim.ok ? aClaim.data.claim.id : "",
    ACTOR,
    YES
  );
  assert.equal(aVerify.ok, true);

  // B now cannot verify the same domain.
  const bVerify = await verifyClaim(
    b.id,
    bClaim.ok ? bClaim.data.claim.id : "",
    ACTOR,
    YES
  );
  assert.equal(bVerify.ok, false);
  if (!bVerify.ok) {
    assert.equal(bVerify.status, 409);
  }
});

test("verifyClaim: blocked when another space has a live mapping under the domain", async () => {
  const a = await seedSpace();
  const b = await seedSpace();
  const server = await seedServer();
  const bCube = await seedCube(b.id, server.id, { status: "running" });
  const domain = uniqueDomain();
  await seedActiveMapping(bCube.id, `app.${domain}`);

  const aClaim = await createClaim(a.id, domain, ACTOR);
  assert.ok(aClaim.ok);
  const result = await verifyClaim(
    a.id,
    aClaim.ok ? aClaim.data.claim.id : "",
    ACTOR,
    YES
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
  }
});

test("addDomainAction: a verified claim in another space blocks the mapping", async () => {
  const lockOwner = await seedSpace();
  const { spaceId, membershipId } = await seedApiKey();
  const server = await seedServer();
  const cube = await seedCube(spaceId, server.id, { status: "running" });
  const domain = uniqueDomain();
  await seedVerifiedClaim(lockOwner.id, domain);

  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(eq(schema.spaceMemberships.id, membershipId));
  assert.ok(membership);

  const result = await addDomainAction(
    {
      actor: { kind: "session", userId: "u", userEmail: "u@itest.dev" },
      membership,
      spaceId,
      cubeId: cube.id,
      reqCtx: { ipAddress: null, userAgent: null },
    },
    { rawDomain: `app.${domain}`, port: 80 }
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.match(result.error, /locked to another space/);
  }
});

test("releaseClaim: frees the lock so another space can claim it", async () => {
  const a = await seedSpace();
  const b = await seedSpace();
  const domain = uniqueDomain();
  const claim = await seedVerifiedClaim(a.id, domain);
  assert.ok(claim);

  // locked for B
  assert.ok(await findCrossSpaceLock(domain, b.id));

  const released = await releaseClaim(a.id, claim?.id ?? "", ACTOR);
  assert.equal(released.ok, true);

  // lock gone; B can now create
  assert.equal(await findCrossSpaceLock(domain, b.id), null);
  const bCreate = await createClaim(b.id, domain, ACTOR);
  assert.equal(bCreate.ok, true);
});
