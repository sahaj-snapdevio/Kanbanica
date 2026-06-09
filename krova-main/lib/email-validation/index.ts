/**
 * Signup-time email-domain validation.
 *
 * Two layers, applied in order:
 *
 *   1. Disposable-email blocklist (`disposable_email_domains` table)
 *      - Curated list (~5,500 entries) of known temporary / throwaway /
 *        spam-trap email services. The industry-standard way to filter
 *        signups from services like mailinator, 10minutemail,
 *        guerrillamail, tempmail. Refreshed weekly by the
 *        `disposable-emails.refresh` pg-boss cron (Sundays at 04:00 UTC)
 *        and on-demand via `pnpm refresh:disposable-emails`. Lookup is
 *        a single indexed PK probe — sub-millisecond on a warm Postgres.
 *
 *   2. DNS MX lookup (Node's `dns/promises`)
 *      - Catches typos at the apex (`gmial.com`, `gmail.con`,
 *        `outloook.com`).
 *      - Fail-OPEN philosophy: only reject on a DEFINITIVE NXDOMAIN /
 *        empty-MX-array response. Timeouts, SERVFAIL, transient network
 *        errors → allow the signup, so a flaky DNS resolver at the worker
 *        egress doesn't lock legitimate users out. The disposable list
 *        catches the abuse case anyway; MX is just a "did you typo?" gate.
 *
 * Why NOT a plain HTTP GET on the domain (the obvious-sounding approach):
 *   - Most disposable services return 200 OK (they have a public homepage
 *     showing their inbox).
 *   - Many legitimate email providers don't serve a 200 at their apex —
 *     they redirect, block bots, or serve only on a subdomain like `www.`.
 *   - Adds 1–3 s of network latency to every signup with no gain.
 *
 * Call site: `lib/auth.ts` `sendMagicLink` (the only customer-facing
 * signup path — Google OAuth already verifies email ownership upstream).
 * Existing-user signins bypass the gate entirely (see auth.ts), so
 * admin-triggered magic links and legacy accounts keep working.
 */

import { promises as dns } from "node:dns";
import { eq } from "drizzle-orm";
import { disposableEmailDomains } from "@/db/schema";
import { db } from "@/lib/db";

export type EmailValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_format" | "disposable" | "unknown_domain";
      message: string;
    };

/**
 * Hard cap on the DNS lookup. Picked so a slow resolver can't stall the
 * signup endpoint, but long enough that a healthy lookup over a moderate
 * link finishes comfortably.
 */
const DNS_TIMEOUT_MS = 3000;

/**
 * Extract the lower-cased domain portion of an email address, or `null`
 * if the input doesn't look like an email at all.
 */
function extractDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const atIdx = trimmed.lastIndexOf("@");
  if (atIdx <= 0 || atIdx === trimmed.length - 1) {
    return null;
  }
  const domain = trimmed.slice(atIdx + 1);
  // Cheap sanity: a domain must contain at least one dot and no whitespace.
  if (!domain.includes(".") || /\s/.test(domain)) {
    return null;
  }
  return domain;
}

/**
 * Returns true iff the given email's domain is in the
 * `disposable_email_domains` table. Domain comparison is case-insensitive
 * (we lower-case both sides; the table is populated with lower-cased
 * values by the refresh job). Returns false for malformed inputs (let
 * the format check surface those separately).
 *
 * Fail-OPEN on DB error: if the lookup throws, we treat the email as
 * NOT disposable (return `false` so the signup proceeds). The cost of
 * a transient DB blip blocking a legitimate signup is higher than the
 * cost of letting through one disposable signup that we'd otherwise
 * have caught — the MX check is still a downstream filter, and the
 * weekly cron continues protecting future signups once the DB recovers.
 */
export async function isDisposableEmailDomain(email: string): Promise<boolean> {
  const domain = extractDomain(email);
  if (!domain) {
    return false;
  }
  try {
    const [hit] = await db
      .select({ domain: disposableEmailDomains.domain })
      .from(disposableEmailDomains)
      .where(eq(disposableEmailDomains.domain, domain))
      .limit(1);
    return !!hit;
  } catch (err) {
    console.error(
      "[email-validation] disposable lookup failed, failing open:",
      err
    );
    return false;
  }
}

/**
 * Returns:
 *   - `"ok"` if the domain has at least one MX record (or the lookup
 *     timed out / errored transiently — fail-open).
 *   - `"nxdomain"` only on a DEFINITIVE "domain does not exist" or
 *     "no MX records" response.
 *
 * Times out at `DNS_TIMEOUT_MS`. Internal helper — call sites should use
 * `validateEmailForSignup` which composes this with the disposable check.
 */
async function checkMxRecord(domain: string): Promise<"ok" | "nxdomain"> {
  const lookup = dns.resolveMx(domain).then(
    (records): "ok" | "nxdomain" => {
      if (records.length === 0) {
        return "nxdomain";
      }
      return "ok";
    },
    (err: NodeJS.ErrnoException): "ok" | "nxdomain" => {
      // NXDOMAIN / NODATA → definitive "no such domain / no MX". Reject.
      if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
        return "nxdomain";
      }
      // Everything else (timeout, SERVFAIL, network blip) → fail open.
      return "ok";
    }
  );

  const timeout = new Promise<"ok">((resolve) =>
    setTimeout(() => resolve("ok"), DNS_TIMEOUT_MS)
  );

  return Promise.race([lookup, timeout]);
}

/**
 * Run the full signup-time email validation pipeline.
 *
 * Returns `{ ok: true }` if the email passes both layers. On failure
 * returns a structured `{ ok: false, reason, message }` so call sites can
 * branch on the machine-readable `reason` and pass `message` straight
 * through to the user-facing error.
 *
 * The check ordering matters:
 *   1. Format sanity first (cheap, no I/O).
 *   2. Disposable lookup next (one indexed DB probe, sub-ms warm).
 *   3. MX lookup last (network round-trip).
 */
export async function validateEmailForSignup(
  email: string
): Promise<EmailValidationResult> {
  const domain = extractDomain(email);
  if (!domain) {
    return {
      ok: false,
      reason: "invalid_format",
      message: "Please enter a valid email address.",
    };
  }

  if (await isDisposableEmailDomain(email)) {
    return {
      ok: false,
      reason: "disposable",
      message:
        "Disposable email addresses aren't accepted. Please use a permanent email.",
    };
  }

  const mxResult = await checkMxRecord(domain);
  if (mxResult === "nxdomain") {
    return {
      ok: false,
      reason: "unknown_domain",
      message:
        "We couldn't find an email server for this domain. Please double-check the address.",
    };
  }

  return { ok: true };
}
