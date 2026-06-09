# Suggestions — Reddit feedback (2026-05-29)

Captured from a technical commenter on the r/SideProject launch post. They run their
own side project on Terraform + Ansible and were "more interested in the hardware and
design choices." High-signal feedback — worth acting on.

## Action items

### 1. "$0/forever" plan label was misleading — DONE
- **Problem:** The Trial plan rendered as `$0/forever`, which reads as "free compute
  forever" rather than "free plan, pay for usage."
- **Fix shipped:** `app/(landing)/page.tsx` `PlanTierCard` now shows `$0/mo` with the
  subtext `$5 free starter credit, then pay-as-you-go`.
- **Status:** Complete. Consider auditing other surfaces (plan-selection sheet, FAQ,
  billing page) for the same "free forever" phrasing if it appears.

### 2. Terraform provider — build one
- **Why it matters:** This was the commenter's answer to "does a solo-founder infra
  product feel like a dealbreaker?" — the mitigation is **portability, not trust**. If
  a user can `terraform destroy` and migrate off, the bus-factor risk largely
  disappears. A real adoption unlock for the dev audience.
- **Prereq:** A clean, stable public API (see #3). The provider wraps it.
- **Status:** Not started. Roadmap candidate.

### 3. OpenAPI spec + better API docs navigation
- **Problem:** The API docs page is hand-written markdown with no headers/anchors —
  hard to parse.
- **Fix:** Generate a standard OpenAPI (Swagger) spec for the v1 API and render docs
  from it (proper nav, anchors, try-it). Becomes the source of truth the Terraform
  provider can also generate against.
- **Status:** Not started.

### 4. KYC / identity verification
- **Why:** Running arbitrary VMs for arbitrary signups invites abuse (miners, spam
  relays, fraud) and will eventually carry AML/KYC pressure as volume grows.
- **Current controls:** email-domain validation, abuse monitoring, per-space credit
  caps — catches low-effort abuse only.
- **Status:** On the radar; design a tiered verification path (e.g. verify on first
  paid top-up / above a usage threshold) before it becomes a fire.

## Positioning notes (not code)

- **Overselling isn't a universal pain.** The commenter hadn't personally hit it.
  Treat "no overselling / RAM is 1:1" as **one wedge**, not the whole pitch — lead with
  it for users who have been burned, not as a blanket claim.
- **"Just reselling bare metal" risk.** When asked about the upstream provider, keep
  the emphasis on the platform layer (provisioning, billing, snapshots, networking,
  microVM orchestration) as the product; the metal underneath is commodity on purpose.

## Confirmed/clarified facts (for future replies)

- Storage: **RAID mirror, 100% SSD** (not ZFS).
- No dedicated public IPv4 per Cube — ingress via host port mapping (iptables DNAT) +
  Cloudflare-fronted custom domains.
- SSH: a host-port → Cube `internal IP:22` DNAT mapping created at boot; customer can
  remap.
- Sleep = pause/kill Firecracker, release vCPU/RAM to the host allocator; rootfs stays
  on host SSD (disk-state preserved, not a live RAM snapshot). Sleeping Cubes still pay
  full disk storage, so sleep is capital-efficient, not a revenue leak.
