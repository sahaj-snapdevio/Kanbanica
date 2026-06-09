/**
 * Per-server Cloudflare for SaaS origin setup.
 *
 * For one server: ensures BOTH of its derived Cloudflare DNS records exist —
 * the proxied `<hostname>.krova.cloud` origin and the DNS-only
 * `connect.<hostname>.krova.cloud` SSH/landing record — and installs the
 * wildcard Origin CA cert on its Caddy. Both records point at the server's
 * public IP; only the proxy flag differs. Shared by the one-time migration
 * script and the phased server setup. Idempotent.
 */

import type { Client } from "ssh2";

import type { servers } from "@/db/schema";
import { ensureDnsRecord } from "@/lib/cloudflare";
import { env } from "@/lib/env";
import {
  serverConnectDomain,
  serverOriginHostname,
} from "@/lib/server/server-hostnames";
import { installOriginCaCert } from "@/lib/ssh/caddy";

type ServerRow = typeof servers.$inferSelect;

/** A minimal logger — satisfied by JobLogger or a console wrapper. */
type StepLogger = { info: (message: string) => Promise<void> | void };

/** Decode a base64-encoded (or already-raw) PEM env value. */
function decodePem(value: string): string {
  return value.includes("-----BEGIN")
    ? value
    : Buffer.from(value, "base64").toString("utf8");
}

export async function setUpServerCloudflareOrigin(
  client: Client,
  server: ServerRow,
  log?: StepLogger
): Promise<{ originHostname: string; connectDomain: string }> {
  const originHostname = serverOriginHostname(server.hostname);
  const connectDomain = serverConnectDomain(server.hostname);

  // Fail fast if the Origin CA cert env is missing — before touching any
  // external state (Cloudflare DNS, the server's Caddy).
  if (!env.CLOUDFLARE_ORIGIN_CERT || !env.CLOUDFLARE_ORIGIN_KEY) {
    throw new Error(
      "CLOUDFLARE_ORIGIN_CERT / CLOUDFLARE_ORIGIN_KEY are not set — cannot install the Origin CA cert"
    );
  }

  // 1. Proxied (orange-cloud) origin record — the Cloudflare for SaaS
  //    `custom_origin_server` target for this server's Custom Hostnames.
  await ensureDnsRecord({
    type: "A",
    name: originHostname,
    content: server.publicIp,
    proxied: true,
  });
  await log?.info(
    `Cloudflare DNS: ${originHostname} -> ${server.publicIp} (proxied)`
  );

  // 2. DNS-only (grey-cloud) connect record — customer SSH/TCP + the bare
  //    landing page. Must NOT be proxied: Cloudflare won't carry SSH ports,
  //    and the landing-page ACME HTTP-01 challenge needs a direct line to
  //    Caddy.
  await ensureDnsRecord({
    type: "A",
    name: connectDomain,
    content: server.publicIp,
    proxied: false,
  });
  await log?.info(
    `Cloudflare DNS: ${connectDomain} -> ${server.publicIp} (DNS-only)`
  );

  // 3. Install + load the wildcard Origin CA cert on the server's Caddy.
  await installOriginCaCert(
    client,
    decodePem(env.CLOUDFLARE_ORIGIN_CERT),
    decodePem(env.CLOUDFLARE_ORIGIN_KEY)
  );
  await log?.info("Caddy: Origin CA cert installed and loaded");

  return { originHostname, connectDomain };
}
