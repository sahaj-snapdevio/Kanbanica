import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { db } from "@/lib/db";
import { seedApiKey, seedCube, seedServer } from "@/tests/integration/_seed";

// The v1 REST API surface: the x-api-key auth gate that protects every route,
// plus a real route end-to-end (GET cubes) and a public route. Auth is
// API-key (not session), so these run fully in the integration harness.

function req(spaceId: string, key?: string): Request {
  return new Request(`http://localhost/api/v1/spaces/${spaceId}/cubes`, {
    headers: key ? { "x-api-key": key } : {},
  });
}

async function expect401(p: Promise<unknown>, label: string) {
  try {
    await p;
    assert.fail(`${label}: expected a 401, but it resolved`);
  } catch (e) {
    assert.ok(e instanceof Response, `${label}: threw a non-Response`);
    assert.equal((e as Response).status, 401, label);
  }
}

test("requireV1ApiKey: a valid key authenticates as its (owner) membership", async () => {
  const { fullKey, spaceId, membershipId } = await seedApiKey();
  const { membership, apiKeyId } = await requireV1ApiKey(
    req(spaceId, fullKey),
    spaceId
  );
  assert.equal(membership.id, membershipId);
  assert.equal(membership.isOwner, true);
  assert.ok(apiKeyId);
});

test("requireV1ApiKey: missing / invalid / revoked / wrong-space keys all 401", async () => {
  const { fullKey, spaceId, apiKeyId } = await seedApiKey();

  await expect401(requireV1ApiKey(req(spaceId), spaceId), "missing header");
  await expect401(
    requireV1ApiKey(req(spaceId, "kro_totally-bogus-key"), spaceId),
    "invalid key"
  );

  // A key minted for space A must not work against space B.
  const other = await seedApiKey();
  await expect401(
    requireV1ApiKey(req(other.spaceId, fullKey), other.spaceId),
    "key used against a different space"
  );

  // Revoke it → now rejected.
  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(schema.apiKeys.id, apiKeyId));
  await expect401(
    requireV1ApiKey(req(spaceId, fullKey), spaceId),
    "revoked key"
  );
});

test("GET /v1/.../cubes: lists the space's cubes, never leaks internal IPs, 401 without key", async () => {
  const { fullKey, spaceId } = await seedApiKey();
  const server = await seedServer();
  await seedCube(spaceId, server.id, {
    status: "running",
    internalIp: "198.18.5.10",
    internalIpv6: "fd00:c0be:5::a",
  });

  const { GET } = await import("@/app/api/v1/spaces/[spaceId]/cubes/route");

  // No key → 401.
  const unauth = await GET(req(spaceId), {
    params: Promise.resolve({ spaceId }),
  });
  assert.equal(unauth.status, 401, "no key must be 401");

  // Valid key → 200 + the cube, with NO internal IPs in the wire shape.
  const res = await GET(req(spaceId, fullKey), {
    params: Promise.resolve({ spaceId }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cubes: unknown[] };
  assert.ok(Array.isArray(body.cubes), "response has a cubes array");
  assert.equal(body.cubes.length, 1, "the seeded cube is listed");
  const json = JSON.stringify(body);
  assert.ok(!json.includes("198.18.5.10"), "internal_ip leaked in v1 response");
  assert.ok(!json.includes("fd00:c0be"), "internal_ipv6 leaked in v1 response");

  // Valid key but a DIFFERENT space → 401 (key is space-scoped).
  const wrong = await GET(req(createId(), fullKey), {
    params: Promise.resolve({ spaceId: createId() }),
  });
  assert.equal(wrong.status, 401, "key must not work for another space");
});

function postReq(
  spaceId: string,
  key: string | undefined,
  body: unknown
): Request {
  return new Request(`http://localhost/api/v1/spaces/${spaceId}/cubes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-api-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("POST /v1/.../cubes: gates auth → permission → validation before any side effect", async () => {
  const { POST } = await import("@/app/api/v1/spaces/[spaceId]/cubes/route");
  const owner = await seedApiKey();
  const params = (id: string) => ({ params: Promise.resolve({ spaceId: id }) });

  // No key → 401 (never reaches validation/enqueue).
  const noKey = await POST(
    postReq(owner.spaceId, undefined, {}),
    params(owner.spaceId)
  );
  assert.equal(noKey.status, 401, "no key → 401");

  // A non-owner membership without cube.create → 403 (before body validation).
  const viewer = await seedApiKey({ spaceId: owner.spaceId, isOwner: false });
  const forbidden = await POST(
    postReq(owner.spaceId, viewer.fullKey, {}),
    params(owner.spaceId)
  );
  assert.equal(forbidden.status, 403, "missing cube.create → 403");

  // Owner + missing sshPublicKey → 400 validation (still before allocate/enqueue).
  const missingKey = await POST(
    postReq(owner.spaceId, owner.fullKey, {
      vcpus: 1,
      ramMb: 1024,
      diskLimitGb: 10,
    }),
    params(owner.spaceId)
  );
  assert.equal(missingKey.status, 400, "missing sshPublicKey → 400");

  // Owner + out-of-range vcpus → 400.
  const badVcpus = await POST(
    postReq(owner.spaceId, owner.fullKey, {
      vcpus: 999,
      ramMb: 1024,
      diskLimitGb: 10,
      sshPublicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYxxxxxxxxxxxxxxxxxxxxxxxx test",
    }),
    params(owner.spaceId)
  );
  assert.equal(badVcpus.status, 400, "out-of-range vcpus → 400");
});

test("GET /v1/regions (public): returns regions that have an active server", async () => {
  const server = await seedServer(); // status defaults to 'active'
  const { GET } = await import("@/app/api/v1/regions/route");
  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { regions: { id: string }[] };
  assert.ok(Array.isArray(body.regions));
  assert.ok(
    body.regions.some((r) => r.id === server.regionId),
    "the seeded active server's region is listed"
  );
});
