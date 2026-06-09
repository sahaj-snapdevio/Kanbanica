import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { validateEmailForSignup } from "@/lib/email-validation";

// Signup email-domain gate (lib/email-validation). Two of three layers are
// deterministic and DB-backed; the MX layer fails OPEN so it can't flake the
// suite. Email SENDING is never exercised here — this is pure validation.

test("signup: rejects a malformed address (format layer, no I/O)", async () => {
  const r = await validateEmailForSignup("not-an-email");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "invalid_format");
  }
});

test("signup: rejects a domain present in disposable_email_domains", async () => {
  const domain = `trash-${createId().slice(0, 10)}.test`;
  await db
    .insert(schema.disposableEmailDomains)
    .values({ domain })
    .onConflictDoNothing();

  try {
    const r = await validateEmailForSignup(`user@${domain}`);
    assert.equal(r.ok, false, "a seeded disposable domain must be rejected");
    if (!r.ok) {
      assert.equal(r.reason, "disposable");
    }
  } finally {
    await db
      .delete(schema.disposableEmailDomains)
      .where(eq(schema.disposableEmailDomains.domain, domain));
  }
});

test("signup: a domain NOT in the table is not rejected as disposable", async () => {
  // gmail.com has MX records; even on a host that can't resolve DNS the MX
  // check fails OPEN (timeout/servfail → valid), so the only deterministic
  // assertion is "not rejected for being disposable".
  const r = await validateEmailForSignup("someone@gmail.com");
  if (!r.ok) {
    assert.notEqual(
      r.reason,
      "disposable",
      "gmail.com is not a disposable domain"
    );
  }
});
