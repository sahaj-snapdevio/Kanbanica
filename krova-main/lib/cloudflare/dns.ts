/**
 * Cloudflare DNS-record + Custom-Hostnames fallback-origin helpers.
 * Scoped to what Phase 2 needs; custom-hostname CRUD arrives in Phase 3.
 */

import {
  CloudflareError,
  cfRequest,
  cloudflareZoneId,
} from "@/lib/cloudflare/client";

export type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
};

export type CreateDnsRecordInput = {
  type: "A" | "CNAME";
  /** Full record name, e.g. "banana.krova.cloud". */
  name: string;
  /** IPv4 for A records; hostname for CNAME records. */
  content: string;
  proxied: boolean;
  /** Defaults to 60s. */
  ttl?: number;
};

/** Find a DNS record by exact name. Returns null if none exists. */
export async function findDnsRecord(name: string): Promise<DnsRecord | null> {
  const zone = cloudflareZoneId();
  const records = await cfRequest<DnsRecord[]>(
    "GET",
    `/zones/${zone}/dns_records?name=${encodeURIComponent(name)}`
  );
  return records[0] ?? null;
}

/** Create a DNS record. */
export async function createDnsRecord(
  input: CreateDnsRecordInput
): Promise<DnsRecord> {
  const zone = cloudflareZoneId();
  return cfRequest<DnsRecord>("POST", `/zones/${zone}/dns_records`, {
    type: input.type,
    name: input.name,
    content: input.content,
    proxied: input.proxied,
    ttl: input.ttl ?? 60,
  });
}

/** Update an existing DNS record's content / proxied flag. */
export async function updateDnsRecord(
  recordId: string,
  input: CreateDnsRecordInput
): Promise<DnsRecord> {
  const zone = cloudflareZoneId();
  return cfRequest<DnsRecord>(
    "PATCH",
    `/zones/${zone}/dns_records/${recordId}`,
    {
      type: input.type,
      name: input.name,
      content: input.content,
      proxied: input.proxied,
      ttl: input.ttl ?? 60,
    }
  );
}

/** Delete a DNS record by id. */
export async function deleteDnsRecord(recordId: string): Promise<void> {
  const zone = cloudflareZoneId();
  await cfRequest("DELETE", `/zones/${zone}/dns_records/${recordId}`);
}

/**
 * Idempotently ensure a DNS record exists with the given content + proxied
 * flag. Creates it if absent, updates it if present but divergent, and
 * returns the final record.
 */
export async function ensureDnsRecord(
  input: CreateDnsRecordInput
): Promise<DnsRecord> {
  const existing = await findDnsRecord(input.name);
  if (!existing) {
    return createDnsRecord(input);
  }
  if (
    existing.content !== input.content ||
    existing.proxied !== input.proxied
  ) {
    return updateDnsRecord(existing.id, input);
  }
  return existing;
}

/** The Custom Hostnames fallback origin, or null if not set. */
export async function getFallbackOrigin(): Promise<string | null> {
  const zone = cloudflareZoneId();
  try {
    const r = await cfRequest<{ origin: string; status: string }>(
      "GET",
      `/zones/${zone}/custom_hostnames/fallback_origin`
    );
    return r.origin ?? null;
  } catch (e) {
    if (e instanceof CloudflareError && e.status === 404) {
      return null;
    }
    throw e;
  }
}

/** Set the Custom Hostnames fallback origin to a (proxied) hostname. */
export async function setFallbackOrigin(origin: string): Promise<void> {
  const zone = cloudflareZoneId();
  await cfRequest("PUT", `/zones/${zone}/custom_hostnames/fallback_origin`, {
    origin,
  });
}
