import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { checkCreditBalance } from "@/lib/credit-check";
import { seedSpace } from "@/tests/integration/_seed";

// Pre-provision credit gate (createCube / wakeCube / redeploy use this).

const specs = { vcpus: 1, ramMb: 1024, diskLimitGb: 10 };

test("checkCreditBalance: a zero-balance space is refused with required+available", async () => {
  const space = await seedSpace({ creditBalance: "0.0000" });
  const r = await checkCreditBalance(space.id, specs);
  assert.ok("error" in r, "zero balance must be refused");
  if ("error" in r) {
    assert.equal(r.error, "Insufficient credits");
    assert.ok((r.required ?? 0) > 0, "hourly cost is positive");
    assert.equal(r.available, 0);
  }
});

test("checkCreditBalance: a funded space passes and returns the hourly cost", async () => {
  const space = await seedSpace({ creditBalance: "100.0000" });
  const r = await checkCreditBalance(space.id, specs);
  assert.ok("ok" in r && r.ok === true, "funded space passes");
  if ("ok" in r) {
    assert.ok(r.hourlyCost > 0, "hourly cost is positive");
  }
});

test("checkCreditBalance: a missing space → Space not found", async () => {
  const r = await checkCreditBalance(`nonexistent_${createId()}`, specs);
  assert.ok("error" in r);
  if ("error" in r) {
    assert.equal(r.error, "Space not found");
  }
});
