/**
 * Weekly security digest — notify-only.
 *
 * Runs every Monday at 08:00 UTC. Calls `runVersionScan()` to check our
 * pinned third-party versions (kernel, Firecracker, Caddy, Railpack,
 * Nixpacks, Pack, plus npm-pinned packages) against upstream releases and
 * GitHub Security Advisories. Emails one digest per admin user with
 * sections for: vulnerable / behind / up-to-date / errors.
 *
 * Notify-only by design (per Rule 7 + the operator preference): we never
 * auto-bump anything. The operator reads the digest and decides what to
 * upgrade. Upgrades go through the normal commit/deploy flow.
 *
 * Idempotent — re-running on the same day produces the same email
 * content. Recipients can be re-emailed safely; admin teams typically
 * appreciate a second copy after deletion. No de-dup guard needed since
 * pg-boss cron schedules don't double-fire.
 *
 * Audit log: writes one `security.weekly-scan.completed` entry per run
 * with the bucket counts for retroactive trail.
 */

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getPlatformBranding } from "@/lib/email/helpers";
import { securityDigestEmailTemplate } from "@/lib/email/templates/security-digest";
import { runVersionScan, summarizeScan } from "@/lib/security/version-check";

export async function handleSecurityWeeklyScan(): Promise<void> {
  const startedAt = new Date();
  const scanDate = startedAt.toISOString().slice(0, 10); // YYYY-MM-DD

  const results = await runVersionScan();
  const summary = summarizeScan(results);

  const recipients = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.role, "admin"));

  if (recipients.length === 0) {
    console.warn(
      "[security-weekly-scan] no admin users found — skipping email send"
    );
    await audit({
      action: "security.weekly-scan.completed",
      category: "platform",
      actorType: "system",
      entityType: "platform",
      description:
        "Weekly security scan completed but no admin recipients found",
      metadata: {
        scanDate,
        vulnerable: summary.vulnerable.length,
        behind: summary.behind.length,
        ok: summary.ok.length,
        errors: summary.error.length,
        recipientsCount: 0,
      },
      source: "system",
    });
    return;
  }

  const branding = getPlatformBranding();
  const subjectPrefix =
    summary.vulnerable.length > 0
      ? "[ACTION NEEDED]"
      : summary.behind.length > 0
        ? "[FYI]"
        : "[OK]";
  const subject = `${subjectPrefix} ${branding.productName} security digest — ${scanDate}`;

  const { html, text } = await securityDigestEmailTemplate({
    scanDate,
    vulnerable: summary.vulnerable,
    behind: summary.behind,
    ok: summary.ok,
    errors: summary.error,
  });

  let queued = 0;
  for (const r of recipients) {
    try {
      await enqueueEmail({ to: r.email, subject, html, text });
      queued++;
    } catch (err) {
      console.error(
        `[security-weekly-scan] failed to enqueue email to ${r.email}:`,
        err
      );
    }
  }

  console.log(
    `[security-weekly-scan] ${scanDate} — checked ${results.length}: ${summary.vulnerable.length} vulnerable, ${summary.behind.length} behind, ${summary.ok.length} ok, ${summary.error.length} errors. Queued ${queued}/${recipients.length} emails.`
  );

  await audit({
    action: "security.weekly-scan.completed",
    category: "platform",
    actorType: "system",
    entityType: "platform",
    description: `Weekly security scan: ${summary.vulnerable.length} vulnerable, ${summary.behind.length} behind, ${summary.ok.length} ok, ${summary.error.length} errors. Emailed ${queued} admin(s).`,
    metadata: {
      scanDate,
      vulnerable: summary.vulnerable.length,
      behind: summary.behind.length,
      ok: summary.ok.length,
      errors: summary.error.length,
      recipientsCount: recipients.length,
      emailsQueued: queued,
      vulnerableComponents: summary.vulnerable.map((r) => ({
        name: r.name,
        current: r.current,
        advisories: r.advisories.map((a) => a.ghsaId),
      })),
    },
    source: "system",
  });
}
