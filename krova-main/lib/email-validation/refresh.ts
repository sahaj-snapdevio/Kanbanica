/**
 * Shared refresh-core for the `disposable_email_domains` table.
 *
 * Pulls the canonical list from the CC0-licensed
 * `disposable-email-domains/disposable-email-domains` GitHub repo and
 * idempotently replaces the table contents inside a single transaction
 * (TRUNCATE + bulk INSERT). One source of truth so the operator CLI
 * (`pnpm refresh:disposable-emails`) and the weekly pg-boss cron
 * (`disposable-emails.refresh`) execute the same code path.
 *
 * Safety:
 *   - Refuses to overwrite if the upstream returns a suspiciously small
 *     list (< 1000 entries) — a 200 OK with a near-empty body would
 *     otherwise blank our blocklist.
 *   - All-or-nothing transaction. A crash mid-refresh leaves the prior
 *     contents intact.
 *   - Bulk INSERT in batches of 1000 to stay within Postgres parameter
 *     limits and keep memory footprint bounded.
 */

import { sql } from "drizzle-orm";
import { disposableEmailDomains } from "@/db/schema";
import { db } from "@/lib/db";

const UPSTREAM_URL =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";

const MIN_REASONABLE_COUNT = 1000;
const INSERT_BATCH_SIZE = 1000;

export interface RefreshResult {
  fetched: number;
  inserted: number;
  previousCount: number;
}

/**
 * Fetch the upstream list, parse and dedup, then replace the table
 * contents in one transaction. Throws on upstream HTTP failure, on a
 * suspiciously small list, or on DB error — caller decides whether
 * that aborts the deploy / cron / CLI invocation.
 */
export async function refreshDisposableEmailDomains(): Promise<RefreshResult> {
  const res = await fetch(UPSTREAM_URL, {
    headers: { Accept: "text/plain" },
  });
  if (!res.ok) {
    throw new Error(
      `Upstream blocklist fetch failed: ${res.status} ${res.statusText}`
    );
  }

  const text = await res.text();
  const domains = Array.from(
    new Set(
      text
        .split("\n")
        .map((l) => l.trim().toLowerCase())
        // Drop empty + commented lines + obvious junk that lacks a dot.
        .filter((l) => l.length > 0 && !l.startsWith("#") && l.includes("."))
    )
  ).sort();

  if (domains.length < MIN_REASONABLE_COUNT) {
    throw new Error(
      `Upstream blocklist suspiciously small (${domains.length} entries < ${MIN_REASONABLE_COUNT}) — refusing to replace`
    );
  }

  return db.transaction(async (tx) => {
    const [{ count: prevCount }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(disposableEmailDomains);

    // TRUNCATE is faster than DELETE for a full replacement and resets
    // the table cleanly. The whole operation runs inside one tx so a
    // concurrent SELECT either sees the old set or the new set, never
    // an intermediate empty state.
    await tx.execute(sql`TRUNCATE TABLE ${disposableEmailDomains}`);

    let inserted = 0;
    for (let i = 0; i < domains.length; i += INSERT_BATCH_SIZE) {
      const batch = domains.slice(i, i + INSERT_BATCH_SIZE);
      await tx
        .insert(disposableEmailDomains)
        .values(batch.map((domain) => ({ domain })));
      inserted += batch.length;
    }

    return {
      fetched: domains.length,
      inserted,
      previousCount: Number(prevCount),
    };
  });
}
