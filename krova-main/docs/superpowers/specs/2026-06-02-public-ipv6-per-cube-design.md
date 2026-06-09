# Decision record — per-cube public IPv6 (GUA): EVALUATED & REJECTED

**Status: REJECTED (2026-06-02).** Cube inbound stays **IPv4-only**; IPv6 remains
**egress + DNS only** via the existing ULA + NAT66 (just stabilized). Public
customer sites are served over IPv6 by **Cloudflare for SaaS**, not by the cube.
Do **not** revisit per-cube public GUA or inbound IPv6 without re-deciding the
security posture against this record.

## What was proposed

Give each cube a real, globally-unique public IPv6 (a provider-routed `/64` per
server → `<prefix>::<octet>` per cube), to replace the operator-only ULA/NAT66,
with opt-in per-port inbound. A Layer-1 foundation (server columns + GUA math +
migration `0071`) was built behind a `ula` default, then **removed** once this
decision landed (it had zero consumers; the migration was never applied).

## Decision & rationale (research-backed, 2026-06-02)

**No inbound IPv6 to cubes. Keep IPv4-only inbound + the stabilized ULA/NAT66
egress.** Scored against the operator's ranked goals:

- **Security (top goal) — WIN.** Untrusted multi-tenant workloads should be
  default-DENY on inbound (RFC 6092 REC-34, RFC 9099, AWS IPv6 security
  guidance). A globally-routable GUA makes a tenant cube directly addressable on
  the public internet; one bad allow rule = worldwide exposure that **bypasses
  Cloudflare's WAF/DDoS**. IPv4-only inbound keeps every cube behind explicit
  per-port DNAT + whitelisted CIDRs and all public traffic behind Cloudflare's
  edge. Adding cube GUA inbound would be a security **regression**.
- **Connectivity — NEUTRAL/WIN.** Cloudflare's proxy edge is dual-stack and
  **auto-generates AAAA on-by-default**, serving IPv6-only visitors to an
  IPv4-only origin (developers.cloudflare.com/network/ipv6-compatibility,
  fetched 2026-06-02). So every custom-domain site is **already** fully
  IPv6-reachable to the public **without** the cube having any inbound v6. For
  raw connections, dual-stack clients use IPv4 via Happy Eyeballs (RFC 8305;
  APNIC 2025 — sub-perceptible) with no AAAA published for cube services.
- **Performance — WIN/NEUTRAL.** NAT66 egress latency is comparable to IPv4 on
  server-class x86 (APNIC); v4-DNAT vs direct-v6 inbound is a wash. Routed GUA
  would not meaningfully improve anything.
- **Simplicity — WIN.** Avoids the entire dual-stack inbound surface the
  operator was worried about: no `expose_ipv6`, no v6 FORWARD rules, no v6 CIDR
  whitelist/UI, no v6 in the 5 tcp-mapping handlers, no per-cube GUA/RA/NDP
  lifecycle, no rDNS/abuse expectations.

**The already-shipped stability fix (`15fa254`: v4-first DNS, IPv6AcceptRA=no,
host accept_ra=2) + ULA/NAT66 egress + IPv4-only inbound + Cloudflare-for-SaaS is
the correct long-term architecture.** This record reaffirms the pre-existing
"no inbound IPv6 / no `servers.public_ipv6`" note in CLAUDE.md (Cube IPv6 §).

## Residual operator notes (not blockers)

- **Pseudo IPv4 caveat:** a customer origin app that reads the visitor IP from
  request headers may need Cloudflare "Pseudo IPv4" enabled to behave for
  IPv6-only visitors. Reachability is unaffected; document in shared-responsibility.
- **One-time smoke test (operator-run, Rule 60):** hit a customer custom domain
  over IPv6-only and confirm it serves end-to-end — closes the medium-confidence
  cross-reference on the SaaS-specific IPv6 surface.
- **Only-if-ever:** a concrete future NON-website protocol that genuinely needs
  raw inbound IPv6 (something Cloudflare proxy/Spectrum can't front) → design a
  per-cube, explicit opt-in path behind the default-deny INPUT firewall +
  allowlist, fleet-wide-off by default. Not speculative; build only on a real
  request, and re-read this record's security section first.

## Sources

- Cloudflare IPv6 Compatibility (auto-AAAA, IPv4-only origin support), fetched 2026-06-02.
- RFC 6092 (residential v6 CPE security), RFC 9099 (operational security for IPv6).
- AWS IPv6 multi-tenant security guidance; egress-only internet gateway pattern.
- RFC 8305 (Happy Eyeballs v2); APNIC 2025 dual-stack latency + NAT66 analyses.
