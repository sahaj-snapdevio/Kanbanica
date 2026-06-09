/**
 * Pure helpers for space domain claims — normalization, coverage, and the
 * parent-domain enumeration the lock-enforcement query uses. No DB / no I/O;
 * unit-tested in claim-coverage.test.ts.
 */

import {
  DOMAIN_CLAIM_TXT_HOST_PREFIX,
  DOMAIN_CLAIM_TXT_VALUE_PREFIX,
} from "@/config/platform";
import { validateDomain } from "@/lib/validators";

/**
 * Normalize + validate a domain a space wants to claim. Lowercases, strips a
 * trailing dot, and validates via `validateDomain` — which already rejects
 * wildcards (`*`), single-label names (`com`), and malformed input. Returns the
 * normalized domain, or null if invalid.
 */
export function normalizeClaimDomain(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim().toLowerCase().replace(/\.$/, "");
  return validateDomain(trimmed);
}

/**
 * True iff `claimDomain` covers `hostname` — `hostname` IS the claim domain or
 * a subdomain of it. The leading-dot boundary means `acme.com` covers
 * `app.acme.com` but NOT `notacme.com`. Both inputs are assumed already
 * lowercased + trailing-dot-stripped (use `normalizeClaimDomain`).
 */
export function claimCovers(claimDomain: string, hostname: string): boolean {
  return hostname === claimDomain || hostname.endsWith(`.${claimDomain}`);
}

/**
 * Every ≥2-label suffix of `hostname`, from the full hostname down to the
 * 2-label apex (never a bare TLD). Used to find a covering claim with an
 * indexed `domain IN (...)` query:
 *   `a.b.acme.com` → ["a.b.acme.com", "b.acme.com", "acme.com"]
 *   `acme.com`     → ["acme.com"]
 *   `com`          → []
 */
export function candidateParentDomains(hostname: string): string[] {
  const labels = hostname.split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) {
    out.push(labels.slice(i).join("."));
  }
  return out;
}

/**
 * True iff two claim domains overlap — one covers the other. Used to keep
 * verified claims across spaces disjoint (no parent/child straddling spaces).
 */
export function claimsOverlap(a: string, b: string): boolean {
  return claimCovers(a, b) || claimCovers(b, a);
}

/**
 * Decide a recheck outcome for a verified claim (pure). On a successful check
 * (`proven`), reset the miss counter. On a miss, increment it and signal
 * `release` once it reaches `maxFailedChecks` — the lock auto-releases so a
 * removed TXT / transferred domain can't hold a domain hostage forever.
 */
export function recheckClaimDecision(
  failedChecks: number,
  proven: boolean,
  maxFailedChecks: number
): { failedChecks: number; release: boolean } {
  if (proven) {
    return { failedChecks: 0, release: false };
  }
  const next = failedChecks + 1;
  return { failedChecks: next, release: next >= maxFailedChecks };
}

/** The TXT record host for a claim, e.g. `_krova-verify.acme.com`. */
export function claimTxtHost(domain: string): string {
  return `${DOMAIN_CLAIM_TXT_HOST_PREFIX}.${domain}`;
}

/** The full TXT record value for a claim, e.g. `krova-domain-verification=<token>`. */
export function claimTxtValue(token: string): string {
  return `${DOMAIN_CLAIM_TXT_VALUE_PREFIX}${token}`;
}
