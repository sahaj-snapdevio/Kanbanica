import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { withIdempotency } from "@/lib/api/idempotency";
import { seedSpace } from "@/tests/integration/_seed";

// Claim-first idempotency (lib/api/idempotency) against the real
// idempotency_keys unique index — the 2026-05-31 audit fix that stopped two
// concurrent same-key POSTs from both creating a billed cube.

test("idempotency: sequential retry replays the cached response", async () => {
  const space = await seedSpace();
  const key = createId();
  let calls = 0;
  const fn = async () => {
    calls++;
    return Response.json({ cube: "abc" }, { status: 201 });
  };

  const first = await withIdempotency(key, space.id, fn);
  const second = await withIdempotency(key, space.id, fn);

  assert.equal(calls, 1, "handler runs exactly once across the retry");
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.headers.get("Idempotency-Replayed"), "true");
  assert.deepEqual(await second.json(), { cube: "abc" });
});

test("idempotency: concurrent same-key calls run the handler exactly once", async () => {
  const space = await seedSpace();
  const key = createId();
  let calls = 0;
  const fn = async () => {
    calls++;
    // Hold the claim briefly so the sibling call overlaps the in-flight window.
    await new Promise((r) => setTimeout(r, 50));
    return Response.json({ ok: true }, { status: 201 });
  };

  const [a, b] = await Promise.all([
    withIdempotency(key, space.id, fn),
    withIdempotency(key, space.id, fn),
  ]);

  assert.equal(calls, 1, "the unique index serializes the claim to one winner");
  const statuses = [a.status, b.status].sort();
  // One request wins (201); the loser gets the in-progress 409.
  assert.deepEqual(statuses, [201, 409]);
});

test("idempotency: a 5xx drops the claim so a later retry re-runs", async () => {
  const space = await seedSpace();
  const key = createId();
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) {
      return Response.json({ error: "boom" }, { status: 500 });
    }
    return Response.json({ ok: true }, { status: 201 });
  };

  const first = await withIdempotency(key, space.id, fn);
  assert.equal(first.status, 500);

  const second = await withIdempotency(key, space.id, fn);
  assert.equal(calls, 2, "the dropped claim lets the retry re-run the handler");
  assert.equal(second.status, 201);
  assert.equal(
    second.headers.get("Idempotency-Replayed"),
    null,
    "the retry is a fresh run, not a replay"
  );
});

test("idempotency: keys do not collide across spaces", async () => {
  const spaceA = await seedSpace();
  const spaceB = await seedSpace();
  const key = createId();
  let calls = 0;
  const fn = async () => {
    calls++;
    return Response.json({ n: calls }, { status: 201 });
  };

  await withIdempotency(key, spaceA.id, fn);
  await withIdempotency(key, spaceB.id, fn);

  assert.equal(calls, 2, "same key in two spaces runs the handler twice");
});
