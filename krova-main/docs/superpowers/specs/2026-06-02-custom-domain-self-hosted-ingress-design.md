# Self-Hosted Custom-Domain Ingress (replacing Cloudflare for SaaS) — v2

**Status:** Design / execution-ready (v2.3 — migration-safety pass for the 30 live cubes; v2.2 refreshed against merged `space_domain_claims` + cache-purge on `main`; v2.1 locked operator decisions; v2 incorporated an 8-dimension adversarial review)
**Date:** 2026-06-02
**Author:** brainstorming session (rohit.bhadani@debutify.com)

> **v2 changelog (what the review changed):** wildcard reframed (per-subdomain on-demand certs, not wildcard certs); **shared cert storage at launch** (not per-node autonomous — LE 5-duplicate/week limit); ingress is a **custom xcaddy build** with its own install/verify story (not a second apt Caddy); **port-bind collision** fixed (existing Caddy must bind its primary IP); `ask` authorizes `pending` (first-issuance deadlock); **domain-ownership TXT proof** restored; **`verificationStatus` global-uniqueness guard preserved**; **real-client-IP** re-plumbing; **SSRF allow-list**; **multi-A DNS primitives** + 429 handling + declarative reconcile + self-egress vantage check; **new `ingress_status`** column + status poll (the TLS badge + `domain.active` webhook were going dark); the **cache-purge subsystem** retirement; the **6 CF call sites** (not 2); **dual-run feature flag** + strict cutover ordering; 3 schema migrations; corrected LE limits + grey/1014 wording; `workers/origin-fallback` already gone.
>
> **v2.1 (operator decisions locked):** **exact-FQDN only — no wildcard mappings/matching** (§4a); domain-ownership proof is **optional, not a gate** (§5.6); §9b CF-tier cost is passed to the customer; **existing customers auto-migrate at the DNS flip** (already on `dns.krova.cloud` — no re-point); all §15 decisions locked (custom xcaddy module · postgres cert storage · internal-CA mTLS · co-located ingress · real-IP re-plumb + SSRF guard kept · §9b + Coraza deferred/opt-in).
>
> **v2.2 (refresh vs `main`):** `feat/space-domain-claims` (PR #62) + `feat/domain-cache-purge` (PR #61) merged. The **optional ownership layer is now the shipped `space_domain_claims` TXT-locking feature** — §5.6 references it instead of proposing one (the ingress only honors it). §5.10 notes the **two independent uniqueness layers** (`domain_mappings` index + `space_domain_claims` index) so Phase-7 decommission touches only the `domain_mappings` one. Latest migration is **0072** (new ones land at 0073+). `components/domain-mappings.tsx` is now an **accordion** (commit `62c4655`) — plan Task 5.1 re-anchored.
>
> **v2.3 (migration-safety pass — 4-agent code+doc verification vs `main`, for the ~30 live cubes):** Blast radius confirmed minimal — **only custom-domain HTTP/WS** routes through `dns.krova.cloud`; SSH/TCP, browser terminal, and dashboard are untouched. Three migration fixes folded in: (1) **🔴 pre-warm moved to POST-flip** — LE validates against public DNS, so a pre-flip pre-warm silently issues zero certs (§5.5, §10 step 9); (2) **live-box Caddy rebind sequenced BEFORE ingress standup** (§10 step 4a-before-4c) to avoid an `EADDRINUSE` outage, and flagged as a non-free socket swap done behind CF (§16); (3) **storage-plugin certmagic-Locker hard gate** + exact repo+commit pin + two-node single-issuance Phase-0 test (§5.1, §12 #3). Added the **operator pre-flight inventory + AAAA-on-flip handling** (§10 step 0/8). The implementation plan's blockers (Badge variants, nullable `cubePort`, `cfRequest` mock, `decideDnsHealth`, `caddy.test.ts`) are now folded into the task bodies.

---

## 1. Problem

Customers map custom domains to their cubes. Today this routes through **Cloudflare for SaaS (Custom Hostnames)**. It is **structurally broken for our customer base**, every one of whom has their domain on **Cloudflare Free**:

1. **Grey (DNS-only) → 1014.** A DNS-only CNAME bypasses O2O entirely (Cloudflare's docs: DNS-only "skips your zone and goes directly to the SaaS provider's zone"), but because the CF-for-SaaS target still resolves into Cloudflare's anycast space owned by a **different account**, the cross-account CNAME hits **Error 1014 "CNAME Cross-User Banned"**. There is no DNS-only path for on-CF customers. (This is `syngulr.ai` / `benchmark.2sc.dev`.)
2. **Orange (proxied = O2O) → WebSockets break.** Cloudflare's O2O product-compatibility matrix lists **`WebSockets: No/No`**. Fatal for a platform hosting arbitrary apps.

So on-CF customers get a working route **or** WebSockets, never both.

**Root rule:** for a grey on-Cloudflare customer, the hostname they point at **must resolve to a non-Cloudflare IP.** Anything behind Cloudflare's edge — CF-for-SaaS, Workers, Containers (Worker-fronted, + metered egress) — re-triggers 1014.

### Hard requirements (locked with the operator)

- Customer adds **one DNS record** (a wildcard `*.acme.com`, apex, or named) at a single Krova target (`dns.krova.cloud`). No per-domain/per-cube DNS records.
- **Grey (DNS-only) must work.** **WebSockets must work.** **Free** (no CF plan upgrade, no per-GB bandwidth). **Transfer-transparent** (no customer re-point). **No single point of ingress downtime.** Dynamic, metadata-driven, scales to 50+ servers.
- Control plane (Next.js + worker + `krova-db` Postgres) lives off the bare-metal (Dokploy VPS).

---

## 2. Decision

Serve custom domains from a **self-hosted Caddy ingress tier** on existing bare-metal servers, reachable at **non-Cloudflare IPs**, terminating TLS with **Let's Encrypt on-demand** (per-FQDN single-SAN certs), routing by `Host` to the cube's current server from a routing table **synced from `krova-db` into a local store on each ingress node**, with **shared cert storage** so the cluster issues each cert once.

`dns.krova.cloud` becomes a **DNS-only** round-robin of the ingress IPs. Grey resolves straight to a non-CF IP → no 1014; WebSockets work (plain reverse proxy). Bandwidth stays on the included 100 TB/server. Customers wanting edge protection bring their **own** Cloudflare (§9a, free) or opt into a paid CF tier (§9b, Phase 2).

---

## 3. Architecture

```
  Cloudflare DNS (DNS-only, proxied:false, TTL 60s)
     dns.krova.cloud  →  A: ingress-IP-1, ingress-IP-2, ingress-IP-3
        │  (health-managed by ingress.dns-health — §6)
        ▼
  ┌──────────── INGRESS TIER (custom xcaddy build, 2–3+ nodes) ─────────┐
  │  • dedicated /29 IP, binds <ingress-ip>:80/:443 explicitly           │
  │  • on-demand TLS (Let's Encrypt) gated by /authorize (local store)   │
  │  • shared cert storage (one issuance cluster-wide)                   │
  │  • Host→backend from local synced store (custom module)             │
  │  • Caddy L7 rate-limit + (optional) Coraza WAF                       │
  │  • strips client X-Forwarded-*/CF-* and sets its own                │
  └───────────────────────┬──────────────────────────────────────────────┘
                          │  reverse_proxy, Host preserved, internal-CA mTLS,
                          │  backend = cube's current server (SSRF-allow-listed)
                          ▼
  backend per-server Caddy (Host→cube internal IP)  →  cube (Firecracker)  ✓ WS
```

- **Ingress count scales with traffic, not server count.** 3 servers → ingress on all 3. 50 servers → still ~3–5 ingress nodes; `dns.krova.cloud` holds ~3–5 A records (never 50 — round-robin has no health-check and bloats responses). DNS stays a handful of records; no per-cube DNS.
- **The records live in the existing `krova.cloud` zone (`CLOUDFLARE_ZONE_ID`) as DNS-only (`proxied:false`) A records.** A `proxied:true` record re-triggers 1014 and forces TTL=Auto/300 — invariant, unit-tested.

---

## 4. Customer lifecycle

1. **Map the domain in Krova** (dashboard / `POST /v1/.../domains`). Named (`app.acme.com`), apex (`acme.com`), or **wildcard** (see 4a). Customer also completes a one-time **ownership proof** (§5.6) before issuance is allowed.
2. **Krova shows one record:** `CNAME <host> → dns.krova.cloud`, **DNS-only (grey)**. (The add-sheet's current "set DNS only — proxying breaks issuance" copy is kept for the *direct* path; the §9a hint covers customers who want their own CF in front — and there the guidance *inverts*, see §9a.)
3. **Customer adds that one record** (+ the one-time TXT ownership record at first add).
4. **Goes live automatically:** first request → `/authorize` confirms the host is a known mapping (incl. wildcard match) and ownership-verified → Caddy issues the LE cert (cluster-wide, once) → routes to the cube. Status flips to `live` (§5.8). Krova pre-warms the cert on add (gated on sync-ack, §5.5) to avoid first-hit latency.
5. **Live.** HTTPS + WebSockets. Caching/WAF are the customer's own (none, or their own CF — §9a).
6. **Forever after, zero customer action:** certs auto-renew (ARI, rate-limit-exempt); transfers re-point internally (§5.3); new mapped subdomains under a wildcard CNAME get certs on first hit.
7. **Remove:** unmap → route dropped + per-node cert purged (§5.9); customer deletes their CNAME whenever.

### 4a. Domains are always EXACT FQDNs (operator decision, v2.1)

**The ingress, certs, `/authorize`, and routing all key on the EXACT fully-qualified hostname — there is NO wildcard *mapping* or wildcard *matching* anywhere.** Caddy attaches the exact domain; on-demand TLS issues one single-SAN cert per exact FQDN (it cannot issue wildcard certs anyway).

- A customer MAY add a single **wildcard CNAME `*.acme.com → dns.krova.cloud` (grey) as a DNS convenience** so they don't add a per-subdomain CNAME — but **every subdomain must still be explicitly mapped in Krova as a concrete FQDN** (`app.acme.com`, `api.acme.com`, …). Unmapped subdomains under the wildcard resolve to the ingress but `/authorize` refuses them (no cert; holding/404). This delivers the "disposable subdomains" UX with **zero** wildcard cert/match machinery.
- Consequences — all simplifications vs v2: `validateDomain`/`validateDomainStrict` need **no `*` change**; `/authorize` + the routing store + the Caddy matcher do **exact-host** lookups only; per-FQDN certs sidestep both the wildcard-cert impossibility and the wildcard-zone rate-limit ceiling. Normal LE per-FQDN limits apply, and shared cert storage (§5.1) keeps us off the 5-duplicate/week limit.

---

## 5. Components

### 5.1 Ingress node — a custom xcaddy build (NOT the apt Caddy)

The existing fleet installs **stock apt/COPR Caddy** pinned via `apt-mark hold caddy=<CADDY_VERSION>` ([server-install.ts:396](lib/worker/handlers/server-install.ts#L396)) on the primary IP, admin API on `localhost:2019`. **The ingress is a different binary and a different install** — a pinned **xcaddy** build bundling: (a) the Host→backend routing module (§5.2, if option A), (b) **caddy-ratelimit** (L7), (c) the **shared-storage module** (Postgres or Redis, §5.1 storage), (d) optionally **Coraza-WAF** (§7). This is a new host-side component with a full Rule-46 story (§5.12 / §8).

- **Runs as its own systemd unit**, dedicated unprivileged user, distinct admin port (e.g. `2020`, since `2019` is the per-server Caddy's), distinct config + data dirs.
- **Binds explicit IPs.** The per-server Caddy currently listens on bare `:80`/`:443` = `0.0.0.0` ([caddy.ts:334,418](lib/ssh/caddy.ts#L334)), grabbing every local IP incl. the /29. **Both must bind explicitly**: existing Caddy → `<primaryIP>:80/:443`; ingress → `<ingressIP>:80/:443`. Otherwise `EADDRINUSE`. (This is a required edit to `initializeCaddyServer`/`reconcileCaddyRoutes` — §8.)
- **On-demand TLS:** `on_demand_tls { ask http://127.0.0.1:9111/authorize }` (GET `?domain=`, **2xx allows**; `interval`/`burst` are deprecated — omit). Site: `tls { on_demand }`.
- **ACME challenges:** HTTP-01 (:80) + TLS-ALPN-01 (:443) default. For a §9a customer who fronts us with their own CF, **only HTTP-01 survives** (TLS-ALPN is terminated at their CF edge) — keep both, rely on HTTP-01 for fronted hosts.
- **Cert storage: SHARED at launch** (reverses v1's per-node default). With ≥3 nodes, per-node autonomous ACME blows past LE's **5 duplicate certs / exact identifier / 7 days** (3 initial + per-node renewals). Shared storage (Caddy clusters, issues each cert once) fixes this **and** cold-start (a new/recovered node reads existing certs, no re-issue) **and** node add/remove portability. **Recommended backend: `caddy-storage-postgres` against `krova-db`** (steady-state serving is from in-memory cache, so a brief CP blip doesn't drop live TLS; cold-start needs the store reachable). Redis on the ingress tier is the alternative (note its own HA). ARI renewals are LE-rate-limit-exempt (Caddy uses ARI) — pin this as the reason renewals are safe.
  - **⚠️ HARD GATE — verify the plugin's certmagic Locker.** "Issues each cert once cluster-wide" is true for Caddy+certmagic ONLY if the chosen storage plugin correctly implements certmagic's `Locker` (atomic `Lock`/`Unlock` via a real DB advisory/row lock with a lease TTL). There is no single canonical `caddy-storage-postgres`; community plugins (e.g. `yroc92/postgres-storage`) document connection config but say **nothing** about locking, and a stubbed/no-op `Lock` compiles, serves, and **silently lets all 3 nodes race to issue the same cert** — at cutover that hits the 5-duplicate/identifier/week GLOBAL limit at the worst moment and locks the customer's domain out of LE re-issuance for a week. **Pin the EXACT plugin repo+commit and verify on the dev host (two nodes, same Postgres store, concurrent first-hit for one SNI → exactly ONE LE order observed) before the flip** (§12 #3).
- **Resources:** ~1 vCPU, ≤1 GB RAM, <100 MB disk per node (Caddy ~40 MB idle, ~96 MB at 500 concurrent; lowest TLS overhead of the major proxies). Negligible on 256 GB/10 Gbps boxes.

### 5.2 Host → backend routing

Stock Caddy dynamic upstreams (SRV/A/Multi) **cannot** select a backend per-request from a Host lookup. Since we need a custom xcaddy build anyway (rate-limit/storage/WAF), the cleaner path is:

- **(A — recommended) Custom dynamic-upstream module** resolving `Host → backend server IP` from the local synced store per request. No config churn, instant transfer updates, scales. Module API is source-stable within a minor; re-confirm against the pinned v2.11.3 source at build.
- **(B — alternative) Config-gen via admin API** — what `reconcileCaddyRoutes`/`addCustomDomainRoute` already do (targeted `@id`/`PUT /id/<id>` route mutations, zero-downtime, ETag/If-Match). Lower-code-risk but churns a route/`map` entry per domain; non-trivial at thousands of domains.

**Pick in planning (§15).** Either way:
- **SSRF allow-list:** the resolved `backend_server_ip` MUST be validated as a member of the known-servers set (server CIDRs) before dialing; reject loopback / link-local / `169.254.169.254` / multicast. A poisoned routing row must not turn the ingress into an open proxy.
- **Backend leg = internal-CA mTLS, NOT skip-verify.** Public TLS terminates at the ingress; the ingress `reverse_proxy`s to the cube's current server **preserving the `Host`**, over the provider network. There is no private network today, so the leg must be **authenticated**: a Krova internal CA — the ingress verifies the backend's internal cert (upstream SNI = the backend's internal hostname; `Host` header = `app.acme.com`). `tls_insecure_skip_verify` is **prohibited** (encrypted-but-unauthenticated = MITM-able, no integrity gain over HTTP). The backend per-server Caddy gains an internal-CA listener that routes `Host → cube` (today `customDomainRoute` is plain HTTP with the CF Origin CA cert for SNI `<server>.krova.cloud` only — §8 reworks this). Plain HTTP is acceptable **only** if/when a real private network exists.
- **Loop/self-routing:** when the ingress node *is* the cube's current server (the 3-server case), dial the **local** backend Caddy (`<primaryIP>`) directly, not a hairpin out the public /29 IP.

### 5.3 Local routing store + sync

- Each node keeps a **local SQLite** (WAL mode) routing table: `host → { backend_server_ip, active, protection_tier }`, plus an `epoch`/version. The "separate self-contained setup" — per-request lookups are local + survive a CP blip.
- **Source of truth:** `krova-db` via a NEW query `host → backend_server_ip` (join `domain_mappings`→`cubes`→`servers.publicIp`) — this is **not** `getActiveCustomDomainsForServer` (which is `host → cubeInternalIp`, kept for the backend leg).
- **Sync = pull (baseline) + push-on-change (mandatory for transfer).** Pull: each node polls `GET /api/internal/ingress/routes` every 15–30 s, writes SQLite (declarative — converge to the snapshot). **Transfer requires push:** the transfer handler must push the new `host → newServerIp` to all ingress nodes **and receive acks BEFORE source teardown** (the source's backend route + cube are torn down seconds after the DB flip — a 15–30 s pull would 404 in the gap). Pull remains the reconcile backstop.
- **Cold-start readiness gate:** a fresh/recovered node MUST complete a first successful sync (non-empty store / `synced_at`) **before** `ingress.dns-health` (re-)adds its A record. An empty-store node refuses every cert (`/authorize` denies) — never route live traffic to it. The health probe checks a `/healthz` that asserts sync freshness, not raw TCP.

### 5.4 `/authorize` (on-demand TLS gate) — abuse-hardened

A loopback service (`127.0.0.1:9111`) reading the local SQLite:
- **Normalize** `?domain=` identically to the routing lookup and the LE SAN (lowercase, IDNA/punycode, strip trailing dot). One shared normalizer in `lib/`, unit-tested.
- **Authorize** iff the host is a mapping that **exists and is not deleted/stopping** — **exact-host match only** (no wildcard rows, §4a). **Authorize `pending` rows, not only `active`** — otherwise first-issuance deadlocks (active requires the route, route needs the cert, cert needs authorize). The gate is anti-abuse (random SNIs are absent → refused), not a liveness gate. (Ownership proof is optional — §5.6 — so it is NOT part of this gate; the `resolves-to-us` precondition below is what bounds abuse.)
- **Resolves-to-us precondition:** a mapping is issuance-eligible only after Krova has verified (CP-side DoH) the host's CNAME currently resolves to `dns.krova.cloud`/an ingress IP — until then `/authorize` may permit routing but Caddy must not order a cert (prevents third parties triggering LE orders by opening a handshake with a victim SNI).
- **Negative cache** denied SNIs (LRU, ~5 min) — Caddy calls `/authorize` per-handshake-per-uncached-SNI; an SNI flood must be answered from memory, and a **per-source-IP handshake rate limit** sits in front.
- **Validation-failure backoff:** track per-identifier ACME failures; after 3 consecutive, stop attempting for ≥1 h (stays under LE's **5 failed-validations / identifier / account / hour**) and surface the failure as `ingress_status='failed'`.
- On a SQLite read error: **fail-closed** (refuse) for anti-abuse, but the negative cache + WAL reads (no reader/writer block) keep legitimate handshakes flowing during sync writes.

### 5.5 Cert pre-warm

On domain-add, **after** the resolves-to-us check (§5.4) passes **and** a positive sync-ack from ≥1 ingress node, make a real TLS connection with SNI=`<fqdn>` to warm the cert. Globally rate-limit pre-warm well under LE's **300 new-orders/account/3 h** AND Caddy's internal 10-attempts/account/10 s AND — critically — the GLOBAL **50 certs (and 5 duplicate) / registered-domain (eTLD+1) / 7 days** (this last bites a customer mapping many subdomains under one registered domain — the §4a disposable-subdomain UX; bucket the pre-warmer per eTLD+1, ≤~45/week). Never blind-fire at add-time (would hit a node that lacks the row → `/authorize` denies → burns a failed-validation).

> **⚠️ Pre-warm only works when public DNS already resolves to the ingress.** LE validates the ACME HTTP-01/TLS-ALPN-01 challenge against PUBLIC DNS, and the `resolves-to-us` precondition (§5.4) requires the same. For the **per-add steady-state path** (post-cutover) this is automatically true (the customer's CNAME already points at the grey `dns.krova.cloud` → ingress). For the **one-time MIGRATION**, this means a *pre-flip* bulk pre-warm issues NOTHING (DNS still points at CF) — so the migration runbook (§10) runs the bulk pre-warm **immediately AFTER the DNS flip** (step 9), not before. The gradual drain (§10 — CF-for-SaaS stays live) covers the brief post-flip window before each cert warms.

### 5.6 Domain ownership — already shipped as `space_domain_claims` (optional, additive) — v2.2

Ownership is **NOT a hard issuance gate**, and it doesn't need to be — two layers already cover it, and **the ingress builds no new ownership mechanism**, it just honors existing mapping/claim state:

1. **On-demand TLS is inherently self-gating:** a cert only issues if the ACME HTTP-01/TLS-ALPN-01 challenge succeeds, which requires the domain to **actually resolve to the ingress** — so nobody obtains a cert for a domain they don't control (e.g. `login.microsoft.com`) regardless of mapping it. The `resolves-to-us` precondition (§5.4) is the binding control and **stays**.
2. **Space-wide TXT domain locking already shipped** (PR #62, merged to `main`) as **`space_domain_claims`** ([db/schema/domain-claims.ts](db/schema/domain-claims.ts), [lib/domains/claim-service.ts](lib/domains/claim-service.ts)): a space proves control via `_krova-verify.<domain> = krova-domain-verification=<token>`; once `verified`, that domain + all subdomains/wildcards **lock to the space** (`findCrossSpaceLock`, enforced in `addDomainAction`), with the `domain-claim.recheck` cron auto-releasing a stale claim after `DOMAIN_CLAIM_MAX_FAILED_CHECKS`. It is **optional + additive** — an unclaimed domain still maps first-come.

- **Residual risk (accepted): "squatting"** an *unclaimed* hostname merely reserves the `domain_mappings` row (no cert issues — DNS won't resolve to us). Contained by **two independent uniqueness guards** (§5.10): per-cube `domain_mappings_domain_verified_unique` and space-wide `space_domain_claims_domain_verified_unique`. A customer wanting hard protection verifies a claim.
- `addDomainAction` writes `domain_mappings.verificationStatus:"verified"` ([cube-actions/domains.ts](lib/cube-actions/domains.ts)) to trip the per-cube uniqueness index — **preserved** (§5.10), independent of the space-claim layer.

### 5.7 Real-client-IP + header sanitization — NEW (a real regression to fix)

Today the backend Caddy's `trusted_proxies` = `CLOUDFLARE_PROXY_CIDRS` ([caddy.ts:393-398](lib/ssh/caddy.ts#L393)), so cubes see the real visitor IP. After the switch, traffic arrives from the **ingress IPs**. Required:
- The **ingress strips** all client-supplied `X-Forwarded-*`, `X-Real-IP`, `Forwarded`, `CF-Connecting-IP` and sets its own `X-Forwarded-For`/`X-Real-IP` from the real TCP peer.
- The **backend per-server Caddy's `trusted_proxies` changes from `CLOUDFLARE_PROXY_CIDRS` to the ingress node IPs.** Otherwise cubes get the ingress IP as the client or a spoofable XFF. Customer IP allow-listing / rate-limiting / geo / audit logging silently break without this.

### 5.8 Domain status model — NEW (the badge + `domain.active` webhook were going dark)

`cloudflareStatus` is the **only** writer of the customer "HTTPS live / Securing TLS" badge ([domain-mappings.tsx:268-291](components/domain-mappings.tsx#L268)) and the **only** emitter of the `domain.active` webhook ([cloudflare-hostname-poll.ts:97](lib/worker/handlers/cloudflare-hostname-poll.ts#L97)). Removing the poll darks both. Replace with:
- A new **`domain_mappings.ingress_status`** column — **5 values: `pending_dns | cert_pending | live | degraded | failed`** (the earlier `routing` value is dropped — it was never emitted). Surfaced via `ingressStatusVariant(): BadgeVariant` in `lib/status-display.ts` per Rule 44 (valid Badge variants only: `default|secondary|destructive|outline`). **Do NOT reuse `tlsStatus`** (it's slated for drop). (Spec inline `components/domain-mappings.tsx` line anchors below predate the table→accordion refactor in commit `62c4655`; re-confirm at edit time — plan Task 5.1 handles this.)
- A new **`ingress.status-poll`** cron (mirrors the retired CF poll cadence + active-recheck) that hits a per-node `GET /healthz?domain=` reporting `{ has_cert, cert_expiry, route_present }`, aggregates across nodes (`live` only when ≥1 node has a valid cert AND the route is present; `degraded` when nodes disagree — catches per-node cert divergence), **fires the `domain.active` webhook** on first-live (preserving the only emitter), and emits the Pusher `domain.update` the UI already listens for ([domain-mappings.tsx:109](components/domain-mappings.tsx#L109)).
- **Deploy order:** ship `ingress_status` + its writer FIRST (dark-launch alongside `cloudflareStatus`), then flip the UI, then remove the poll.

### 5.9 Cube-lifecycle matrix — NEW

| Cube state | Route in routes-endpoint? | `/authorize` issues cert? | Customer sees |
|---|---|---|---|
| running | yes | yes | served |
| sleeping | yes (instant wake) | yes (status ∈ {running,sleeping} ∧ `transferState=idle`) | branded "starting up" interstitial at the **ingress** (`handle_errors`, see §8) until woken — NOT a raw 502 |
| error / stopping | no | no | branded "unavailable" |
| transfer | yes; push new server before source teardown (§5.3) | yes | no 404 window (push-before-teardown) |
| delete | removed on next sync | no | gone; **per-node cert explicitly purged**, not left to expire |
| backup-redeploy / import | re-inserted `pending`; needs explicit **pre-warm + status-flip** step (replaces the lost poll) | yes once re-synced + `resolves-to-us` (any existing `space_domain_claims` lock persists — claims are space-level, not per-mapping) | live after pre-warm |

`/authorize` takes a cube-status input so it does **not** issue/renew certs for `error`/deleted cubes (wasted LE quota + valid-cert-but-down).

### 5.10 Ingress node designation + uniqueness guard — NEW schema

- **`servers.is_ingress`** (boolean) + **`servers.ingress_ip`** (the /29 IP) + per-node health/hysteresis state (a small `ingress_node_health` table or columns). `ingress.dns-health` probes/manages `WHERE is_ingress`.
- **Global hostname uniqueness MUST survive.** `domain_mappings_domain_verified_unique` (partial unique `WHERE verification_status='verified'`, [domains.ts](db/schema/domains.ts)) + the `verificationStatus:"verified"` insert are the **live anti-hijack guard** ("≤1 cube globally per hostname") — **NOT vestigial**. The cleanup migration MUST replace it with an **unconditional `uniqueIndex(domain) WHERE status <> 'deleted'`** in the SAME migration that stops writing `verificationStatus`, so there's never a window without global uniqueness.
- **Second, independent layer (v2.2):** the merged **`space_domain_claims`** feature has its OWN `space_domain_claims_domain_verified_unique` index + its own `domain-claim.recheck` flow ([db/schema/domain-claims.ts](db/schema/domain-claims.ts)). It is a **separate table** — the `domain_mappings` index swap above does NOT touch it, and the ingress must not disturb it. Decommission (Phase 7) only removes the `domain_mappings.verification_status` column/index; the space-claim lock stays.

### 5.11 Ingress firewall, key custody, isolation — NEW

- **Firewall:** on the /29 ingress IP, default-DENY inbound except tcp/80 + tcp/443. The admin API (`:2020`), `/authorize` (`:9111`), SSH (2822), restic, vsock helpers MUST bind loopback/primary-IP and be unreachable on the public ingress IP. Explicit nft/iptables scoped to the ingress IP (mirror `applyHostNetworking` default-deny INPUT).
- **Key custody / threat model:** with shared storage the cert keys + LE account key live in the store; a compromised ingress node still yields impersonation of all custom domains. Ingress process = dedicated unprivileged user, no cube-host/SSH-orchestration privileges; storage encrypted at rest; **prefer dedicating ingress to a subset of boxes** once node count allows (co-location couples the internet-facing ingress with the cube host — jailer protects host-from-cube, not ingress-from-host).
- **AAAA:** if the /29 has IPv6, `ingress.dns-health` manages AAAA identically (happy-eyeballs prefers v6 → a stale AAAA is a worse black hole). If no v6 ingress, guarantee no AAAA exists on `dns.krova.cloud`.

### 5.12 Control-plane changes

- New `GET /api/internal/ingress/routes` (host→server-ip snapshot) — auth via **timestamped HMAC** (`hmacSign(serverId + "." + unixSeconds)`, ≤300 s tolerance, timing-safe; NOT the static replayable boot-notify token, given this discloses fleet topology). Response carries only `host, backend_server_ip, active, protection_tier` — **no** space/cube/customer ids. Network-restrict to ingress source IPs if possible.
- New **sync agent** on each ingress node (systemd unit + install path; analog to `install:vsock-pty`/`install:boot-notify`) that pulls routes → local SQLite and serves `/healthz`.
- `domain.add`/`domain.remove` reworked (§8); new `INGRESS_*` env in `lib/env.ts`.

---

## 6. HA & failover (`ingress.dns-health`)

`dns.krova.cloud` = DNS-only, **TTL 60 s** (CF non-Enterprise floor; 30 s is Enterprise-only), 2–3 A records.

- **Cron: `INGRESS_DNS_HEALTH`, every 1 min, `policy:"exclusive"`** (explicit `QUEUE_OPTIONS` entry per Rule 56; `boss.schedule` registration).
- **L7 probe, not raw TCP.** HTTPS GET to a sentinel route on each ingress IP (TLS handshake + `/healthz` asserting sync freshness + cert-store readability). **`isServerReachable` is unsuitable** — it probes `server.sshPort` (2822) and resolves on TCP connect ([connect-to-server.ts:69,100](lib/ssh/connect-to-server.ts#L69)); it can't tell "Caddy up" from "Caddy serving."
- **Declarative reconcile:** each tick computes desired = {healthy ingress IPs} (subject to guards), lists live CF records, converges (add missing / delete extra) — idempotent, self-heals after partition, safe vs concurrent replica ticks + operator edits.
- **New multi-A DNS primitives** (the existing single-record helpers are unsafe — `findDnsRecord` returns `records[0]`, `ensureDnsRecord` rewrites it → would collapse the round-robin set): `listDnsRecordsByName(name,type)`, `ensureDnsRecordByContent(name,content,{proxied:false,ttl:60})` (create-if-absent by name+content), `deleteDnsRecordByContent(name,content)`. Never use `ensureDnsRecord` for this set.
- **429-aware CF client.** `cfRequest` ([client.ts](lib/cloudflare/client.ts)) has no 429 handling; a 429 blocks **all** CF API calls for 5 min. Add `Retry-After`-honoring backoff + abort the tick; cap mutations per tick.
- **Vantage-point guard (the worker runs only on the CP).** Before deleting **any** record on an all-fail / >50%-fail tick, the worker self-checks its own egress (probe a known-good external target / the CF API); if its own network is the failure, **abort the tick, change nothing, alert**. Hysteresis: remove after **2** consecutive fails, re-add after **2** consecutive healthy (≈2 min detect at a 1-min tick).
- **Never delete the last record (fail-open)** — but this only prevents a *zero-record* outage; if all nodes are genuinely down it keeps one dead record (nothing at the DNS layer can fix all-down). Raise a distinct `ingress.all_nodes_down` alert; never silently mask.
- **Honest failover budget:** detect ≈2 min + CF propagation + client TTL drain (≤60 s, but many resolvers floor/ignore low TTLs) → **realistic worst-case 3–6 min** for node-fully-down. Happy-eyeballs only fails over on connection-refused/RST/connect-timeout (RFC 8305) — **not** an accepted-but-hung socket or slow 5xx, and **non-browser clients (APIs, webhooks, mobile) may not fail over at all**. So the L7 probe (not clients) is what removes an up-but-broken node. Restate the guarantee as "no single point of *ingress* downtime, TTL-bound + client-dependent failover, with a CF-DNS dependency."
- **Observability:** an Orbit "Ingress" surface (each IP, current A-record membership, last probe, per-node cert count, fail-open flag) + a one-shot admin email (`getErrorNotifyEmails()`) on any record deletion / fail-open refusal.

---

## 7. DDoS + application-layer protection

- **L3/L4 (volumetric):** the bare-metal provider's **10 Gbps / 30 M pps, free** on each IP — the layer a small node can't self-absorb. Primary defense.
- **L7:** the **caddy-ratelimit** module (3rd-party → must be in the xcaddy build, §5.1/§5.13) — connection/request caps, timeouts; `/authorize` negative-cache + per-IP handshake cap (§5.4).
- **Lost-WAF (a real downgrade to call out):** CF-for-SaaS implicitly gave every custom-domain request CF's managed WAF / OWASP CRS / bot-fight / IP-reputation / TLS floor. Grey customers lose this. Baseline at the ingress: min TLS 1.2, request-size/method/path caps, and **recommended: ship Coraza-WAF (OWASP CRS) in the xcaddy build**, opt-out per customer. §9a (own CF) is an *additional* layer, not the only answer.

---

## 8. What changes / retires (full enumeration — removal respects Rule 40)

**CF call sites — 6 handlers + 1 helper module (not 2):** `domain-add.ts` (register), `domain-remove.ts` (deregister), `cube-delete.ts:108` (deregister), `cube-transfer.ts:817` (repoint), `cube-transfer-cancel.ts:229` (repoint-restore — Rule 57), `cloudflare-hostname-poll.ts`; all via `lib/server/cube-domain.ts` (`registerCubeCustomHostname`/`deregisterCubeCustomHostname`/`repointCubeCustomHostname`/`repointCubeDomainsToServer`/`resolveServerOrigin` → delete). **Dual-run rule:** reworked handlers MUST **no-op** the CF path on rows that still carry `cloudflareHostnameId` (pre-migration cubes), not error (§10). Transfer's domain logic **collapses** to "push route to ingress + ensure destination backend Caddy route" — the CF repoint is gone; the backend route on the destination is STILL required (`addCustomDomainRoute`).

**Retire (at decommission):**
- `lib/cloudflare/custom-hostnames.ts`; the `cloudflare.hostname-poll` cron.
- **The entire cache-purge subsystem** (CF-edge-specific, dead with no CF edge): `lib/cloudflare/cache.ts`, `lib/domains/cache-purge.ts` (+ test), `domain-purge-cache.ts`, `JOB_NAMES.DOMAIN_PURGE_CACHE` (+ `boss.ts:298` + `ensure-queues.ts:190`), `runDomainCachePurge`/`purgeDomainCacheAction`/`adminPurgeDomainCacheAction`, the v1 + Orbit purge routes, the "Clear cache" buttons ([domain-mappings.tsx:330](components/domain-mappings.tsx#L330), `domains-table.tsx:148`), `DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS`, `domain_mappings.lastCachePurgeAt` (deferred DROP), the `domain.cache-purged` Pusher event, `tests/integration/domain-cache-purge.test.ts`. (Unless §9b re-introduces it for the CF tier.)
- **`workers/origin-fallback/` is ALREADY removed** from the repo — CLAUDE.md's "Origin-fallback Worker" section is **stale** and must be deleted (Rule 22). The branded origin-down page is re-implemented at the **ingress** via `handle_errors` (reuse `CUBE_STARTING_HTML`/`BRANDED_FALLBACK_HTML` from [caddy.ts:74,137](lib/ssh/caddy.ts#L74)).

**Change (not delete):**
- `scripts/cloudflare-setup.ts`: `dns.krova.cloud` becomes DNS-only A → ingress IPs; drop the SaaS fallback origin.
- `lib/server/cloudflare-origin.ts` / `installOriginCaCert`: **load-bearing — do not blindly drop.** `setUpServerCloudflareOrigin` creates BOTH the proxied origin record AND the **DNS-only `connect.<hostname>` record** (SSH/TCP — must survive) AND installs the wildcard Origin CA cert (still used for the per-server landing page). It hard-throws if `CLOUDFLARE_ORIGIN_CERT/_KEY` unset and is **mandatory in `server.install`**. Rework: keep `connect.` + landing cert; the custom-domain TLS no longer terminates here (moves to ingress); reconcile the install-phase fail-fast gate.
- `lib/ssh/caddy.ts`: `customDomainRoute` reworked for the internal-CA mTLS backend leg (§5.2); `initializeCaddyServer`/`reconcileCaddyRoutes` bind the primary IP explicitly (§5.1); `trusted_proxies` → ingress IPs (§5.7). `reconcileCaddyRoutes`/`getActiveCustomDomainsForServer` remain the **backend** route source of truth per server.
- **UI/API/webhook/docs:** `components/domain-mappings.tsx` (add-instructions text [:437-479], the "Managed TLS+DDoS via Cloudflare" copy, the badge → `ingress_status`, the §9a hint); Orbit domain detail page (drop the "Cloudflare for SaaS" card) + `domains-table.tsx` (the "Cloudflare" column); `lib/status-display.ts` `cloudflareStatusVariant` → ingress status (Rule 44); `lib/webhook-payloads.ts` `buildDomainPayload:117` (`cloudflareStatus` → `ingressStatus` — **breaking webhook-contract change**, deprecation note + version bump); `lib/webhook-events.ts:183,190` descriptions (drop "Cloudflare Custom Hostname" wording) + ensure `domain.active` still fires (§5.8); `lib/api/v1-cube-format.ts formatDomain` + `docs/api/v1.md:303,474`.
- **CLAUDE.md + README (Rule 22):** rewrite "Custom Domains (Cloudflare for SaaS)", the origin-fallback section (delete — already gone), the `server.refresh-caddy` / `domain.purge-cache` rows, the webhooks count, the architecture "Domain mappings" line.

**Queues:** add `INGRESS_DNS_HEALTH` + `INGRESS_STATUS_POLL` (+ optional `INGRESS_ROUTES_POKE` for transfer push) to `JOB_NAMES`, each with explicit `QUEUE_OPTIONS` (Rule 56), crons `policy:"exclusive"`. Routes-sync is **pull-side on the ingress — no worker queue**. Remove `cloudflare.hostname-poll` + `domain.purge-cache` from `boss.schedule`/`boss.work` at decommission.

---

## 9. "Cloudflare protection" options

### 9a. Bring-your-own-Cloudflare (free, default, recommended)

A customer who wants edge DDoS/WAF/cache adds an **A/AAAA record to the ingress IP** (NOT a CNAME to `dns.krova.cloud` — a CNAME to our CF-managed name re-introduces cross-account CNAME risk) and orange-clouds it. This is a **plain CF→origin proxy, not O2O** → **WebSockets work, no 1014** (1014 is cross-account-CNAME-to-proxied only; a proxied record to a plain origin IP is fine — verified), full CF protection on **their** account, **$0 to Krova**. UI hint: note they may need to enable **Network → WebSockets** in their own dashboard (their responsibility). This **inverts** the current add-sheet warning ("set DNS-only, proxying breaks issuance") — for their *own* CF in front of our origin IP, proxying is fine.

### 9b. Krova-provided Cloudflare-for-SaaS tier (paid, Phase 2 — OPTIONAL)

For **off-Cloudflare** customers wanting CF benefits without their own account: a separate proxied target `cdns.krova.cloud` (must be separate — `dns.krova.cloud` is DNS-only) backed by CF-for-SaaS; $0.10/hostname CF cost.
- **WebSockets: resolved — works.** The `No/No` is the **O2O** matrix; a non-O2O custom hostname (off-CF customer, non-CF CNAME → proxied SaaS target, single CF zone in path) is standard proxying, WebSockets supported on all plans. Apex/A-record proxying is also explicitly non-O2O. (Re-confirm at build per Rule on third-party, but not a blocker.)
- **Billing — fix the rounding loss:** $0.10/mo ÷ 730 h = $0.000137/h → rounds to **$0.0001/h = $0.073/mo** at the platform's `numeric(12,4)` + `Math.round(x*1e4)/1e4` ([billing-hourly.ts:908](lib/worker/handlers/billing-hourly.ts#L908)) — a **27% under-recovery**. Price the tier at **$0.15/mo** (→ $0.0002/h = $0.146/mo ≥ cost) or document the ~3¢/mo eaten. Add `billing_events.type='domain_protection_charge'` to the pgEnum **and** to `BILLING_DEBIT_TYPES` (Rule 54 — else it renders as a green credit). Bill it as a per-domain pass mirroring backup-storage, routed through `applyOverageCascadeTx`, keyed on **hostname-exists-at-CF** (not cube state — CF bills regardless). Funding-failure → auto-downgrade to §9a (clear `protection_tier`, delete the CF hostname, fire `domain.update`, threshold email). Decide `maxDomains` interaction + which plans may enable. Adds a `domain_mappings.protection_tier` (`free|cloudflare`) column.
- **Recommend: defer to Phase 2; ship the free core first.**

---

## 10. Migration runbook (strict order, operator-run flips per Rule 60)

> **Blast radius (verified):** only **custom-domain HTTP/WS** routes through `dns.krova.cloud`. SSH + TCP mappings (`connect.<hostname>` → `server.publicIp`, grey), the browser terminal (worker → `server.publicIp:sshPort` → vsock), and the dashboard/API (Dokploy VPS, `krova.cloud`) **do NOT** — the 30 live cubes' management plane is untouched throughout. A cube with no custom domain sees zero change at any step.

0. **Operator pre-flight inventory + go/no-go (agent prepares the read-only commands; operator runs them, Rule 60).** Count active custom domains + distinct registered domains (eTLD+1) — confirm N is within a single pre-warm window (≤~200 distinct registered domains/3h; ≤~45 single-SAN certs per customer registered domain/7 days, GLOBAL). Confirm the ingress `/29` IPs + each node's `/healthz` store-count == active-domain count. **`dig AAAA dns.krova.cloud`** — if a proxied AAAA exists, step 8 MUST also handle it. Confirm the §12 two-node single-issuance (storage-Locker) test passed. These are HARD gates.
1. **Schema (additive, deploy-first):** `domain_mappings.ingress_status`; `servers.is_ingress` + `servers.ingress_ip` + ingress health state. (`pnpm db:generate`, Rule 6.) Do NOT touch CF columns yet.
2. **Code dual-run behind a flag** (`CUSTOM_DOMAIN_INGRESS_ENABLED`, `lib/env.ts`): when ON, the 6 CF call sites **no-op** the `cube-domain.ts` calls (incl. on rows that still have `cloudflareHostnameId`) and instead mark the mapping for ingress sync; `cloudflare.hostname-poll` no-ops. Deploy with flag **OFF**.
3. **Build + deploy** `GET /api/internal/ingress/routes` (timestamped-HMAC) + the new host→server-ip routes builder + the `ingress.status-poll` writer (dark-launched alongside `cloudflareStatus`).
4. **Build the xcaddy ingress image** (routing + ratelimit + storage [+ Coraza]); pin the EXACT `caddy-storage-postgres` repo+commit and verify its certmagic Locker on the dev host (§12 #3). Then **per box, in order: (4a) rebind the live per-server Caddy to `<primaryIP>:80/:443` (low-traffic, one box at a time, while still behind CF so CF cushions the listen-address socket-swap blip) + install the internal-CA leaf listener + reconcile the `setUpServerCloudflareOrigin` install gate; (4b) verify `ss -ltnp` shows `<primaryIP>:443` (off `0.0.0.0`) AND a live custom domain still serves; (4c) THEN stand up the ingress on `<ingressIp>:80/:443`** (own user, firewall §5.11, shared cert storage §5.1). **4a-before-4c is mandatory or the ingress bind collides (`EADDRINUSE`) on the co-located box.**
5. **`pnpm routing:refresh-fleet`** so every backend Caddy route is current (else the ingress proxies to a server whose Caddy 404s — the 2026-05-29 failure mode), then **seed every existing active domain into each ingress node's local store** and confirm the count. (No cert pre-warm yet — see step 9; LE can't validate while DNS still points at CF.)
6. **Backfill ownership state** for existing domains (grandfather existing active mappings as verified). Optional — `space_domain_claims` is additive (§5.6).
7. **Flip the flag ON** (handlers stop calling CF; new status flows).
8. **Operator flips `dns.krova.cloud`** — agent supplies exact CF DNS API v4 commands: list record id → **DELETE** the proxied A record → **POST 2–3 DNS-only A records** (`proxied:false`, TTL 60) for the ingress IPs. (PATCH can't convert one proxied record into N grey records.) **AAAA:** if step 0 found a proxied AAAA, DELETE it here too (and POST grey AAAA only if the /29 has v6 ingress — else guarantee none exists, §5.11), or happy-eyeballs v6 clients black-hole / 1014 on a stale CF v6.
9. **Immediately POST-flip: pre-warm all certs** (`pnpm ingress:prewarm`). NOW the challenge validates (public DNS resolves to the ingress). At N≈30 this completes in ~30 s (bounded by Caddy's cluster-wide 10-orders/10s, far under LE 300/3h); the gradual drain (cached-OLD resolvers still on working CF-for-SaaS) covers the seconds between a resolver re-resolving and its cert warming. Rate-limit per-registered-domain (eTLD+1) and hard-gate each FQDN on `/authorize` sync-ack.
10. **Soak (e.g. 7 days).** Rollback trigger = any Phase-0 (§12) check regresses OR custom-domain error-rate rises. Rollback = operator re-POSTs the proxied A (+AAAA) record (commands prepared). **Rollback is valid ONLY before step 11** — once CF hostnames are deleted, reverting DNS 1014s.
11. **Decommission (separate deploy):** remove the CF handler code + `cloudflare.hostname-poll` + the cache-purge subsystem; **then a `DROP COLUMN` migration** for `cloudflareHostnameId`/`cloudflareStatus`/`cloudflareCheckedAt`/`verificationStatus`/`verifyAttempts`/`verificationError`/`tlsStatus`/`lastCachePurgeAt` — in the SAME migration, **swap the `verification_status='verified'` partial unique index for an unconditional `uniqueIndex(domain) WHERE status<>'deleted'`** so global hostname uniqueness never lapses (§5.10).

**Existing cubes** need no per-cube action beyond step 5 (their backend Caddy route must be current). It's control-plane + DNS.

**Existing customers auto-migrate at the flip (step 8) — no customer re-point.** They already point (grey) at `dns.krova.cloud`; flipping it from the proxied CF record to the DNS-only ingress IPs moves all of them onto the self-hosted ingress — and *fixes* the ones currently 1014-broken. The flip is a **gradual per-resolver drain** (CF-for-SaaS stays live until step 11): cached-OLD resolvers keep working while re-resolved ones move to the ingress. Per-segment: on-CF+grey → strict improvement; on-CF+orange/O2O → improves if moved to grey-direct (UI copy, §8/Task 5.1); **off-CF customers working today → the ONLY regression-risk segment** (moved off a working path), protected only if steps 5 + 9 (store-seed + route-refresh + post-flip pre-warm) succeed.

---

## 11. Schema migrations (Rule 6 / Rule 40)

- **Additive (pre-cutover):** `domain_mappings.ingress_status` (enum); `servers.is_ingress` (bool), `servers.ingress_ip` (text), ingress health state.
- **Cleanup (post-decommission):** DROP the 8 CF/verification/cache columns + the partial-unique-index swap (above). Separate, additive-safe.
- **Optional (§9b Phase 2):** `domain_mappings.protection_tier`.
- §8's v1 claim "no core schema migration required" was **wrong** — corrected here.

---

## 12. Phase 0 — live verification (gates the build; operator-run, Rule 60)

On a real **on-Cloudflare** test domain + a designated test cube:
1. **Ordering: rebind the per-server Caddy to `<primaryIP>` (4.5) → verify `ss -ltnp` shows `<primaryIP>:443` off `0.0.0.0` AND a live custom domain still serves (no customer-visible drop while behind CF) → THEN start the ingress.** Both Caddy services then run with **no `EADDRINUSE`** (the co-located bind collision the ordering exists to prevent).
2. `dns.krova.cloud` DNS-only A → one ingress IP; test domain grey CNAME → it; **no 1014**.
3. **Two-node single-issuance (storage Locker, §5.1):** two ingress nodes on the SAME Postgres store, concurrent first-hit for one SNI → **exactly ONE LE order** observed (proves the pinned plugin's certmagic Locker is atomic — a no-op Locker races to 3× duplicate certs at cutover). Cert issues cluster-wide, once, via `/authorize`.
4. **WebSockets** work end-to-end (ingress → backend → cube).
5. **Cube sees the real client IP** (XFF re-plumb §5.7).
6. **Transfer** re-routes with **no 404 window** (push-before-teardown) and no customer DNS change.
7. **Kill one ingress node** → `ingress.dns-health` removes its A within ~2 min (L7 probe), never deletes the last, self-egress-check aborts on CP partition.
8. **`/authorize` refuses** an unmapped/random SNI and an unverified mapping.

Fail any of 1–6 → stop and revisit.

---

## 13. Testing (Rule 59)

- **Unit:** the shared host normalizer (ask/routing/SAN); `/authorize` decision (mapped+verified+`pending`/`active` → 2xx; unmapped/unverified → non-2xx; wildcard single-label match; cube-status gate); `ingress.dns-health` decision (declarative reconcile; never-delete-last AND >50%-fail abort; self-egress-check; `proxied:false` invariant; AAAA); the multi-A DNS helpers; the host→server-ip routes builder; SSRF allow-list; the §9b per-hour billing amount + `BILLING_DEBIT_TYPES` membership; the dual-run no-op-on-`cloudflareHostnameId` branch.
- **Integration:** `domain.add`/`remove` sync; transfer push-before-teardown; the routes endpoint auth (timestamped HMAC, replay rejected); the uniqueness-index swap preserves global uniqueness across the migration.
- **Host/E2E:** the Phase-0 sequence; reconcile with the existing E2E harness (`KROVA_E2E_SKIP_CLOUDFLARE` / `server-install` gate semantics change — §8).
- Re-verify Caddy/LE/CF/ACME third-party contracts against current docs at build (Rule).

---

## 14. Verified facts (research log, 2026-06-02)

**Vendor-doc-verified:**
- Grey on-CF DNS-only CNAME bypasses O2O but still 1014s (target resolves into another account's anycast); O2O (orange) authorizes but `WebSockets No/No` (O2O matrix only; non-O2O standard proxying supports WS on all plans). Workers/Containers are Worker-fronted (CF in path); Containers meter egress $0.025–0.05/GB.
- §9a: a proxied record → plain origin IP does NOT 1014 and supports WebSockets (customer may need the Network→WebSockets toggle); use an **A-record-to-IP**, not a CNAME to our name.
- Caddy 2.11.3 (released 2026-05-12): `on_demand_tls { ask }` GET `?domain=`, **2xx allows**, `interval`/`burst` deprecated; `reverse_proxy` WebSockets automatic; stock dynamic upstreams are DNS-based only (no per-Host lookup w/o a module); admin API config changes zero-downtime (Etag/If-Match); multi-instance: shared storage ⇒ issues once / cluster-coordinated, local ⇒ per-node autonomous. `caddy-ratelimit` + Coraza are 3rd-party (need xcaddy). **Re-confirm the module API against pinned v2.11.3 at build.**
- ACME: HTTP-01 (:80) + TLS-ALPN-01 (:443). **Let's Encrypt limits — corrected:** the binding one for ≥3 autonomous nodes is **5 duplicate certs / exact identifier / 7 days** (NOT 50/registered-domain); also **50 certs/registered-domain/week (global across ALL accounts)**, **300 new-orders/account/3 h**, **5 failed-validations / identifier / account / hour**. **ARI renewals are exempt from all limits** (Caddy uses ARI) — the reason renewals are safe; the LE 90→64→45-day transition (from 2026-02) ~doubles renewal frequency. Shared storage removes the duplicate-cert exposure.
- CF DNS: multiple A per name = round-robin; **DNS-only min TTL 60 s non-Enterprise** (30 s Enterprise-only); proxied forces TTL=Auto/300; round-robin has no health-checking; CF API 429 blocks all calls 5 min (`Retry-After`). `name=` exact filter not deprecated.

**Operator-asserted (plan-specific, not vendor-doc-checkable):** provider DDoS **10 Gbps / 30 M pps free**, **/29 (5 usable)**, **100 TB / 10 Gbps**, LA.

**Codebase facts:** existing Caddy binds bare `:80/:443` (0.0.0.0); `trusted_proxies=CLOUDFLARE_PROXY_CIDRS`; `customDomainRoute` is plain-HTTP to cube; `findDnsRecord` returns `[0]` (unsafe for multi-A); `cfRequest` has no 429 handling; `addDomainAction` writes `verificationStatus:"verified"` (the live uniqueness guard); `validateDomain` rejects `*`; the 6 CF call sites in §8; `workers/origin-fallback/` already removed; `cloudflareStatus` is the sole TLS-badge writer + sole `domain.active` emitter; Caddy installed via apt-hold (no xcaddy).

---

## 15. Decisions — LOCKED (v2.1)

1. **Routing mechanism:** ✅ **custom xcaddy module** (xcaddy is needed anyway for rate-limit/storage modules).
2. **Shared cert storage:** ✅ **`caddy-storage-postgres` against `krova-db`**.
3. **Internal-leg auth:** ✅ **internal-CA mTLS** (`skip-verify` prohibited).
4. **Ingress placement:** ✅ **co-located on the 3 existing boxes** now; dedicate boxes later as node count grows.
5. **Domain shape:** ✅ **exact-FQDN only — NO wildcard mappings/matching** (§4a). Customer wildcard CNAME = DNS convenience; each subdomain is an explicit FQDN mapping. (Removes the validator/ask wildcard work entirely.)
6. **Domain-ownership proof:** ✅ **optional, not a gate** (§5.6). `resolves-to-us` + global hostname uniqueness stay enforced.
7. **Real-client-IP re-plumb:** ✅ **required** (ingress strips/sets XFF; backend `trusted_proxies` → ingress IPs).
8. **SSRF backend-dial allow-list:** ✅ **required** (validate backend ∈ known-servers; cheap guard).
9. **§9b paid CF tier:** ✅ **deferred to Phase 2**; the $0.10/hostname cost is passed to the customer (price ≥ $0.15/mo to clear the 4-decimal rounding) when built.
10. **Coraza-WAF baseline:** ✅ **opt-in, not default** at launch.

**Operator-provided at deploy time (NOT blockers for the plan):** which /29 IPs are the ingress IPs; the internal-CA material; running the `dns.krova.cloud` flip + fleet scripts (operator-run, Rule 60). The agent prepares exact commands.

---

## 16. Risks

- The ingress holds (via shared storage) every custom-domain private key + the LE account key + the routing map — highest-value compromise target; mitigated by isolation (§5.11), but it's a new concentration of risk vs CF holding the public-leg keys.
- DNS-layer failover is TTL-bound + client-dependent (§6) — not instant, and non-browser clients may not fail over. Honest SLA framing required.
- Custom xcaddy build adds a Go/module maintenance burden on every Caddy + module security bump (Rule 46 install/verify/retrofit).
- Migration touches Rule 57 (transfer-cancel) + Rule 58 (transfer) critical paths — the dual-run no-op + push-before-teardown must be implemented carefully and tested.
- **Live-box Caddy rebind (§10 step 4a) is a listen-ADDRESS change (socket swap), NOT a free zero-downtime reload** — Caddy's zero-downtime guarantee covers route/handler config, not a bind-address change. Mitigated by doing it per-box, low-traffic, while still behind CF (CF connection-pooling absorbs the origin blip; active WS through CF may reconnect). It is the one pre-flip step that touches the 30 cubes' live custom-domain path.
- **Shared-cert-storage "issue once" depends on an unverified third-party plugin's certmagic Locker** (§5.1) — a stubbed lock silently races 3 nodes to issue at cutover and blows the 5-duplicate/identifier/week GLOBAL limit. Hard-gated by the §12 #3 two-node test + an exact repo+commit pin.
- **Pre-warm cannot validate while public DNS still points at CF** — RESOLVED by moving the bulk pre-warm to immediately POST-flip (§10 step 9); the gradual drain covers the gap. A pre-flip pre-warm would silently issue zero certs (false confidence) — do not reintroduce it.
