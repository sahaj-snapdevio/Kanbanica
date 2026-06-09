#!/usr/bin/env tsx
/**
 * Preflight check for the Cloudflare for SaaS integration.
 *
 * Verifies the CLOUDFLARE_* env values BEFORE any integration code
 * depends on them: the zone ID and DNS + Custom Hostname API access
 * (which together prove the API token authenticates), plus (if
 * supplied) the Origin CA cert/key pair.
 *
 * Usage:  pnpm cloudflare:check
 *
 * Read-only — issues only GET requests to the Cloudflare API and writes
 * nothing. See docs/superpowers/specs/2026-05-16-cloudflare-for-saas-design.md.
 */

import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

import { createPrivateKey, X509Certificate } from "crypto";

import {
  CLOUDFLARE_API_BASE_URL,
  CLOUDFLARE_CNAME_TARGET,
} from "@/config/platform";

type CheckResult = { ok: boolean; label: string; detail: string };
const results: CheckResult[] = [];

function record(ok: boolean, label: string, detail: string) {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${label} — ${detail}`);
}

type CfBody = {
  success?: boolean;
  result?: unknown;
  errors?: { code: number; message: string }[];
};

async function cf(path: string, token: string) {
  try {
    const res = await fetch(`${CLOUDFLARE_API_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const body = (await res.json().catch(() => null)) as CfBody | null;
    return { status: res.status, body, error: undefined as string | undefined };
  } catch (e) {
    return {
      status: 0,
      body: null as CfBody | null,
      error: (e as Error).message,
    };
  }
}

/** Accept either raw PEM or base64-encoded PEM. */
function toPem(value: string): string {
  return value.includes("-----BEGIN")
    ? value
    : Buffer.from(value, "base64").toString("utf8");
}

function finish(): never {
  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length === 0) {
    console.log("PASS — Cloudflare credentials are ready.\n");
    process.exit(0);
  }
  console.log(`FAIL — ${failed.length} check(s) failed. Fix the env above.\n`);
  process.exit(1);
}

async function main() {
  console.log("\nCloudflare for SaaS — preflight check\n");

  // Dynamic import: `@/lib/env` validates process.env at module-eval time,
  // so it must load AFTER the top-level process.loadEnvFile() above.
  const { env } = await import("@/lib/env");

  const token = env.CLOUDFLARE_API_TOKEN;
  const zoneId = env.CLOUDFLARE_ZONE_ID;

  if (!token) {
    record(false, "CLOUDFLARE_API_TOKEN", "not set in env");
  }
  if (!zoneId) {
    record(false, "CLOUDFLARE_ZONE_ID", "not set in env");
  }
  if (!token || !zoneId) {
    finish();
  }

  // Zone details — needs Zone:Read; degrade gracefully if not granted.
  // This call (and the DNS + Custom Hostnames calls below) are real
  // authenticated requests, so they also prove the API token works.
  // The /user/tokens/verify endpoint is deliberately NOT used: it is
  // user-scoped and returns 401 for a correctly zone-scoped token.
  {
    const { status, body, error } = await cf(`/zones/${zoneId}`, token);
    if (status === 200 && body?.success) {
      const name = (body.result as { name?: string }).name;
      record(true, "Zone ID", `resolves to "${name}"`);
    } else if (status === 403) {
      record(
        true,
        "Zone ID",
        "Zone:Read not granted — ID not verified here (a wrong zone fails the DNS/SaaS checks below)"
      );
    } else {
      record(
        false,
        "Zone ID",
        error
          ? `request failed: ${error}`
          : status === 401
            ? "HTTP 401 — CLOUDFLARE_API_TOKEN rejected"
            : `HTTP ${status} — zone ID may be wrong`
      );
    }
  }

  // DNS access
  {
    const { status, body, error } = await cf(
      `/zones/${zoneId}/dns_records?per_page=1`,
      token
    );
    record(
      status === 200 && body?.success === true,
      "DNS access",
      error
        ? `request failed: ${error}`
        : status === 200
          ? "can list DNS records"
          : `HTTP ${status}`
    );
  }

  // Custom Hostnames / Cloudflare for SaaS access
  {
    const { status, body, error } = await cf(
      `/zones/${zoneId}/custom_hostnames?per_page=1`,
      token
    );
    if (status === 200 && body?.success === true) {
      record(true, "Cloudflare for SaaS", "Custom Hostnames API reachable");
    } else if (error) {
      record(false, "Cloudflare for SaaS", `request failed: ${error}`);
    } else {
      const msg = body?.errors?.[0]?.message ?? `HTTP ${status}`;
      record(
        false,
        "Cloudflare for SaaS",
        `${msg} (is Cloudflare for SaaS enabled on the zone?)`
      );
    }
  }

  // Routing record — the proxied dns.krova.cloud customer CNAME target
  {
    const { status, body, error } = await cf(
      `/zones/${zoneId}/dns_records?name=${encodeURIComponent(CLOUDFLARE_CNAME_TARGET)}`,
      token
    );
    const records = (body?.result as { proxied?: boolean }[] | undefined) ?? [];
    const rec = records[0];
    record(
      status === 200 && body?.success === true && !!rec && rec.proxied === true,
      "Routing record",
      error
        ? `request failed: ${error}`
        : rec
          ? rec.proxied === true
            ? `${CLOUDFLARE_CNAME_TARGET} present and proxied`
            : `${CLOUDFLARE_CNAME_TARGET} exists but is NOT proxied`
          : `${CLOUDFLARE_CNAME_TARGET} not found — run \`pnpm cloudflare:setup\``
    );
  }

  // Custom Hostnames fallback origin
  {
    const { status, body, error } = await cf(
      `/zones/${zoneId}/custom_hostnames/fallback_origin`,
      token
    );
    const origin = (body?.result as { origin?: string } | undefined)?.origin;
    record(
      status === 200 && body?.success === true && !!origin,
      "Fallback origin",
      error
        ? `request failed: ${error}`
        : origin
          ? `set to ${origin}`
          : "not set — run `pnpm cloudflare:setup`"
    );
  }

  // Origin CA cert/key — optional in Phase 1
  if (env.CLOUDFLARE_ORIGIN_CERT && env.CLOUDFLARE_ORIGIN_KEY) {
    try {
      const cert = new X509Certificate(toPem(env.CLOUDFLARE_ORIGIN_CERT));
      const key = createPrivateKey(toPem(env.CLOUDFLARE_ORIGIN_KEY));
      const matches = cert.checkPrivateKey(key);
      record(
        matches,
        "Origin CA cert",
        matches
          ? `cert + key match (subject ${cert.subject.replace(/\s*\n\s*/g, ", ")})`
          : "cert + key DO NOT match"
      );
    } catch (e) {
      record(false, "Origin CA cert", `parse failed: ${(e as Error).message}`);
    }
  } else {
    console.log(
      "  · Origin CA cert — not set (only needed from Phase 2; skipped)"
    );
  }

  console.log(
    "  · CLOUDFLARE_ACCOUNT_ID — not exercised by this check (zone-scoped APIs only)"
  );

  finish();
}

main().catch((e) => {
  console.error("cloudflare:check crashed:", e);
  process.exit(1);
});
