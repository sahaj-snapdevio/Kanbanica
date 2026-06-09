#!/usr/bin/env tsx
/**
 * One-shot probe: does this Cloudflare account support `custom_origin_server`
 * for Custom Hostnames?
 *
 * The Cloudflare for SaaS per-server-origin design depends on
 * `custom_origin_server`, which Cloudflare documents as gated ("only
 * certain customers have access"). This probe answers it definitively:
 * it creates a throwaway proxied A record, creates a test Custom Hostname
 * WITH `custom_origin_server` set, inspects whether Cloudflare accepted it,
 * then deletes everything it created.
 *
 * Usage:  pnpm cloudflare:probe <test-hostname>
 *
 * <test-hostname> must be any hostname under a domain YOU own that is NOT
 * krova.cloud — e.g. `cfprobe.yourdomain.com`. It never needs real DNS:
 * the probe only creates a pending Custom Hostname object and deletes it
 * seconds later. It cannot be under example.com / example.net /
 * example.org (Cloudflare prohibits those for custom hostnames).
 *
 * Makes self-cleaning WRITES to your Cloudflare account. Every created
 * object is clearly named or commented as a krova probe and deleted at the
 * end; if a delete fails the script prints a loud MANUAL CLEANUP line.
 *
 * See docs/superpowers/specs/2026-05-16-cloudflare-for-saas-design.md.
 */

import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

import { CLOUDFLARE_API_BASE_URL } from "@/config/platform";

type CfError = { code: number; message: string };
type CfBody = {
  success?: boolean;
  result?: unknown;
  errors?: CfError[];
};

async function cfReq(
  method: "GET" | "POST" | "DELETE",
  path: string,
  token: string,
  body?: unknown
): Promise<{ status: number; body: CfBody | null; error?: string }> {
  try {
    const res = await fetch(`${CLOUDFLARE_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = (await res.json().catch(() => null)) as CfBody | null;
    return { status: res.status, body: parsed };
  } catch (e) {
    return { status: 0, body: null, error: (e as Error).message };
  }
}

function errText(r: { body: CfBody | null; status: number; error?: string }) {
  if (r.error) {
    return `request failed: ${r.error}`;
  }
  const errs = r.body?.errors ?? [];
  if (errs.length > 0) {
    return errs.map((e) => `[${e.code}] ${e.message}`).join("; ");
  }
  return `HTTP ${r.status}`;
}

function usage(): never {
  console.log(
    "\nUsage:  pnpm cloudflare:probe <test-hostname>\n\n" +
      "  <test-hostname> — any hostname under a domain YOU own that is NOT\n" +
      "  krova.cloud, e.g. cfprobe.yourdomain.com. It never needs real DNS;\n" +
      "  the probe creates a pending Custom Hostname object and deletes it.\n" +
      "  It cannot be under example.com / example.net / example.org.\n"
  );
  process.exit(1);
}

async function main() {
  console.log("\nCloudflare for SaaS — custom_origin_server probe\n");

  const testHostname = process.argv[2]?.trim().toLowerCase();
  if (!testHostname) {
    usage();
  }
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      testHostname
    )
  ) {
    console.log(`✗ "${testHostname}" is not a valid hostname.`);
    usage();
  }
  if (/\.example\.(com|net|org)$/.test(testHostname)) {
    console.log(
      `✗ "${testHostname}" is under example.com/.net/.org — Cloudflare prohibits those.`
    );
    usage();
  }
  if (testHostname === "krova.cloud" || testHostname.endsWith(".krova.cloud")) {
    console.log(
      `✗ "${testHostname}" is in the krova.cloud zone — use a hostname under a different domain you own.`
    );
    usage();
  }

  // Dynamic import: @/lib/env validates process.env at module-eval time,
  // so it must load AFTER the top-level process.loadEnvFile() above.
  const { env } = await import("@/lib/env");
  const token = env.CLOUDFLARE_API_TOKEN;
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    console.log(
      "✗ CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set — run `pnpm cloudflare:check` first.\n"
    );
    process.exit(1);
  }

  const probeOriginName = `krova-probe-origin-${Date.now()}.krova.cloud`;
  let dnsRecordId: string | undefined;
  let customHostnameId: string | undefined;
  let verdict: "available" | "gated" | "inconclusive" = "inconclusive";

  try {
    // 1. Throwaway proxied A record — the would-be custom origin.
    //    custom_origin_server requires a proxied record in the zone.
    const dns = await cfReq("POST", `/zones/${zoneId}/dns_records`, token, {
      type: "A",
      name: probeOriginName,
      content: "192.0.2.1", // RFC 5737 TEST-NET-1 — non-routable
      ttl: 60,
      proxied: true,
      comment: "krova cloudflare:probe — temporary, safe to delete",
    });
    if (dns.body?.success) {
      dnsRecordId = (dns.body.result as { id: string }).id;
      console.log(
        `· created throwaway proxied origin record  ${probeOriginName}`
      );

      // 2. Create a Custom Hostname WITH custom_origin_server.
      const ch = await cfReq(
        "POST",
        `/zones/${zoneId}/custom_hostnames`,
        token,
        {
          hostname: testHostname,
          ssl: { method: "http", type: "dv" },
          custom_origin_server: probeOriginName,
        }
      );
      if (ch.body?.success) {
        customHostnameId = (ch.body.result as { id: string }).id;
        const echoed = (ch.body.result as { custom_origin_server?: string })
          .custom_origin_server;
        console.log(`· created test Custom Hostname  ${testHostname}`);
        if (echoed === probeOriginName) {
          verdict = "available";
        } else {
          console.log(
            `⚠ Custom Hostname created, but custom_origin_server was not echoed back (got: ${echoed ?? "absent"})`
          );
          console.log(
            "  Cloudflare appears to have silently ignored the field — treat as NOT available."
          );
          verdict = "gated";
        }
      } else {
        const text = errText(ch);
        console.log("· test Custom Hostname create REJECTED:");
        console.log(`  ${text}`);
        if (
          /custom.?origin|origin server|entitl|upgrade|\bplan\b|not (allowed|available|enabled|permitted)/i.test(
            text
          )
        ) {
          verdict = "gated";
        } else if (/host ?name|\b1411\b|prohibited/i.test(text)) {
          console.log(
            "  → This looks like a hostname-validation error, not a custom_origin_server"
          );
          console.log(
            "    error. Re-run with a different <test-hostname> you own."
          );
          verdict = "inconclusive";
        } else {
          verdict = "inconclusive";
        }
      }
    } else {
      console.log("✗ Could not create the throwaway proxied DNS record:");
      console.log(`  ${errText(dns)}`);
    }
  } catch (e) {
    console.log(`✗ probe crashed: ${(e as Error).message}`);
  } finally {
    // Cleanup — always; the Custom Hostname (dependent) before the DNS record.
    if (customHostnameId) {
      const del = await cfReq(
        "DELETE",
        `/zones/${zoneId}/custom_hostnames/${customHostnameId}`,
        token
      );
      console.log(
        del.body?.success
          ? `· cleaned up test Custom Hostname  ${customHostnameId}`
          : `✗ MANUAL CLEANUP NEEDED — delete Custom Hostname ${customHostnameId} in the Cloudflare dashboard`
      );
    }
    if (dnsRecordId) {
      const del = await cfReq(
        "DELETE",
        `/zones/${zoneId}/dns_records/${dnsRecordId}`,
        token
      );
      console.log(
        del.body?.success
          ? `· cleaned up throwaway DNS record  ${probeOriginName}`
          : `✗ MANUAL CLEANUP NEEDED — delete DNS record ${dnsRecordId} (${probeOriginName})`
      );
    }
  }

  console.log("");
  if (verdict === "available") {
    console.log("✓ AVAILABLE — custom_origin_server works on this account.");
    console.log(
      "  Cloudflare accepted and echoed it back. The per-server-origin"
    );
    console.log("  design can proceed as specified.\n");
    process.exit(0);
  }
  if (verdict === "gated") {
    console.log(
      "✗ NOT AVAILABLE — custom_origin_server is not usable on this account."
    );
    console.log(
      "  Without it, all custom hostnames route to a single fallback origin,"
    );
    console.log(
      "  which needs an internal router tier — the architecture must change.\n"
    );
    process.exit(1);
  }
  console.log(
    "⚠ INCONCLUSIVE — could not determine custom_origin_server support."
  );
  console.log(
    "  Review the messages above and/or confirm with Cloudflare support.\n"
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("cloudflare:probe crashed:", e);
  process.exit(1);
});
