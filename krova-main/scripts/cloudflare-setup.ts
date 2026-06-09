#!/usr/bin/env tsx
/**
 * Provisions the Cloudflare for SaaS account-level objects:
 *   1. the proxied `dns.krova.cloud` routing record (the fixed customer
 *      CNAME target), pointed at a server's public IP;
 *   2. the Custom Hostnames fallback origin = `dns.krova.cloud`.
 *
 * Idempotent — safe to re-run. The operator must first enable Cloudflare
 * for SaaS on the zone in the dashboard.
 *
 * Usage:  pnpm cloudflare:setup [serverIp]
 *
 *   [serverIp] — optional IPv4 for the routing record. If omitted, an
 *   active server's public IP is read from the database; pass it
 *   explicitly to run without database access.
 *
 * See docs/superpowers/specs/2026-05-16-cloudflare-for-saas-design.md.
 */

import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

import { CLOUDFLARE_CNAME_TARGET } from "@/config/platform";

async function main() {
  console.log("\nCloudflare for SaaS — account setup\n");

  // Dynamic import: `@/lib/cloudflare` pulls in `@/lib/env`, which
  // validates process.env at evaluation time — must run AFTER
  // process.loadEnvFile().
  const { ensureDnsRecord, getFallbackOrigin, setFallbackOrigin } =
    await import("@/lib/cloudflare");

  // Origin IP for the routing record. Custom hostnames all use
  // custom_origin_server, so the fallback is never used for live traffic —
  // the record just has to exist and be valid. An optional IPv4 arg skips
  // the DB lookup so the script can run without database access.
  const ipArg = process.argv[2]?.trim();
  let originIp: string;
  let originLabel: string;
  if (ipArg) {
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ipArg)) {
      console.log(`✗ "${ipArg}" is not a valid IPv4 address.\n`);
      process.exit(1);
    }
    originIp = ipArg;
    originLabel = "cli arg";
  } else {
    const { eq } = await import("drizzle-orm");
    const { db } = await import("@/lib/db");
    const { servers } = await import("@/db/schema");
    const [server] = await db
      .select({ hostname: servers.hostname, publicIp: servers.publicIp })
      .from(servers)
      .where(eq(servers.status, "active"))
      .limit(1);
    if (!server) {
      console.log(
        "✗ No active server found, and no IP given.\n" +
          "  Usage: pnpm cloudflare:setup [serverIp]\n"
      );
      process.exit(1);
    }
    originIp = server.publicIp;
    originLabel = server.hostname;
  }

  // 1. Proxied dns.krova.cloud routing record.
  const record = await ensureDnsRecord({
    type: "A",
    name: CLOUDFLARE_CNAME_TARGET,
    content: originIp,
    proxied: true,
  });
  console.log(
    `✓ routing record ${CLOUDFLARE_CNAME_TARGET} -> ${record.content} (${originLabel}, proxied)`
  );

  // 2. Custom Hostnames fallback origin.
  const current = await getFallbackOrigin();
  if (current === CLOUDFLARE_CNAME_TARGET) {
    console.log(`✓ fallback origin already set to ${CLOUDFLARE_CNAME_TARGET}`);
  } else {
    await setFallbackOrigin(CLOUDFLARE_CNAME_TARGET);
    console.log(`✓ fallback origin set to ${CLOUDFLARE_CNAME_TARGET}`);
  }

  console.log("\nPASS — Cloudflare for SaaS account setup complete.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("cloudflare:setup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
