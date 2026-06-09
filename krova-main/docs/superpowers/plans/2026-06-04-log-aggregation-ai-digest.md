# Krova Observability & Log-Aggregation Master Plan

> **Single source of truth.** This is the one consolidated plan for Krova's observability
> work. It absorbs both (1) the former log-aggregation design spec
> (`docs/superpowers/specs/2026-06-04-log-aggregation-ai-digest-design.md`) and (2) the former
> standalone `docs/plans/observability-and-alerting.md` — both merged here on 2026-06-04 and
> both deleted. **Two workstreams:** **A** — log aggregation + daily AI digest (Parts I–IV);
> **B** — durable instrumentation, unified Orbit timeline, alerting, per-cube metrics, and SSH
> keepalive hardening (Part V). References are Part VI.
>
> **Status:** Design + plan, execution-ready (v1 — grounded by version-pinned
> research, re-verified against vendor docs 2026-06-04; see Part VI).
> **Author:** brainstorming session (rohit.bhadani@debutify.com)
>
> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement Parts II and V task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (one line):** stream every Krova *platform* container's stdout/stderr into a
self-hosted **Grafana Loki**, then run a once-daily worker job that distills +
PII-redacts the last 24h of logs, sends them to **Ollama Cloud** for triage, and
delivers a structured "what looks wrong today" digest by email + an Orbit history page.

**Why:** the worker runs **10 replicas** (the web app runs 1). Eyeballing 11 containers'
logs across replicas is infeasible; there is no persistent log store today (only live
`docker logs` tailing in Dokploy + a per-job `job_logs` table that covers worker *job
steps*, not raw stdout, and nothing from web).

## Table of contents

- **Part I — Design & Decisions** — problem, locked decisions, architecture, Half A (Loki/Alloy/Grafana), Half B (digest pipeline), worker-stack, data model, config/env, deviations, risks, out-of-scope.
- **Part II — Implementation Plan** — file structure + Phases 0–13 (execution-ready, TDD).
- **Part III — Operator Runbook** (Rule 60).
- **Part IV — Testing & Rules Compliance** (Rule 59).
- **Part V — Companion Workstream (B): Durable Instrumentation, Orbit Timeline, Alerting, Per-Cube Metrics & SSH Keepalive.**
- **Part VI — References & Research Log** (verified web citations).

---
---

## Part I — Design & Decisions

## 1. Problem

- **No persistent, queryable log store.** Dokploy's log view is live `docker logs --follow`
  tailing only — no aggregation, no history, no forwarding/drains (Dokploy issues
  [#2748 "Log drains"](https://github.com/Dokploy/dokploy/issues/2748) and
  [#3132 "Configure Docker log drivers per-app"](https://github.com/Dokploy/dokploy/issues/3132)
  are both open & uncommitted as of v0.29.x). `job_logs`
  ([lib/worker/job-log.ts](../../../lib/worker/job-log.ts)) captures structured *job-step*
  rows for cube/server/snapshot/backup entities only — not raw container stdout, and nothing
  from the Next.js web service.
- **10 worker replicas.** The heavy lifting (SSH, provisioning, billing, snapshots) is spread
  across 10 replicas. A fault in one replica is invisible unless you happen to tail that exact
  container.
- **No daily health signal.** The operator wants a daily, AI-summarized "here's what's wrong"
  rather than ad-hoc log spelunking.

## 2. Decision

Build two cleanly separable halves, matching the Rule-60 split (operator runs live infra;
app code lives in the repo and ships via the normal worker deploy):

- **Half A — Observability stack (operator-deployed via Dokploy Compose):** Grafana
  **Loki 3.7.2** (monolithic, S3-chunk backend, 30-day retention) + **Grafana Alloy v1.16.2**
  (per-node Docker-socket scrape) + **Grafana** (search UI), fronted by **Caddy**
  (basic-auth + TLS). Data never leaves the operator's infra.
- **Half B — Daily AI digest (krova-cloud repo, pg-boss worker):** a once-daily
  `policy:"exclusive"` cron that queries Loki, distills + PII-redacts, calls **Ollama Cloud**
  (`gpt-oss:120b-cloud`) for structured triage, persists a `log_digests` row, emails the
  operator via EmailIt, and surfaces history at `/orbit/logs`.

Plus a coupled config change the operator requested: **reconcile `dokploy/worker-stack.yml`
to `replicas: 10`** with a `stop-first, parallelism: 0` (all-at-once) update strategy.

### Locked decisions

| # | Decision | Chosen |
|---|---|---|
| D1 | Log store + who runs it | **Self-hosted Grafana Loki** (data stays on operator infra) |
| D2 | AI analysis cadence | **Fully automated daily digest** (not on-demand) |
| D3 | Log scope | **App only** — web (×1) + worker (×10); customer cubes are Firecracker microVMs, out of scope |
| D4 | Digest delivery | **EmailIt push + Orbit history page** (backed by a `log_digests` table) |
| D5 | Log shipper | **Grafana Alloy** (not the Loki Docker driver — see §4.2) |
| D6 | LLM backend | **Ollama Cloud**, native `ollama@0.6.3` lib, model `gpt-oss:120b-cloud` |
| D7 | Worker deploy strategy at 10 replicas | **stop-first, `parallelism: 0`** (all drain in parallel, no mixed versions) |
| D8 | Loki retention | **30 days** (`720h`) |
| D9 | Digest schedule | **07:00 UTC daily** (offset from the 06:00-Sunday restic check + the 03:xx prunes) |

## 3. Architecture

```
┌─ HALF A: Observability stack (operator-deployed via Dokploy Compose) ───────┐
│  web ×1  ─┐                                                                 │
│  worker ×10┤  stdout/stderr (json-file driver, UNTOUCHED — docker logs OK)  │
│            ▼                                                                │
│   Grafana Alloy  (deploy.mode: global → 1 per Swarm node, RO docker.sock)   │
│            │  labels: service=web|worker, container_name (per-replica), host│
│            ▼                                                                │
│   Loki 3.7.2 (monolithic, -target=all) ──chunks──▶ S3 (NEW bucket)          │
│            │   TSDB+v13 · index/WAL on ~10–20GB local · 30-day compactor    │
│       ┌────┴─────┐                                                          │
│   Grafana UI    Loki HTTP query API  ── both behind Caddy (basic-auth+TLS)  │
│  (manual search)      │                  /ready left open for healthchecks  │
└───────────────────────┼─────────────────────────────────────────────────────┘
                        │  LogQL /loki/api/v1/query_range (Bearer/Basic over Caddy)
┌─ HALF B: Daily AI digest (krova-cloud repo, pg-boss worker, 1-of-10 via exclusive)─┐
│  cron 07:00 UTC                                                                    │
│   ├─ 1. Loki metric queries  → per-service error counts + spike ratio (vs 24h ago) │
│   ├─ 2. Loki bounded raw fetch → error/warn lines (hard limit, paged by ns-ts)     │
│   ├─ 3. distill: PII-redact → mask/cluster (self-contained) → top-N + net-new      │
│   │        + hard token ceiling (never exceed model context)                       │
│   ├─ 4. Ollama Cloud: gpt-oss:120b-cloud, temp 0, forced tool-call = digest schema │
│   │        → Zod.parse + bounded retry on parse/validation failure                 │
│   ├─ 5. persist log_digests row (summary + incidents JSONB + token counts)         │
│   ├─ 6. EmailIt → ERROR_NOTIFY_EMAILS (React Email template)                       │
│   └─ 7. audit() row; Orbit /orbit/logs renders history                             │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Failure isolation:** Alloy is an independent sidecar reading the socket; if Loki/S3 is
down, Alloy buffers/retries and the app containers + Dokploy's own log view are completely
unaffected. If Loki is unreachable at digest time, the cron fails and pg-boss retries — no
customer-facing impact.

## 4. Half A — observability stack (operator-deployed)

Repo layout (agent prepares files; **operator deploys** per Rule 60):

```
observability/
  README.md            # operator runbook (deploy order, S3 bucket creation, key minting, Caddy)
  compose.yml          # Dokploy Compose stack: loki + alloy (global) + grafana
  loki/loki-config.yaml
  alloy/config.alloy
  caddy/observability.caddy   # snippet to merge into the host Caddy (basic-auth + TLS vhosts)
```

### 4.1 Loki 3.7.2 (monolithic)

- **Mode:** single-binary `-target=all`, `replication_factor: 1`, `kvstore.store: inmemory`,
  `path_prefix: /loki`. Rated to ~20 GB/day; our volume is a few GB/day at most.
- **Storage:** TSDB index + schema **v13** (the 3.x default), chunks in a **new S3 bucket** on
  the operator's existing S3 provider. Config via the expanded `storage_config.aws` key/value
  form with **`s3forcepathstyle: true`** (load-bearing for non-AWS S3).
  `schema_config.configs[0].from` = a date ≥ first ingest (never backdated); `index.period: 24h`
  (required for retention).
- **Retention (30 d):** compactor with `retention_enabled: true`, **`delete_request_store: s3`**
  (per the Loki docs, *"required when retention is enabled"* — the field everyone forgets),
  `limits_config.retention_period: 720h` (Loki's minimum retention is 24h). The S3 bucket's own
  lifecycle policy must be longer than 720h (or disabled) so the provider doesn't delete chunks
  under Loki. → [Loki retention docs](https://grafana.com/docs/loki/latest/operations/storage/retention/).
- **Footprint:** 1–2 vCPU, container memory limit ~4 GB (caps query blast radius), ~10–20 GB
  local disk for index/WAL/compactor scratch.
- **Field-name caveat:** docs are inconsistent between `bucketnames` and `bucket_names`; verify
  against the running 3.7.2 binary with `loki -verify-config` before deploy (operator step in
  Part III).

### 4.2 Grafana Alloy v1.16.2 (the shipper)

- **Why Alloy, not the Loki Docker driver:** Promtail is **EOL as of 2026-03-02**
  ([Grafana announcement](https://community.grafana.com/t/promtail-end-of-life-eol-march-2026-how-to-migrate-to-grafana-alloy-for-existing-loki-server-deployments/159636)).
  The `loki-docker-driver` in its default *blocking* mode can deadlock `dockerd` when Loki is
  unreachable (grafana/loki [#2017](https://github.com/grafana/loki/issues/2017),
  [#2361](https://github.com/grafana/loki/issues/2361)) and breaks `docker logs` /
  `docker service logs`; its non-blocking mode silently drops logs under backpressure. Alloy is
  an isolated sidecar — no app-container blast radius, `docker logs` keeps working, and a
  positions file means it resumes from the last offset after a restart.
- **Deploy:** `deploy.mode: global` (one Alloy task per Swarm node), `/var/run/docker.sock`
  mounted **read-only**, plus a persistent `alloy-data` volume for the positions file. Pin
  `grafana/alloy:v1.16.2` (never `:latest`).
- **Collection:** `discovery.docker` → `discovery.relabel` → `loki.source.docker` → `loki.write`
  ([loki.source.docker reference](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.docker/)).
  Relabel rules set:
  - `service` = from the Swarm service-name label
    (`__meta_docker_container_label_com_docker_swarm_service_name`), normalized to `web` / `worker`.
  - `container_name` = `__meta_docker_container_name` with the leading `/` stripped —
    **per-replica attribution** so the digest can spot "one bad replica vs systemic" across the
    10 workers.
  - `host` = node hostname.
  - Low-cardinality `service` is the cheap selector; `container_name` (10 values) is fine as a
    secondary label.
- **Scope filter:** only `web` + `worker` services are forwarded (drop everything else in the
  relabel stage) per D3.

### 4.3 Grafana + auth

- Grafana for manual search (directly serves "hard to check 10 replicas"), Loki datasource
  pointed at the Caddy-fronted Loki URL with matching Basic Auth.
- Loki has **no built-in auth** (`auth_enabled: false` → single tenant `fake`). **Caddy** (the
  operator's existing per-server reverse proxy) fronts both Loki and Grafana with **Basic Auth +
  TLS**; `/ready` is left unauthenticated for healthchecks. The Alloy `loki.write` push and
  Grafana's datasource both send the same Basic Auth creds (or push stays on the internal Docker
  network and only the query path is exposed — operator's choice, documented in the runbook).

### 4.4 Dokploy's role

Dokploy has no native log forwarding/Loki/Prometheus and can't set a per-app logging driver from
the UI ([#2748](https://github.com/Dokploy/dokploy/issues/2748),
[#3132](https://github.com/Dokploy/dokploy/issues/3132)). Its only role here is to **deploy +
manage `observability/compose.yml` as a Compose application** alongside the existing services —
the community-standard pattern. Collection is Alloy, not a Dokploy feature.

## 5. Half B — daily AI digest (worker)

All worker-side (Rule 1), idempotent (Rule 7), no SSH/infra from Next.js.

### 5.1 New module layout

```
lib/observability/
  loki-client.ts       # query_range HTTP client: metric queries + paged raw fetch
  distill.ts           # PII-redact → mask/cluster (self-contained) → top-N + spike + net-new + hard token cap
  redact.ts            # regex PII redaction (email/IPv4/IPv6/bearer/JWT/secret)
  ollama-digest.ts     # Ollama Cloud call (gpt-oss:120b-cloud), tool-call schema, Zod-validate + retry
  digest-schema.ts     # shared Zod schema + TS types for the digest (plain lib module, importable anywhere)
lib/worker/handlers/
  log-digest-daily.ts  # the cron handler orchestrating the above
```

### 5.2 The cron

- New `JOB_NAMES.LOG_DIGEST_DAILY` in [lib/worker/job-types.ts](../../../lib/worker/job-types.ts)
  + explicit `QUEUE_OPTIONS` entry in [lib/worker/ensure-queues.ts](../../../lib/worker/ensure-queues.ts)
  (Rule 56 — the `Record<JobName,…>` is exhaustive, so a missing entry fails typecheck) +
  `boss.schedule(JOB_NAMES.LOG_DIGEST_DAILY, "0 7 * * *")` in
  [lib/worker/boss.ts](../../../lib/worker/boss.ts) with `policy:"exclusive"` (fires exactly once
  across all 10 worker replicas).
- **Idempotency:** the `log_digests` row is keyed by a UNIQUE `digest_date`. The handler
  claims/up-serts the row first; a retry for the same date is a no-op or resumes a
  `pending`/`failed` row. Email send is gated on `email_sent_at IS NULL` so a retry never
  double-sends.

### 5.3 Loki query (cheap-first)

Via `loki-client.ts` against `/loki/api/v1/query_range` with `since=24h`
([Loki HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/)):
1. **Spike signal (tiny matrix payloads):**
   `sum by (service) (count_over_time({service=~"web|worker"} |~ "(?i)error" [1h]))` and the same
   expr `offset 24h` → ratio per service. Optionally per `container_name` to flag a single bad
   replica.
2. **Bounded raw fetch:** error/warn lines via `detected_level=~"error|warn"` (Loki 3.1+
   auto-detects level on unstructured stdout) widened with a line filter
   (`|~ "(?i)(error|exception|unhandled|rejection|\b5\d\d\b|ECONN|timeout)"`), `direction=forward`,
   hard `limit` (e.g. 2000), paged by last-entry-ns-timestamp+1ns, `line_format` to strip each
   line before it leaves Loki. Keep `detected_level`/structured-metadata filters **before** any
   parser stage (query-acceleration requirement).

### 5.4 Distill + redact (the real token win)

In `distill.ts` (Node, same runtime as the worker):
1. **Redact** (`redact.ts`, applied to every line before anything leaves the box): mask email +
   IPv4 + IPv6, fully redact `Bearer`/JWT/`api_key|secret|token|password`/AWS-key patterns. IPv6
   alternation (full/compressed/v4-mapped) is the error-prone one — unit-tested.
2. **Mask + cluster (self-contained, dependency-free):** replace high-cardinality variable tokens
   (UUIDs, hex, numbers, durations) with placeholders so near-identical lines collapse to one
   template; count occurrences; keep representative samples. (See the deviation note in §9 — the
   v1 distiller is a deterministic in-repo function, not `logpare`/Drain.)
3. **Select:** top-N templates by count + any **net-new** template not seen in the prior 24h
   (compare against yesterday's stored template fingerprints); attach 1–2 raw samples each +
   first/last-seen + the §5.3 spike ratio.
4. **Hard ceiling:** cap the final payload (e.g. ≤30 templates, ≤2 samples each) and a token
   budget so a pathological spike can't exceed the model context. **Never silently truncate** —
   if over budget, drop lowest-count templates and `log()` what was dropped.

### 5.5 Ollama Cloud call

In `ollama-digest.ts`, native `ollama@0.6.3` (new dep, pinned —
[npm](https://www.npmjs.com/package/ollama)):

```ts
import { Ollama } from "ollama";
import { env } from "@/lib/env";
const ollama = new Ollama({
  host: OLLAMA_HOST,                                     // "https://ollama.com"
  headers: { Authorization: `Bearer ${env.OLLAMA_API_KEY}` },
});
```

- **Model:** `gpt-oss:120b-cloud` (128K context — fits 30–60k distilled tokens; config constant,
  swappable as the cloud catalog rotates). Larger-context fallback: `qwen3-coder:480b-cloud`
  (256K). Cloud model list: [ollama.com/search?c=cloud](https://ollama.com/search?c=cloud).
- **⚠️ Structured output — do NOT rely on cloud schema enforcement.** Ollama's capabilities doc
  states verbatim *"Ollama's Cloud currently does not support structured outputs"* —
  grammar-constrained `format` is **not** enforced on the cloud tier
  ([docs.ollama.com/capabilities/structured-outputs](https://docs.ollama.com/capabilities/structured-outputs),
  re-verified 2026-06-04). Mechanism:
  - Build the JSON Schema with **`z.toJSONSchema(DigestSchema, { target: "draft-2020-12" })`** —
    native to the installed **`zod@4.4.3`**, so **no `zod-to-json-schema`** dependency (it's
    unmaintained). → [Zod JSON Schema docs](https://zod.dev/json-schema).
  - Use **forced tool-calling** (a single tool whose `parameters` is the digest schema; tool
    calling *is* supported on gpt-oss) as the most reliable JSON path, `temperature: 0`, and also
    state "respond as JSON matching this schema" in the prompt.
  - **Always `DigestSchema.parse(JSON.parse(...))`** in a try/catch; on parse/validation failure,
    bounded retry (optionally escalate to a stronger model). Grammar (even if honored) guarantees
    shape, not value-correctness (`enum`/min/max ignored) — Zod re-checks.
- **Practicalities:** `stream: false`; the lib has no per-request timeout → wrap in an
  `AbortController` (`AbortSignal.timeout`); **no batch API**; serialize (Free tier = 1
  concurrent); pg-boss retries on 429/5xx; read `prompt_eval_count`/`eval_count` for token logging
  (informational — billing is GPU-time, not tokens).

### 5.6 Persist + deliver

- **Persist:** up-sert the `log_digests` row → `summary`, `incidents` (JSONB), token counts,
  `model`, `status='complete'`. Store only the distilled JSON, **never raw log blobs** (Rule 23).
- **Email (Rule 10/25):** a React Email template `lib/email/components/log-digest.tsx` (mirror the
  existing security-digest template), rendered via [lib/email/renderer.ts](../../../lib/email/renderer.ts),
  sent through EmailIt to `ERROR_NOTIFY_EMAILS`
  ([config/platform.ts:244](../../../config/platform.ts#L244) — currently `[]`; operator populates).
  Dates via `formatEmailDateUtc`. Gate on `email_sent_at IS NULL`.
- **Audit (Rule 9):** an `audit({ action: "log_digest.generated", category: "system", … })` row
  per run, including a `log_digest.failed` row on the failure path.
- **Orbit page:** `app/(orbit)/orbit/logs/` — a `<DataTable>` list of digests (newest first) + a
  detail page rendering the incidents with severity badges routed through
  [lib/status-display.ts](../../../lib/status-display.ts) (Rule 44 — add the digest entries, never a
  local switch). Sidebar nav entry under the existing Orbit groups.

## 6. Worker-stack.yml update (operator-requested, coupled)

Reconcile [dokploy/worker-stack.yml](../../../dokploy/worker-stack.yml) +
[dokploy/README.md](../../../dokploy/README.md) to the live reality of **10 worker replicas** with
the **stop-first all-at-once** strategy (D7):

```yaml
deploy:
  mode: replicated
  replicas: 10                 # was 1
  update_config:
    order: stop-first
    parallelism: 0             # was 1 — 0 = all-at-once: drain 10 in parallel, NOT 10×45m serially
    failure_action: rollback
    monitor: 180s
  rollback_config:
    order: stop-first
    parallelism: 0             # was 1
  restart_policy: { condition: on-failure, delay: 10s, max_attempts: 3, window: 120s }
```

`stop_grace_period: 45m`, the `pgrep -f scripts/worker.ts` healthcheck, and `init: true` are
unchanged. README rationale rewritten: *no mixed code versions ever; on deploy all 10 drain in
parallel (≤45m, usually far less) then 10 fresh start; queued jobs wait in Postgres during the gap
(pg-boss persists them)*. Add a one-liner that `policy:"exclusive"` on every recurring queue is
what keeps crons — billing-hourly, reconciles, **and the new `log-digest-daily`** — firing once
across all 10 replicas.

> **Note (out of scope, flagged):** the trade-off of an all-stop drain is a brief window where
> *no* worker processes jobs (until the slowest in-flight job drains). This is the same
> correctness guarantee the original `replicas:1` config had, scaled to 10. If the operator later
> wants zero-gap deploys they'd switch to `start-first` rolling and accept brief mixed-version
> windows — a separate decision, not part of this work.

## 7. Data model (Rule 6 / Rule 40)

New table via `pnpm db:generate` (drizzle-kit; never hand-write the migration/journal/snapshot).
Additive, nullable-friendly, idempotent SQL.

`log_digests`:

| column | type | notes |
|---|---|---|
| `id` | text PK | cuid2, repo convention |
| `digest_date` | date | **UNIQUE** — idempotency key (one digest per UTC day) |
| `status` | enum (`pending`/`complete`/`failed`) | pgEnum → drives `lib/status-display.ts` (Rule 44) |
| `generated_at` | timestamptz | UTC (Rule 25) |
| `model` | text | e.g. `gpt-oss:120b-cloud` |
| `window_start` / `window_end` | timestamptz | the 24h window queried |
| `summary` | text | model's prose summary |
| `incidents` | jsonb | structured array: `{ service, severity, title, count, sample, firstSeen, lastSeen, spikeRatio }` |
| `template_count` | integer | total distinct templates mined (observability) |
| `input_tokens` / `output_tokens` | integer | from Ollama response (informational) |
| `email_sent_at` | timestamptz null | gates re-send on retry |
| `error` | text null | failure reason (truncated) |
| `created_at` / `updated_at` | timestamptz | repo convention |

Stores only the distilled JSON; raw logs live in Loki/S3 only (Rule 23). The prior-day
**template fingerprints** for net-new detection can be derived from yesterday's `incidents` (no
extra storage).

## 8. Config + env additions

- **`lib/env.ts` (Rule 5 — Zod-validated, never `process.env` directly):** `OLLAMA_API_KEY`
  (secret), `LOKI_QUERY_URL`, `LOKI_BASIC_AUTH_USER`, `LOKI_BASIC_AUTH_PASSWORD` (secrets). All
  optional → the digest cron is inert until populated.
- **`config/platform.ts` (Rule 30):** `OLLAMA_HOST` base URL, `LOG_DIGEST_MODEL =
  "gpt-oss:120b-cloud"`, `LOG_DIGEST_SCHEDULE_CRON`, `LOG_DIGEST_TOP_N`,
  `LOG_DIGEST_SAMPLES_PER_TEMPLATE`, `LOG_DIGEST_MAX_INPUT_CHARS`, `LOG_DIGEST_MAX_RAW_LINES`,
  `LOG_DIGEST_LOOKBACK_HOURS = 24`.
- **New dep:** `ollama@0.6.3` (pinned). `zod` already at 4.4.3 (native `z.toJSONSchema`). No
  `@anthropic-ai/sdk`, no `openai`, no `zod-to-json-schema`, no `logpare` in v1 (see §9).

## 9. Deviations from the original design (deliberate, surfaced)

- **Distiller:** the design named `logpare` (a Drain-based npm template miner —
  [github.com/logpare/logpare](https://github.com/logpare/logpare), claims 60–90% token
  reduction). **v1 uses a self-contained masking+grouping distiller** (`distill.ts`) —
  dependency-free, deterministic, fully unit-testable. logpare/Drain3 is a documented **future
  upgrade** if token reduction proves insufficient. **The only new runtime dep is `ollama@0.6.3`.**
- **`log_digests` is platform-wide** (one row per UTC day, unique `digest_date`) — NOT per-space.
- **The Orbit digests list is low-volume** (≤366 rows/yr) → client-side `<DataTable>`
  (credit-purchases pattern), no server-pagination API route. Raw logs are browsed in Grafana.

## 10. Risks / open questions

- **R1 — Ollama Cloud quota opacity.** Numeric quotas aren't published; over-limit requests are
  queued (Pro/Max) or rejected (Free). One daily run on a 120b model *should* fit Free, but may
  need Pro. Mitigation: pg-boss retry/backoff + config-swappable model (drop to `gpt-oss:20b-cloud`
  if throttled). The handler must treat 429 as retryable, not fatal.
- **R2 — Cloud `/v1` base URL undocumented.** The cloud OpenAI-compat base is confirmed in
  practice but not on the official docs page; we use the **native** lib (documented) to sidestep
  it. A startup `GET /api/tags` probe surfaces a bad key/endpoint clearly.
- **R3 — `detected_level` is heuristic** on unstructured Next.js/worker stdout — it will mis-label
  some lines. Mitigation: widen with explicit line filters; treat it as a coarse pre-filter, not
  ground truth. (A future enhancement is structured JSON logging in the app, out of scope for v1.)
- **R4 — Volume from 10 worker replicas.** If daily volume is higher than expected, the distill
  step's hard ceiling protects the model context, but the Loki raw-fetch `limit` could clip.
  Mitigation: lead with metric queries; `log()` any clip; tune `limit`/lookback in config.
- **R5 — Worker-stack all-stop gap.** Brief no-processing window on deploy (see §6 note). Accepted
  by the operator (D7).

## 11. Out of scope (v1)

- Customer **cube/guest** log collection (Firecracker VMs, not Docker containers) — separate effort.
- Structured JSON logging inside the app (pino-style) — a future enhancement that would make
  `detected_level` exact.
- On-demand "analyze last N hours" button — D2 chose automated daily only.
- Metrics/traces (Prometheus/Tempo) — logs only.
- Alerting/paging on the digest — email + Orbit only for v1.
- Switching the worker to start-first rolling deploys — separate decision (§6 note).

---
---

## Part II — Implementation Plan

> Branching: doc-only until Phase 2. Create the feature branch
> (`feat/log-aggregation-ai-digest`) at the START of Phase 2 (first code change), per "a branch is
> created only when code changes begin." Phases 0–1 are config files; group them onto the same
> branch when you start Phase 2.

## File structure

**Half A (operator-deployed config — new dir `observability/`):**
- `observability/README.md` — operator runbook
- `observability/compose.yml` — Dokploy Compose stack (loki + alloy global + grafana)
- `observability/loki/loki-config.yaml`
- `observability/alloy/config.alloy`
- `observability/caddy/observability.caddy` — Caddy vhost snippet

**Half B (repo code):**
- Modify `dokploy/worker-stack.yml`, `dokploy/README.md` — replicas 1→10, stop-first parallelism 0
- Modify `package.json` — add `ollama@^0.6.3`
- Modify `lib/env.ts` — `OLLAMA_API_KEY`, `LOKI_QUERY_URL`, `LOKI_BASIC_AUTH_USER`, `LOKI_BASIC_AUTH_PASSWORD` (all optional)
- Modify `config/platform.ts` — `OLLAMA_HOST`, `LOG_DIGEST_*` constants
- Create `db/schema/log-digests.ts` + modify `db/schema/index.ts` (barrel) → `pnpm db:generate` (→ `0074_*`)
- Modify `lib/status-display.ts` — `logDigestStatus` options/variant + `DIGEST_INCIDENT_SEVERITY_*`
- Create `lib/observability/redact.ts` (+ test) — PII redaction
- Create `lib/observability/digest-schema.ts` (+ test) — Zod schema + types
- Create `lib/observability/distill.ts` (+ test) — mask → cluster → select → token-cap
- Create `lib/observability/loki-client.ts` (+ test) — query_range client
- Create `lib/observability/ollama-digest.ts` (+ test) — Ollama Cloud call + validate/retry
- Create `lib/email/components/log-digest.tsx` + `lib/email/templates/log-digest.ts` (+ test on text builder)
- Create `lib/worker/handlers/log-digest-daily.ts` (+ integration test)
- Modify `lib/worker/job-types.ts`, `lib/worker/ensure-queues.ts`, `lib/worker/boss.ts` — wire the cron
- Create `app/(orbit)/orbit/logs/page.tsx`, `_components/log-digests-table.tsx`, `[id]/page.tsx`; modify `components/orbit/orbit-shell.tsx` (nav)
- Modify `CLAUDE.md` + create `docs/architecture/log-aggregation.md` (Rule 22)

---

## Phase 0 — Worker-stack reconciliation (10 replicas)

### Task 0: Update worker-stack.yml + README to 10 replicas, stop-first all-at-once

**Files:** Modify `dokploy/worker-stack.yml`, `dokploy/README.md`

- [ ] **Step 1: Edit `dokploy/worker-stack.yml` `deploy:` block** — change `replicas: 1` → `10`,
  and both `update_config.parallelism` and `rollback_config.parallelism` from `1` → `0`
  (all-at-once). Final block:

```yaml
    deploy:
      mode: replicated
      replicas: 10
      update_config:
        order: stop-first
        parallelism: 0          # 0 = all tasks at once: drain 10 in parallel, NOT 10×45m serially
        failure_action: rollback
        monitor: 180s
      rollback_config:
        order: stop-first
        parallelism: 0
      restart_policy:
        condition: on-failure
        delay: 10s
        max_attempts: 3
        window: 120s
```

Leave `init: true`, `stop_grace_period: 45m`, and the `healthcheck:` block unchanged.

- [ ] **Step 2: Rewrite the "Why a single worker replica" section of `dokploy/README.md`** —
  replace with a "Why 10 replicas, stop-first all-at-once" rationale: pg-boss is concurrency-safe
  (`FOR UPDATE SKIP LOCKED`), so 10 workers never double-process; `stop-first` + `parallelism: 0`
  keeps the *no-mixed-code-versions* guarantee — on deploy all 10 drain in parallel (≤45m, usually
  far less), then 10 fresh start; queued jobs wait in Postgres during the gap (pg-boss persists
  every job). Update the "Replicas" row in the Swarm-Settings table to `10` and the parallelism
  rows to `0`. Add: *every recurring queue is `policy:"exclusive"`, so crons (billing-hourly, the
  reconciles, and the new `log-digest.daily`) fire exactly once across all 10 replicas.*

- [ ] **Step 3: Commit** — `git add dokploy/worker-stack.yml dokploy/README.md && git commit -m "docs(dokploy): reconcile worker-stack to 10 replicas, stop-first all-at-once"`

> Applying these in Dokploy Swarm Settings is an **operator** action (Rule 60).

---

## Phase 1 — Observability stack config (operator-deployed, Half A)

> Config files the operator deploys; no app tests. Pin every image. Agent prepares; operator runs (Rule 60).

### Task 1: Loki config

**Files:** Create `observability/loki/loki-config.yaml`

- [ ] **Step 1: Write the monolithic Loki config (Loki 3.7.2, TSDB v13, S3 backend, 30-day retention)**

```yaml
auth_enabled: false                 # single tenant 'fake'; Caddy handles auth
server:
  http_listen_port: 3100
  log_level: info
common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  ring:
    kvstore: { store: inmemory }
  replication_factor: 1
schema_config:
  configs:
    - from: 2026-06-05            # MUST be >= first ingest date; never backdate
      store: tsdb
      object_store: s3
      schema: v13
      index: { prefix: index_, period: 24h }   # 24h REQUIRED for retention
storage_config:
  tsdb_shipper:
    active_index_directory: /loki/tsdb-index
    cache_location: /loki/tsdb-cache
  aws:
    bucketnames: ${LOKI_S3_BUCKET}          # verify bucketnames vs bucket_names with -verify-config
    endpoint: ${LOKI_S3_ENDPOINT}           # host only, no scheme, no bucket
    region: ${LOKI_S3_REGION}
    access_key_id: ${LOKI_S3_ACCESS_KEY}
    secret_access_key: ${LOKI_S3_SECRET_KEY}
    s3forcepathstyle: true                  # REQUIRED for non-AWS S3
    insecure: false
compactor:
  working_directory: /loki/compactor
  retention_enabled: true                   # off by default — REQUIRED to delete
  delete_request_store: s3                  # mandatory when retention on
  retention_delete_delay: 2h
  compaction_interval: 10m
limits_config:
  retention_period: 720h                    # 30 days
  reject_old_samples: true
  reject_old_samples_max_age: 168h
```

- [ ] **Step 2: Validate syntax locally** —
  `docker run --rm -v "$PWD/observability/loki/loki-config.yaml:/c.yaml" grafana/loki:3.7.2 -config.file=/c.yaml -verify-config`
  Expected: prints config + exits 0. Settle `bucketnames` vs `bucket_names` here if it complains.

- [ ] **Step 3: Commit** — `git add observability/loki && git commit -m "feat(observability): Loki 3.7.2 monolithic config (S3 backend, 30d retention)"`

### Task 2: Alloy config (Docker-socket scrape, web/worker only)

**Files:** Create `observability/alloy/config.alloy`

- [ ] **Step 1: Write the Alloy river config**

```alloy
discovery.docker "containers" {
  host             = "unix:///var/run/docker.sock"
  refresh_interval = "5s"
}

discovery.relabel "containers" {
  targets = discovery.docker.containers.targets

  // Swarm service name (e.g. "krova_web", "krova_worker") → normalized service label
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_swarm_service_name"]
    target_label  = "service_raw"
  }
  // strip leading slash from container name → per-replica attribution
  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container_name"
  }
  // KEEP only web/worker services (drop everything else — Postgres, soketi, caddy, dokploy system)
  rule {
    source_labels = ["service_raw"]
    regex         = ".*(web|worker).*"
    action        = "keep"
  }
  // collapse to a clean service=web|worker label
  rule {
    source_labels = ["service_raw"]
    regex         = ".*worker.*"
    target_label  = "service"
    replacement   = "worker"
  }
  rule {
    source_labels = ["service_raw"]
    regex         = ".*web.*"
    target_label  = "service"
    replacement   = "web"
  }
}

loki.source.docker "containers" {
  host          = "unix:///var/run/docker.sock"
  targets       = discovery.relabel.containers.output
  relabel_rules = discovery.relabel.containers.rules
  labels        = { job = "krova" }
  forward_to    = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"   // internal Docker network; query path is Caddy-fronted
  }
}
```

- [ ] **Step 2: Commit** — `git add observability/alloy && git commit -m "feat(observability): Alloy config — scrape web+worker container logs to Loki"`

### Task 3: Compose stack + Caddy snippet + README

**Files:** Create `observability/compose.yml`, `observability/caddy/observability.caddy`, `observability/README.md`

- [ ] **Step 1: Write `observability/compose.yml`** — loki + alloy global + grafana; pin images
  `grafana/loki:3.7.2`, `grafana/alloy:v1.16.2`, `grafana/grafana:11.4.0` (or current); `alloy`
  service `deploy.mode: global` with RO `/var/run/docker.sock` + `alloy-data` volume; `loki` with
  a `loki-data` volume for index/WAL; pass S3 + basic-auth env. Loki + Grafana on the internal
  network; only Caddy exposes the query/UI ports.
- [ ] **Step 2: Write `observability/caddy/observability.caddy`** — two vhosts (Loki query +
  Grafana) with `basic_auth` (bcrypt hash) + automatic TLS, `/ready` left open on the Loki vhost.
  Snippet to merge into the host Caddy.
- [ ] **Step 3: Write `observability/README.md`** — the operator runbook (mirror Part III).
- [ ] **Step 4: Commit** — `git add observability && git commit -m "feat(observability): compose stack + Caddy snippet + operator runbook"`

---

## Phase 2 — Dependencies, env, platform config

> **Create the branch now:** `git checkout -b feat/log-aggregation-ai-digest` (first code change).
> Cherry-pick/move the Phase 0–1 commits onto it if you committed them on main.

### Task 4: Add the `ollama` dependency

**Files:** Modify `package.json`

- [ ] **Step 1:** `pnpm add ollama@0.6.3`
- [ ] **Step 2:** Confirm pin: `grep '"ollama"' package.json` → `"ollama": "^0.6.3"` (or `0.6.3`). `pnpm install` to sync the lockfile.
- [ ] **Step 3: Commit** — `git add package.json pnpm-lock.yaml && git commit -m "build: add ollama@0.6.3 for log-digest"`

### Task 5: Env vars (Rule 5)

**Files:** Modify `lib/env.ts`

- [ ] **Step 1:** Insert before the closing `});` of `envSchema` (after the `KROVA_E2E_*` block, ~line 79):

```ts
  // Ollama Cloud — the log-digest worker job's LLM backend. OLLAMA_HOST
  // (base URL) lives in config/platform.ts; only the key is a secret.
  // Optional: when unset the log-digest cron is inert.
  OLLAMA_API_KEY: z.string().min(1).optional(),

  // Loki — log query backend the log-digest job pulls from via LogQL.
  // URL + basic-auth creds. Optional: digest cron is inert until populated.
  LOKI_QUERY_URL: z.url().optional(),
  LOKI_BASIC_AUTH_USER: z.string().min(1).optional(),
  LOKI_BASIC_AUTH_PASSWORD: z.string().min(1).optional(),
```

- [ ] **Step 2:** `pnpm typecheck` → PASS. **Commit** — `git commit -am "feat(env): Ollama + Loki vars for log-digest (optional)"`

### Task 6: Platform constants (Rule 30)

**Files:** Modify `config/platform.ts`

- [ ] **Step 1:** Add a new banner section near `ERROR_NOTIFY_EMAILS` (~line 244). **Use the CLOUD values (not local Ollama):**

```ts
// ── Log Digest ───────────────────────────────────────────────────────

/** Ollama Cloud base URL. The API key is env-only (OLLAMA_API_KEY). */
export const OLLAMA_HOST = "https://ollama.com";

/** Ollama Cloud model for the daily log digest. 128K context fits the
 *  distilled payload. Swappable as the cloud catalog rotates. */
export const LOG_DIGEST_MODEL = "gpt-oss:120b-cloud";

/** Cron for the recurring log-digest job (UTC). Offset from the 03:xx
 *  prunes and the 06:00-Sunday restic check. Recurring ⇒ policy:"exclusive". */
export const LOG_DIGEST_SCHEDULE_CRON = "0 7 * * *";

/** How many hours back each digest run queries Loki. */
export const LOG_DIGEST_LOOKBACK_HOURS = 24;

/** Max distilled templates fed to the model per run. */
export const LOG_DIGEST_TOP_N = 30;

/** Max representative samples kept per template. */
export const LOG_DIGEST_SAMPLES_PER_TEMPLATE = 2;

/** Hard ceiling on characters of distilled input sent to the model
 *  (proxy for token budget; ~4 chars/token → ~30k tokens at 120000). */
export const LOG_DIGEST_MAX_INPUT_CHARS = 120_000;

/** Max raw lines pulled from Loki per service before distillation. */
export const LOG_DIGEST_MAX_RAW_LINES = 2_000;
```

- [ ] **Step 2:** `pnpm typecheck` → PASS. **Commit** — `git commit -am "feat(config): log-digest platform constants (Ollama Cloud)"`

---

## Phase 3 — Schema + status display

### Task 7: `log_digests` table + `logDigestStatus` enum (platform-wide)

**Files:** Create `db/schema/log-digests.ts`; modify `db/schema/index.ts`

- [ ] **Step 1: Write `db/schema/log-digests.ts`** (NO spaceId — platform-wide; unique `digest_date`):

```ts
import { createId } from "@paralleldrive/cuid2"
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const logDigestStatus = pgEnum("log_digest_status", [
  "pending",
  "complete",
  "failed",
])

export const logDigests = pgTable(
  "log_digests",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    // one digest per UTC day — the idempotency key
    digestDate: date("digest_date").notNull(),
    status: logDigestStatus("status").notNull().default("pending"),
    model: text("model"),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    summary: text("summary"),
    // structured incidents (see lib/observability/digest-schema.ts DigestIncident)
    incidents: jsonb("incidents").$type<unknown[]>(),
    templateCount: integer("template_count").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    error: text("error"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("log_digests_digest_date_unique").on(t.digestDate),
    index("log_digests_created_at_idx").on(t.createdAt),
  ]
)
```

- [ ] **Step 2: Append the barrel export** to `db/schema/index.ts`: `export * from "@/db/schema/log-digests"`
- [ ] **Step 3: Generate the migration (DO NOT apply)** — `pnpm db:generate` → creates
  `db/migrations/0074_*.sql` + `meta/0074_snapshot.json` + a new `_journal.json` entry (idx 74,
  correct `Date.now()` `when`). **Never hand-edit these (Rule 6).** Skim the SQL: `CREATE TYPE
  "log_digest_status"`, `CREATE TABLE "log_digests"`, the unique + plain index — all additive (Rule 40).
- [ ] **Step 4: Commit** — `git add db/schema/log-digests.ts db/schema/index.ts db/migrations && git commit -m "feat(db): log_digests table + log_digest_status enum (migration 0074)"`

> `pnpm db:migrate` against prod is operator-run (Rule 60). The throwaway integration DB applies the full chain automatically.

### Task 8: status-display wiring (Rule 44)

**Files:** Modify `lib/status-display.ts`; extend `lib/status-display.test.ts`

- [ ] **Step 1:** Add `logDigestStatus` to the `@/db/schema` import block (alphabetical) in `lib/status-display.ts`.
- [ ] **Step 2:** Add the log-digest status section + UI-only severity scale:

```ts
// ─── Log digest ────────────────────────────────────────────────────────────
export type LogDigestStatus = (typeof logDigestStatus.enumValues)[number];
export const LOG_DIGEST_STATUS_OPTIONS = buildFilterOptions(
  logDigestStatus.enumValues
);
export function logDigestStatusVariant(s: LogDigestStatus): BadgeVariant {
  if (s === "complete") return "default";
  if (s === "failed") return "destructive";
  return "secondary"; // pending
}

// ─── Digest incident severity (UI-only — not a pgEnum) ───────────────────────
export const DIGEST_INCIDENT_SEVERITY_VALUES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type DigestIncidentSeverity =
  (typeof DIGEST_INCIDENT_SEVERITY_VALUES)[number];
export function digestIncidentSeverityVariant(
  s: DigestIncidentSeverity
): BadgeVariant {
  if (s === "critical" || s === "high") return "destructive";
  if (s === "medium") return "secondary";
  return "outline"; // low
}
export const DIGEST_INCIDENT_SEVERITY_CLASSES: Record<
  DigestIncidentSeverity,
  string
> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  high: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400",
};
```

- [ ] **Step 3:** `pnpm typecheck` → PASS (the `Record<DigestIncidentSeverity,…>` is the compile guard). **Commit** — `git commit -am "feat(status-display): log-digest status + incident severity (Rule 44)"`

---

## Phase 4 — `redact.ts` (PII redaction, TDD)

### Task 9: PII redaction

**Files:** Create `lib/observability/redact.ts`, `lib/observability/redact.test.ts`

- [ ] **Step 1: Write the failing test** (`lib/observability/redact.test.ts`):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { redactLine } from "@/lib/observability/redact";

test("masks email addresses", () => {
  assert.equal(redactLine("login from rohit.bhadani@debutify.com ok"),
    "login from <EMAIL> ok");
});
test("masks IPv4", () => {
  assert.equal(redactLine("conn from 198.18.0.42:5432"),
    "conn from <IPV4>:5432");
});
test("masks IPv6 (compressed + v4-mapped)", () => {
  assert.equal(redactLine("peer fd00::1 and ::ffff:1.2.3.4"),
    "peer <IPV6> and <IPV6>");
});
test("redacts bearer tokens and JWTs", () => {
  assert.equal(redactLine("Authorization: Bearer eyJhbG.payLOAD.sig123"),
    "Authorization: Bearer <REDACTED>");
});
test("redacts secret-like key=value", () => {
  assert.equal(redactLine('api_key="sk_live_abc123" done'),
    'api_key=<REDACTED> done');
});
test("leaves benign text untouched", () => {
  assert.equal(redactLine("cube cl59y73 booted in 1240ms"),
    "cube cl59y73 booted in 1240ms");
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test lib/observability/redact.test.ts` → "Cannot find module redact".
- [ ] **Step 3: Implement `lib/observability/redact.ts`**:

```ts
// Order matters: redact tokens/secrets BEFORE masking emails/IPs so a token
// containing an email-shaped substring is fully redacted first.
const PATTERNS: { re: RegExp; to: string }[] = [
  // Bearer / JWT
  { re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, to: "Bearer <REDACTED>" },
  { re: /\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/g, to: "<REDACTED>" },
  // secret-ish key=value / key: value
  {
    re: /\b(api[_-]?key|secret|token|password|passwd|authorization)\b\s*[:=]\s*"?[^\s"]+"?/gi,
    to: (m: string) => `${m.split(/[:=]/)[0].trim()}=<REDACTED>`,
  } as unknown as { re: RegExp; to: string },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: "<REDACTED>" },
  // email
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, to: "<EMAIL>" },
  // IPv6 (v4-mapped first, then general) — must precede IPv4
  { re: /::ffff:(?:\d{1,3}\.){3}\d{1,3}/gi, to: "<IPV6>" },
  { re: /\b(?:[A-Fa-f0-9]{0,4}:){2,7}[A-Fa-f0-9]{0,4}\b/g, to: "<IPV6>" },
  // IPv4
  { re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g, to: "<IPV4>" },
];

export function redactLine(line: string): string {
  let out = line;
  for (const { re, to } of PATTERNS) {
    out = typeof to === "function"
      ? out.replace(re, to as (m: string) => string)
      : out.replace(re, to);
  }
  return out;
}
```

> If the `key=value` callback typing is awkward, split it into its own named `replace` call in the function body instead of the array — keep it readable. The test pins the behavior; refactor freely as long as tests stay green.

- [ ] **Step 4: Run → PASS** — iterate the regexes until all 6 cases pass (IPv6 vs IPv4 ordering is the tricky one).
- [ ] **Step 5: Commit** — `git add lib/observability/redact.ts lib/observability/redact.test.ts && git commit -m "feat(observability): PII redaction for log lines (Rule 59)"`

---

## Phase 5 — `digest-schema.ts` (Zod schema + types, TDD)

### Task 10: Digest schema

**Files:** Create `lib/observability/digest-schema.ts`, `lib/observability/digest-schema.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DigestSchema, digestJsonSchema } from "@/lib/observability/digest-schema";

const valid = {
  summary: "2 recurring errors; worker replica 7 noisy.",
  incidents: [{
    service: "worker", severity: "high", title: "ECONNREFUSED to host",
    count: 42, sample: "Error: connect ECONNREFUSED", containerName: "krova_worker.7",
  }],
};

test("parses a valid digest", () => {
  assert.equal(DigestSchema.parse(valid).incidents[0].severity, "high");
});
test("rejects an unknown severity", () => {
  assert.throws(() => DigestSchema.parse({ ...valid,
    incidents: [{ ...valid.incidents[0], severity: "fatal" }] }));
});
test("emits a JSON schema with additionalProperties false", () => {
  const js = digestJsonSchema as Record<string, unknown>;
  assert.equal((js as any).additionalProperties, false);
  assert.ok((js as any).properties.incidents);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `lib/observability/digest-schema.ts`:**

```ts
import { z } from "zod";

export const DigestIncidentSchema = z.object({
  service: z.enum(["web", "worker"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string(),
  count: z.number().int(),
  sample: z.string(),
  containerName: z.string().optional(),
  firstSeen: z.string().optional(),
  lastSeen: z.string().optional(),
  spikeRatio: z.number().optional(),
});
export type DigestIncident = z.infer<typeof DigestIncidentSchema>;

export const DigestSchema = z.object({
  summary: z.string(),
  incidents: z.array(DigestIncidentSchema),
});
export type DigestResult = z.infer<typeof DigestSchema>;

// JSON Schema for the Ollama tool-call `parameters` (zod v4 native).
export const digestJsonSchema = z.toJSONSchema(DigestSchema, {
  target: "draft-2020-12",
});
```

- [ ] **Step 4: Run → PASS.** **Commit** — `git add lib/observability/digest-schema.* && git commit -m "feat(observability): digest Zod schema + JSON Schema (Rule 59)"`

---

## Phase 6 — `distill.ts` (mask → cluster → select → cap, TDD)

### Task 11: Distillation

**Files:** Create `lib/observability/distill.ts`, `lib/observability/distill.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { maskVariables, distill } from "@/lib/observability/distill";

test("maskVariables collapses numbers/uuids/hex into a stable template", () => {
  const a = maskVariables("cube cl59y73 booted in 1240ms");
  const b = maskVariables("cube ab12c34 booted in 88ms");
  assert.equal(a, b); // same template after masking
});

test("distill groups duplicates, counts, keeps samples, applies top-N", () => {
  const lines = [
    { service: "worker", containerName: "w.1", ts: "1", line: "Error connect ECONNREFUSED 198.18.0.1" },
    { service: "worker", containerName: "w.2", ts: "2", line: "Error connect ECONNREFUSED 198.18.0.9" },
    { service: "worker", containerName: "w.1", ts: "3", line: "timeout after 5000ms" },
  ];
  const out = distill(lines, { topN: 10, samplesPerTemplate: 2, maxChars: 100_000 });
  const econn = out.templates.find((t) => t.template.includes("ECONNREFUSED"));
  assert.equal(econn?.count, 2);
  assert.ok(econn!.samples.length <= 2);
  assert.equal(out.droppedCount, 0);
});

test("distill drops lowest-count templates past topN and reports drop", () => {
  const lines = Array.from({ length: 5 }, (_, i) =>
    ({ service: "web" as const, containerName: "web.1", ts: String(i), line: `unique error number ${i} xyz` }));
  // 5 distinct templates, topN=2 → 3 dropped
  const out = distill(lines, { topN: 2, samplesPerTemplate: 1, maxChars: 100_000 });
  assert.equal(out.templates.length, 2);
  assert.equal(out.droppedCount, 3);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `lib/observability/distill.ts`:**

```ts
import { redactLine } from "@/lib/observability/redact";

export interface RawLogLine {
  service: "web" | "worker";
  containerName: string;
  ts: string; // ns epoch string from Loki
  line: string;
}
export interface TemplateCluster {
  template: string;
  count: number;
  service: "web" | "worker";
  samples: string[];
  containerNames: string[];
  firstSeen: string;
  lastSeen: string;
}
export interface DistillOptions {
  topN: number;
  samplesPerTemplate: number;
  maxChars: number;
}
export interface DistilledPayload {
  templates: TemplateCluster[];
  droppedCount: number;
  totalLines: number;
}

// Replace high-cardinality variable tokens with placeholders so near-identical
// lines collapse to one template. Deterministic, dependency-free.
export function maskVariables(line: string): string {
  return line
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<HEX>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<HEX>")
    .replace(/\b\d+(\.\d+)?(ms|s|kb|mb|gb)?\b/gi, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();
}

export function distill(lines: RawLogLine[], opts: DistillOptions): DistilledPayload {
  const map = new Map<string, TemplateCluster>();
  for (const l of lines) {
    const redacted = redactLine(l.line);
    const template = maskVariables(redacted);
    const key = `${l.service} ${template}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      if (existing.samples.length < opts.samplesPerTemplate) existing.samples.push(redacted);
      if (!existing.containerNames.includes(l.containerName)) existing.containerNames.push(l.containerName);
      if (l.ts < existing.firstSeen) existing.firstSeen = l.ts;
      if (l.ts > existing.lastSeen) existing.lastSeen = l.ts;
    } else {
      map.set(key, {
        template, count: 1, service: l.service,
        samples: [redacted], containerNames: [l.containerName],
        firstSeen: l.ts, lastSeen: l.ts,
      });
    }
  }
  const sorted = [...map.values()].sort((a, b) => b.count - a.count);
  let kept = sorted.slice(0, opts.topN);
  const droppedByTopN = sorted.length - kept.length;

  // Enforce the char ceiling by trimming the lowest-count kept templates.
  let droppedByChars = 0;
  const size = (t: TemplateCluster) => t.template.length + t.samples.join("").length;
  while (kept.length > 0 && kept.reduce((s, t) => s + size(t), 0) > opts.maxChars) {
    kept = kept.slice(0, -1);
    droppedByChars++;
  }
  return { templates: kept, droppedCount: droppedByTopN + droppedByChars, totalLines: lines.length };
}
```

- [ ] **Step 4: Run → PASS.** Tune `maskVariables` ordering if `cl59y73` vs `ab12c34` don't collapse (add `.replace(/\b[a-z0-9]{6,}\b/gi, "<ID>")` AFTER the specific ones if needed). Keep iterating until green.
- [ ] **Step 5: Commit** — `git add lib/observability/distill.* && git commit -m "feat(observability): log distillation (mask/cluster/top-N/cap) (Rule 59)"`

---

## Phase 7 — `loki-client.ts` (query_range client, TDD)

### Task 12: Loki client

**Files:** Create `lib/observability/loki-client.ts`, `lib/observability/loki-client.test.ts`

- [ ] **Step 1: Write the failing test** (pure parsing/URL building; HTTP injected as a `fetch`-like fn → no network):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQueryRangeUrl, parseStreams, nextPageStartNs } from "@/lib/observability/loki-client";

test("buildQueryRangeUrl encodes query + since + limit + direction", () => {
  const u = new URL(buildQueryRangeUrl("https://loki.example/", {
    query: '{service="worker"} |~ "(?i)error"', startNs: "100", endNs: "200",
    limit: 500, direction: "forward",
  }));
  assert.equal(u.pathname, "/loki/api/v1/query_range");
  assert.equal(u.searchParams.get("limit"), "500");
  assert.equal(u.searchParams.get("direction"), "forward");
  assert.equal(u.searchParams.get("start"), "100");
});

test("parseStreams flattens stream values into RawLogLine[]", () => {
  const body = { status: "success", data: { resultType: "streams", result: [
    { stream: { service: "worker", container_name: "w.1" },
      values: [["170000000000000000", "boom"], ["170000000000000001", "bang"]] },
  ] } };
  const rows = parseStreams(body, "worker");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].containerName, "w.1");
  assert.equal(rows[1].line, "bang");
});

test("nextPageStartNs bumps the last timestamp by 1ns", () => {
  assert.equal(nextPageStartNs("170000000000000000"), "170000000000000001");
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `lib/observability/loki-client.ts`** — pure helpers (`buildQueryRangeUrl`,
  `parseStreams`, `parseMatrix`, `nextPageStartNs`) + an HTTP-driving `LokiClient` class that takes
  `{ baseUrl, user, password }` and uses global `fetch` with a Basic-Auth header,
  `AbortSignal.timeout(...)`, paging raw fetches by `nextPageStartNs` until a page returns
  `< limit`. `parseStreams(body, service)` maps each `[ns, line]` to
  `{ service, containerName: stream.container_name, ts: ns, line }`. Expose
  `fetchRawErrorLines(service, sinceHours, maxLines)` and `fetchSpikeRatio(service, sinceHours)`
  (two metric queries divided app-side). Read creds from `@/lib/env` at the call site (handler),
  passed into the constructor — not imported here, so the module stays pure + testable. (See the
  [Loki HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/) for param shapes.)
- [ ] **Step 4: Run → PASS.** **Commit** — `git add lib/observability/loki-client.* && git commit -m "feat(observability): Loki query_range client (Rule 59)"`

---

## Phase 8 — `ollama-digest.ts` (Ollama Cloud call, TDD)

### Task 13: Ollama digest call

**Files:** Create `lib/observability/ollama-digest.ts`, `lib/observability/ollama-digest.test.ts`

- [ ] **Step 1: Write the failing test** — inject the Ollama client so no network. (a) builds a
  tool-call request with the digest JSON schema + `temperature: 0`; (b) parses + Zod-validates the
  tool-call arguments; (c) retries once on invalid JSON, throws after the retry budget:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { runDigest } from "@/lib/observability/ollama-digest";

function fakeChat(responses: string[]) {
  let i = 0;
  return async () => ({
    message: { role: "assistant", tool_calls: [
      { function: { name: "emit_digest", arguments: JSON.parse(responses[i++]) } },
    ] },
    prompt_eval_count: 10, eval_count: 20,
  });
}

test("parses + validates a good tool-call response", async () => {
  const good = JSON.stringify({ summary: "ok", incidents: [] });
  const out = await runDigest({ prompt: "x", model: "gpt-oss:120b-cloud",
    chat: fakeChat([good]) as never });
  assert.equal(out.digest.summary, "ok");
  assert.equal(out.inputTokens, 10);
});

test("retries once on invalid shape then succeeds", async () => {
  const bad = JSON.stringify({ nope: true });
  const good = JSON.stringify({ summary: "ok2", incidents: [] });
  const out = await runDigest({ prompt: "x", model: "m", maxAttempts: 2,
    chat: fakeChat([bad, good]) as never });
  assert.equal(out.digest.summary, "ok2");
});

test("throws after exhausting retries", async () => {
  const bad = JSON.stringify({ nope: true });
  await assert.rejects(runDigest({ prompt: "x", model: "m", maxAttempts: 2,
    chat: fakeChat([bad, bad]) as never }));
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `lib/observability/ollama-digest.ts`:**

```ts
import { DigestSchema, type DigestResult, digestJsonSchema } from "@/lib/observability/digest-schema";

type ChatFn = (req: unknown) => Promise<{
  message: { tool_calls?: { function: { name: string; arguments: unknown } }[]; content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}>;

export interface RunDigestArgs {
  prompt: string;
  model: string;
  chat: ChatFn;          // injected (real one wraps the ollama client) — keeps this unit pure
  maxAttempts?: number;
}
export interface RunDigestResult {
  digest: DigestResult;
  inputTokens: number | null;
  outputTokens: number | null;
}

const TOOL = {
  type: "function",
  function: {
    name: "emit_digest",
    description: "Emit the structured log digest.",
    parameters: digestJsonSchema,
  },
};

export async function runDigest(args: RunDigestArgs): Promise<RunDigestResult> {
  const maxAttempts = args.maxAttempts ?? 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await args.chat({
      model: args.model,
      stream: false,
      options: { temperature: 0 },
      tools: [TOOL],
      messages: [
        { role: "system", content:
          "You are a log-triage analyst. Call emit_digest exactly once with a JSON object matching its schema. Group similar errors, rank severity, never invent data." },
        { role: "user", content: args.prompt },
      ],
    });
    const call = res.message.tool_calls?.find((t) => t.function.name === "emit_digest");
    const raw = call ? call.function.arguments : safeJson(res.message.content);
    const parsed = DigestSchema.safeParse(raw);
    if (parsed.success) {
      return {
        digest: parsed.data,
        inputTokens: res.prompt_eval_count ?? null,
        outputTokens: res.eval_count ?? null,
      };
    }
    lastErr = parsed.error;
  }
  throw new Error(`Ollama digest failed schema validation after ${maxAttempts} attempts: ${String(lastErr)}`);
}

function safeJson(s?: string): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
```

- [ ] **Step 4: Run → PASS.** **Commit** — `git add lib/observability/ollama-digest.* && git commit -m "feat(observability): Ollama Cloud digest call + validate/retry (Rule 59)"`

> The REAL `chat` (used by the handler) is a thin adapter:
> `const client = new Ollama({ host: OLLAMA_HOST, headers: { Authorization: \`Bearer ${env.OLLAMA_API_KEY}\` } }); const chat = (req) => client.chat(req as never);` — built in the handler (Task 15), never imported into this pure unit.

---

## Phase 9 — Email (component + template + text builder, TDD)

### Task 14: Log-digest email

**Files:** Create `lib/email/components/log-digest.tsx`, `lib/email/templates/log-digest.ts`, `lib/email/templates/log-digest.test.ts`

- [ ] **Step 1: Write the failing test** for the plaintext builder (pure, no render):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLogDigestText } from "@/lib/email/templates/log-digest";

test("text fallback lists summary + incidents", () => {
  const txt = buildLogDigestText({
    productName: "Krova", date: "June 4, 2026", summary: "1 issue",
    incidents: [{ service: "worker", severity: "high", title: "ECONN", count: 5, sample: "x" }],
  });
  assert.match(txt, /Krova log digest — June 4, 2026/);
  assert.match(txt, /HIGH.*worker.*ECONN/s);
});
test("text fallback handles no incidents", () => {
  const txt = buildLogDigestText({ productName: "Krova", date: "d", summary: "all clear", incidents: [] });
  assert.match(txt, /No incidents/);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `lib/email/components/log-digest.tsx`** (React Email; import from
  `"react-email"`, `EmailLayout`+`emailStyles` from `@/lib/email/components/layout`; props use
  `DigestIncident` from `@/lib/observability/digest-schema`; `<Fragment key>` on the incident map;
  **no `<LocalDate>`** — pass pre-formatted `date` string; severity tint inline). Export
  `LogDigestEmail` + `LogDigestEmailProps`.
- [ ] **Step 4: Implement `lib/email/templates/log-digest.ts`** — `buildLogDigestText(opts)` (pure,
  the tested fn) + `logDigestEmailTemplate(opts): Promise<{html,text}>` that `createElement`s the
  component, calls `renderEmailTemplate`, resolves branding via `getPlatformBranding()`, and returns
  `{ html, text: buildLogDigestText(...) }`. Mirror the existing security-digest template.
- [ ] **Step 5: Run → PASS.** **Commit** — `git add lib/email/components/log-digest.tsx lib/email/templates/log-digest.* && git commit -m "feat(email): log-digest template (Rule 10/25/59)"`

---

## Phase 10 — Worker handler + cron wiring (TDD)

### Task 15: The handler

**Files:** Create `lib/worker/handlers/log-digest-daily.ts`

- [ ] **Step 1: Implement the handler** — zero-arg `async (): Promise<void>`, plain
  `console.log("[log-digest-daily] …")` (NO JobLogger — system cron). Flow:
  1. **Inert guard:** if `!env.OLLAMA_API_KEY || !env.LOKI_QUERY_URL` → log "not configured, skipping" + `return`.
  2. **Idempotent claim:** compute `digestDate` (UTC `YYYY-MM-DD`).
     `insert(logDigests).values({ digestDate, status: "pending" }).onConflictDoNothing({ target: logDigests.digestDate })`.
     Re-select the row; if already `complete` → `return` (a sibling replica or earlier run finished it).
  3. **Preflight (Rule 58):** `windowEnd = now`, `windowStart = now - LOG_DIGEST_LOOKBACK_HOURS h`. Build `LokiClient` from env.
  4. **Query + distill:** for each service (`web`,`worker`): `fetchSpikeRatio` + `fetchRawErrorLines`
     (≤`LOG_DIGEST_MAX_RAW_LINES`); concat; `distill(lines, { topN: LOG_DIGEST_TOP_N, samplesPerTemplate:
     LOG_DIGEST_SAMPLES_PER_TEMPLATE, maxChars: LOG_DIGEST_MAX_INPUT_CHARS })`. If `droppedCount > 0`,
     `console.warn` the count (no silent truncation).
  5. **Build prompt** from the distilled templates + spike ratios (compact, schema-described).
  6. **Ollama:** `const client = new Ollama({ host: OLLAMA_HOST, headers: { Authorization: \`Bearer ${env.OLLAMA_API_KEY}\` } }); const { digest, inputTokens, outputTokens } = await runDigest({ prompt, model: LOG_DIGEST_MODEL, chat: (r) => client.chat(r as never) });`
  7. **Persist:** `update(logDigests).set({ status: "complete", summary, incidents, templateCount, inputTokens, outputTokens, model: LOG_DIGEST_MODEL, windowStart, windowEnd, generatedAt: now, updatedAt: now }).where(eq(logDigests.digestDate, digestDate))`.
  8. **Email (gated):** re-read the row; if `emailSentAt == null`: render `logDigestEmailTemplate`, `getErrorNotifyEmails()`, per-recipient `enqueueEmail` in try/catch, then set `emailSentAt = now`.
  9. **audit:** `audit({ action: "log_digest.generated", category: "system", entityType: "log_digest", entityId: row.id, description: …, metadata: { templateCount, droppedCount, inputTokens }, source: "worker" }).catch(() => {})`.
  10. **Failure path:** wrap the whole body in try/catch; on error set `status: "failed", error: msg.slice(0,1000), updatedAt: now` and `audit({ action: "log_digest.failed", category: "system", … }).catch(()=>{})`, then rethrow so pg-boss records the failure (retryLimit 1).

- [ ] **Step 2: Verify** `pnpm typecheck` → PASS.
- [ ] **Step 3: Commit** — `git add lib/worker/handlers/log-digest-daily.ts && git commit -m "feat(worker): log-digest-daily handler"`

### Task 16: Wire the cron (3 edits)

**Files:** Modify `lib/worker/job-types.ts`, `lib/worker/ensure-queues.ts`, `lib/worker/boss.ts`

- [ ] **Step 1: `job-types.ts`** — add to `JOB_NAMES` (before `} as const;`): `LOG_DIGEST_DAILY: "log-digest.daily",`
- [ ] **Step 2: `ensure-queues.ts`** — add to `QUEUE_OPTIONS` (Rule 56):

```ts
  // log-digest.daily (daily 07:00 UTC). Idempotent; safe to retry once. exclusive (cron).
  [JOB_NAMES.LOG_DIGEST_DAILY]: { retryLimit: 1, expireInSeconds: 600, policy: "exclusive" },
```

- [ ] **Step 3: `boss.ts`** — in the late cron-handler import block (~line 424):
  `const { handleLogDigestDaily } = await import("@/lib/worker/handlers/log-digest-daily");` ;
  register: `await boss.work(JOB_NAMES.LOG_DIGEST_DAILY, async () => { await handleLogDigestDaily(); });` ;
  schedule in the recurring block:
  `await boss.schedule(JOB_NAMES.LOG_DIGEST_DAILY, LOG_DIGEST_SCHEDULE_CRON); // daily 07:00 UTC — log digest`
  (import `LOG_DIGEST_SCHEDULE_CRON` from `@/config/platform`).
- [ ] **Step 4:** `pnpm typecheck` → PASS (Rule 56 guard satisfied). **Commit** — `git commit -am "feat(worker): schedule log-digest.daily cron (exclusive)"`

### Task 17: Integration test — idempotent claim + email gate

**Files:** Create `tests/integration/log-digest.test.ts`

- [ ] **Step 1: Write the test** (real `postgres:18` via the integration harness): insert a `pending`
  row for a date; assert a second `insert(...).onConflictDoNothing({ target: digestDate })` does NOT
  duplicate (count stays 1); flip to `complete` + set `emailSentAt`; assert the email-gate predicate
  (`emailSentAt != null`) prevents re-send; assert a `failed`→re-run can transition the row to
  `complete`. (Stub Ollama/Loki/email — DB only, per Rule 59.)
- [ ] **Step 2: Run → PASS** — `pnpm test:integration`. **Commit** — `git add tests/integration/log-digest.test.ts && git commit -m "test(integration): log_digests idempotency + email gate"`

---

## Phase 11 — Orbit UI (list + detail + nav)

### Task 18: Digests list page (client-side DataTable — low volume)

**Files:** Create `app/(orbit)/orbit/logs/page.tsx`, `app/(orbit)/orbit/logs/_components/log-digests-table.tsx`

- [ ] **Step 1: `page.tsx`** (server component, `export const dynamic = "force-dynamic"`): fetch up
  to 200 digests `db.select({...}).from(logDigests).orderBy(desc(logDigests.createdAt)).limit(200)`,
  map to plain props (incident count from `incidents` length), render `<PageHeader>` ("Log digests" /
  "AI-summarized daily platform log analysis. Newest first.") + `<LogDigestsTable digests={…} />`.
- [ ] **Step 2: `_components/log-digests-table.tsx`** (`"use client"`): `<DataTable>` (client
  pagination, no `pagination` prop) over the array; module-scope `logDigestColumns`: `digestDate`
  (Link to `/orbit/logs/${id}`), `status` (`<Badge variant={logDigestStatusVariant(s)}>`), incident
  count, `<LocalDate iso={createdAt} mode="relative" />`; `toolbarRight` = `<FilterDropdown
  label="Status" options={LOG_DIGEST_STATUS_OPTIONS} …>`. `<Fragment key>` only if a cell maps multiple elements.
- [ ] **Step 3:** `pnpm typecheck` → PASS. **Commit** — `git commit -am "feat(orbit): log digests list page"`

### Task 19: Digest detail page

**Files:** Create `app/(orbit)/orbit/logs/[id]/page.tsx`

- [ ] **Step 1:** Server component (`params: Promise<{ id: string }>`, `await params`, `notFound()`
  if missing). Header = breadcrumb + `flex flex-wrap items-center gap-3` h1 (`Digest {digestDate}`) +
  `<Badge variant={logDigestStatusVariant(status)}>`. A `<Card>` with the summary + window + token
  counts (via `<LocalDate>`), then the incidents: map `incidents` (cast to `DigestIncident[]`) to rows
  showing `<Badge variant={digestIncidentSeverityVariant(severity)}>`, service, title, count,
  container, and the `sample` in a `<pre>`. Use `<Fragment key={…}>`.
- [ ] **Step 2:** `pnpm typecheck` → PASS. **Commit** — `git commit -am "feat(orbit): log digest detail page"`

### Task 20: Sidebar nav

**Files:** Modify `components/orbit/orbit-shell.tsx`

- [ ] **Step 1:** Add a Phosphor icon import (e.g. `ListMagnifyingGlassIcon`) and append to
  `managementItems`: `{ label: "Log Digests", href: "/orbit/logs", icon: ListMagnifyingGlassIcon }`.
  `isActive` via `startsWith` keeps it lit on the detail route.
- [ ] **Step 2:** `pnpm typecheck` + `pnpm lint` → PASS. **Commit** — `git commit -am "feat(orbit): nav entry for log digests"`

---

## Phase 12 — Docs (Rule 22)

### Task 21: Architecture doc + CLAUDE.md index

**Files:** Create `docs/architecture/log-aggregation.md`; modify `CLAUDE.md`, `docs/architecture/README.md`

- [ ] **Step 1:** Write `docs/architecture/log-aggregation.md` — the two halves, the
  Loki/Alloy/Grafana stack (operator-deployed), the `observability/` files, the daily digest
  pipeline (Loki→distill→Ollama Cloud→`log_digests`→email/Orbit), the env/config, and the operator
  runbook pointer.
- [ ] **Step 2:** Add a one-line bullet to the Architecture map in `CLAUDE.md` + a row in
  `docs/architecture/README.md`. Add `OLLAMA_API_KEY`/`LOKI_*` to any env documentation if present.
- [ ] **Step 3: Commit** — `git add docs CLAUDE.md && git commit -m "docs: log-aggregation subsystem (Rule 22)"`

---

## Phase 13 — Final verification (Rule 59)

### Task 22: The single gate

- [ ] **Step 1:** `pnpm lint` → clean (or `pnpm lint:fix`).
- [ ] **Step 2:** `pnpm typecheck` → 0 errors.
- [ ] **Step 3:** `pnpm test` → all unit green (redact, digest-schema, distill, loki-client, ollama-digest, log-digest text, status-display).
- [ ] **Step 4:** `pnpm test:all` → unit + migrations (0074 in chain) + integration (log_digests idempotency) all green.
- [ ] **Step 5:** `pnpm build` → succeeds (confirms the `QUEUE_OPTIONS` Rule-56 guard + RSC boundaries).
- [ ] **Step 6:** Final review against Part IV. **Commit** any lint fixes. The feature is "done" only when `pnpm test:all` is green (Rule 59).

---
---

## Part III — Operator Deployment Runbook (Rule 60 — agent prepares, operator runs)

1. Create a new **S3 bucket** for Loki chunks (lifecycle ≥ 720h or disabled); note endpoint/region/keys.
2. Mint an **Ollama Cloud API key** at [ollama.com/settings/keys](https://ollama.com/settings/keys)
   (Free tier to start; Pro $20/mo if the session quota throttles the daily run).
3. Drop `observability/` into a repo Dokploy can reach; create a **Dokploy Compose app** pointing at
   `observability/compose.yml`; set its env (S3 creds, Basic Auth creds, Grafana admin).
4. **Verify Loki config** on the pinned image:
   `loki -config.file=loki-config.yaml -verify-config` (settle the `bucketnames` vs `bucket_names` field).
5. Add the **Caddy vhosts** (basic-auth + TLS for Loki query + Grafana; `/ready` open); reload Caddy.
6. Confirm Alloy is tailing: check `service`/`container_name` labels appear in Grafana for both `web` and `worker`.
7. Apply the **worker-stack.yml** changes (replicas 10, stop-first parallelism 0) in Dokploy Swarm Settings.
8. Set the app env (`OLLAMA_API_KEY`, `LOKI_QUERY_URL`, `LOKI_BASIC_AUTH_*`) and populate
   `ERROR_NOTIFY_EMAILS`; deploy the worker (the migration runs at boot).
9. After 24h of ingest, confirm the first 07:00 UTC digest email + the `/orbit/logs` row.

> **Privacy note for the operator:** Ollama Cloud states "never logged or trained on … zero data
> retention" but **may route to US/EU/Singapore**. PII redaction-before-send is the real control;
> treat the no-retention claim as secondary. There is no published "GA" — it's a live paid service
> that originated as a preview.

---
---

## Part IV — Testing & Rules Compliance

## Testing (Rule 59 — `pnpm test:all` green before "done")

**Tier-1 unit (`lib/**/*.test.ts`, no DB/host/network):**
- `redact.test.ts` — email/IPv4/**IPv6 (full/compressed/v4-mapped)**/Bearer/JWT/secret patterns; mask-vs-redact; no false-positives on benign text.
- `distill.test.ts` — template mining collapses near-dup lines; top-N selection; net-new detection vs a prior set; hard token-cap drops lowest-count + reports the drop (no silent truncation).
- `loki-client.test.ts` — query_range URL/param building; ns-timestamp paging cursor (last-ts+1ns); streams-vs-matrix parsing. (HTTP stubbed.)
- `digest-schema.test.ts` — `z.toJSONSchema` shape; Zod parse accepts valid / rejects malformed digest.
- `ollama-digest.test.ts` — request shape (model, temp 0, tool schema); Zod-validate-then-retry on bad JSON; empty/whitespace response handled. (Ollama client stubbed — no network.)
- `log-digest` email text builder; status-display derivation for the new enum.

**Integration (`tests/integration/`, real `postgres:18`):**
- `log-digests` UNIQUE `digest_date` claim-first idempotency: a second run for the same date does not duplicate; `email_sent_at` gate prevents re-send; `failed` → re-run transitions to `complete`.

**Migration smoke** (`pnpm test:migrations`) covers migration 0074 in the chain.

Email, Ollama Cloud, Loki HTTP, and S3 are all **stubbed/assumed** — only the DB is real (Rule 59).
Back the load-bearing comments ("idempotent on retry", "no silent truncation", "redaction before
send") with tests.

## Rules touched (compliance checklist)

1 (worker-only infra) · 4 (ORM-only) · 5 (env in lib/env.ts) · 6 (db:generate migration) · 7
(idempotent handler) · 9 (audit row) · 10 (React Email) · 13 (`<Fragment key>`) · 14 (shared logic
in lib/, no dup) · 22 (update CLAUDE.md + docs/architecture) · 23 (no file data in DB) · 25 (UTC +
`<LocalDate>` / `formatEmailDateUtc`) · 30 (config in platform.ts) · 40 (additive non-locking
migration) · 44 (status-display single source) · 56 (explicit QUEUE_OPTIONS) · 58 (preflight) · 59
(tests) · 60 (operator runs live infra).

## Self-review notes

- **Spec coverage:** Half A (Loki/Alloy/Grafana/Caddy) → Phase 1; worker-stack → Phase 0;
  deps/env/config → Phase 2; schema+status → Phase 3; redact/schema/distill/loki/ollama → Phases
  4–8; email → Phase 9; handler+cron+integration → Phase 10; Orbit → Phase 11; docs → Phase 12;
  gate → Phase 13. PII redaction-before-send (§5.4) enforced inside `distill` (every line redacted
  before clustering). Idempotency via unique `digest_date` (§5.2). No-silent-truncation (§5.4) →
  `droppedCount` + `console.warn`.
- **Type consistency:** `DigestResult`/`DigestIncident` (digest-schema) flow into `ollama-digest`
  (return), the handler (persist `incidents`), the email component, and the Orbit detail page.
  `RawLogLine` is produced by `loki-client.parseStreams` and consumed by `distill`.
  `logDigestStatusVariant`/`digestIncidentSeverityVariant` are the only badge mappers (Rule 44).
- **Deviation flags:** logpare dropped for a self-contained distiller; `log_digests` platform-wide
  (no spaceId); Orbit list is client-side. All surfaced in §9.

---
---

## Part V — Companion Workstream (B): Durable Instrumentation, Orbit Timeline, Alerting, Per-Cube Metrics & SSH Keepalive

> Folded in from the former standalone `docs/plans/observability-and-alerting.md` (merged
> 2026-06-04, that file deleted). Same production-safety rules as Workstream A (Rule 6
> `db:generate`, Rule 40 additive/idempotent DDL, Rule 59 tests-green, Rule 60 operator-applies).
> PLAN — nothing implemented.

This is the **app/DB-side** observability that complements the Loki log pipeline above.
Workstream A ships container stdout to Loki + an AI digest; Workstream B makes the
control-plane's own decisions durable + queryable, surfaces them in Orbit, alerts on them, and
charts per-cube metrics.

### B · Why this exists

Diagnosing the 2026-06-04 incident required stitching together the host journal, `job_logs`,
`audit_logs`, `lifecycle_logs`, and `pgboss.job` by hand — because the worker's load-bearing
decisions live only in `console.log` (ephemeral stdout), and there is no unified per-cube /
per-server timeline, no alerting, and no metric history. The incident itself turned out benign
(operator maintenance reboots + a customer's own cube-churn + a client-side SSH drop), but it took
an hour to prove that. This workstream makes the next one take five minutes.

### Phase B0 — Operator turn-on (no code; do now)

Infra/config actions, not code — the cheapest, highest-leverage wins.

1. **Persist + ship the worker (pg-boss) container logs.** This is where every cron "why" currently
   lives (`cube-state-sync.ts` host-reboot/relaunch/mismatch decisions are `console.log`). At minimum
   a bounded `json-file` log driver with rotation; ideally piped to the Workstream-A Loki stack once
   it lands.
2. **Host journald persistent + sized** on mango/banana: `Storage=persistent`, a generous
   `SystemMaxUse=`. (Boot history was intact, so likely already on — confirm retention.)
3. **Guest journald** already creates `/var/log/journal` in the rootfs; confirm a `SystemMaxUse=` cap
   so a chatty deploy can't evict the evidence.
4. **Know the look-back windows:** `job_logs` = 30d info / 90d error / 5000-row cap per entity
   ([job-logs-prune.ts](../../../lib/worker/handlers/job-logs-prune.ts)). Bump if you need longer.
   Populate **`ERROR_NOTIFY_EMAILS`** ([config/platform.ts:244](../../../config/platform.ts#L244)) —
   it's the alert channel and is currently `[]`.

### Phase B1 — Durable instrumentation (the data foundation)

Goal: every control-plane decision becomes a queryable row, not a stdout line. Phases B2 and B3
consume these rows.

**Tasks**
1. **`server.reboot_detected` audit row** at [cube-state-sync.ts:172](../../../lib/worker/handlers/cube-state-sync.ts#L172)
   (today only `console.log`). `audit({ action: "server.reboot_detected", category: "server",
   entityType: "server", entityId: serverId, source: "worker", metadata: { oldBootId, newBootId,
   runningCubeCount } })`. → host reboots + blast radius become one query, and the alert hook (Phase B3)
   lands here.
2. **Uniform `cube.cold_boot` audit at the launch layer.** Thread a `launchReason` (`"provision" |
   "snapshot_restore" | "backup_redeploy" | "from_snapshot" | "import" | "auto_relaunch" |
   "error_recovery" | "reboot_recovery" | "wake" | "cold_restart" | "resize" | "transfer"`) into
   `createCube`/`startCube` ([firecracker.ts](../../../lib/ssh/firecracker.ts) InstanceStart at ~885 /
   ~1249) and emit one audit row at boot with `{ reason, tapDevice, internalIp, kernelVersion }`. →
   answers "why did this cube boot, on which tap" without cross-referencing. (Decision: thread a param
   vs write at each caller — recommend the param so it's impossible to forget a caller.)
3. **Promote load-bearing `console.log`s to durable rows** in `cube-state-sync.ts` (guest-reboot
   relaunch ~348, mismatch ~394/446/473) and `cube-reachability.ts` — `audit()` (terminal decisions)
   or `JobLogger` (handler steps).
4. **Quiet the reachability SSH-probe noise.** The L2 `/dev/tcp` probe makes every guest's `sshd` log
   `Connection closed by 198.18.1.1` once a minute, burying real sessions. Prefer the existing
   **guest-agent vsock ping** (L1) for liveness and only fall back to the SSH port probe when the agent
   is down. → guest `sshd` logs become usable for session forensics.

**Migrations:** none expected — `audit_logs.action` is free-text and `metadata` is `jsonb`; reuse
existing `audit_category` values (`server`, `cube`). Confirm the enum at impl time; if a value is
missing it's a `pgEnum` change via `db:generate`.
**Tests (Rule 59):** unit on the `launchReason` plumbing + audit payload shape; integration asserting
a reboot-detect and a cold-boot write the expected row.
**Risk:** `audit()` is fire-and-forget but must never throw on the hot path — wrap call sites in a
swallow. Low.

### Phase B2 — Unified Orbit timeline (consumes B1)

Goal: one merged, time-ordered, server-paginated feed per cube AND per server.

**Tasks**
1. `lib/observability/timeline.ts`: a query that merges `job_logs` + `audit_logs` + `lifecycle_logs`
   (optionally reachability events) for an entity into a normalized shape `{ ts, source, level, actor,
   message, metadata }`, keyset-paginated by `(created_at, id)`. (Note: `lib/observability/` is shared
   with Workstream A's modules — no conflict.)
2. Add an **"Activity" tab** to the Orbit cube-detail and server-detail pages
   (`components/orbit/*-detail.tsx`) via [useTabParam](../../../hooks/use-tab-param.ts).
3. A read-only server action / API route returns one page; reuse
   [data-table.tsx](../../../components/ui/data-table.tsx) in **server-pagination** mode (honor the
   Rule 49.10 page-size contract) and color rows via [status-display.ts](../../../lib/status-display.ts).

**Migrations:** none for reads; add covering indexes on `(entity_id, created_at)` where missing
(`audit_logs` already indexes `created_at`/`category`).
**Tests:** unit on merge/ordering/pagination; integration over seeded rows across all three tables.
**Risk:** query cost on large tables → indexes + `LIMIT` + keyset paging. Low–med.

### Phase B3 — Alerting (consumes B1)

Goal: get told *before* a customer reports it.

**Conditions & where they're detected**
1. **Host reboot** → hook the new `server.reboot_detected` (B1).
2. **Relaunch storm** → count `cube.cold_boot{reason:"reboot_recovery"}` (or `reboot_recovered`) in a
   rolling hour > threshold.
3. **Reachability failure** → N consecutive L1/L2/L3 fails for a cube (read `cubes.reachabilityJsonb`);
   extend the reachability cron or a small new cron.
4. **Cube stuck** in `pending|booting|stopping` >10 min →
   [cube-stale-check.ts](../../../lib/worker/handlers/cube-stale-check.ts) already detects this; emit
   an alert there (don't duplicate detection).

**Delivery & dedup**
- Email to `ERROR_NOTIFY_EMAILS` (reuse the existing admin-email path) + optional outbound webhook
  ([lib/webhook-events.ts](../../../lib/webhook-events.ts)) + an Orbit alerts surface.
- New `alerts` table for **fire-once-until-cleared** flap protection (`id, type, entityId, firedAt,
  clearedAt, state, metadata`).
- New `JOB_NAMES` get an explicit `QUEUE_OPTIONS` entry (Rule 56); any recurring queue is
  `policy:"exclusive"`.

**Migrations:** new `alerts` table (additive) via `db:generate`.
**Tests:** threshold detection, fire-once dedup, delivery (stubbed email/webhook).
**Risk:** alert spam if dedup is wrong → the fire-once-until-cleared table is the guard. Med.

### Phase B4 — Per-cube metrics time-series (independent; heaviest write-load)

Goal: chart load/CPU/mem/disk per cube over time. Reachability already collects a `CubeMetricsSnapshot`
into `cubes.lastMetricsJsonb` every minute — we just persist history.

**Tasks**
1. New append-only `cube_metrics` table: `(cubeId, ts, load1, cpuPct, memUsedMb, memTotalMb, diskUsedGb,
   diskTotalGb)`, index `(cubeId, ts)`.
2. The reachability cron writes **one batched multi-row insert per tick** (not per-cube) from the
   snapshot it already has.
3. A retention prune cron: raw N days, then delete (or downsample). Sizing: ~89 cubes × 1440/day ≈
   **128k rows/day** → 14d ≈ ~1.8M rows.
4. A **"Metrics" tab** on cube-detail reading a time range (SWR + a server endpoint).

**Migrations:** new `cube_metrics` table + a retention cron (`QUEUE_OPTIONS` + `boss.schedule`).
**Tests:** batch-insert shape, retention-prune bounds (idempotent/bounded), range query.
**Risk: HIGHEST** — per-minute write volume + table growth on the live DB. Mitigations: single batched
insert/tick, aggressive retention, the `(cubeId, ts)` index, ship behind a feature flag, start with a
short retention window and watch DB load. Do this phase **last**, and revisit whether the time-series
belongs in the metrics/Loki store (Workstream A) once that lands.

### Phase B5 — SSH keepalive hardening (independent; from the session-drop investigation)

Confirmed mechanism: the host **masquerades** customer SSH (cube sees `198.18.1.1`) and the host
conntrack established-timeout is the kernel default **5 days** — so the host is *not* the reaper; an idle
session with no keepalives was dropped by an **upstream NAT**. Fix at the right layer (guest sshd +
client), three tiers:

1. **Customer guidance** (doc): run long jobs under `tmux`/`nohup`/`systemd-run`; client
   `ServerAliveInterval 30`.
2. **Existing-cube fleet retrofit** — `lib/ssh/sshd-keepalive-retrofit.ts` +
   `scripts/install-sshd-keepalive-fleet.ts`, mirroring
   [install-guest-network-fleet.ts](../../../scripts/install-guest-network-fleet.ts): write an
   `/etc/ssh/sshd_config.d/10-krova-keepalive.conf` drop-in (`ClientAliveInterval 30`,
   `ClientAliveCountMax 6`) + `systemctl reload ssh` (**reload preserves active sessions**). Additive,
   idempotent, **no rootfs rebuild**, no dropped connections. `pnpm install:sshd-keepalive`. Operator
   runs it (Rule 60).
3. **New cubes** — add the same keepalive to the rootfs `sshd` default in
   [build-all-images.sh](../../../setup/images/build-all-images.sh) (mind Rule 39 heredoc quoting;
   `bash -n` after).

### B · Sequencing

```text
Phase B0 (ops, now)
   └─> Phase B1 (instrumentation — foundation)
          ├─> Phase B2 (timeline)      ┐ both consume B1; can run in parallel
          └─> Phase B3 (alerting)      ┘
   Phase B4 (metrics)  — independent, heaviest; do last, feature-flagged
   Phase B5 (SSH keepalive) — independent; can land anytime
```

Instrumentation (B1) is first because the timeline and alerting both read the rows it creates. Metrics
(B4) is independent but the riskiest write-load, so it goes last behind a flag. SSH keepalive (B5) is
orthogonal and can land whenever. (The cross-cutting rules + test gate in Part IV apply to this
workstream too.)

### B · Open decisions (needed before coding)

1. **Alert channels** — email to `ERROR_NOTIFY_EMAILS` only, or also outbound webhook and/or an Orbit banner?
2. **Relaunch-storm threshold** — absolute (e.g. >10 recovered/hour) or relative (> fleet/3)?
3. **Reachability-failure alert** — how many consecutive failed ticks before firing (e.g. 3 = ~3 min)?
4. **Metrics retention** — raw window (7 / 14 / 30 days), and downsample-then-keep vs hard-delete?
5. **Timeline scope** — include the once-a-minute reachability ticks, or only lifecycle/audit/job events (less noise)?

---
---

## Part VI — References & Research Log

> Verified against vendor docs on **2026-06-04**. Pin versions; re-verify on every touch
> (third-party-integration rule).

### Grafana Loki (log store, retention, query API)
- [Retention configuration](https://grafana.com/docs/loki/latest/operations/storage/retention/) — `retention_enabled`, **`delete_request_store` required when retention enabled**, `limits_config.retention_period`, 24h minimum.
- [HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/) — `/loki/api/v1/query_range`, `limit`/`start`/`end` ns-epoch params.
- [LogQL log queries](https://grafana.com/docs/loki/latest/query/log_queries/) — `detected_level` auto-detected since Loki 3.1.
- [Storage / TSDB](https://grafana.com/docs/loki/latest/operations/storage/) — schema v13, S3 backend (`s3forcepathstyle`).
- Loki Docker driver deadlock / `docker logs` breakage — grafana/loki [#2017](https://github.com/grafana/loki/issues/2017), [#2361](https://github.com/grafana/loki/issues/2361).

### Grafana Alloy (the shipper) + Promtail EOL
- [`loki.source.docker` component reference](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.docker/)
- [Monitor Docker containers with Alloy](https://grafana.com/docs/alloy/latest/monitor/monitor-docker-containers/) — discovery.docker + relabel + loki.source.docker.
- [Send logs to Loki tutorial](https://grafana.com/docs/alloy/latest/tutorials/send-logs-to-loki/)
- **Promtail End-of-Life (March 2, 2026) → migrate to Alloy** — [announcement](https://community.grafana.com/t/promtail-end-of-life-eol-march-2026-how-to-migrate-to-grafana-alloy-for-existing-loki-server-deployments/159636), [Docker-users variant](https://community.grafana.com/t/promtail-is-now-end-of-life-eol-how-to-migrate-to-grafana-alloy-for-existing-loki-server-deployments/162087), [Promtail docs (deprecated)](https://grafana.com/docs/loki/latest/send-data/promtail/).

### Ollama Cloud (LLM backend)
- [Cloud docs](https://docs.ollama.com/cloud) — host `https://ollama.com`, `Authorization: Bearer $OLLAMA_API_KEY`.
- [Structured outputs](https://docs.ollama.com/capabilities/structured-outputs) — **"Ollama's Cloud currently does not support structured outputs"** (verbatim; use tool-calling + temp 0 + Zod-validate).
- [API keys](https://ollama.com/settings/keys)
- [Cloud model catalog](https://ollama.com/search?c=cloud) — `gpt-oss:120b-cloud`, `qwen3-coder:480b-cloud`.
- [`ollama` JS/TS client (npm)](https://www.npmjs.com/package/ollama) — `new Ollama({ host, headers })`, `chat` with `tools`.

### Zod (schema → JSON Schema for the tool-call)
- [`z.toJSONSchema`](https://zod.dev/json-schema) — native in Zod v4 (`{ target: "draft-2020-12" }`); replaces `zod-to-json-schema`. [v4 notes](https://zod.dev/v4).

### Log template mining (future-upgrade path; not a v1 dep)
- [`logpare`](https://github.com/logpare/logpare) — Drain-based semantic log compression for LLM context (60–90% token reduction).
- [Drain3](https://github.com/logpai/Drain3) — reference algorithm.

### Dokploy (deploy substrate — gap that motivates self-hosting the stack)
- [Log drains feature request (open)](https://github.com/Dokploy/dokploy/issues/2748)
- [Configure Docker log drivers per-app (open)](https://github.com/Dokploy/dokploy/issues/3132)

### Research log (one-line fact summary, 2026-06-04)
Loki **3.7.2** monolithic, TSDB+v13, `s3forcepathstyle: true`; compactor retention needs
`retention_enabled:true` + `delete_request_store:s3` + `retention_period:720h`; index `period:24h`.
Promtail **EOL 2026-03-02** → **Alloy v1.16.2**, global mode, `discovery.docker` + `loki.source.docker`
over RO socket; Loki Docker driver can deadlock dockerd / breaks `docker logs`. Dokploy v0.29.x: no
log drains / per-app driver (#2748, #3132) → deploy own stack as Compose. **Ollama Cloud** host
`https://ollama.com`, native `/api/chat`, `Authorization: Bearer OLLAMA_API_KEY`; subscription pricing
(Free / Pro $20 / Max $100, GPU-time + session quotas, numbers opaque); "never logged or trained on";
**Cloud does not support structured outputs** → tool-calling + temp 0 + Zod-validate. `ollama@0.6.3`;
`zod@4.4.3` native `z.toJSONSchema`; `zod-to-json-schema` unmaintained. `logpare` (Drain, 60–90% token
cut) is a future upgrade — v1 ships a dependency-free distiller. Loki `detected_level` auto-detect on
by default since 3.1; `/loki/api/v1/query_range` paged by ns-timestamp.
