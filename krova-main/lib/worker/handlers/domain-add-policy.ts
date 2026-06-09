/**
 * Pure decision for what domain.add should do when its setup fails. Extracted
 * so the (untestable) handler I/O stays thin and the branch logic is unit-
 * tested. See domain-add.ts.
 *
 *  - keep-live: the mapping already flipped to `active`, so the domain is LIVE.
 *    A failure in a trivial post-success step (lifecycle log / Pusher / audit)
 *    must NOT tear it down (Rule 50 forward-flip). Log and treat as success.
 *  - retry: a transient failure with pg-boss retries remaining. Leave the row
 *    `pending` and the idempotent Cloudflare hostname in place; rethrow so the
 *    retry re-attempts. Deleting here is what made a single SSH/Cloudflare blip
 *    permanently destroy a customer's domain (the pg-boss retry then found no
 *    `pending` row and skipped).
 *  - cleanup: the FINAL attempt failed. Deregister the hostname + delete the
 *    row so a fresh re-add works (the (cube_id, domain) unique index needs the
 *    row gone).
 */

export type DomainAddFailureAction = "keep-live" | "retry" | "cleanup";

export function domainAddFailureAction(opts: {
  becameActive: boolean;
  /** pg-boss 0-based retrycount for this attempt. */
  retryCount: number;
  /** QUEUE_OPTIONS[DOMAIN_ADD].retryLimit. */
  retryLimit: number;
}): DomainAddFailureAction {
  if (opts.becameActive) {
    return "keep-live";
  }
  return opts.retryCount >= opts.retryLimit ? "cleanup" : "retry";
}
