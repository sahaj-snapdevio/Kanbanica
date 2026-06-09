/**
 * One-off remediation: re-push Caddy routing on every ready server so any
 * STALE custom-domain routes left behind by past cube transfers are dropped.
 *
 * Why this is needed: before the 2026-05-29 transfer fix, the cube-transfer
 * source-teardown gated route removal on the vestigial `verificationStatus`
 * column, so it never ran for live domains. Every server a cube was
 * transferred AWAY from kept a stale `custom-<domain>` Caddy route pointing at
 * the cube's old internal IP. Those routes are dormant (Cloudflare no longer
 * routes the hostname there) but are latent cross-tenant risk if that internal
 * IP is later reused by a new cube on that server.
 *
 * What it does: enqueues a `server.refresh-caddy` job per ready server. That
 * handler rebuilds the entire `srv0` routes array from the DB truth
 * (`getActiveCustomDomainsForServer` → only domains whose cube CURRENTLY lives
 * on that server), so every stale route is dropped in the atomic rebuild. It
 * also re-asserts the landing route, DNS records, Origin CA cert, and ACME
 * policy — all idempotent. Reusing the tested handler (rather than duplicating
 * SSH logic here) means the cleanup goes through the same audited, job-logged
 * path as the operator's "Refresh Routing" button.
 *
 * The worker MUST be running to process the enqueued jobs. Watch progress per
 * server under Orbit → Servers → <server> → Logs.
 *
 * Idempotent — safe to re-run; a server already in its desired routing state
 * is re-pushed identically.
 *
 * Run: pnpm routing:refresh-fleet
 */

import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main(): Promise<void> {
  const { and, eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers } = await import("@/db/schema");
  const { enqueueJob } = await import("@/lib/worker/enqueue");
  const { JOB_NAMES } = await import("@/lib/worker/job-types");

  // refresh-caddy only operates on a fully set-up server (it touches the
  // landing route + automation policy that the install phase establishes).
  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(and(eq(servers.status, "active"), eq(servers.setupPhase, "ready")));

  if (rows.length === 0) {
    console.log("No active + ready servers found — nothing to refresh.");
    return;
  }

  console.log(
    `Enqueuing server.refresh-caddy for ${rows.length} ready server(s)...\n`
  );

  let enqueued = 0;
  for (const s of rows) {
    // singletonKey collapses a duplicate enqueue (e.g. re-running this script
    // while a prior refresh for the same server is still queued/active) into
    // one job — returns null on the collapse.
    const jobId = await enqueueJob(
      JOB_NAMES.SERVER_REFRESH_CADDY,
      { serverId: s.id },
      { singletonKey: `refresh-caddy:${s.id}` }
    );
    if (jobId) {
      enqueued++;
      console.log(`  ✓ ${s.hostname} (${s.id}) → job ${jobId}`);
    } else {
      console.log(
        `  • ${s.hostname} (${s.id}) → refresh already queued/active, skipped`
      );
    }
  }

  console.log(
    `\nEnqueued ${enqueued}/${rows.length}. Watch Orbit → Servers → <server> → Logs for progress.`
  );
  console.log(
    "Each job rebuilds routes from the DB, dropping any stale custom-domain routes left by past transfers."
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("refresh-routing-fleet failed:", err);
    process.exit(1);
  });
