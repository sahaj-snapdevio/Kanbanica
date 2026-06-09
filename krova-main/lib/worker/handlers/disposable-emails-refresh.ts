/**
 * Weekly refresh of the `disposable_email_domains` blocklist.
 *
 * Pulls the CC0-licensed upstream list from
 * `disposable-email-domains/disposable-email-domains` and idempotently
 * replaces the table contents. Shares its core logic with
 * `pnpm refresh:disposable-emails` via
 * `lib/email-validation/refresh.ts` so the cron and the operator CLI
 * cannot drift.
 *
 * Scheduling: weekly on Sundays at 04:00 UTC (the same low-traffic
 * window the restic-prune cron uses). policy=exclusive +
 * retryLimit=0 — a transient upstream / DB hiccup is fine to skip; the
 * next week's tick will heal the blocklist. Manual operator refresh
 * remains available via the pnpm script.
 *
 * Failure handling: the refresh helper throws on (a) upstream HTTP
 * failure, (b) a suspiciously small response (< 1000 entries — guards
 * against an empty upstream blanking our list), and (c) DB error. The
 * handler logs + audit-logs the failure so an operator sees it; the
 * existing blocklist contents are preserved untouched on any failure
 * because the helper does its work inside a single transaction.
 */

import type { Job } from "pg-boss";
import { audit } from "@/lib/audit";
import { refreshDisposableEmailDomains } from "@/lib/email-validation/refresh";

async function runHandler(_job: Job): Promise<void> {
  void _job;
  console.log("[disposable-emails-refresh] starting weekly refresh");

  try {
    const result = await refreshDisposableEmailDomains();
    const netChange = result.inserted - result.previousCount;

    console.log(
      `[disposable-emails-refresh] complete — fetched ${result.fetched}, ` +
        `inserted ${result.inserted}, previous count ${result.previousCount} ` +
        `(net change ${netChange >= 0 ? "+" : ""}${netChange})`
    );

    audit({
      action: "disposable_emails.refresh_complete",
      category: "platform",
      actorType: "system",
      entityType: "platform_settings",
      entityId: "disposable_email_domains",
      description: `Weekly disposable-email blocklist refresh — ${result.inserted} entries (${netChange >= 0 ? "+" : ""}${netChange} vs previous)`,
      metadata: {
        fetched: result.fetched,
        inserted: result.inserted,
        previousCount: result.previousCount,
        netChange,
      },
      source: "worker",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[disposable-emails-refresh] failed:", err);
    audit({
      action: "disposable_emails.refresh_failed",
      category: "platform",
      actorType: "system",
      entityType: "platform_settings",
      entityId: "disposable_email_domains",
      description: `Weekly disposable-email blocklist refresh failed: ${msg.slice(0, 200)}`,
      metadata: { error: msg.slice(0, 1000) },
      source: "worker",
    });
    // Swallow — retryLimit=0 means pg-boss won't re-queue. Operator can
    // run the manual `pnpm refresh:disposable-emails` script to retry
    // before the next weekly tick.
  }
}

export async function handleDisposableEmailsRefresh(
  jobs: Job[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
