import assert from "node:assert/strict";
import { test } from "node:test";
import {
  candidateParentDomains,
  claimCovers,
  claimsOverlap,
  normalizeClaimDomain,
  recheckClaimDecision,
} from "@/lib/domains/claim-coverage";

test("normalizeClaimDomain: accepts + normalizes valid registrable domains", () => {
  assert.equal(normalizeClaimDomain("acme.com"), "acme.com");
  assert.equal(normalizeClaimDomain("  ACME.com "), "acme.com");
  assert.equal(normalizeClaimDomain("acme.com."), "acme.com"); // trailing dot
  assert.equal(normalizeClaimDomain("app.acme.co.uk"), "app.acme.co.uk");
});

test("normalizeClaimDomain: rejects wildcard / single-label / invalid / non-string", () => {
  assert.equal(normalizeClaimDomain("*.acme.com"), null);
  assert.equal(normalizeClaimDomain("com"), null);
  assert.equal(normalizeClaimDomain(""), null);
  assert.equal(normalizeClaimDomain("not a domain"), null);
  assert.equal(normalizeClaimDomain("acme..com"), null);
  assert.equal(normalizeClaimDomain(null), null);
  assert.equal(normalizeClaimDomain(123), null);
});

test("claimCovers: apex + subdomains, with the dot boundary", () => {
  assert.equal(claimCovers("acme.com", "acme.com"), true); // apex itself
  assert.equal(claimCovers("acme.com", "app.acme.com"), true);
  assert.equal(claimCovers("acme.com", "a.b.acme.com"), true);
  // dot boundary — these must NOT be covered
  assert.equal(claimCovers("acme.com", "notacme.com"), false);
  assert.equal(claimCovers("acme.com", "xacme.com"), false);
  assert.equal(claimCovers("acme.com", "acme.com.evil.com"), false);
  assert.equal(claimCovers("acme.com", "acme.org"), false);
  assert.equal(claimCovers("acme.com", "com"), false);
});

test("candidateParentDomains: every ≥2-label suffix, no bare TLD", () => {
  assert.deepEqual(candidateParentDomains("a.b.acme.com"), [
    "a.b.acme.com",
    "b.acme.com",
    "acme.com",
  ]);
  assert.deepEqual(candidateParentDomains("app.acme.com"), [
    "app.acme.com",
    "acme.com",
  ]);
  assert.deepEqual(candidateParentDomains("acme.com"), ["acme.com"]);
  assert.deepEqual(candidateParentDomains("com"), []);
});

test("claimsOverlap: parent/child overlap, disjoint siblings don't", () => {
  assert.equal(claimsOverlap("acme.com", "app.acme.com"), true); // parent/child
  assert.equal(claimsOverlap("app.acme.com", "acme.com"), true); // symmetric
  assert.equal(claimsOverlap("acme.com", "acme.com"), true); // identical
  assert.equal(claimsOverlap("a.acme.com", "b.acme.com"), false); // siblings
  assert.equal(claimsOverlap("acme.com", "acme.org"), false); // unrelated
});

test("recheckClaimDecision: proven resets, misses accumulate then release", () => {
  const MAX = 3;
  // proven → reset to 0, never release (even if it had prior misses)
  assert.deepEqual(recheckClaimDecision(2, true, MAX), {
    failedChecks: 0,
    release: false,
  });
  // miss from 0 → 1, no release
  assert.deepEqual(recheckClaimDecision(0, false, MAX), {
    failedChecks: 1,
    release: false,
  });
  // miss from 1 → 2, no release
  assert.deepEqual(recheckClaimDecision(1, false, MAX), {
    failedChecks: 2,
    release: false,
  });
  // miss from 2 → 3 = MAX → release
  assert.deepEqual(recheckClaimDecision(2, false, MAX), {
    failedChecks: 3,
    release: true,
  });
});
