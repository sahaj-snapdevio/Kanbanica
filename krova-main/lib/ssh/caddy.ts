import type { Client } from "ssh2";
import { CLOUDFLARE_PROXY_CIDRS } from "@/config/platform";
import type { ServerLandingHosts } from "@/lib/server/server-hostnames";
import { execCommand } from "@/lib/ssh/exec";

const CADDY_ADMIN = "http://localhost:2019";

/** Send a request to the Caddy admin API via SSH. Uses base64 encoding to safely pass JSON. */
async function caddyRequest(
  client: Client,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: string,
  headers?: Record<string, string>
): Promise<{ statusCode: string; body: string }> {
  let cmd: string;
  const headerArgs = Object.entries(headers ?? {})
    .map(([name, value]) => ` -H '${name}: ${value}'`)
    .join("");

  if (body) {
    // Base64-encode JSON to avoid all shell escaping issues
    const b64 = Buffer.from(body).toString("base64");
    cmd = `echo '${b64}' | base64 -d | curl -s -w '\\nHTTP_STATUS:%{http_code}' -X ${method} ${CADDY_ADMIN}${path} -H 'Content-Type: application/json'${headerArgs} -d @-`;
  } else {
    cmd = `curl -s -w '\\nHTTP_STATUS:%{http_code}' -X ${method} ${CADDY_ADMIN}${path}${headerArgs}`;
  }

  // Note: deliberately no per-call logging here. Every caller already throws
  // with the response body included in the error message on non-2xx, which
  // is the only outcome operators need to see. Adding pre/post logs for
  // every Caddy admin call (potentially hundreds per server lifecycle) just
  // floods the worker output and makes real errors harder to spot.
  const result = await execCommand(client, cmd);
  const output = (result.stdout + "\n" + result.stderr).trim();
  const statusMatch = output.match(/HTTP_STATUS:(\d+)/);
  const statusCode = statusMatch?.[1] ?? "unknown";
  const responseBody = output.replace(/HTTP_STATUS:\d+/, "").trim();

  return { statusCode, body: responseBody };
}

/** Set a Caddy config value, using PATCH if the key exists or PUT if it doesn't. */
async function caddySet(
  client: Client,
  path: string,
  value: unknown
): Promise<void> {
  const json = JSON.stringify(value);
  const resp = await caddyRequest(client, "PATCH", path, json);
  if (resp.statusCode.startsWith("2")) {
    return;
  }

  // Key doesn't exist yet — create it with PUT
  await caddyRequest(client, "PUT", path, json);
}

/**
 * Branded landing page served for BOTH of a server's own hostnames — the
 * proxied origin (`<hostname>.krova.cloud`) and the grey-cloud connect
 * domain (`connect.<hostname>.krova.cloud`) — by the host-matched
 * `server-domain-landing` route. Either is something a curious customer
 * might paste into a browser, so both must answer with a branded page
 * instead of a bare 404 or a cert error.
 *
 * This is NOT the catch-all: unknown hostnames and literal-IP hits fall
 * through to `FALLBACK_ROUTE` (a bodyless 404). See `serverDomainRoute`.
 *
 * Single-quotes inside the HTML are intentional because the surrounding
 * JSON serialization in `caddyRequest` uses double-quotes — keeps escaping
 * minimal. Inline CSS so we never depend on the fallback fetching anything.
 */
const BRANDED_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Krova Cloud — Server Node</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;line-height:1.6}
.card{max-width:560px;text-align:center}
.badge{display:inline-block;padding:.25rem .75rem;background:rgba(16,185,129,.1);color:#10b981;border-radius:9999px;font-size:.7rem;font-weight:600;margin-bottom:1.25rem;letter-spacing:.08em;text-transform:uppercase}
h1{font-size:1.75rem;font-weight:600;margin-bottom:.75rem;letter-spacing:-.02em;color:#fafafa}
p{color:#a3a3a3;margin-bottom:1rem}
a{color:#10b981;text-decoration:none;font-weight:500;border-bottom:1px solid transparent;transition:border-color .15s}
a:hover{border-bottom-color:#10b981}
.foot{margin-top:1.5rem;font-size:.8rem;color:#525252}
</style>
</head>
<body>
<div class="card">
<span class="badge">Krova Cloud</span>
<h1>This is a Krova server node.</h1>
<p>Nothing is configured at this hostname. If you're a customer, your application's domain should be mapped to a specific Cube — check your dashboard.</p>
<p>To launch your own Cubes on infrastructure like this, visit <a href="https://krova.cloud">krova.cloud</a>.</p>
<p class="foot">Powered by Krova · Firecracker microVMs on bare metal</p>
</div>
</body>
</html>`;

/**
 * Catch-all for any hostname Caddy has no explicit route for (literal-IP
 * visits, misconfigured DNS, probes). Returns 404 and closes the connection
 * immediately — no body, no infrastructure details leak, no cert issuance
 * attempted (no match.host, so Caddy's ACME engine never tries to issue a
 * cert for unknown hostnames here).
 */
const FALLBACK_ROUTE = {
  "@id": "default-fallback",
  handle: [
    {
      handler: "static_response",
      status_code: 404,
      close: true,
    },
  ],
};

/** Security headers added to every proxied response.
 *  X-Frame-Options SAMEORIGIN can be overridden by the upstream app if needed. */
const SECURITY_HEADERS_HANDLER = {
  handler: "headers",
  response: {
    set: {
      "Strict-Transport-Security": ["max-age=31536000; includeSubDomains"],
      "X-Content-Type-Options": ["nosniff"],
      "X-Frame-Options": ["SAMEORIGIN"],
      "Referrer-Policy": ["strict-origin-when-cross-origin"],
    },
  },
} as const;

/** Served when Caddy gets 502/503/504 from the cube upstream (sleeping/starting).
 *  meta refresh=5 auto-reloads so the customer doesn't have to manually retry. */
const CUBE_STARTING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Starting up...</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;line-height:1.6}
.card{max-width:480px;text-align:center}
.spinner{width:32px;height:32px;border:3px solid rgba(16,185,129,.2);border-top-color:#10b981;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1.5rem}
@keyframes spin{to{transform:rotate(360deg)}}
h1{font-size:1.4rem;font-weight:600;margin-bottom:.5rem;color:#fafafa}
p{color:#a3a3a3;font-size:.9rem}
</style>
</head>
<body>
<div class="card">
<div class="spinner"></div>
<h1>Starting up...</h1>
<p>This cube is waking from sleep. The page will reload automatically in a few seconds.</p>
</div>
</body>
</html>`;

/**
 * Build the Caddy `errors` config object (JSON key: "errors", not "handle_errors" —
 * "handle_errors" is a Caddyfile directive that compiles to the "errors" JSON key).
 * The value is `HTTPErrorConfig { routes: [...] }`. Intercepts 502/503/504 from
 * reverse_proxy (upstream unreachable/sleeping) and serves the starting-up interstitial.
 */
function handleErrorsBlock(): Record<string, unknown> {
  return {
    routes: [
      {
        match: [{ status_code: [502, 503, 504] }],
        handle: [
          {
            handler: "static_response",
            headers: {
              "Content-Type": ["text/html; charset=utf-8"],
            },
            body: CUBE_STARTING_HTML,
            status_code: 503,
          },
        ],
      },
    ],
  };
}

/**
 * Build the single host-matched landing route for a server's OWN two
 * hostnames — the proxied origin (`<hostname>.krova.cloud`) and the
 * grey-cloud connect domain (`connect.<hostname>.krova.cloud`). Both answer
 * with the branded landing page.
 *
 * One route, two hosts in the matcher (OR semantics) — the served content is
 * identical, so a second route would just be duplication. The host matcher
 * also tells Caddy's automatic-HTTPS engine these are names it owns: the
 * connect domain is ACME-issued via `buildAutomationPolicies`, while the
 * origin hostname is excluded from cert management via `automatic_https.skip`
 * (it is served the loaded wildcard Origin CA cert instead).
 *
 * `terminal: true` so this route's static_response wins and routing stops
 * before the catch-all.
 *
 * Stable `@id` (`server-domain-landing`) so subsequent route rebuilds can
 * find and replace it cleanly without leaving orphaned copies behind.
 */
function serverDomainRoute(hosts: ServerLandingHosts): Record<string, unknown> {
  return {
    "@id": "server-domain-landing",
    match: [{ host: [hosts.originHostname, hosts.connectDomain] }],
    handle: [
      {
        handler: "static_response",
        headers: { "Content-Type": ["text/html; charset=utf-8"] },
        body: BRANDED_FALLBACK_HTML,
        status_code: 200,
      },
    ],
    terminal: true,
  };
}

/**
 * Build the `automatic_https` config for `srv0`.
 *
 * The proxied origin hostname (`<hostname>.krova.cloud`) is listed in `skip`
 * so Caddy never tries to ACME-issue a certificate for it: it is orange-cloud,
 * so an HTTP-01 challenge would be intercepted by Cloudflare's proxy and fail.
 * It is served the loaded wildcard Origin CA cert instead. `skip` only
 * suppresses cert management + HTTP->HTTPS redirects for that name — the
 * host-matched landing route still serves it normally.
 *
 * The connect domain is intentionally NOT skipped — it is grey-cloud and
 * gets a real ACME certificate (see `buildAutomationPolicies`).
 */
function automaticHttpsBlock(
  hosts?: ServerLandingHosts
): Record<string, unknown> {
  return { skip: hosts ? [hosts.originHostname] : [] };
}

/**
 * ACME issuers used by every Krova-managed automation policy.
 * Caddy tries them in order: Let's Encrypt first, ZeroSSL as fallback.
 * Having two issuers means a transient LE outage or rate-limit doesn't
 * leave the domain uncertified — Caddy retries automatically with ZeroSSL.
 *
 * `challenges.http.alternate_port: 0` keeps the HTTP-01 challenge on the
 * standard `:80` listener — Cloudflare proxy MUST be off (DNS-only / grey
 * cloud) for HTTP-01 to reach our Caddy directly.
 */
const ACME_ISSUERS = [
  { module: "acme", challenges: { http: { alternate_port: 0 } } },
  {
    module: "acme",
    ca: "https://acme.zerossl.com/v2/DV90",
    challenges: { http: { alternate_port: 0 } },
  },
];

/**
 * Build the TLS automation policy array for a Krova server.
 *
 * Only the grey-cloud connect domain (`connect.<hostname>.krova.cloud`) gets
 * a Caddy-managed ACME certificate — for its branded landing page over real
 * TLS. The proxied origin hostname is served the wildcard Origin CA cert and
 * is excluded from cert management (see `automaticHttpsBlock`); every customer
 * hostname routes through Cloudflare for SaaS and is also served the Origin
 * CA cert (installed by `installOriginCaCert`). So the connect domain is the
 * only `subjects` entry — Caddy never issues any other per-domain cert.
 */
function buildAutomationPolicies(
  hosts?: ServerLandingHosts
): Array<Record<string, unknown>> {
  if (!hosts) {
    return [];
  }
  return [
    {
      subjects: [hosts.connectDomain],
      issuers: ACME_ISSUERS,
    },
  ];
}

/**
 * Bootstrap Caddy with the listeners + branded landing route that every
 * server needs to respond to traffic on `:80`/`:443` from day one —
 * including traffic to the server's own hostnames (which a curious customer
 * might paste into a browser). Without this, a fresh server with no Cubes /
 * no domain mappings never has Caddy bound to those ports → connection
 * refused.
 *
 * Verified against Caddy's admin API docs (https://caddyserver.com/docs/api):
 *
 *   - POST /load: replaces the entire config atomically. We use this when
 *     no `srv0` exists yet (typical install path) — there's nothing to
 *     clobber, and it's the simplest atomic bootstrap.
 *   - PATCH /config/<path>: strictly REPLACES an existing value (it does
 *     NOT merge). We use it on the routes array when srv0 already exists,
 *     to overwrite the route list while preserving any non-fallback routes
 *     the admin may have added by another path.
 *   - PUT /config/<path>: strictly CREATES a new value at the path. Used
 *     by `caddySet` as the fall-through when PATCH fails.
 *
 * Idempotent: safe to call repeatedly. Only writes if it changes anything.
 */
export async function initializeCaddyServer(
  client: Client,
  hosts?: ServerLandingHosts
): Promise<void> {
  // Build the route list once. Landing route FIRST (host-matched to the
  // server's own two hostnames) → fallback LAST (catch-all for unknown hosts
  // and literal-IP hits).
  const routes = hosts
    ? [serverDomainRoute(hosts), FALLBACK_ROUTE]
    : [FALLBACK_ROUTE];

  // Probe srv0 first. We can't just unconditionally POST /load — if a later
  // retry of the install phase happens after Cube domains have been added
  // (unlikely but possible), POST /load would clobber them.
  const probe = await execCommand(
    client,
    `curl -s -o /dev/null -w '%{http_code}' ${CADDY_ADMIN}/config/apps/http/servers/srv0`,
    10_000
  );
  const httpCode = probe.stdout.trim();

  if (httpCode === "200") {
    // srv0 exists. Merge our routes into the existing list (preserving any
    // custom-domain routes that may have been added since), then ensure the
    // ACME automation policy is in place.
    await caddySet(client, "/config/apps/http/servers/srv0/listen", [
      ":80",
      ":443",
    ]);

    const routesRes = await execCommand(
      client,
      `curl -s ${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`,
      10_000
    );
    let currentRoutes: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(routesRes.stdout.trim());
      if (Array.isArray(parsed)) {
        currentRoutes = parsed;
      }
    } catch {
      currentRoutes = [];
    }
    // Drop our own managed routes (we'll re-add them); preserve everything else.
    const filtered = currentRoutes.filter(
      (r) =>
        r["@id"] !== "default-fallback" && r["@id"] !== "server-domain-landing"
    );
    // Landing route first (so its host match runs before custom routes —
    // though in practice custom domains are different hostnames so they
    // never conflict). Custom routes preserved next. Fallback last.
    const newRoutes = hosts
      ? [serverDomainRoute(hosts), ...filtered, FALLBACK_ROUTE]
      : [...filtered, FALLBACK_ROUTE];
    const resp = await caddyRequest(
      client,
      "PATCH",
      "/config/apps/http/servers/srv0/routes",
      JSON.stringify(newRoutes)
    );
    if (!resp.statusCode.startsWith("2")) {
      throw new Error(
        `Caddy initialize: PATCH routes failed (${resp.statusCode}): ${resp.body}`
      );
    }

    // Exclude the proxied origin hostname from automatic-HTTPS cert
    // management (it is served the loaded wildcard Origin CA cert). PATCH-
    // then-PUT creates the key if Caddy has none yet.
    await caddySet(
      client,
      "/config/apps/http/servers/srv0/automatic_https",
      automaticHttpsBlock(hosts)
    );

    // Ensure the automation config is present (connect-domain ACME only).
    // caddySet's PATCH-then-PUT semantics creates apps.tls.automation if it
    // doesn't exist yet.
    await caddySet(
      client,
      "/config/apps/tls/automation/policies",
      buildAutomationPolicies(hosts)
    );
    // Ensure Cloudflare edge IPs are trusted so X-Forwarded-For carries the real client IP.
    // trusted_proxies uses inline_key="source" (not "module") per Caddy v2 JSON schema.
    await caddySet(client, "/config/apps/http/servers/srv0/trusted_proxies", {
      source: "static",
      ranges: [...CLOUDFLARE_PROXY_CIDRS],
    });
    // Ensure the 502/503/504 starting-up interstitial is in place.
    // JSON key is "errors", not "handle_errors" (the latter is the Caddyfile directive name).
    await caddySet(
      client,
      "/config/apps/http/servers/srv0/errors",
      handleErrorsBlock()
    );
    return;
  }

  // srv0 doesn't exist (404 from curl, or whatever else). Bootstrap with
  // POST /load — sets the entire config atomically, including the TLS
  // automation policy so ACME is ready to issue for the server-domain
  // route on the very first request.
  const initialConfig = {
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [":80", ":443"],
            automatic_https: automaticHttpsBlock(hosts),
            trusted_proxies: {
              source: "static",
              ranges: [...CLOUDFLARE_PROXY_CIDRS],
            },
            errors: handleErrorsBlock(),
            routes,
          },
        },
      },
      tls: {
        automation: {
          policies: buildAutomationPolicies(hosts),
        },
      },
    },
  };
  const resp = await caddyRequest(
    client,
    "POST",
    "/load",
    JSON.stringify(initialConfig)
  );
  if (!resp.statusCode.startsWith("2")) {
    throw new Error(
      `Caddy initialize: POST /load failed (${resp.statusCode}): ${resp.body}`
    );
  }
}

/**
 * Build the host-matched reverse-proxy route for a customer custom domain.
 * Pure function — no SSH. Shared by the incremental `addCustomDomainRoute`
 * path and the wholesale `reconcileCaddyRoutes` rebuild so the route shape
 * has a single definition (Rule 14).
 *
 * The `@id` is `custom-<domain dashed>` (dots → dashes) so a route can be
 * located/replaced via Caddy's `/id/<id>` endpoint. `terminal: true` so the
 * route's reverse_proxy wins and routing stops before the catch-all.
 */
export function customDomainRoute(
  domain: string,
  cubeInternalIp: string,
  port: number
): Record<string, unknown> {
  return {
    "@id": `custom-${domain.replace(/\./g, "-")}`,
    // Exact-hostname match only. Each hostname is its own Cloudflare for
    // SaaS Custom Hostname; `www` is added as a separate domain mapping.
    match: [{ host: [domain] }],
    handle: [
      SECURITY_HEADERS_HANDLER,
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: `${cubeInternalIp}:${port}` }],
        flush_interval: -1,
        transport: {
          protocol: "http",
          dial_timeout: "30s",
          response_header_timeout: "60s",
        },
      },
    ],
    terminal: true,
  };
}

export async function addCustomDomainRoute(
  client: Client,
  domain: string,
  cubeInternalIp: string,
  port: number
): Promise<void> {
  const routeConfig = customDomainRoute(domain, cubeInternalIp, port);
  const routeId = routeConfig["@id"] as string;

  // TLS automation policies are owned by initializeCaddyServer (called
  // during server.install) — we deliberately do not touch them here, since
  // overwriting would risk dropping the server-domain-specific direct-ACME
  // policy. Operators must run server.install once before custom domains
  // can be added.

  // Ensure HTTP access logging is enabled so domain logs can be tailed.
  await caddySet(client, "/config/apps/http/servers/srv0/logs", {
    default_logger_name: "access-log",
  }).catch((err) => {
    console.warn(
      "[caddy] access logging setup failed (non-fatal):",
      err instanceof Error ? err.message : err
    );
  });

  // Ensure the access-log logger exists and writes to a dedicated file.
  await caddySet(client, "/config/logging/logs/access-log", {
    writer: {
      output: "file",
      filename: "/var/log/caddy/access.log",
      roll_size_mb: 100,
      roll_keep: 5,
    },
    encoder: { format: "json" },
    include: ["http.log.access.access-log"],
  }).catch((err) => {
    console.warn(
      "[caddy] log writer setup failed (non-fatal):",
      err instanceof Error ? err.message : err
    );
  });

  // Exclude access logs from the default logger to prevent duplicates.
  await caddySet(client, "/config/logging/logs/default/exclude", [
    "http.log.access.access-log",
  ]).catch((err) => {
    console.warn(
      "[caddy] log exclusion setup failed (non-fatal):",
      err instanceof Error ? err.message : err
    );
  });

  // Build and write routes in one PATCH (one reload). Use optimistic
  // concurrency with ETag/If-Match as recommended by Caddy docs for /config
  // workflows that involve read-modify-write across multiple requests.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const getCmd = `curl -s -D - ${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`;
    const getResult = await execCommand(client, getCmd);
    const output = getResult.stdout;
    const splitIndex = output.search(/\r?\n\r?\n/);
    const headerBlock = splitIndex === -1 ? "" : output.slice(0, splitIndex);
    const body =
      splitIndex === -1
        ? output.trim()
        : output
            .slice(splitIndex)
            .replace(/^\r?\n\r?\n/, "")
            .trim();
    const etagMatch = headerBlock.match(/^etag:\s*(.+)$/im);
    const etag = etagMatch?.[1]?.trim();

    let currentRoutes: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(body);
      currentRoutes = Array.isArray(parsed) ? parsed : [];
    } catch {
      currentRoutes = [];
    }

    const filteredRoutes = currentRoutes.filter(
      (r) => r["@id"] !== routeId && r["@id"] !== "default-fallback"
    );

    // Put the host-matched route first so any legacy catch-all route cannot
    // shadow it; fallback must remain last.
    const newRoutes = [routeConfig, ...filteredRoutes, FALLBACK_ROUTE];

    const resp = await caddyRequest(
      client,
      "PATCH",
      "/config/apps/http/servers/srv0/routes",
      JSON.stringify(newRoutes),
      etag ? { "If-Match": etag } : undefined
    );

    if (resp.statusCode.startsWith("2")) {
      const verify = await execCommand(
        client,
        `curl -s -w '\\nHTTP_STATUS:%{http_code}' ${CADDY_ADMIN}/id/${routeId}`,
        10_000
      );
      const verifyOutput = (verify.stdout + "\n" + verify.stderr).trim();
      const verifyStatus = verifyOutput.match(/HTTP_STATUS:(\d+)/)?.[1];
      const verifyBody = verifyOutput.replace(/HTTP_STATUS:\d+/, "").trim();

      if (verifyStatus?.startsWith("2")) {
        return;
      }

      throw new Error(
        `Failed to verify custom domain route for ${domain} via /id/${routeId}: ${verifyStatus ?? "unknown"} — ${verifyBody}`
      );
    }
    if (resp.statusCode === "412" && attempt < 3) {
      continue;
    }

    throw new Error(
      `Failed to add custom domain route for ${domain}: ${resp.statusCode} — ${resp.body}`
    );
  }
}

export async function removeCustomDomainRoute(
  client: Client,
  domain: string
): Promise<void> {
  const routeId = `custom-${domain.replace(/\./g, "-")}`;

  const resp = await caddyRequest(client, "DELETE", `/id/${routeId}`);

  // 404 is fine — route was already removed (e.g., by cube-delete)
  if (!resp.statusCode.startsWith("2") && resp.statusCode !== "404") {
    throw new Error(
      `Failed to remove custom domain route for ${domain}: ${resp.statusCode} — ${resp.body}`
    );
  }
}

/**
 * Atomically rebuild a server's entire `srv0` routes array from the desired
 * state — the bare-server landing route, one reverse-proxy route per live
 * customer custom domain, and the catch-all fallback last.
 *
 * Used by the operator-triggered `server.refresh-caddy` job to re-push the
 * landing route + automation policy after a hostname change AND to self-heal
 * any drift between Caddy and `domain_mappings`.
 *
 * The whole array is replaced in ONE `PATCH /config/apps/http/servers/srv0/routes`
 * — Caddy validates the config then swaps it in, so there is no routing gap
 * and no half-applied state (an invalid config is rejected wholesale). The
 * automation policy, the Cloudflare trusted-proxy ranges, and the 502/503/504
 * error interstitial are re-asserted the same way — so a refresh also heals
 * those if Caddy was reset. Never touches the `tls` certificates (Origin CA
 * cert) or any non-`http` Caddy app.
 *
 * Idempotent — re-running re-pushes the identical desired state.
 */
export async function reconcileCaddyRoutes(
  client: Client,
  hosts: ServerLandingHosts,
  domains: Array<{ domain: string; cubeInternalIp: string; port: number }>
): Promise<void> {
  // Landing route first (host-matched to the server's own two hostnames),
  // then one route per custom domain, then the catch-all fallback.
  const routes = [
    serverDomainRoute(hosts),
    ...domains.map((d) =>
      customDomainRoute(d.domain, d.cubeInternalIp, d.port)
    ),
    FALLBACK_ROUTE,
  ];

  // M4: wholesale routes swap with optimistic concurrency. This rebuild is the
  // desired-state replacement (not a read-merge), but a concurrent writer —
  // e.g. an `addCustomDomainRoute` racing the Phase-6 migration's
  // `server.refresh-caddy` — could land its PATCH between our read and write
  // and be silently clobbered. Read the routes' ETag first and send it as
  // `If-Match`; on a 412 (someone else wrote) re-read the ETag and retry.
  // Mirrors the ETag/412 loop in `addCustomDomainRoute`.
  let lastResp: { statusCode: string; body: string } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const getResult = await execCommand(
      client,
      `curl -s -D - ${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`
    );
    const output = getResult.stdout;
    const splitIndex = output.search(/\r?\n\r?\n/);
    const headerBlock = splitIndex === -1 ? "" : output.slice(0, splitIndex);
    const etag = headerBlock.match(/^etag:\s*(.+)$/im)?.[1]?.trim();

    lastResp = await caddyRequest(
      client,
      "PATCH",
      "/config/apps/http/servers/srv0/routes",
      JSON.stringify(routes),
      etag ? { "If-Match": etag } : undefined
    );
    if (lastResp.statusCode.startsWith("2")) {
      break;
    }
    if (lastResp.statusCode === "412" && attempt < 3) {
      continue;
    }
    throw new Error(
      `reconcileCaddyRoutes: PATCH routes failed (${lastResp.statusCode}): ${lastResp.body}`
    );
  }

  // Re-push the connect-domain ACME automation policy.
  await caddySet(
    client,
    "/config/apps/tls/automation/policies",
    buildAutomationPolicies(hosts)
  );

  // Re-assert the origin-hostname automatic-HTTPS skip, the Cloudflare
  // trusted-proxy ranges (so X-Forwarded-For carries the real client IP),
  // and the 502/503/504 starting-up interstitial — so a refresh also heals
  // these if Caddy was reset to a bare config.
  await caddySet(
    client,
    "/config/apps/http/servers/srv0/automatic_https",
    automaticHttpsBlock(hosts)
  );
  await caddySet(client, "/config/apps/http/servers/srv0/trusted_proxies", {
    source: "static",
    ranges: [...CLOUDFLARE_PROXY_CIDRS],
  });
  await caddySet(
    client,
    "/config/apps/http/servers/srv0/errors",
    handleErrorsBlock()
  );
}

// ── Cloudflare for SaaS — Origin CA certificate ───────────────────────

/**
 * On-server directory + paths for the Cloudflare Origin CA cert/key.
 * MUST live inside Caddy's own data dir — the `caddy` user (and Caddy's
 * systemd sandbox) cannot necessarily reach paths elsewhere on the host.
 */
const ORIGIN_CA_DIR = "/var/lib/caddy/origin-ca";
const ORIGIN_CA_CERT_PATH = `${ORIGIN_CA_DIR}/origin.crt`;
const ORIGIN_CA_KEY_PATH = `${ORIGIN_CA_DIR}/origin.key`;

/**
 * Install the wildcard Cloudflare Origin CA certificate on a server and
 * load it into Caddy, so Caddy presents it on the Cloudflare->origin TLS
 * leg (SNI `<server>.krova.cloud`) instead of trying to ACME-issue.
 *
 * Writes the cert + key under Caddy's own data dir (chown caddy, chmod
 * 600), verifies the `caddy` user can read them, then reads Caddy's live
 * config, splices in `apps.tls.certificates.load_files`, and POSTs the
 * whole config to `/load`. Verifying readability first is essential: a
 * POST /load referencing an unreadable cert fails mid-reload and can
 * wedge the Caddy service. Additive — existing routes and automation
 * policies are untouched. Idempotent — safe to re-run.
 */
export async function installOriginCaCert(
  client: Client,
  certPem: string,
  keyPem: string
): Promise<void> {
  // 1. Create the dir inside Caddy's data dir, owned by caddy so the
  //    caddy user can traverse it. Then write the cert + key files
  //    (chown caddy, chmod 600 — base64 keeps the echo pipe safe).
  const mk = await execCommand(
    client,
    `mkdir -p '${ORIGIN_CA_DIR}' && chown caddy:caddy '${ORIGIN_CA_DIR}' && chmod 750 '${ORIGIN_CA_DIR}'`
  );
  if (mk.exitCode !== 0) {
    throw new Error(
      `installOriginCaCert: failed to create ${ORIGIN_CA_DIR}: ${mk.stderr.trim()}`
    );
  }
  for (const [pem, filePath] of [
    [certPem, ORIGIN_CA_CERT_PATH],
    [keyPem, ORIGIN_CA_KEY_PATH],
  ] as const) {
    const b64 = Buffer.from(pem).toString("base64");
    const res = await execCommand(
      client,
      `echo '${b64}' | base64 -d > '${filePath}' && chown caddy:caddy '${filePath}' && chmod 600 '${filePath}'`
    );
    if (res.exitCode !== 0) {
      throw new Error(
        `installOriginCaCert: failed to write ${filePath}: ${res.stderr.trim()}`
      );
    }
  }

  // 2. Verify the caddy user can read both files BEFORE touching Caddy's
  //    config. A POST /load referencing an unreadable cert fails
  //    mid-reload and can wedge the Caddy service — abort cleanly here.
  for (const filePath of [ORIGIN_CA_CERT_PATH, ORIGIN_CA_KEY_PATH]) {
    const check = await execCommand(
      client,
      `runuser -u caddy -- test -r '${filePath}'`
    );
    if (check.exitCode !== 0) {
      throw new Error(
        `installOriginCaCert: the caddy user cannot read ${filePath} — aborting before touching Caddy config`
      );
    }
  }

  // 3. Load the cert into Caddy: read the live config, add the
  //    certificates section, POST the whole config back to /load.
  const cur = await caddyRequest(client, "GET", "/config/");
  if (!cur.statusCode.startsWith("2")) {
    throw new Error(
      `installOriginCaCert: Caddy GET /config/ failed (${cur.statusCode}): ${cur.body}`
    );
  }
  const config = JSON.parse(cur.body || "null");
  if (!config || typeof config !== "object" || !config.apps?.tls) {
    throw new Error(
      "installOriginCaCert: Caddy has no tls config — run server setup first"
    );
  }
  config.apps.tls.certificates = {
    ...config.apps.tls.certificates,
    load_files: [{ certificate: ORIGIN_CA_CERT_PATH, key: ORIGIN_CA_KEY_PATH }],
  };
  const resp = await caddyRequest(
    client,
    "POST",
    "/load",
    JSON.stringify(config)
  );
  if (!resp.statusCode.startsWith("2")) {
    throw new Error(
      `installOriginCaCert: Caddy POST /load failed (${resp.statusCode}): ${resp.body}`
    );
  }
}
