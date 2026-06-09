# Cube IPv6 — Phase 5: Address visibility (Orbit-admin-only)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Make `internal_ip` + `internal_ipv6` Orbit-admin-only (operator decision 6): remove `internalIp` from the customer webhook payload + v1 API surface, fix the pre-existing openapi mismatch, and add `internal_ipv6` only to the Orbit admin display surfaces.

**Architecture:** `buildCubeSummary` (webhooks + v1 create response) drops `internalIp`. The v1 read serializer (`formatCube`) already omits it. The Orbit cube detail + list selects gain `internal_ipv6` and render it in the existing `orbit`-gated rows. No customer surface exposes either address. Confirmed safe to drop — no customers consume internal IP (operator confirmation).

**Tech Stack:** TypeScript, React (Orbit pages/components), OpenAPI JSON.

**Spec:** Address visibility § (decision 6 / M7 / N-H2). **Depends on:** Phase 2 (`internal_ipv6` column exists).

> **Concurrent-edit note:** the Orbit cube pages + cube components were touched by concurrent commits — read live; line numbers below are from a HEAD re-check but confirm before editing.

---

## File structure

- **Modify** `lib/webhook-payloads.ts` — remove `internalIp` from `CubeSummary` + the `Pick` + the return (customer-facing).
- **Modify** `app/api/v1/openapi.json/route.ts` — drop the documented `internalIp`; rename the documented `publicIp` → `publicIpv4` to match what `formatCube` actually returns (pre-existing lie).
- **Modify** `docs/api/v1.md` — remove the `"internalIp": "10.0.0.2"` example line (Rule 22).
- **Modify** `lib/cube-actions/cube-list-create.ts` — add `internalIpv6` to the Pick union + the select (admin-consumed).
- **Modify** `components/cube-detail-shell.tsx` — add `internalIpv6` to the cube type + pass-through.
- **Modify** `components/cube-detail-sidebar.tsx` — add an `orbit`-gated "Internal IPv6" `DetailRow` next to the existing Internal IP row.
- **Modify** `app/(orbit)/orbit/cubes/[cubeId]/page.tsx` — add `internalIpv6` to the select + a display row.

---

## Task 1: Remove `internalIp` from the customer webhook + v1 surface

**Files:** Modify `lib/webhook-payloads.ts`.

- [ ] **Step 1: Remove the three references** (read live; the shape is):
  - In `interface CubeSummary` delete the line `internalIp: string | null;`.
  - In the `Pick<Cube, …>` delete `| "internalIp"`.
  - In the returned object delete `internalIp: cube.internalIp,`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — `buildCubeSummary` callers pass a cube that still HAS `internalIp` (harmless extra field; `Pick` no longer requires it). If any caller destructured `summary.internalIp`, the typecheck flags it — grep `\.internalIp` on webhook consumers and remove. Expected: none (webhook consumers treat the payload opaquely).

- [ ] **Step 3: Commit**

```bash
git add lib/webhook-payloads.ts
git commit -m "feat(webhooks): drop internalIp from cube summary (admin-only; no customer consumers)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fix the openapi schema + v1 docs

**Files:** Modify `app/api/v1/openapi.json/route.ts`, `docs/api/v1.md`.

- [ ] **Step 1: openapi** — at the cube schema (≈line 76): remove the `internalIp: { type: "string", nullable: true },` property. If a `publicIp` property is documented but the response returns `publicIpv4` (verify against `lib/api/v1-cube-format.ts`), rename the documented property to `publicIpv4` so the schema matches the actual response. Do NOT add `internalIpv6`.

- [ ] **Step 2: docs/api/v1.md** — find the webhook/cube example containing `"internalIp": "10.0.0.2"` (≈line 453) and remove that line so the documented payload matches the new `CubeSummary`.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/openapi.json/route.ts docs/api/v1.md
git commit -m "docs(v1): drop internalIp from openapi + example; fix publicIp->publicIpv4 schema mismatch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add `internalIpv6` to Orbit display surfaces

**Files:** Modify `lib/cube-actions/cube-list-create.ts`, `components/cube-detail-shell.tsx`, `components/cube-detail-sidebar.tsx`, `app/(orbit)/orbit/cubes/[cubeId]/page.tsx`.

- [ ] **Step 1: `lib/cube-actions/cube-list-create.ts`** — add `| "internalIpv6"` to the column Pick union (≈line 34) and `internalIpv6: schema.cubes.internalIpv6,` to the select (≈line 113).

- [ ] **Step 2: `components/cube-detail-shell.tsx`** — add `internalIpv6: string | null;` to the cube type (≈line 34) and include `cube.internalIpv6` wherever `cube.internalIp` is passed down (≈line 112).

- [ ] **Step 3: `components/cube-detail-sidebar.tsx`** — add `internalIpv6: string | null;` to the cube type (≈line 15) and, right after the existing orbit-gated Internal IP row (≈lines 138-139), add:

```tsx
{orbit && cube.internalIpv6 && (
  <DetailRow label="Internal IPv6" mono value={cube.internalIpv6} />
)}
```

- [ ] **Step 4: `app/(orbit)/orbit/cubes/[cubeId]/page.tsx`** — add `internalIpv6: schema.cubes.internalIpv6,` to the select (≈line 64) and a display row next to the internal-IP render (≈line 553), e.g.:

```tsx
<DetailRow label="Internal IPv6" value={row.internalIpv6 ?? "—"} />
```

(match the existing row component/markup used at line 553).

- [ ] **Step 5: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/cube-actions/cube-list-create.ts components/cube-detail-shell.tsx components/cube-detail-sidebar.tsx "app/(orbit)/orbit/cubes/[cubeId]/page.tsx"
git commit -m "feat(orbit): show internal_ipv6 on admin cube surfaces (parity with internal_ip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 verification gate

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` → PASS.
- [ ] Grep `internalIp` across `lib/webhook-payloads.ts` → gone; across customer-facing v1 read/openapi → no `internalIp`/`internalIpv6`.
- [ ] `internalIpv6` appears ONLY in Orbit selects/components + the (admin) cube-detail data path — never in `buildCubeSummary` or the v1 customer schema.

## Self-review (against spec)

- Remove `internalIp` from `buildCubeSummary` + v1 + openapi (decision 6 / N-H2 / M7) → Tasks 1, 2. ✓
- Fix the pre-existing `publicIp`→`publicIpv4` openapi lie (M7) → Task 2. ✓
- Add `internal_ipv6` to Orbit-only surfaces (cube-list-create, cube-detail-shell/sidebar, orbit page) → Task 3. ✓
- `docs/api/v1.md` example fixed (Rule 22) → Task 2. ✓
- No placeholders; exact files/lines (verified at HEAD); types consistent.
