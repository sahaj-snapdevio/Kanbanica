/**
 * On-demand refresh of the `disposable_email_domains` table.
 *
 * Wraps the shared `refreshDisposableEmailDomains()` core that powers
 * the weekly `disposable-emails.refresh` pg-boss cron — both paths
 * execute the same DB transaction (TRUNCATE + bulk INSERT from the
 * upstream `disposable-email-domains/disposable-email-domains` CC0
 * list), so the cron and the operator CLI can't drift.
 *
 * Use after deploying the feature for the first time (the table starts
 * empty after migration, so you don't want to wait up to a week for the
 * Sunday cron to populate it) or to pull in a fresh list ahead of the
 * normal schedule.
 *
 * Run: pnpm refresh:disposable-emails
 */

import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

import { refreshDisposableEmailDomains } from "@/lib/email-validation/refresh";

async function main(): Promise<void> {
  console.log("[refresh-disposable-domains] starting");

  const result = await refreshDisposableEmailDomains();

  console.log(
    `[refresh-disposable-domains] done — fetched ${result.fetched}, ` +
      `inserted ${result.inserted}, previous count ${result.previousCount} ` +
      `(net change ${result.inserted - result.previousCount})`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[refresh-disposable-domains] failed:", err);
    process.exit(1);
  });
