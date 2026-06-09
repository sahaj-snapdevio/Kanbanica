import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

/**
 * Block-listed IP ranges for outbound-webhook URL targets. Centralized here so
 * the create-time guard and the delivery-time guard cannot disagree.
 *
 * Covers RFC 1918 private space, loopback, link-local (169.254 includes the
 * cloud metadata endpoint at 169.254.169.254), carrier-grade NAT, benchmarking,
 * IPv6 loopback / ULA / link-local.
 */
const BLOCKED_V4_CIDRS: ReadonlyArray<[number, number]> = [
  cidr("0.0.0.0", 8),
  cidr("10.0.0.0", 8),
  cidr("127.0.0.0", 8),
  cidr("169.254.0.0", 16),
  cidr("172.16.0.0", 12),
  cidr("192.0.0.0", 24),
  cidr("192.168.0.0", 16),
  cidr("100.64.0.0", 10),
  cidr("198.18.0.0", 15),
];

function cidr(net: string, bits: number): [number, number] {
  const ipNum = ipv4ToInt(net);
  const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0;
  return [ipNum & mask, mask];
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".");
  return (
    ((Number.parseInt(parts[0], 10) << 24) |
      (Number.parseInt(parts[1], 10) << 16) |
      (Number.parseInt(parts[2], 10) << 8) |
      Number.parseInt(parts[3], 10)) >>>
    0
  );
}

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  for (const [net, mask] of BLOCKED_V4_CIDRS) {
    if ((n & mask) === net) {
      return true;
    }
  }
  return false;
}

/**
 * Extract the embedded IPv4 from an IPv4-mapped IPv6 (`::ffff:…`). The mapping
 * arrives in TWO forms and we must handle both, because `new URL()` normalizes
 * the dotted form to the hex form: `[::ffff:127.0.0.1]` → hostname
 * `::ffff:7f00:1`. The original code only matched the dotted form, so a
 * webhook URL like `http://[::ffff:169.254.169.254]/` (cloud metadata!) slipped
 * past the guard once URL parsing rewrote it to `::ffff:a9fe:a9fe`.
 */
function mappedV4(v6lower: string): string | null {
  if (!v6lower.startsWith("::ffff:")) {
    return null;
  }
  const rest = v6lower.slice("::ffff:".length);
  if (isIPv4(rest)) {
    return rest; // dotted form: ::ffff:127.0.0.1
  }
  // hex form: ::ffff:7f00:1  (two 16-bit groups, low 32 bits = the v4 address)
  const groups = rest.split(":");
  if (groups.length === 2 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
    const hi = Number.parseInt(groups[0], 16);
    const lo = Number.parseInt(groups[1], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") {
    return true;
  }
  if (
    lower.startsWith("fe80:") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return true;
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  const v4 = mappedV4(lower);
  if (v4 && isIPv4(v4)) {
    return isBlockedV4(v4);
  }
  return false;
}

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Resolve the hostname of the URL and reject any URL whose target IP is in a
 * blocked range. Called at create time (so a malicious URL can never be saved)
 * AND at delivery time (defense in depth — DNS can change after create).
 *
 * Returns `{ok: true}` on success or `{ok: false, reason}` with a customer-
 * safe explanation. Never throws — DNS errors map to `ok: false` so the caller
 * decides whether to fail the create or fail-open the delivery.
 */
export async function assertSafeWebhookUrl(
  url: string
): Promise<SsrfCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "URL is not a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "URL must use http or https" };
  }

  // `URL.hostname` keeps the `[...]` brackets around IPv6 literals; strip them
  // so node:net's isIPv6 / our CIDR checks see a clean address.
  const host =
    parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;

  if (isIPv4(host)) {
    if (isBlockedV4(host)) {
      return { ok: false, reason: "URL resolves to a non-routable IP range" };
    }
    return { ok: true };
  }
  if (isIPv6(host)) {
    if (isBlockedV6(host)) {
      return { ok: false, reason: "URL resolves to a non-routable IP range" };
    }
    return { ok: true };
  }

  try {
    const results = await lookup(host, { all: true });
    for (const r of results) {
      if (r.family === 4 && isBlockedV4(r.address)) {
        return { ok: false, reason: "URL resolves to a non-routable IP range" };
      }
      if (r.family === 6 && isBlockedV6(r.address)) {
        return { ok: false, reason: "URL resolves to a non-routable IP range" };
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: `DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true };
}
