import { promises as dns } from "node:dns";
import { claimTxtHost, claimTxtValue } from "@/lib/domains/claim-coverage";

const DNS_TIMEOUT_MS = 3000;

/**
 * Confirm a domain claim's ownership TXT record.
 *
 * **FAIL-CLOSED**: returns `true` ONLY if the exact value
 * `krova-domain-verification=<token>` is present at `_krova-verify.<domain>`.
 * Any miss / NXDOMAIN / NODATA / SERVFAIL / timeout / network error → `false`.
 * This is the OPPOSITE polarity from the fail-open MX check in
 * `lib/email-validation` — a claim must be POSITIVELY proven before it locks a
 * domain to a space, so when in doubt we refuse.
 *
 * `dns.resolveTxt` returns `string[][]` — each record is an array of chunks
 * (TXT strings can be split into ≤255-byte segments), so each record's chunks
 * are concatenated before comparison.
 */
export async function verifyClaimTxt(
  domain: string,
  token: string
): Promise<boolean> {
  const host = claimTxtHost(domain);
  const expected = claimTxtValue(token);

  const lookup = dns.resolveTxt(host).then(
    (records): boolean =>
      records.some((chunks) => chunks.join("") === expected),
    (): boolean => false
  );
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(false), DNS_TIMEOUT_MS)
  );
  return Promise.race([lookup, timeout]);
}
