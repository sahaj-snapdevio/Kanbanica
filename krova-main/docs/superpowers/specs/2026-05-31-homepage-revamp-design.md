# Homepage revamp — security-led positioning, honest resourcing, programmatic provisioning, motion

Date: 2026-05-31
Branch: `audit/snapshots-backups-wiring` (no new branch — per request)
Surface: `app/(landing)/page.tsx` (+ new SVG/illustration components, new motion primitives, FAQ data, metadata)

## 1. Why

The current homepage leads with boot time (`<1s`), buries security as 1 of 6 equal
capability cards, never mentions that a Cube has **no public IP**, never mentions the
**v1 API / programmatic fleet** story, and — under a header that literally reads "No
overselling. Ever." — contradicts itself with a vCPU card that says Firecracker
"oversubscribes safely on dedicated cores." Prospects raising "boot time is never a
concern" and "do you share a kernel like containers?" confirm the framing is off.

Goal: a full content + structure revamp that leads with **security & isolation**,
makes the **no-public-IP** and **own-kernel-per-cube** stories first-class, adds a
**programmatic/fleet** story (compared factually against named competitors' setup
complexity), reframes CPU honestly (shared vCPU — deliberately, to keep prices low —
while RAM and disk are 1:1), and adds tasteful, professional motion + on-brand SVG
graphics. Every claim must be true and sourced (CLAUDE.md: no fake features, no fake
claims, describe only what is real).

## 2. Positioning

**Security-led, three pillars** (chosen):

1. **Isolated by hardware** — own kernel per Cube + per-cube jailer sandbox.
2. **Nothing exposed** — no public IP; only the ports you explicitly open.
3. **No overselling** — RAM & disk 1:1 with the host; vCPU shared (the one cloud
   resource that is, deliberately, to keep your price low).

Velocity (programmatic fleets) and price are strong supporting acts, not the lead.

## 3. Truthful-claims ledger (claim → source → honest caveat)

Every marketing claim below is verified against code/docs. The honest caveats MUST
survive into the copy — overclaiming is a CLAUDE.md violation.

| Claim | Source | Honest caveat to preserve |
| --- | --- | --- |
| Each Cube boots **its own guest kernel** (Linux 6.1.x vmlinux), never a shared host kernel | `docs/security/shared-responsibility.md` ("The guest kernel (vmlinux) … supplied by the host at boot"); CLAUDE.md Image Hosting | The kernel is Krova-built + swapped only on cold-restart; customer can't `apt upgrade` it. Fine to say "we keep the kernel patched for you." |
| **Per-cube jailer sandbox** — unique uid+gid, chroot, PID namespace, cgroup v2; a VMM/guest escape lands as an unprivileged per-cube uid, not host root. Fleet-wide. | `docs/security/host-hardening.md` ("Jailer per cube … unique uid AND gid … chroot, PID namespace, cgroup v2"); CLAUDE.md (`JAILER_ENABLED` enabled fleet-wide 2026-05-30) | This is genuinely new (announce it). Don't claim "unescapable" — claim "an escape is contained to an unprivileged sandbox, not host root." |
| **Default seccomp** (most-restrictive filters, Firecracker's production recommendation) | `docs/security/host-hardening.md` | — |
| **Hardware-enforced KVM boundary** — same isolation tech as AWS Lambda/Fargate | CLAUDE.md "What is a Cube" + landing copy | Already on the page; keep. |
| **KSM off** — no cross-VM page-dedup side channel; RAM allocated 1:1 | `docs/security/host-hardening.md` ("KSM disabled … allocated 1:1") | — |
| **Cube has no public IPv4 or IPv6.** Internal addresses are private + NAT'd (`198.18.0.0/15` v4, `fd00:c0be::/…` ULA v6). | CLAUDE.md "Cube IPv6 + globally-unique networking" | The **host server** has a public IP; the Cube does not. Say "your Cube has no public IP of its own." |
| **IPv6 is outbound + DNS only** — no inbound IPv6, no AAAA, no public IPv6 | CLAUDE.md ("IPv6 is outbound + DNS only … no inbound IPv6") | — |
| **Nothing inbound is reachable unless you explicitly map a port**; every TCP mapping is IP-allowlistable | CLAUDE.md (port-mapping DNAT; `tcp_port_mappings` whitelists); landing capability card | SSH + the ports you map ARE reachable on the host by your choice. Frame as "only what you open," NOT "literally nothing." |
| **Web traffic rides Cloudflare's edge** (Cloudflare for SaaS) — DDoS + origin hidden | CLAUDE.md "Custom Domains (Cloudflare for SaaS)" | Applies to custom domains / HTTP(S), not raw TCP. |
| **Default-deny stateful host firewall** on both IPv4 + IPv6 | `docs/security/host-hardening.md` "Host INPUT firewall" | — |
| **RAM & disk sold 1:1 with the host — never oversold/thin-provisioned** | CLAUDE.md Rule 53; landing pricing copy | True and load-bearing. Keep. |
| **vCPU is shared/oversubscribed** | CLAUDE.md (no 1:1 claim for CPU; host-hardening SMT-on); current code comment | DO NOT claim CPU is 1:1. Reframe as "shared vCPU, like every cloud — deliberately, so you pay a fraction." |
| **Full v1 REST API** — `POST /api/v1/spaces/{spaceId}/cubes` (`X-API-KEY`, `Idempotency-Key`, `userData` cloud-init), full lifecycle (sleep/wake/snapshot/domain/tcp/import/webhook), OpenAPI 3.1 at `/api/v1/openapi.json` | `app/api/v1/spaces/[spaceId]/cubes/route.ts`; `docs/api/v1.md` | Real. The code snippet on the page must match the real request shape exactly. |
| **Boots in milliseconds** | CLAUDE.md "boots in milliseconds"; current copy | Keep, but demote from hero to a supporting line in the programmatic section. |
| Hardware: ECC RAM, mirrored NVMe RAID1, 10 Gbps / 100 TB, DDoS | Existing landing copy (provider-supplied) | Keep as-is; already hedged ("provided by our bare-metal hosts"). |

## 4. New section structure

`0.` **Announcement bar** (new, top, dismissible-style strip): hardened per-cube sandbox is live fleet-wide → anchors to Security section.

`1.` **Hero (reframed, asymmetric split — design-taste DESIGN_VARIANCE>4 bans centered hero):** copy left, hero SVG right.
   - H1 direction: *"Your own server. Your own kernel. No exposed IP."* (final wording tuned in build)
   - Sub: hardware-isolated microVM · own kernel (never shared) · no public IP · full root SSH · provision 1 or 100 by API · real 1:1 RAM & disk · 40%+ less than Lightsail/DO/Vultr/Linode.
   - CTAs: primary `Start with $X free` / secondary `See how isolation works` (anchors to Security).
   - Right: hero isolation SVG + a refined terminal card (kept, polished, blinking cursor).

`2.` **Three-pillar strip** (replaces the boot-time key-numbers row): the three pillars above, each a sharp-bordered panel linking to its deep section. Reveal-on-scroll, staggered.

`3.` **What is a Cube?** — tightened; adds "its own kernel — never shared" explicitly.

`4.` **Security deep-dive (NEW centerpiece) + isolation SVG.** Own kernel per Cube; per-cube jailer sandbox; default seccomp; KSM off; KVM boundary. Honest contrast vs shared-kernel containers (one kernel bug exposes every tenant — Cubes don't share a kernel).

`5.` **No-exposure networking (NEW) + network-boundary SVG.** No public IP; IPv6 outbound-only; only-what-you-open (IP-allowlistable); Cloudflare edge for web. Honest "no server IP for botnets to find" framing.

`6.` **Programmatic / fleets (NEW) + API→fleet SVG + real code snippet.** v1 API, idempotency, `userData`, full lifecycle, OpenAPI. Then the **named** competitor-complexity comparison (Krova: one request per Cube vs AWS: VPC + subnet + security group + AMI + key pair + IAM + launch template; DO/Vultr: droplet API, no per-tenant kernel isolation). Boot-time demoted to a supporting line here.

`7.` **Everything that ships with every Cube** — keep 6 capability cards; swap the now-redundant "Security by design" card for **"API & automation"** (the security story is its own section now).

`8.` **Premium hardware. Included.** — keep (ECC / mirrored SSD / 10 Gbps / DDoS).

`9.` **How Krova compares** (Krova vs VPS vs Containers) — add an **"Own kernel"** row (Krova ✓ / VPS ✓ / Containers ✗ shared), demote the boot-time row to last.

`10.` **Stop overpaying / price comparison** — keep; corrected no-overselling framing (RAM/disk 1:1; vCPU shared, deliberately, to keep price low).

`11.` **No-overselling section (reframed)** — FIX the CPU card. New CPU copy: *"Shared vCPU — like every cloud. Your vCPUs run on real, dedicated cores shared across Cubes, so you pay a fraction of a whole CPU. RAM and disk are never shared."* Keep RAM/disk 1:1 cards.

`12.` **Who is it for** — keep; add a "Security-conscious / regulated workloads" audience.

`13.` **Pricing** (plans + per-hour rates + sizing catalog) — keep; make the 1:1 annotations consistent; vCPU annotation reframed (drop "no overselling" on the vCPU row, replace with "shared — keeps it cheap").

`14.` **FAQ** — add: "Do Cubes share a kernel?" (No), "Does my Cube have a public IP?" (No), "Can I provision Cubes with an API?" (Yes); strengthen "Is my data safe?".

`15.` **Bottom CTA** — keep, re-skinned with motion.

## 5. Motion system (no new dependency)

Constraints: `tw-animate-css` + Geist already installed; no framer-motion/gsap added.
Honor the brand: **sharp corners (`--radius: 0`)**, single **teal `--primary`** accent,
neutral grayscale, Geist/Geist Mono, technical/terminal feel. design-taste dials
MOTION_INTENSITY≈6 (fluid CSS, not cinematic). Hardware-accelerated only
(`transform`/`opacity`). `prefers-reduced-motion: reduce` disables all of it.

- **`components/landing/reveal.tsx`** — one small `"use client"` leaf. IntersectionObserver
  set up in `useEffect` with cleanup; toggles a class on the DOM node directly via a ref
  (NO `useState` in the observer callback → React-Compiler-safe, dodges
  `react-hooks/set-state-in-effect`). Props: `as`, `delay` (stagger), `className`. Used to
  wrap sections/cards for staggered fade-up-on-scroll.
- **`app/globals.css` keyframes** (transform/opacity only): `krova-fade-up`, `krova-fade-in`,
  `krova-scale-in`, `krova-float` (perpetual, hero cube), `krova-blink` (terminal cursor),
  `krova-draw` (SVG stroke-dashoffset line-draw), `krova-gradient-pan` (subtle accent
  sheen), `krova-marquee` (optional kinetic strip). Plus a `@media (prefers-reduced-motion:
  reduce)` block neutralizing them.
- Perpetual micro-motion used sparingly: hero cube float, terminal cursor blink, a "live"
  status pulse, animated SVG line-draw on the three diagrams, subtle gradient sheen on the
  announcement bar. No magnetic cursor, no neon glow, no gradient-text headers (AI tells).
- Tactile `:active` press (`active:translate-y-px`) on CTAs.

## 6. SVG assets (hand-built, theme-aware, in `components/landing/`)

All sharp-cornered, `currentColor` + `--primary`/`--muted-foreground` so they theme with
light/dark. No raster, no external image hosts.

1. **`hero-isolation.tsx`** — isometric stacked "isolated cube" visual with a hardware
   boundary frame; subtle float + line-draw.
2. **`diagram-isolation.tsx`** — guest userspace → its own kernel → KVM hardware boundary →
   jailer chroot/uid, annotated; line-draw on reveal.
3. **`diagram-networking.tsx`** — Cube on private NAT'd net → host edge → (a) Cloudflare edge
   for HTTP, (b) explicit port-map DNAT for chosen TCP; "no public IP / IPv6 outbound-only"
   labels.
4. **`diagram-fleet.tsx`** — one API key → `POST /cubes` ×N → N isolated Cubes; staggered
   node reveal.

(If any diagram proves too heavy inline, it stays a self-contained component — page stays
a Server Component; only `reveal.tsx` is a client leaf. SVGs are static markup, server-safe.)

## 7. File plan / build sequence

1. `app/globals.css` — add keyframes + reduced-motion block.
2. `components/landing/reveal.tsx` — client reveal leaf.
3. `components/landing/hero-isolation.tsx`, `diagram-isolation.tsx`, `diagram-networking.tsx`,
   `diagram-fleet.tsx` — SVG components.
4. `lib/seo/faq-data.ts` — add/adjust FAQ entries (kernel, public IP, API).
5. `app/(landing)/page.tsx` — rewrite sections + copy, wire SVGs + `<Reveal>`, fix CPU/overselling,
   add Security / Networking / Programmatic sections, announcement bar, metadata description tune.
6. Keep all dynamic data wiring (plans, rates, free credit) intact — only copy/structure changes.

## 8. Verification

- `pnpm typecheck` — green.
- `pnpm lint` — green (Biome; watch the React-hooks rules around `reveal.tsx`).
- `pnpm build` — green (RSC boundary: page stays server, `reveal.tsx` is the only `"use client"`).
- Manual smoke: load `/` in light + dark, confirm reveals fire, reduced-motion disables motion,
  no horizontal scroll on mobile (`< 768px` single-column), all anchor links work, code snippet
  matches the real API shape, every competitor/price claim still accurate.
- Update `CLAUDE.md` / `README.md` only if a convention changes (Rule 22). This is copy/UI on one
  marketing page — likely no doc change beyond noting the landing motion primitives if reused.

## 10. Refinements (post-review, 2026-05-31)

These supersede the relevant parts of §3–§7.

### 10.1 Real savings number (dynamic, not hardcoded "40%")
Krova prices from config (`hourly × 730`): 2v/4G/80G **$11.68**, 4v/8G/100G **$20.11**,
8v/16G/100G **$32.89**, 16v/32G/100G **$58.98**. Verified current competitor prices
(researched 2026-05-31, all give every instance a **public IPv4**):

| RAM | AWS Lightsail | DigitalOcean | Vultr | Linode | Krova saves vs $rep |
| --- | --- | --- | --- | --- | --- |
| 4 GB | $24 (2v/80G) | $24 (2v/80G) | $20 | $24 (2v) | ~51% |
| 8 GB | $44 (2v/160G) | $48 (4v/160G) | $40 | $48 (4v) | ~58% |
| 16 GB | $84 (4v/320G) | $96 (8v/320G) | $80 (6v) | $96 (6v) | ~66% |
| 32 GB | $164 (8v/640G) | $192¹ | $160 (8v) | $192 (8v) | ~69% |

¹ DO 32 GB is CPU-/general-optimized (~$192); Basic Droplets cap at 16 GB.

Representative "DO / Vultr / Linode" column = **24 / 48 / 96 / 192** (conservative; Vultr
is lower). Lightsail column = **24 / 44 / 84 / 164**. Smallest saving 51% → "**less than
half the price, every size**"; max 69% → "**up to 69% less**". The headline % is **computed
at render** (`Math.max(savings)`) so a future rate change never makes the copy lie. Honest
disclosure kept: competitors bundle 160–640 GB disk vs Krova's 100 GB cap; Krova gives
**equal-or-more vCPU** at each RAM tier (e.g. 16 vCPU at 32 GB vs their 8). Sources:
aws.amazon.com/lightsail/pricing, digitalocean.com/pricing/droplets, vultr.com/pricing,
akamai.com/cloud/pricing.

### 10.2 Billing granularity — "hourly rate, billed by the minute" (prominent)
True per `lib/cost.ts` `chargeProratedUsage` (prorates the fractional hour from
`lastBilledAt`; skips < 1 min). Surface a loud line + concrete example: **"Hourly rates,
billed by the minute. Run a Cube for 5 minutes — pay for 5 minutes, not the hour."**
Do NOT claim finer granularity than DigitalOcean (DO is now per-second as of Jan 2026) —
frame it as a Krova virtue, not a "we beat DO on granularity" claim.

### 10.3 Programmatic section — "create as many Cubes as you need", NOT "1 API → N"
There is no batch "one call spins up N" endpoint. Reframe to: provision Cubes
programmatically via the v1 REST API, **create and run as many as you need** (no artificial
cap; concurrency is **unlimited on higher plans** — `plans.maxConcurrentCubes = null`).
Diagram = `diagram-fleet.tsx` becomes an **"unlimited Cubes"** visual: an API request →
a Cube, looped, accumulating into a grid of many isolated Cubes (honest: each request =
one Cube; you loop). Keep the real code snippet matching `POST /api/v1/spaces/{id}/cubes`.
Keep "boots in milliseconds" as a supporting line here. Competitor-complexity comparison
stays (named, factual).

### 10.4 Drop the shared-vCPU narrative entirely
Per request: remove ALL "shared vCPU" / "oversubscribe" copy. The no-overselling section
shows **only RAM and Disk** (two cards, 1:1, never oversold) — no vCPU card, no CPU
sharing claim anywhere. The per-hour rate table still lists a vCPU rate (it's a price, not
a sharing claim) but carries **no** overselling/sharing annotation on the vCPU row. §11's
CPU-reframe wording from the original spec is VOID — there is simply no CPU-overselling
mention.

### 10.5 Named real-provider comparison (flashy, genuine)
Add a comparison that names **AWS Lightsail, DigitalOcean, Vultr, Linode** (not only the
generic "VPS / Containers"). Compare on verifiable dimensions only:
- **Public IP**: Krova *none — only ports you open*; all four competitors *public IPv4 on
  every instance* (verified). ← strongest true differentiator.
- **Price** (real numbers above).
- **Sizing**: Krova *custom any vCPU/RAM/disk*; competitors *fixed plan bundles* (true).
- **Per-cube sandbox / own kernel** (Krova jailer + own kernel — true; vs container PaaS
  it's a kernel differentiator, vs these VM VPSs it's the jailer-hardening + no-public-IP).
- **Billing**: Krova *by the minute*; Lightsail/Vultr/Linode *hourly, monthly cap*; DO
  *per-second*. State each accurately.
Keep the conceptual Krova-vs-VPS-vs-Containers table too (adds the "own kernel" row), but
the named-provider matrix is the flashy centerpiece. No invented claims (do NOT assert a
named provider "oversells" — keep 1:1 as a Krova property, competitor cell neutral).

### 10.6 Graphics — professional, scroll-animated (not filler)
Animated-on-scroll SVGs with genuine motion design: stroke `krova-draw` line-drawing tied
to reveal, staggered node reveals, a subtle data-flow pulse along network paths, the hero
cube float. Reference language: clean technical infra diagrams (Fly.io / Vercel / Firecracker
docs aesthetic) — sharp corners, mono labels, single teal accent, lots of negative space.
Performance: transform/opacity only, `prefers-reduced-motion` disables, animations isolated
so the page stays a Server Component (only `reveal.tsx` is `"use client"`).

### 10.7 Cloudflare + DDoS protection (prominent, accurate)
Lead the "Nothing exposed" pillar with protection, not just absence:
- **No public IP on the Cube** — vs every competitor giving each instance a public IPv4
  (verified: DO "each Droplet comes with its own public IPv4", Lightsail static IP included).
  Framing: a public IP is a fixed address the whole internet can scan + hammer; Krova Cubes
  don't have one.
- **Web traffic runs through Cloudflare's global edge** (Cloudflare for SaaS, proxied custom
  hostnames): edge **TLS**, the **origin IP hidden** behind Cloudflare's proxy, and
  **always-on, unmetered DDoS protection across L3/4/7** on Cloudflare's **330+ city** network
  (verified cloudflare.com/ddos: "enabled by default", "no bandwidth caps, no penalty for
  being attacked", "layers 3, 4, and 7"). CLAUDE.md confirms Cloudflare manages TLS + DDoS for
  custom domains.
- **Hosts carry provider-grade network DDoS mitigation** on top (existing hardware promise) →
  "fully DDoS-protected".
- **Honest scope**: only HTTP(S) custom-domain traffic is proxied through Cloudflare. SSH + raw
  TCP mappings reach the host directly — but the host exposes **no Cube-identifying public IP**,
  sits behind a **stateful default-deny firewall** (`docs/security/host-hardening.md`), and every
  TCP mapping is **IP-allowlistable**. Do NOT claim SSH/TCP is proxied through Cloudflare (it
  isn't — that needs Spectrum). Represent the web path as Cloudflare-fronted and the raw-TCP path
  as no-public-IP + firewall + allowlist. Both are strong; neither is overclaimed.

## 9. Out of scope

- No pricing/rate changes (numbers stay dynamic from DB/config).
- No new marketing routes, no blog, no changelog page (the "announcement" is an on-page bar, not a
  new system).
- No raster/AI photographic art (cannot generate in this environment; SVG only).
- No backend/API changes — the API already does everything the copy claims.
