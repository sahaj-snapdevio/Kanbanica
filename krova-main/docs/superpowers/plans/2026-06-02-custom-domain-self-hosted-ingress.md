# Custom-Domain Self-Hosted Ingress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cloudflare-for-SaaS custom-domain routing with a self-hosted Caddy ingress tier so on-Cloudflare customers' grey (DNS-only) domains work, WebSockets work, and there's no per-domain CF cost.

**Architecture:** `dns.krova.cloud` becomes a DNS-only round-robin of 2–3 ingress IPs (on existing bare-metal /29 addresses). Each ingress node runs a custom `xcaddy` build that terminates Let's Encrypt on-demand TLS (gated by a local `/authorize`), routes by **exact** `Host` to the cube's current server (resolved from a local SQLite synced from `krova-db`), and re-encrypts to the backend per-server Caddy over internal-CA mTLS. A `ingress.dns-health` cron health-manages the A records. Everything ships behind `CUSTOM_DOMAIN_INGRESS_ENABLED` (dual-run) and migrates via a DNS flip — existing customers (already on `dns.krova.cloud`) auto-migrate at the flip with no re-point.

**Tech Stack:** Next.js 16 / TypeScript, Drizzle ORM + Postgres, pg-boss, Caddy 2.11.3 (xcaddy custom build: routing module + `caddy-ratelimit` + `caddy-storage-postgres`), Let's Encrypt (on-demand + ARI), Cloudflare DNS API v4, SQLite (local routing store on each node), `node --test` / `tsx` for tests.

**Spec:** [docs/superpowers/specs/2026-06-02-custom-domain-self-hosted-ingress-design.md](../specs/2026-06-02-custom-domain-self-hosted-ingress-design.md) (v2.1, decisions locked in §15).

**Decisions locked (spec §15):** custom xcaddy routing module · `caddy-storage-postgres` cert storage · internal-CA mTLS backend leg · ingress co-located on the 3 existing boxes · **exact-FQDN only (no wildcard mappings/matching)** · domain-ownership proof optional (not a gate) · real-client-IP re-plumb + SSRF guard kept · §9b paid CF tier + Coraza WAF deferred.

**Test commands:** unit `pnpm test` (single file: `node --env-file=.env.unit --import tsx --test <file>`); DB `pnpm test:integration`; migrations `pnpm test:migrations`; `pnpm typecheck`; `pnpm lint`; full gate `pnpm test:all`.

**Phasing (each phase is independently testable + mergeable; nothing changes customer behavior until Phase 6 flip):**
- **Phase 0** — Foundations: feature flag, additive schema, status-display wiring.
- **Phase 1** — Pure-logic libraries (TDD): host normalizer, routes builder, multi-A DNS primitives, dns-health decision, authorize decision, SSRF allow-list.
- **Phase 2** — Control-plane endpoints + crons: routes endpoint, `ingress.dns-health`, `ingress.status-poll`.
- **Phase 3** — Handler reworks behind the flag (domain.add/remove, transfer, transfer-cancel, delete) + backend Caddy changes.
- **Phase 4** — Host-side ingress component (xcaddy build, routing module, sync agent, Caddyfile, systemd, install/verify, internal CA).
- **Phase 5** — UI / v1 API / webhook / docs surfaces.
- **Phase 6** — Migration & cutover: pre-flight inventory → seed + route-refresh (pre-flip) → **flip** → **post-flip** pre-warm → Phase-0 live verification. (Pre-warm is AFTER the flip — LE can't validate while DNS still points at CF.)
- **Phase 7** — Decommission (after soak): remove CF code + cache-purge subsystem, DROP-COLUMN migration + uniqueness-index swap, CLAUDE.md/README.

> **Host-side caveat (Phase 4):** the ingress component (Go module, Caddyfile, systemd) is verified by the host-smoke / E2E harness + the Phase-0 live test, **not** Node unit tests. Those tasks give complete artifacts + exact verification commands instead of `pnpm test` TDD loops.

---

## Revision history & remaining inline guidance (READ FIRST)

**v2.3 — migration-safety pass (2026-06-02, 4-agent code+doc verification vs `main`).** Confirmed the design is sound and only **custom-domain HTTP/WS** is in the blast radius (SSH, TCP mappings, browser terminal, and the dashboard do NOT route through `dns.krova.cloud` — the 30 live cubes' management plane is untouched). Folded the following structural fixes directly into the tasks:

- **🔴 Pre-warm ordering corrected (was a silent no-op).** LE validates the ACME challenge against PUBLIC DNS; a pre-flip pre-warm issues zero certs while DNS still points at CF. Phase 6 now runs **seed + route-refresh (pre-flip) → FLIP → pre-warm (post-flip)**. See the new Phase 6 preamble + Tasks 6.1/6.2/6.3.
- **🔴 Phase 4 reordered to prevent an `EADDRINUSE` outage.** The live per-server Caddy rebind (now **Task 4.5**) MUST complete + verify on a box BEFORE the ingress is stood up (now **Task 4.6**) on that box. The rebind is a listen-address socket swap (NOT free) — do it per-box, low-traffic, while still behind CF (CF absorbs the origin blip). Internal-CA listener install + the `setUpServerCloudflareOrigin` install-gate reconcile folded into 4.5.
- **New hard gates:** operator pre-flight inventory + AAAA check + storage-plugin certmagic-Locker two-node single-issuance verification (Task 6.0 + 6.3) — the shared-cert-storage "issue once" claim is conditional on the plugin's lock; an unverified plugin races 3 nodes to issue at cutover and blows the 5-duplicate/identifier/week limit.

**v2.2 — 6-agent anchor pass (2026-06-02).** The following BLOCKERS were found and are now **FOLDED INTO the task bodies** (no longer pending — the task code is already corrected): Task 0.1 (real-boolean `.transform`, not the enum shape), Task 0.3 (real Badge variants `default|secondary|destructive|outline` — `success`/`warning` don't exist), Task 1.2 (`cubePort: number | null`; hand-insert the domain row, no `_seed` helper), Task 1.3 (no `cfRequest` mock precedent → pure `parseCfRateLimit` + `CloudflareRateLimitError`), Task 1.4 (corrected `decideDnsHealth` gating partial-abort on `!allDown`), Task 3.3 (create `lib/ssh/caddy.test.ts`; extract pure `buildListenArray`/`buildTrustedProxies`; mTLS leg is a connection-policy, not `customDomainRoute`).

### Discrepancies / ordering (still advisory — note when executing)

- **Task 0.1:** ignore "follow `KROVA_E2E_SKIP_CLOUDFLARE`" (that var is `z.enum(["true","false"])`, NOT a transform). KEEP the `.transform((v)=>v==="true")` snippet → yields a real `boolean` so the Phase-3 `if (!env.CUSTOM_DOMAIN_INGRESS_ENABLED)` gates work; do NOT copy the enum shape (the string `"false"` is truthy).
- **Task 0.2:** `db/schema` is Biome-excluded and uses **no semicolons** — match the surrounding no-semicolon style (the `lib/` snippets DO use semicolons — those are linted).
- **Task 2.1:** `verifyIngressToken` MUST length-guard before `timingSafeEqual` (it throws on unequal-length buffers — see `server-rebooted/route.ts:49`).
- **Task 2.2:** repo form is `boss.schedule(JOB_NAMES.INGRESS_DNS_HEALTH, "* * * * *")` — **no data/options/`{tz}` arg** (UTC default). Register with plain `boss.work` like `CLOUDFLARE_HOSTNAME_POLL` (boss.ts:302).
- **Task 2.3:** preserve the envelope — `dispatchWebhookEvent(spaceId, "domain.active", { domain: buildDomainPayload(updatedRow) })`; Pusher = `triggerEvent(\`private-cube-${cubeId}\`, "domain.update", {...})` from `@/lib/pusher`.
- **Task 3.1:** `domain-add.ts` imports `summarizeCloudflareStatus` from `custom-hostnames.ts` (deleted in Phase 7) — keep it imported (flag-gated) until Phase 7. Reword the `domain-add.ts:110,125` "registered with Cloudflare for SaaS" lifecycle/audit strings in the ON branch. **`lib/ingress/push-routes.ts` must be import-injectable** so flag-ON integration tests can stub the network POST (no real ingress node in `test:integration`) — mirror the CF-client spy.
- **Task 3.2:** the F2 rollback (`cube-transfer.ts:1331`, gated on `domainRoutingApplied`) loops `activeDomains` — call `pushRouteToIngress(d.domain, sourcePublicIp)` after resolving `sourceServerId → servers.publicIp` (push takes host + IP, not a server id).
- **Task 5.2:** pin the detail path `app/(orbit)/orbit/domains/[domainId]/page.tsx` (CF card `:138-152`, badge `:81`, selects `:42-43`). The LIST query `app/(orbit)/orbit/domains/page.tsx:22-24,44-45` also selects `cloudflareStatus`/`verificationStatus` → add `ingressStatus` (must precede the Phase-7 column drop); `:87` has "routed through Cloudflare for SaaS" copy to reword.
- **Task 5.3:** `formatDomain` (`v1-cube-format.ts:59`) emits **no** `cloudflareStatus` — it's a pure ADD of `ingressStatus`, not a swap. `docs/api/v1.md:474` is the **webhook** payload (swap there); `:303` is the purge-cache REST row → that edit moves to **Phase 7**, not Task 5.3.
- **Task 7.2:** **PREREQ — Task 5.2 must have removed the Orbit `verificationStatus` reads first** (`orbit/domains/page.tsx:22,43`, `[domainId]/page.tsx`, `domains-table.tsx`) or `pnpm typecheck` fails at the column drop. The generated migration ALSO drops `domain_mappings_pending_verify_idx` (`WHERE verification_status='pending_dns'`) — expected. Remaining `verificationStatus` mentions in `cube-transfer.ts`/`transfer-check/route.ts`/`refresh-routing-fleet.ts` are **comments only**.
- **Task 7.3:** CLAUDE.md's `Origin-fallback Worker — REMOVED` paragraph (`:596`) is a deliberate **do-not-reintroduce guardrail**, NOT stale cruft — rewrite/keep it (point the branded origin-down page at the ingress `handle_errors`), don't blank-delete. README hits to fix: `:35, :36, :113, :237, :264, :338`.
- **`ingress_status` enum is LOCKED to 5 values** (`pending_dns, cert_pending, live, degraded, failed`); the spec's old `routing` value is never emitted (spec §5.8 corrected to match).

---

## Phase 0 — Foundations (no behavior change)

### Task 0.1: Feature flag `CUSTOM_DOMAIN_INGRESS_ENABLED`

**Files:**
- Modify: `lib/env.ts` (the zod env schema)

- [ ] **Step 1: Add the flag to the env schema.** In `lib/env.ts`, add to the schema object. ⚠️ Do NOT copy `KROVA_E2E_SKIP_CLOUDFLARE`'s shape — that one is `z.enum(["true","false"])` and stays a STRING (so `"false"` is truthy). This flag MUST `.transform()` to a real `boolean` so the Phase-3 `if (!env.CUSTOM_DOMAIN_INGRESS_ENABLED)` gates are correct:

```ts
// Custom-domain self-hosted ingress: dual-run gate. When false (default),
// the CF-for-SaaS path is unchanged. When true, the 6 CF call sites no-op
// and routing flows through the self-hosted ingress.
CUSTOM_DOMAIN_INGRESS_ENABLED: z
  .string()
  .optional()
  .transform((v) => v === "true"), // → real boolean (NOT a "true"/"false" string)
```

- [ ] **Step 2: Verify typecheck passes.**

Run: `pnpm typecheck`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit.**

```bash
git add lib/env.ts
git commit -m "feat(ingress): add CUSTOM_DOMAIN_INGRESS_ENABLED dual-run flag"
```

### Task 0.2: Additive schema migration

**Files:**
- Modify: `db/schema/domains.ts` (add `ingressStatus` column + enum)
- Modify: `db/schema/servers.ts` (add `isIngress`, `ingressIp`)
- Create: `db/schema/ingress-node-health.ts` (per-node health/hysteresis state)
- Modify: `db/schema/index.ts` (export the new table)
- Generated: `db/migrations/<next>_*.sql` + snapshot + journal (via `pnpm db:generate` — never hand-write, Rule 6)

- [ ] **Step 1: Add the `ingress_status` pgEnum + column** to `db/schema/domains.ts` (mirror the existing `domainStatus` pgEnum style):

```ts
export const ingressStatus = pgEnum("ingress_status", [
  "pending_dns",   // mapping exists, route synced, no cert yet
  "cert_pending",  // first request seen, ACME in flight
  "live",          // ≥1 ingress node has a valid cert AND the route is present
  "degraded",      // nodes disagree (per-node cert divergence)
  "failed",        // repeated validation failure (backoff)
]);
// in the domainMappings table definition, add:
//   ingressStatus: ingressStatus("ingress_status"),  // nullable; null until ingress live
```

- [ ] **Step 2: Add `is_ingress` + `ingress_ip`** to the `servers` table in `db/schema/servers.ts`:

```ts
// in the servers pgTable definition:
isIngress: boolean("is_ingress").notNull().default(false),
ingressIp: text("ingress_ip"), // the dedicated /29 IP this node serves the ingress on; null unless isIngress
```

- [ ] **Step 3: Create `db/schema/ingress-node-health.ts`** (per-node hysteresis counters, so the dns-health worker has durable state):

```ts
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { servers } from "@/db/schema/servers";

export const ingressNodeHealth = pgTable("ingress_node_health", {
  serverId: text("server_id")
    .primaryKey()
    .references(() => servers.id, { onDelete: "cascade" }),
  ingressIp: text("ingress_ip").notNull(),
  healthy: boolean("healthy").notNull().default(true),
  consecutiveFails: integer("consecutive_fails").notNull().default(0),
  consecutiveOks: integer("consecutive_oks").notNull().default(0),
  inDnsRotation: boolean("in_dns_rotation").notNull().default(false),
  lastProbeAt: timestamp("last_probe_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Export the new table** from `db/schema/index.ts` (add `export * from "@/db/schema/ingress-node-health";`).

- [ ] **Step 5: Generate the migration.**

Run: `pnpm db:generate`
Expected: a new `db/migrations/<idx>_*.sql` (additive `ADD COLUMN` + `CREATE TABLE` + `CREATE TYPE`), a `meta/<idx>_snapshot.json`, and a new `_journal.json` entry. **Do not hand-edit any of these.** (v2.2: latest on `main` is `0072` from the merged domain-claims feature, so this generates `0073`+.)

- [ ] **Step 6: Run the migration smoke test.**

Run: `pnpm test:migrations`
Expected: PASS (applied count == journal count; re-run is a no-op).

- [ ] **Step 7: Commit.**

```bash
git add db/schema/domains.ts db/schema/servers.ts db/schema/ingress-node-health.ts db/schema/index.ts db/migrations/
git commit -m "feat(ingress): additive schema — ingress_status, servers.is_ingress/ingress_ip, ingress_node_health"
```

### Task 0.3: Wire `ingress_status` into status-display (Rule 44)

**Files:**
- Modify: `lib/status-display.ts`
- Test: **extend the EXISTING `lib/status-display.test.ts`** (it already has the per-enum completeness convention — do NOT create a new `lib/status-display.ingress.test.ts`)

> **⚠️ Badge variants are constrained.** `components/ui/badge.tsx` exposes only `default | secondary | destructive | outline | ghost | link`. **`success` / `warning` do NOT exist** and fail at the type level. Use real variants only.

- [ ] **Step 1: Add a failing test** to `lib/status-display.test.ts` (match the file's existing per-enum block style):

```ts
import { ingressStatusDisplay } from "@/lib/status-display";
import { ingressStatus } from "@/db/schema/domains";

test("ingress_status maps every enum value to a label + real Badge variant", () => {
  const valid = new Set(["default", "secondary", "destructive", "outline"]);
  for (const v of ingressStatus.enumValues) {
    const d = ingressStatusDisplay(v);
    assert.ok(d.label.length > 0, `label for ${v}`);
    assert.ok(valid.has(d.variant), `real variant for ${v} (got ${d.variant})`);
  }
  assert.equal(ingressStatusDisplay("live").variant, "default");
  assert.equal(ingressStatusDisplay("failed").variant, "destructive");
  assert.equal(ingressStatusDisplay("degraded").variant, "outline");
});
```

- [ ] **Step 2: Run it; verify it fails.**

Run: `node --env-file=.env.unit --import tsx --test lib/status-display.test.ts`
Expected: FAIL ("ingressStatusDisplay is not a function").

- [ ] **Step 3: Implement** `ingressStatusDisplay(s)` in `lib/status-display.ts`, deriving values from `ingressStatus.enumValues` per the file's existing per-enum pattern (returns `{ label, variant, className }`). Variant map (real variants only): `live → "default"`, `pending_dns | cert_pending → "secondary"`, `degraded → "outline"`, `failed → "destructive"`. Labels: `live → "HTTPS live"`, `cert_pending → "Securing TLS"`, `pending_dns → "Awaiting DNS"`, `degraded → "Degraded"`, `failed → "Failed"`.

- [ ] **Step 4: Run; verify PASS.**

Run: `node --env-file=.env.unit --import tsx --test lib/status-display.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/status-display.ts lib/status-display.test.ts
git commit -m "feat(ingress): status-display mapping for ingress_status"
```

---

## Phase 1 — Pure-logic libraries (TDD)

### Task 1.1: Host normalizer (single source for ask / routing / SAN)

**Files:**
- Create: `lib/domains/host-normalize.ts`
- Test: `lib/domains/host-normalize.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeHost } from "@/lib/domains/host-normalize";

test("lowercases, strips trailing dot, strips port, IDNA to ascii", () => {
  assert.equal(normalizeHost("App.Acme.COM"), "app.acme.com");
  assert.equal(normalizeHost("app.acme.com."), "app.acme.com");
  assert.equal(normalizeHost("app.acme.com:443"), "app.acme.com");
  assert.equal(normalizeHost("xn--caf-dma.com"), "xn--caf-dma.com");
  assert.equal(normalizeHost("café.com"), "xn--caf-dma.com");
});

test("rejects empty / wildcard / non-host input by returning null", () => {
  assert.equal(normalizeHost(""), null);
  assert.equal(normalizeHost("*.acme.com"), null); // exact-FQDN only, spec §4a
  assert.equal(normalizeHost("not a host"), null);
});
```

- [ ] **Step 2: Run; verify FAIL.** `node --env-file=.env.unit --import tsx --test lib/domains/host-normalize.test.ts`

- [ ] **Step 3: Implement.**

```ts
// lib/domains/host-normalize.ts
// Single normalizer shared by /authorize, the routing store, and LE SAN matching.
// EXACT-FQDN only (spec §4a) — wildcards are rejected.
export function normalizeHost(input: string): string | null {
  if (!input) return null;
  let h = input.trim().toLowerCase();
  const at = h.indexOf(":");
  if (at !== -1) h = h.slice(0, at); // strip :port
  if (h.endsWith(".")) h = h.slice(0, -1); // strip trailing dot
  if (h.includes("*")) return null; // no wildcards
  let ascii: string;
  try {
    ascii = new URL(`https://${h}`).hostname; // IDNA/punycode via WHATWG URL
  } catch {
    return null;
  }
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(ascii)) return null;
  return ascii;
}
```

- [ ] **Step 4: Run; verify PASS.**

- [ ] **Step 5: Commit.**

```bash
git add lib/domains/host-normalize.ts lib/domains/host-normalize.test.ts
git commit -m "feat(ingress): exact-FQDN host normalizer"
```

### Task 1.2: Routes-table builder (`host → backend server IP`)

**Files:**
- Create: `lib/ingress/routes-table.ts` (the query: active domain mappings → cube → `servers.publicIp`)
- Test: `tests/integration/ingress-routes-table.test.ts` (needs real rows → integration)

- [ ] **Step 1: Write the failing integration test** using the seed helper (`tests/integration/_seed.ts` pattern). ⚠️ `_seed.ts` has `seedServer`/`seedCube`/`seedSpace` but **no domain-mapping seeder** — hand-`insert` the `domainMappings` row (required: `cubeId`, `domain`, and `verificationStatus: "verified"` for the partial unique index). Pass `{ publicIp: "203.0.113.10", isIngress: false }` as a `seedServer` override (its default publicIp is `203.0.113.1`). Seed: a server, a running cube on it, an active mapping `app.acme.com`. Then:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildIngressRoutesTable } from "@/lib/ingress/routes-table";
// ... seed setup omitted; follow tests/integration/_seed.ts conventions ...

test("returns host → backend publicIp for active mappings only", async () => {
  const rows = await buildIngressRoutesTable();
  const row = rows.find((r) => r.host === "app.acme.com");
  assert.ok(row, "active mapping present");
  assert.equal(row.backendServerIp, "203.0.113.10");
  assert.equal(row.active, true);
  // a mapping whose cube is deleted must be absent
  assert.ok(!rows.some((r) => r.host === "deleted.example.com"));
});
```

- [ ] **Step 2: Run; verify FAIL.** `pnpm test:integration`

- [ ] **Step 3: Implement** the builder (Drizzle ORM only, Rule 4 — no raw SQL). NOTE: this is a NEW query distinct from `getActiveCustomDomainsForServer` (which returns `host → cubeInternalIp` for the backend leg).

```ts
// lib/ingress/routes-table.ts
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { cubes } from "@/db/schema/cubes";
import { domainMappings } from "@/db/schema/domains";
import { servers } from "@/db/schema/servers";

export type IngressRoute = {
  host: string;             // exact FQDN
  backendServerIp: string;  // servers.publicIp of the cube's current server
  cubePort: number | null;  // domainMappings.port is NULLABLE (no .notNull()); endpoint/agent defaults the HTTP port
  active: boolean;
  protectionTier: "free" | "cloudflare"; // §9b reserved; "free" until that ships
};

export async function buildIngressRoutesTable(): Promise<IngressRoute[]> {
  const rows = await db
    .select({
      host: domainMappings.domain,
      backendServerIp: servers.publicIp,
      cubePort: domainMappings.port,
      status: domainMappings.status,
    })
    .from(domainMappings)
    .innerJoin(cubes, eq(domainMappings.cubeId, cubes.id))
    .innerJoin(servers, eq(cubes.serverId, servers.id))
    .where(and(ne(cubes.status, "deleted"), ne(domainMappings.status, "stopping")));

  return rows.map((r) => ({
    host: r.host,
    backendServerIp: r.backendServerIp,
    cubePort: r.cubePort,
    active: r.status === "active",
    protectionTier: "free" as const,
  }));
}
```

- [ ] **Step 4: Run; verify PASS.** `pnpm test:integration`

- [ ] **Step 5: Commit.**

```bash
git add lib/ingress/routes-table.ts tests/integration/ingress-routes-table.test.ts
git commit -m "feat(ingress): routes-table builder (host -> backend publicIp)"
```

### Task 1.3: Multi-A DNS primitives + 429 handling

**Files:**
- Modify: `lib/cloudflare/dns.ts` (add `listDnsRecordsByName`, `ensureDnsRecordByContent`, `deleteDnsRecordByContent`)
- Modify: `lib/cloudflare/client.ts` (429-aware retry/backoff in `cfRequest`)
- Test: `lib/cloudflare/dns-multi.test.ts` (mock `cfRequest`)

- [ ] **Step 1: Write the failing test.** ⚠️ There is NO `cfRequest`-mocking precedent — `cache.test.ts` only tests the pure `buildPurgeByHostnameBody` (stubs nothing), and `cfRequest` has no DI. So: (1) the `recordsToDiff` test below is a pure unit test (no mock needed — keep it); (2) for the 429 path, either monkeypatch `globalThis.fetch` inside the `node:test` to return `{ status: 429, headers: { "retry-after": "120" } }`, OR extract a pure `parseCfRateLimit(status, retryAfterHeader)` helper and test that. Do the pure-helper extraction — it's cleaner and matches the codebase's pure-builder convention.

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { recordsToDiff } from "@/lib/cloudflare/dns"; // pure helper extracted for testability

test("recordsToDiff: add missing, delete extra, leave matching", () => {
  const live = [
    { id: "r1", content: "1.1.1.1" },
    { id: "r2", content: "2.2.2.2" },
  ];
  const desired = ["2.2.2.2", "3.3.3.3"];
  const diff = recordsToDiff(live, desired);
  assert.deepEqual(diff.toCreate, ["3.3.3.3"]);
  assert.deepEqual(diff.toDeleteIds, ["r1"]);
});
```

- [ ] **Step 2: Run; verify FAIL.** `node --env-file=.env.unit --import tsx --test lib/cloudflare/dns-multi.test.ts`

- [ ] **Step 3: Implement.** Add the pure `recordsToDiff` + the three CRUD functions. `findDnsRecord`/`ensureDnsRecord` (which return/rewrite `records[0]`) MUST NOT be used for the round-robin set — add a comment saying so.

```ts
// lib/cloudflare/dns.ts (additions)
export function recordsToDiff(
  live: { id: string; content: string }[],
  desired: string[],
): { toCreate: string[]; toDeleteIds: string[] } {
  const liveByContent = new Map(live.map((r) => [r.content, r.id]));
  const desiredSet = new Set(desired);
  const toCreate = desired.filter((c) => !liveByContent.has(c));
  const toDeleteIds = live.filter((r) => !desiredSet.has(r.content)).map((r) => r.id);
  return { toCreate, toDeleteIds };
}

/** ALL records for a name (round-robin safe — unlike findDnsRecord which returns [0]). */
export async function listDnsRecordsByName(name: string, type: "A" | "AAAA") {
  const zone = cloudflareZoneId();
  const recs = await cfRequest<{ id: string; content: string; name: string; type: string }[]>(
    "GET",
    `/zones/${zone}/dns_records?type=${type}&name=${encodeURIComponent(name)}&per_page=100`,
  );
  return recs.filter((r) => r.name === name && r.type === type);
}

/** Create an A/AAAA record for a specific content only if absent. DNS-only, TTL 60. */
export async function ensureDnsRecordByContent(name: string, type: "A" | "AAAA", content: string) {
  const existing = await listDnsRecordsByName(name, type);
  if (existing.some((r) => r.content === content)) return;
  const zone = cloudflareZoneId();
  await cfRequest("POST", `/zones/${zone}/dns_records`, {
    type, name, content, proxied: false, ttl: 60,
  });
}

/** Delete the record whose content matches; no-op if absent. */
export async function deleteDnsRecordByContent(name: string, type: "A" | "AAAA", content: string) {
  const zone = cloudflareZoneId();
  const match = (await listDnsRecordsByName(name, type)).find((r) => r.content === content);
  if (!match) return;
  await cfRequest("DELETE", `/zones/${zone}/dns_records/${match.id}`);
}
```

- [ ] **Step 4: Add 429 handling to `cfRequest`** in `lib/cloudflare/client.ts` — on HTTP 429, read `Retry-After`, and throw a typed `CloudflareRateLimitError` (do NOT silently retry in a tight loop; the caller aborts the tick). Add a unit test asserting a 429 response surfaces as `CloudflareRateLimitError` with the `retryAfterSeconds` populated.

- [ ] **Step 5: Run; verify PASS.** `node --env-file=.env.unit --import tsx --test lib/cloudflare/dns-multi.test.ts`

- [ ] **Step 6: Commit.**

```bash
git add lib/cloudflare/dns.ts lib/cloudflare/client.ts lib/cloudflare/dns-multi.test.ts
git commit -m "feat(ingress): multi-A DNS primitives + 429-aware cfRequest"
```

### Task 1.4: `ingress.dns-health` decision function (pure)

**Files:**
- Create: `lib/ingress/dns-health-decision.ts`
- Test: `lib/ingress/dns-health-decision.test.ts`

- [ ] **Step 1: Write the failing tests** (the safety invariants are the whole point — test them explicitly, spec §6):

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decideDnsHealth } from "@/lib/ingress/dns-health-decision";

const nodes = (probe: Record<string, boolean>) =>
  Object.entries(probe).map(([ip, ok]) => ({ ip, probeOk: ok, consecutiveFails: ok ? 0 : 2, consecutiveOks: ok ? 2 : 0, inRotation: true }));

test("healthy set → keep all", () => {
  const d = decideDnsHealth({ nodes: nodes({ "1.1.1.1": true, "2.2.2.2": true }), liveRecords: ["1.1.1.1", "2.2.2.2"], selfEgressOk: true });
  assert.deepEqual(d.desired.sort(), ["1.1.1.1", "2.2.2.2"]);
  assert.equal(d.abort, false);
});

test("one down (past hysteresis) → remove it", () => {
  const d = decideDnsHealth({ nodes: nodes({ "1.1.1.1": true, "2.2.2.2": false }), liveRecords: ["1.1.1.1", "2.2.2.2"], selfEgressOk: true });
  assert.deepEqual(d.desired, ["1.1.1.1"]);
});

test("NEVER delete the last record", () => {
  const d = decideDnsHealth({ nodes: nodes({ "1.1.1.1": false }), liveRecords: ["1.1.1.1"], selfEgressOk: true });
  assert.deepEqual(d.desired, ["1.1.1.1"]); // kept
  assert.equal(d.allNodesDownAlert, true);
});

test(">50% fail on one tick → abort, change nothing", () => {
  const d = decideDnsHealth({ nodes: nodes({ "1.1.1.1": false, "2.2.2.2": false, "3.3.3.3": true }), liveRecords: ["1.1.1.1", "2.2.2.2", "3.3.3.3"], selfEgressOk: true });
  assert.equal(d.abort, true);
});

test("self-egress failed → abort regardless", () => {
  const d = decideDnsHealth({ nodes: nodes({ "1.1.1.1": false, "2.2.2.2": true }), liveRecords: ["1.1.1.1", "2.2.2.2"], selfEgressOk: false });
  assert.equal(d.abort, true);
});
```

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement.**

```ts
// lib/ingress/dns-health-decision.ts
export type IngressProbe = { ip: string; probeOk: boolean; consecutiveFails: number; consecutiveOks: number; inRotation: boolean };
export type DnsHealthInput = { nodes: IngressProbe[]; liveRecords: string[]; selfEgressOk: boolean };
export type DnsHealthDecision = { desired: string[]; abort: boolean; allNodesDownAlert: boolean };

const REMOVE_AFTER = 2; // consecutive failed ticks
const READD_AFTER = 2;  // consecutive healthy ticks

export function decideDnsHealth(input: DnsHealthInput): DnsHealthDecision {
  const failing = input.nodes.filter((n) => !n.probeOk).length;
  const total = input.nodes.length;
  const allDown = total > 0 && failing === total;
  // Vantage guard: abort (change nothing) if the worker's own egress is broken,
  // OR a SUSPICIOUS partial mass-failure (>50% but NOT all-down) — almost
  // certainly the control-plane's own network, not the nodes. all-down is NOT
  // suspicious here (it's handled by never-delete-last below), so it must NOT
  // trip the abort — otherwise the never-delete-last / allNodesDownAlert path
  // is unreachable.
  if (!input.selfEgressOk || (!allDown && total > 0 && failing * 2 > total)) {
    return { desired: input.liveRecords, abort: true, allNodesDownAlert: false };
  }
  // Compute desired set with hysteresis.
  let desired = input.nodes
    .filter((n) =>
      n.probeOk ? n.consecutiveOks + 1 >= READD_AFTER || n.inRotation
                : n.consecutiveFails + 1 < REMOVE_AFTER, // still within grace → keep
    )
    .map((n) => n.ip);
  // NEVER delete the last record (fail-open): keep one dead record rather than
  // a zero-record outage, and raise allNodesDownAlert so the operator is paged.
  if (desired.length === 0) {
    desired = input.liveRecords.length > 0 ? [input.liveRecords[0]] : [];
  }
  return { desired, abort: false, allNodesDownAlert: allDown };
}
```

- [ ] **Step 4: Run; verify PASS.**

- [ ] **Step 5: Commit.**

```bash
git add lib/ingress/dns-health-decision.ts lib/ingress/dns-health-decision.test.ts
git commit -m "feat(ingress): dns-health decision (declarative reconcile + never-delete-last + abort guards)"
```

### Task 1.5: `/authorize` decision function (pure)

**Files:**
- Create: `lib/ingress/authorize-decision.ts`
- Test: `lib/ingress/authorize-decision.test.ts`

- [ ] **Step 1: Write failing tests** (exact-host, authorize `pending` AND `active`, refuse deleted/stopping/unknown — spec §5.4):

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decideAuthorize } from "@/lib/ingress/authorize-decision";

const store = {
  "app.acme.com": { status: "active", cubeStatus: "running" },
  "new.acme.com": { status: "pending", cubeStatus: "running" },
  "old.acme.com": { status: "stopping", cubeStatus: "running" },
};
const lookup = (h: string) => store[h] ?? null;

test("authorizes active + pending mapped hosts", () => {
  assert.equal(decideAuthorize("App.Acme.com", lookup).allow, true);   // normalized
  assert.equal(decideAuthorize("new.acme.com", lookup).allow, true);   // pending → first-issuance
});
test("refuses unknown / stopping / wildcard", () => {
  assert.equal(decideAuthorize("random.acme.com", lookup).allow, false);
  assert.equal(decideAuthorize("old.acme.com", lookup).allow, false);
  assert.equal(decideAuthorize("*.acme.com", lookup).allow, false);
});
```

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement** (uses the Task 1.1 normalizer):

```ts
// lib/ingress/authorize-decision.ts
import { normalizeHost } from "@/lib/domains/host-normalize";

export type AuthMapping = { status: string; cubeStatus: string };
export function decideAuthorize(
  rawDomain: string,
  lookup: (host: string) => AuthMapping | null,
): { allow: boolean; host: string | null } {
  const host = normalizeHost(rawDomain);
  if (!host) return { allow: false, host: null };
  const m = lookup(host);
  if (!m) return { allow: false, host };
  // Authorize pending OR active (first-issuance must not deadlock, spec §5.4).
  const okStatus = m.status === "active" || m.status === "pending";
  const okCube = m.cubeStatus === "running" || m.cubeStatus === "sleeping";
  return { allow: okStatus && okCube, host };
}
```

- [ ] **Step 4: Run; verify PASS.**

- [ ] **Step 5: Commit.**

```bash
git add lib/ingress/authorize-decision.ts lib/ingress/authorize-decision.test.ts
git commit -m "feat(ingress): /authorize decision (exact-host, pending|active, cube-liveness)"
```

### Task 1.6: SSRF backend allow-list

**Files:**
- Create: `lib/ingress/backend-allowlist.ts`
- Test: `lib/ingress/backend-allowlist.test.ts`

- [ ] **Step 1: Write failing tests.**

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isAllowedBackend } from "@/lib/ingress/backend-allowlist";

test("allows known server IPs, rejects loopback/metadata/private", () => {
  const known = new Set(["203.0.113.10", "203.0.113.11"]);
  assert.equal(isAllowedBackend("203.0.113.10", known), true);
  assert.equal(isAllowedBackend("127.0.0.1", known), false);
  assert.equal(isAllowedBackend("169.254.169.254", known), false);
  assert.equal(isAllowedBackend("10.0.0.5", known), false);
  assert.equal(isAllowedBackend("203.0.113.99", known), false); // not a known server
});
```

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement** — must be a member of the known-servers set AND not loopback/link-local/RFC1918/multicast.

```ts
// lib/ingress/backend-allowlist.ts
export function isAllowedBackend(ip: string, knownServerIps: Set<string>): boolean {
  if (!knownServerIps.has(ip)) return false;
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  if (o[0] === 127) return false;                      // loopback
  if (o[0] === 169 && o[1] === 254) return false;      // link-local / metadata
  if (o[0] === 10) return false;                        // RFC1918
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return false;
  if (o[0] === 192 && o[1] === 168) return false;
  if (o[0] >= 224) return false;                        // multicast / reserved
  return true;
}
```

- [ ] **Step 4: Run; verify PASS.**

- [ ] **Step 5: Commit.**

```bash
git add lib/ingress/backend-allowlist.ts lib/ingress/backend-allowlist.test.ts
git commit -m "feat(ingress): SSRF backend allow-list"
```

---

## Phase 2 — Control-plane endpoints + crons

### Task 2.1: Routes endpoint `GET /api/internal/ingress/routes`

**Files:**
- Create: `app/api/internal/ingress/routes/route.ts`
- Reuse: `lib/encrypt.ts` `hmacSign` (the `server-rebooted` pattern), but **timestamped** (`serverId.unixSeconds`, ≤300 s tolerance)
- Create: `lib/ingress/sync-auth.ts` (sign + verify the timestamped token)
- Test: `lib/ingress/sync-auth.test.ts`

- [ ] **Step 1: Write the failing test** for `lib/ingress/sync-auth.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { signIngressToken, verifyIngressToken } from "@/lib/ingress/sync-auth";

test("valid fresh token verifies; stale/forged rejected", () => {
  const now = 1_900_000_000;
  const tok = signIngressToken("srv_1", now);
  assert.equal(verifyIngressToken("srv_1", tok, now + 100), true);
  assert.equal(verifyIngressToken("srv_1", tok, now + 400), false); // >300s
  assert.equal(verifyIngressToken("srv_1", "deadbeef.1", now), false); // forged
});
```

- [ ] **Step 2: Run; verify FAIL.** `node --env-file=.env.unit --import tsx --test lib/ingress/sync-auth.test.ts`

- [ ] **Step 3: Implement** `lib/ingress/sync-auth.ts` — `signIngressToken(serverId, nowSec)` returns `"<hmacHex>.<nowSec>"` where the HMAC is `hmacSign(serverId + "." + nowSec)` (reuse `lib/encrypt.ts`); `verifyIngressToken` re-derives, timing-safe compares, and enforces `|now - tokenSec| ≤ 300`.

- [ ] **Step 4: Run; verify PASS.**

- [ ] **Step 5: Implement the route** `app/api/internal/ingress/routes/route.ts` — `GET`, reads the `Authorization: Ingress <serverId>:<token>` header, `verifyIngressToken`, returns `buildIngressRoutesTable()` (Task 1.2) as JSON. Returns **only** `{host, backendServerIp, cubePort, active, protectionTier}` — no space/cube/customer ids. 401 on bad/stale token. No heavy work (read-only).

- [ ] **Step 6: Add an integration test** `tests/integration/ingress-routes-endpoint.test.ts`: seed a mapping, call the route handler with a valid token → 200 + the host present; with a stale token → 401.

Run: `pnpm test:integration` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add lib/ingress/sync-auth.ts lib/ingress/sync-auth.test.ts app/api/internal/ingress/routes/route.ts tests/integration/ingress-routes-endpoint.test.ts
git commit -m "feat(ingress): routes endpoint + timestamped-HMAC sync auth"
```

### Task 2.2: `ingress.dns-health` cron + handler

**Files:**
- Modify: `lib/worker/job-types.ts` (add `INGRESS_DNS_HEALTH` to `JOB_NAMES`)
- Modify: `lib/worker/ensure-queues.ts` (add the `QUEUE_OPTIONS` entry — Rule 56)
- Modify: `lib/worker/boss.ts` (add `boss.schedule("ingress.dns-health", "* * * * *")` + `boss.work`, `policy:"exclusive"`)
- Create: `lib/worker/handlers/ingress-dns-health.ts`
- Test: covered by the Task 1.4 pure decision tests; add an integration test for the handler's reconcile-against-CF mock if practical

- [ ] **Step 1: Add the job name + queue options + schedule.** `INGRESS_DNS_HEALTH = "ingress.dns-health"` in `JOB_NAMES`; an explicit `QUEUE_OPTIONS["ingress.dns-health"] = { policy: "exclusive", retryLimit: 0 }` (Rule 56 — the full Record must stay exhaustive); `boss.schedule(JOB_NAMES.INGRESS_DNS_HEALTH, "* * * * *", {}, { tz: "UTC" })` + a `boss.work` registration at `localConcurrency: 1`.

- [ ] **Step 2: Verify the typecheck guard.** `pnpm typecheck` — confirms the new job has a `QUEUE_OPTIONS` entry (the `Record<JobName,…>` makes a missing entry a compile error, Rule 56).

- [ ] **Step 3: Implement the handler** `lib/worker/handlers/ingress-dns-health.ts`:
  - Load ingress nodes: `servers WHERE is_ingress = true` → their `ingress_ip`.
  - **Probe each L7** (HTTPS GET `https://<ingressIp>/healthz` with `Host: health.krova.cloud`, expect 200 — NOT `isServerReachable`, which probes sshPort 2822 and is TCP-only).
  - Self-egress check: probe a known-good external target (e.g. the CF API or `1.1.1.1:443`).
  - Load live records: `listDnsRecordsByName("dns.krova.cloud", "A")` (Task 1.3).
  - Call `decideDnsHealth(...)` (Task 1.4). If `abort`, log + return.
  - Reconcile via `recordsToDiff` + `ensureDnsRecordByContent`/`deleteDnsRecordByContent`. On `CloudflareRateLimitError` → abort the tick.
  - Persist hysteresis counters to `ingress_node_health`.
  - If `allNodesDownAlert`, `audit()` + one-shot email to `getErrorNotifyEmails()`.
  - If `CUSTOM_DOMAIN_INGRESS_ENABLED` is false, the handler **no-ops** (so it's inert pre-cutover).

- [ ] **Step 4: Run the full gate.** `pnpm test:all` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/worker/job-types.ts lib/worker/ensure-queues.ts lib/worker/boss.ts lib/worker/handlers/ingress-dns-health.ts
git commit -m "feat(ingress): ingress.dns-health cron (L7 probe + safe DNS reconcile)"
```

### Task 2.3: `ingress.status-poll` cron + handler (replaces `cloudflare.hostname-poll` for status + `domain.active`)

**Files:**
- Modify: `lib/worker/job-types.ts`, `lib/worker/ensure-queues.ts`, `lib/worker/boss.ts` (add `INGRESS_STATUS_POLL`, `policy:"exclusive"`, every 1 min)
- Create: `lib/worker/handlers/ingress-status-poll.ts`

- [ ] **Step 1: Add job name + queue options + schedule** (same pattern as 2.2; `policy:"exclusive"`).

- [ ] **Step 2: Implement the handler.** For each active/pending domain mapping: query each ingress node's `GET /healthz?domain=<host>` returning `{has_cert, cert_expiry, route_present}`; aggregate → `live` (≥1 node has a valid cert AND route present), `degraded` (nodes disagree), `cert_pending`, `failed`. Write `domain_mappings.ingress_status`. On a `pending_dns/cert_pending → live` transition, **fire `dispatchWebhookEvent(spaceId, "domain.active", buildDomainPayload(...))`** (preserve the only emitter) and emit the Pusher `domain.update` the UI listens for. No-op when the flag is off.

- [ ] **Step 3: Run.** `pnpm test:all` → PASS. **Commit.**

```bash
git add lib/worker/job-types.ts lib/worker/ensure-queues.ts lib/worker/boss.ts lib/worker/handlers/ingress-status-poll.ts
git commit -m "feat(ingress): ingress.status-poll cron (ingress_status + domain.active)"
```

---

## Phase 3 — Handler reworks (behind the flag)

> All Phase-3 behavior is gated on `env.CUSTOM_DOMAIN_INGRESS_ENABLED`. With the flag OFF, the existing CF-for-SaaS behavior is byte-for-byte unchanged. With it ON, the CF calls no-op (even on rows that still carry `cloudflareHostnameId`) and routing flows through the ingress.

### Task 3.1: `domain.add` / `domain.remove` flag gating

**Files:**
- Modify: `lib/worker/handlers/domain-add.ts`, `lib/worker/handlers/domain-remove.ts`
- Test: `tests/integration/domain-add-ingress.test.ts`

- [ ] **Step 1: Write the failing integration test:** with the flag ON, `domain.add` does NOT call `registerCubeCustomHostname` (assert the CF client is not invoked — inject a spy), ensures the backend Caddy route, and leaves the mapping `pending` (so the ingress sync + status-poll take it `live`).

- [ ] **Step 2: Run; FAIL.** `pnpm test:integration`

- [ ] **Step 3: Implement.** Wrap the CF custom-hostname register/deregister calls in `if (!env.CUSTOM_DOMAIN_INGRESS_ENABLED) { …existing CF path… }`. In the ON branch: ensure the backend per-server Caddy route (`addCustomDomainRoute`, unchanged), set status `pending`, and trigger a routes-poke/pre-warm (Task 4.3 endpoint) — **gated on a sync-ack** before pre-warm. Preserve the `verificationStatus:"verified"` write either way (it backs the uniqueness index, spec §5.10).

- [ ] **Step 4: Run; PASS. Commit.**

```bash
git add lib/worker/handlers/domain-add.ts lib/worker/handlers/domain-remove.ts tests/integration/domain-add-ingress.test.ts
git commit -m "feat(ingress): flag-gate domain.add/remove (no CF when ingress on)"
```

### Task 3.2: `cube-transfer` / `cube-transfer-cancel` / `cube-delete` flag gating + push-before-teardown

**Files:**
- Modify: `lib/worker/handlers/cube-transfer.ts` (the `repointCubeCustomHostname` step + the F2/F3 rollback restore)
- Modify: `lib/worker/handlers/cube-transfer-cancel.ts` (`repointCubeDomainsToServer`)
- Modify: `lib/worker/handlers/cube-delete.ts` (`deregisterCubeCustomHostname`)
- Create: `lib/ingress/push-routes.ts` (push the route delta to all ingress nodes + await acks)
- Test: `tests/integration/cube-transfer-ingress.test.ts`

- [ ] **Step 1: Write the failing test:** with the flag ON, a transfer pushes `host → newServerIp` to ingress nodes and **awaits acks before** the source-teardown step runs; the CF repoint is NOT called; on the destination, the backend Caddy route IS added (still required — the ingress only knows the new server, the destination Caddy still needs Host→cube). Assert ordering: push-ack happens before `deleteCube`/source-teardown.

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Implement.**
  - `lib/ingress/push-routes.ts`: `pushRouteToIngress(host, backendServerIp)` POSTs to each ingress node's `/internal/route-poke` (Task 4.3) with the sync token; returns when all ack (timeout → proceed-but-log).
  - In `cube-transfer.ts`: gate the CF repoint behind `if (!flag)`; in the ON branch, after the atomic DB flip and BEFORE source teardown, call `pushRouteToIngress(...)` and await; keep `addCustomDomainRoute` on the destination. The ON-branch rollback (F2) becomes a `pushRouteToIngress(host, sourceServerIp)` instead of the CF restore.
  - `cube-transfer-cancel.ts`: replace `repointCubeDomainsToServer` (CF) with a `pushRouteToIngress` to the source server when the flag is ON (Rule 57 — the restore must still happen; this is the new restore mechanism).
  - `cube-delete.ts`: gate `deregisterCubeCustomHostname` behind `if (!flag)`; keep the backend route removal; the ingress drops the route on next sync (deleted cube → absent from `buildIngressRoutesTable`). Add a per-node cert-purge poke (Task 4.3) so deleted-cube certs don't linger.
  - **All three:** the CF no-op must trigger even when `mapping.cloudflareHostnameId` is non-null (pre-migration rows) — gate on the flag, not on the column.

- [ ] **Step 4: Run; PASS.** `pnpm test:all` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/worker/handlers/cube-transfer.ts lib/worker/handlers/cube-transfer-cancel.ts lib/worker/handlers/cube-delete.ts lib/ingress/push-routes.ts tests/integration/cube-transfer-ingress.test.ts
git commit -m "feat(ingress): flag-gate transfer/cancel/delete + push-before-teardown"
```

### Task 3.3: Backend per-server Caddy reworks

**Files:**
- Modify: `lib/ssh/caddy.ts` (`initializeCaddyServer`/`reconcileCaddyRoutes` listen array; `trusted_proxies`; backend internal-CA listener)
- Create: `lib/ssh/caddy.test.ts` (**it does NOT exist yet** — create it)

> **⚠️ Why a Step 0.** `listen` (`caddy.ts:334,418`) and `trusted_proxies` (`:395,711`) live INSIDE the side-effecting `initializeCaddyServer`/`reconcileCaddyRoutes` (they call `caddySet` over SSH) — they are not unit-testable as-is. The **internal-CA mTLS backend leg is a `tls_connection_policies`/listener concern, NOT `customDomainRoute`** — `customDomainRoute` stays a pure route object with `transport.protocol:"http"` and is already exact-host; don't fold mTLS into it. Extract pure builders first, mirroring how `customDomainRoute` was extracted from `addCustomDomainRoute`.

- [ ] **Step 0: Extract pure builders** from `caddy.ts`: `buildListenArray(primaryIp: string, hasIngressIp: boolean): string[]` (returns `["<primaryIp>:80","<primaryIp>:443"]` when an ingress IP co-resides, else `[":80",":443"]`) and `buildTrustedProxies(ingressEnabled: boolean, ingressIps: string[]): { source: string; ranges: string[] }` (ingress IPs when the flag is on, else `CLOUDFLARE_PROXY_CIDRS`). Have `initializeCaddyServer`/`reconcileCaddyRoutes` call them — no behavior change yet.

- [ ] **Step 1: Write failing unit tests** in the new `lib/ssh/caddy.test.ts`: (a) `buildListenArray("203.0.113.10", true)` → `["203.0.113.10:80","203.0.113.10:443"]`; `buildListenArray("203.0.113.10", false)` → `[":80",":443"]`; (b) `buildTrustedProxies(true, ["203.0.113.20"])` includes `203.0.113.20`; `buildTrustedProxies(false, [])` falls back to `CLOUDFLARE_PROXY_CIDRS`; (c) `customDomainRoute("app.acme.com", ip, 3000)` is an exact-host match with `transport.protocol === "http"` (regression-pin: it stays plain to the backend Caddy; the public→ingress TLS is the ingress's job, the ingress→backend mTLS is a connection-policy added at the listener, Task 4.x).

- [ ] **Step 2: Run; FAIL.** `node --env-file=.env.unit --import tsx --test lib/ssh/caddy.test.ts`

- [ ] **Step 3: Implement** the builders + wire the internal-CA `tls_connection_policies` listener (separate from the route object). Keep flag-aware where it changes live behavior. Preserve `installOriginCaCert` + the `connect.<hostname>` record + the landing-page cert (spec §8 — `setUpServerCloudflareOrigin` is load-bearing; do NOT remove, only stop terminating customer-domain public TLS here).

- [ ] **Step 4: Run; PASS. Commit.**

```bash
git add lib/ssh/caddy.ts lib/ssh/caddy.test.ts
git commit -m "feat(ingress): backend Caddy — extract pure builders, explicit IP bind, ingress trusted_proxies"
```

---

## Phase 4 — Host-side ingress component (artifacts + smoke, not unit TDD)

> These produce host artifacts verified by the Phase-0 live test (Phase 6) and the host-smoke harness — not `pnpm test`. Each task delivers complete file content + an exact verification command.

> **🚨 HARD ORDERING (prevents an `EADDRINUSE` outage on the live 30-cube boxes).** The existing per-server Caddy binds bare `:80/:443` (= `0.0.0.0`, `caddy.ts:334,418`), which grabs **every** local IP including the /29 ingress IP. The ingress binds `<ingressIp>:443`. If the ingress starts while the per-server Caddy still owns `0.0.0.0:443`, the ingress bind collides → fails to start (or, worse on a co-located box, churns the live listener). **Therefore Task 4.5 (rebind the live per-server Caddy to `<primaryIP>`) MUST fully complete and be verified on a box BEFORE Task 4.6 (stand up the ingress) runs on that same box.** Build artifacts 4.1–4.4 first (no live-box touch); then per box: 4.5 → verify → 4.6.

### Task 4.1: Internal CA

- [ ] Create `setup/ingress/gen-internal-ca.sh` — generates a Krova internal root CA + a per-backend-server leaf cert (SNI = `<server-hostname>.internal.krova`). Document storage (encrypted at rest; the CA cert is distributed to each ingress node's `transport.tls.ca` trust; each backend server gets its own leaf as a `tls_connection_policy` cert). Verify: `openssl verify -CAfile ca.pem leaf.pem` → OK. Commit.

### Task 4.2: The xcaddy routing module (Go)

- [ ] Create `setup/ingress/caddy-modules/krova_ingress/` — a Caddy `dynamic upstreams` module that, per request: `normalizeHost(Host)` → look up the exact host in the local SQLite (`host → backend_server_ip, cube_port`) → validate via the allow-list (mirror `lib/ingress/backend-allowlist.ts` logic) → return the upstream. Refuse (502) unknown hosts. Full `module.go` + `go.mod` with pinned Caddy v2.11.3. Verify: `xcaddy build v2.11.3 --with github.com/.../krova_ingress=./setup/ingress/caddy-modules/krova_ingress` produces a binary; `caddy list-modules | grep krova` shows it. Commit.

### Task 4.3: The sync agent + `/authorize` + `/healthz` + `/internal/route-poke`

- [ ] Create `setup/ingress/krova-ingress-agent` (a small Go or Python service) that: (a) **pulls** `GET /api/internal/ingress/routes` every 15–30 s (timestamped-HMAC) → writes the local SQLite (WAL) → declarative reconcile; (b) serves `127.0.0.1:9111/authorize?domain=` implementing `decideAuthorize` against the SQLite (port the Task 1.5 logic; negative-cache denied SNIs ~5 min; fail-closed on DB error); (c) serves `/healthz` (sync freshness + cert-store readability) and `/healthz?domain=` (`{has_cert, cert_expiry, route_present}` for Task 2.3); (d) accepts authenticated `POST /internal/route-poke` to force an immediate pull (Task 3.2 push) + a cert pre-warm/purge. Include the systemd unit. Verify: start it, `curl 127.0.0.1:9111/authorize?domain=app.acme.com` returns 200 only for a seeded host. Commit.

### Task 4.4: The ingress Caddyfile

- [ ] Create `setup/ingress/Caddyfile` — global `on_demand_tls { ask http://127.0.0.1:9111/authorize }` + `storage postgres { … }` (caddy-storage-postgres against krova-db) + per-IP `bind <ingressIp>`; site `https://` with `tls { on_demand }`, `reverse_proxy` using the `krova_ingress` dynamic upstream + `transport http { tls { ca <internal-ca.pem> } }` (mTLS, verify — NOT skip-verify) + `header_up`/`header_down` stripping client `X-Forwarded-*`/`CF-*` and setting our own + `rate_limit` (caddy-ratelimit) + `handle_errors` serving the branded "starting up / unavailable" page (reuse `CUBE_STARTING_HTML`/`BRANDED_FALLBACK_HTML`). Verify: `caddy validate --config setup/ingress/Caddyfile`. Commit.

### Task 4.5: Live per-server Caddy prep — primary-IP rebind + internal-CA listener (DO THIS FIRST, per box)

> **This is the single most dangerous step for the running cubes** — it edits the LIVE per-server Caddy that currently serves all 30 cubes' custom-domain traffic. Two facts drive the procedure: (1) a Caddy admin-API config change is zero-downtime **for routes/handlers**, but changing the `listen` ADDRESS is a socket swap (old `0.0.0.0:443` socket closed, new `<primaryIP>:443` opened) — in-flight TLS on the old listener can blip; (2) at this point in the runbook `dns.krova.cloud` is **still the proxied CF record**, so live traffic arrives via CF's edge to the origin, and CF's connection pooling/retry **absorbs a brief origin-side socket blip** for ordinary HTTP (active WebSockets proxied through CF may still drop and reconnect).

- [ ] Add a server-setup change + one-shot (`scripts/install-ingress-prep.ts`, `pnpm install:ingress-prep`) that, **one box at a time, in a low-traffic window, while still behind CF**: (a) rebinds the per-server Caddy `listen` from `[":80",":443"]` to `["<primaryIP>:80","<primaryIP>:443"]` via the `buildListenArray` builder (Task 3.3); (b) installs the internal-CA leaf as a `tls_connection_policy` so the box can serve the mTLS backend leg from the ingress (Task 3.3 / 4.1) **without disturbing** the existing `connect.<hostname>` listener, the Origin CA landing cert, or the live custom-domain routes; (c) reconciles the `setUpServerCloudflareOrigin` install-phase fail-fast gate (spec §8) so a box that no longer terminates customer-domain public TLS still passes `server.install` — keep the `connect.` record + landing cert mandatory, drop only the customer-domain-TLS assertion. Verify per box: `ss -ltnp | grep ':443'` shows the `<primaryIP>` listener (NOT `0.0.0.0`) and the existing cubes' custom domains still serve (curl one live domain through CF → 200) BEFORE moving to the next box. Commit.

### Task 4.6: Install / verify / retrofit the ingress (Rule 46) — REQUIRES Task 4.5 done on that box

> **Precondition (enforced, not advisory):** do NOT run this on a box until `ss -ltnp` confirms its per-server Caddy is bound to `<primaryIP>:443` (Task 4.5) and off `0.0.0.0`. Otherwise the `<ingressIp>:443` bind collides → `EADDRINUSE`.

- [ ] Add an ingress provisioning path: a `server.setup-ingress` worker step OR `scripts/install-ingress.ts` (`pnpm install:ingress`) that, on a server with `is_ingress=true`: assigns the `/29 ingress_ip`, installs the xcaddy binary + the agent + systemd units + the internal-CA trust, opens **only** 80/443 on the ingress IP (default-deny else — mirror `applyHostNetworking`), binds the admin API (`:2020`) + `/authorize` (`:9111`) to loopback. Add the ingress binary/agent to the `verify host tools` REQUIRED list (Rule 46). Verify on the dev host (Rule 60 — operator runs; agent prepares commands): both Caddy services up, `ss -ltnp | grep ':443'` shows two distinct IPs (no `EADDRINUSE`). Commit.

---

## Phase 5 — UI / v1 API / webhook / docs

### Task 5.1: Customer dashboard (`components/domain-mappings.tsx`)

- [ ] **NOTE (v2.2): `components/domain-mappings.tsx` was restructured `table → accordion` in commit `62c4655` (merged) — re-anchor to the accordion's per-domain instruction block, NOT the old "amber step-2 callout"; re-confirm current line numbers before editing.** Rewrite the add-domain instructions: default = "add a CNAME (or wildcard CNAME) to `dns.krova.cloud`, **DNS-only / grey**"; add the §9a hint ("for DDoS/CDN, add an **A record to your ingress IP** and proxy it on your own Cloudflare — note: enable Network→WebSockets there"). Replace the `cloudflareStatus`-driven "HTTPS live / Securing TLS" badge with `ingressStatus` (Task 0.3 display). The "Clear cache" button is **removed in Phase 7** (the cache-purge subsystem merged via PR #61) unless §9b ships. Verify: `pnpm typecheck` + `pnpm lint`. Commit.

### Task 5.2: Orbit domains list + detail

- [ ] In `app/(orbit)/orbit/domains/_components/domains-table.tsx` + the detail page: drop the "Cloudflare" column + the "Cloudflare for SaaS" card + `cloudflareHostnameId`/`cloudflareStatus`/`verificationStatus` displays; add an **ingress health** column (`ingressStatus` + per-node cert coverage). Add a new Orbit **Ingress** surface (a card or `/orbit/ingress`) listing each ingress IP, current A-record membership, last probe, per-node cert count, fail-open flag (reuse the reachability-card pattern). Commit.

### Task 5.3: v1 API + webhook + events

- [ ] `lib/webhook-payloads.ts buildDomainPayload`: replace `cloudflareStatus` with `ingressStatus` (breaking webhook-contract change → bump the documented payload version + deprecation note in `docs/api/v1.md`). `lib/webhook-events.ts:183,190`: fix the `domain.added`/`domain.active` descriptions (drop "Cloudflare Custom Hostname" wording); confirm `domain.active` still fires (Task 2.3). `lib/api/v1-cube-format.ts formatDomain`: surface `ingressStatus`. Update `docs/api/v1.md:303,474`. Commit.

---

## Phase 6 — Migration & cutover (operator-run flips, Rule 60)

> **Blast radius — what the 30 live cubes actually depend on (verified against the code).** This migration flips exactly ONE thing: `dns.krova.cloud` (today a single PROXIED A record at one server IP — `scripts/cloudflare-setup.ts:71-79`). Only **custom-domain HTTP/WS** routes through it. **Everything else is untouched:**
>
> | Cube access path | Routes via `dns.krova.cloud`? | Migration impact |
> |---|---|---|
> | Custom-domain HTTP/WS | **YES** | **The entire blast radius.** Moves at the flip. |
> | SSH + TCP port mappings (`connect.<hostname>` → `server.publicIp`, grey) | no | none |
> | Browser terminal (worker → `server.publicIp:sshPort` → vsock) | no | none |
> | Dashboard / API (Dokploy VPS, `krova.cloud`) | no | none |
>
> So a cube with **no custom domain** sees zero change at any point in this migration. A cube **with** a custom domain has only its public web path moved — its SSH, terminal, and dashboard stay live throughout.

> **The flip is a GRADUAL per-resolver DRAIN, not a hard cut.** The CF-for-SaaS custom hostnames are NOT deleted until Phase 7. After the flip, resolvers still serving the cached OLD proxied answer keep hitting working CF-for-SaaS; resolvers that re-resolve get the grey ingress IP. Both populations work *simultaneously* during the drain (governed by the OLD record's forced TTL Auto/300 → ~5 min nominal, tens-of-min tail). **Per-segment outcome at the flip:** (a) on-CF + grey (1014-broken today, e.g. `syngulr.ai`) → **strict improvement**, broken→working; (b) on-CF + orange/O2O (WS broken today) → improves if they go grey-direct (new UI copy, Task 5.1); (c) **off-CF customers working today via CF-for-SaaS → the ONLY regression-risk segment** — they move off a working path, so their certs MUST be warm + routes seeded or they see TLS errors on first hit.

> **🔴 Corrected cutover ordering (the original "pre-warm before flip" was a silent no-op).** Let's Encrypt validates the ACME challenge against **public DNS**. Until the flip, public DNS still points at Cloudflare, so a pre-flip pre-warm issues **zero** real certs — false confidence. The correct order is **seed + route-refresh (pre-flip, no DNS dependency) → FLIP → immediately pre-warm (post-flip, now resolves to the ingress so the challenge validates)**. At N≈30 the post-flip first-hit burst is tiny and *staggered* (resolvers re-resolve as their individual TTLs expire, not in lockstep) and is bounded by Caddy's cluster-wide 10-orders/10s throttle (~30s to warm all 30) — far under LE's 300/3h. The gradual drain covers the seconds between a resolver re-resolving and its cert being warmed.

### Task 6.0: Operator pre-flight inventory + go/no-go gates (operator-run, Rule 60)

> The agent cannot query prod (Rule 60). This task makes the OPERATOR gather the facts the cutover depends on. The agent prepares the exact commands; the operator runs them and pastes results back.

- [ ] Prepare (in `scripts/ingress-cutover-commands.md`) the read-only commands + a go/no-go checklist the operator runs BEFORE the flip:
  - **Domain inventory:** count active custom domains and their distinct registered domains (eTLD+1) — `SELECT count(*), count(DISTINCT …) FROM domain_mappings WHERE status='active'` (operator-run psql per the CLAUDE.md recipe). Confirms N is in the "single pre-warm window" range (≤~200 distinct registered domains/3h; ≤~45 single-SAN certs per customer registered domain/7 days — the §4a disposable-subdomain UX must be throttled per eTLD+1).
  - **Ingress IPs:** confirm which /29 IPs are `servers.is_ingress=true` + `ingress_ip` set, and that each ingress node's `/healthz` reports a store row count == the active-domain count (no missing domain). **Hard gate.**
  - **Backend routes current:** `pnpm routing:refresh-fleet` ran and every backend Caddy `srv0` has the domain's route (the 2026-05-29 stale-route failure mode).
  - **AAAA check:** `dig AAAA dns.krova.cloud` — if a proxied AAAA exists, the flip step MUST also handle it (delete it, or POST grey AAAA to v6 ingress IPs), else happy-eyeballs v6 clients black-hole / 1014 on a stale CF v6. **Hard gate (§6 AAAA).**
  - **Storage-Locker verified:** confirm the Phase-0 two-node single-issuance test passed (Task 6.3 / spec §12 #3) — without it, 3 nodes race to issue the same cert at cutover and blow the 5-duplicate/identifier/week limit at the worst moment. **Hard gate.**
  - Commit the doc.

### Task 6.1: Seed + route-refresh script (PRE-flip — no DNS dependency)

- [ ] Create `scripts/ingress-seed.ts` (`pnpm ingress:seed`): for every active domain mapping, (a) run `pnpm routing:refresh-fleet` first so every backend Caddy route is current, then (b) force each ingress node to pull + confirm its local store holds ALL active domains (count check via `/healthz`). **No cert pre-warm here** — pre-warm is post-flip (Task 6.3) because LE can't validate while DNS still points at CF. Dry-run by default; `--apply` commits. Verify on the dev host. Commit.

### Task 6.2: The DNS flip (+ AAAA) + rollback commands (prepared, operator-run)

- [ ] Document in spec §10 + `scripts/ingress-cutover-commands.md` the exact CF DNS API v4 sequence (operator-run): `GET` the current proxied `dns.krova.cloud` A record id → **DELETE** it → **POST** 2–3 DNS-only A records (`proxied:false`, `ttl:60`) for the ingress IPs (PATCH can't convert one proxied record into N grey records). **AAAA:** if Task 6.0 found a proxied AAAA on `dns.krova.cloud`, DELETE it in the same flip (and POST grey AAAA only if the /29 has v6 ingress, else guarantee no AAAA exists — §5.11). **Rollback = re-POST the single proxied A (and AAAA) record.** Bound: **rollback is valid ONLY during the soak, before Phase 7** — once Phase 7 deletes the CF custom hostnames, reverting DNS 1014s every grey-on-CF customer again. Commit.

### Task 6.3: POST-flip cert pre-warm + Phase-0 live verification

- [ ] Create `scripts/ingress-prewarm.ts` (`pnpm ingress:prewarm`) to run **immediately AFTER the flip**: for every active FQDN, make a real SNI TLS connection to an ingress IP to trigger on-demand issuance (now valid — public DNS resolves to the ingress). Rate-limit per the REAL binding limits: per-account ≤~200 orders/3h, **per-registered-domain (eTLD+1) ≤~45 certs/7 days** (GLOBAL limit — bites multi-subdomain customers), and hard-gate each FQDN on `/authorize` sync-ack so a not-yet-synced domain doesn't burn the 5-failed-validations/identifier/hour budget. Honor `CloudflareRateLimitError`/LE backoff; dry-run by default; `--apply` commits.
- [ ] Create `docs/superpowers/plans/ingress-phase0-verification.md` — the operator-run dev-host checklist (spec §12), gating the prod flip. All must pass on the dev host first: both Caddy services bind with **no `EADDRINUSE`** (4.5 rebind → 4.6 ingress ordering); grey on-CF test domain → **no 1014**; **two-node single-issuance** test (concurrent first-hits for the same SNI from 2 nodes against the shared Postgres store produce exactly ONE LE order — proves the storage plugin's certmagic Locker works; pin the exact plugin repo+commit); cert issues via `/authorize`; **WebSockets** end-to-end; cube sees the **real client IP** (XFF re-plumb); **transfer** with no 404 window (push-before-teardown); kill one ingress node → its A record pulled within ~2 min (L7 probe), last never deleted, self-egress-check aborts on CP partition; `/authorize` refuses random/unverified SNIs; **the live-box rebind (4.5) caused no customer-visible drop** while behind CF. Commit.

---

## Phase 7 — Decommission (separate deploy, after soak)

### Task 7.1: Remove CF code + cache-purge subsystem

- [ ] Delete `lib/cloudflare/custom-hostnames.ts`, the `cloudflare.hostname-poll` cron + handler, and the **entire cache-purge subsystem** (`lib/cloudflare/cache.ts`, `lib/domains/cache-purge.*`, `domain-purge-cache.ts`, `JOB_NAMES.DOMAIN_PURGE_CACHE` + `boss.ts`/`ensure-queues.ts` entries, the purge actions, v1 + Orbit purge routes, the "Clear cache" UI, `DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS`, the `domain.cache-purged` event, `tests/integration/domain-cache-purge.test.ts`). Delete the now-dead `lib/server/cube-domain.ts` CF helpers. Run a grep pass for residual references. `pnpm test:all` + `pnpm typecheck` + `pnpm lint` green. Commit.

### Task 7.2: DROP-COLUMN migration + uniqueness-index swap

- [ ] After 7.1 removes all references: edit `db/schema/domains.ts` to drop `cloudflareHostnameId`/`cloudflareStatus`/`cloudflareCheckedAt`/`verificationStatus`/`verifyAttempts`/`verificationError`/`tlsStatus`/`lastCachePurgeAt`, AND in the SAME schema change replace the `verification_status='verified'` partial unique index with an **unconditional `uniqueIndex(domain) WHERE status <> 'deleted'`** (spec §5.10 — global hostname uniqueness must never lapse).
- [ ] **🚨 v2.2 — do NOT touch the `space_domain_claims` feature.** In `lib/cube-actions/domains.ts` `addDomainAction`: remove ONLY the `verificationStatus:"verified"` write (the new unconditional index replaces its purpose), but **KEEP the `findCrossSpaceLock` space-claim check** — that's the independent space-wide `space_domain_claims` lock (PR #62) on a separate table with its own `space_domain_claims_domain_verified_unique` index; this DROP-COLUMN migration must not touch it. Confirm with a grep that nothing else reads `domain_mappings.verificationStatus` before dropping it.
- [ ] `pnpm db:generate` → `pnpm test:migrations`. Commit.

### Task 7.3: CLAUDE.md + README (Rule 22)

- [ ] Rewrite the "Custom Domains (Cloudflare for SaaS)" CLAUDE.md section for the self-hosted ingress; **delete the stale "Origin-fallback Worker" section** (already gone from the repo); fix the `server.refresh-caddy` / `domain.purge-cache` rows, the webhooks count, the architecture "Domain mappings" line; same for README. Commit.

---

## Self-Review

**Spec coverage (§-by-§):** §1–2 problem/decision → Phase 0–1 foundations. §3 architecture → Phases 2/4. §4 + §4a customer lifecycle + exact-FQDN → Tasks 1.1, 1.5, 3.1, 5.1. §5.1 ingress node → 4.1–4.6. §5.2 routing/SSRF/mTLS → 1.6, 4.2, 3.3, 4.4. §5.3 sync → 2.1, 4.3, 3.2. §5.4 authorize → 1.5, 4.3. §5.5 pre-warm → 6.3 (POST-flip). §5.6 ownership (optional) → no gate task (intentional, §15 #6). §5.7 real-IP → 3.3, 4.5. §5.8 status → 0.2, 0.3, 2.3, 5.x. §5.9 lifecycle matrix → 3.2 + 4.3 (`/authorize` cube-status). §5.10 designation + uniqueness → 0.2, 7.2. §5.11 firewall/key custody → 4.6. §5.12 control-plane → 2.1, 4.3. §6 HA → 1.3, 1.4, 2.2. §7 DDoS/L7 → 4.4 (ratelimit); Coraza deferred (§15). §8 retire → Phase 7. §9a hint → 5.1; §9b deferred. §10 migration → Phase 6 (6.0 inventory, 6.1 seed, 6.2 flip+AAAA, 6.3 post-flip pre-warm + Phase-0). §11 migrations → 0.2 + 7.2. §12 Phase-0 → 6.3. §13 testing → embedded per task.

**Placeholder scan:** no "TBD"/"handle edge cases"; infra tasks (Phase 4) give artifacts + exact verify commands rather than `pnpm test` loops (host-smoke domain, called out in the header).

**Type consistency:** `IngressRoute`/`buildIngressRoutesTable` (1.2) ↔ routes endpoint (2.1) ↔ sync agent (4.3); `decideAuthorize` (1.5) ↔ agent `/authorize` (4.3); `decideDnsHealth` (1.4) ↔ handler (2.2); `normalizeHost` (1.1) used by 1.5; `isAllowedBackend` (1.6) ↔ routing module (4.2). `ingressStatus` enum (0.2) ↔ display (0.3) ↔ status-poll (2.3) ↔ UI (5.x).

**Known cross-phase dependency:** Phase 3/6 reference the agent endpoints from Phase 4 (`/route-poke`, `/healthz`, `/authorize`) — implement Phase 4 before enabling the flag in Phase 6; Phases 0–3 are mergeable independently (flag OFF = no behavior change).
