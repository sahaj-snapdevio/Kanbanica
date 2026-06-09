# Landing Page

## Goal

A public marketing site that converts visitors into sign-ups. It communicates Teamority's value proposition, shows pricing, and drives users to the magic-link sign-up flow. It must be fast (LCP < 2.5s), SEO-indexed, and analytics-instrumented from day 1.

---

## Existing Scope (MVP)

- Sections: Nav, Hero, Features, Social Proof, Pricing, FAQ, CTA, Footer
- SEO meta tags (OG, Twitter Card, canonical)
- Analytics event tracking (page view, CTA clicks)
- Legal pages: Privacy Policy, Terms of Service, Cookie Policy
- No blog in MVP
- No multi-language in MVP

---

## User Flow

1. Visitor lands on `/` -> sees Nav + Hero with primary CTA "Get Started Free"
2. Visitor scrolls through Features -> Social Proof -> Pricing
3. Visitor clicks "Get Started Free" or any primary CTA -> navigated to `/sign-in`
4. `/sign-in` shows the magic link form (see authentication.md)
5. Visitor clicks "Privacy Policy" or "Terms of Service" in footer -> `/privacy`, `/terms`

---

## Technical Design

### Routing

The landing page and legal pages live in the `(marketing)` route group to isolate them from the authenticated app layout:

```
src/app/
  (marketing)/              <- public marketing layout (no auth check)
    layout.tsx              <- Nav + Footer; no sidebar; no session check
    page.tsx                <- Landing page (/)
    pricing/page.tsx        <- Standalone pricing page (optional)
    privacy/page.tsx        <- Privacy Policy
    terms/page.tsx          <- Terms of Service
    cookies/page.tsx        <- Cookie Policy
  (auth)/                   <- sign-in, onboarding (unauthenticated)
  (app)/                    <- authenticated app
```

The `(marketing)` group has no session check -- it is fully public. This is enforced by keeping it outside the `(app)` route group.

### Rendering Strategy

All landing page routes use **Static Site Generation (SSG)**. Add `export const dynamic = 'force-static'` in each page for maximum CDN cache hit rate.

Exception: the Pricing section reads plan data from the database. Use ISR with a 1-hour revalidation so pricing changes propagate without a full redeploy:

```typescript
// src/app/(marketing)/page.tsx
export const revalidate = 3600

async function getPricingData() {
  return prisma.plan.findMany({
    where: { isActive: true },
    include: { limits: true, bullets: true },
    orderBy: { orderIndex: 'asc' },
  })
}
```

### SEO

Every page must export `metadata` from Next.js:

```typescript
// src/app/(marketing)/page.tsx
export const metadata: Metadata = {
  title: 'Teamority -- Project Management for Modern Teams',
  description: 'Organize work across Workspaces, Spaces, and Lists...',
  openGraph: {
    title: 'Teamority',
    description: '...',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Teamority',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: 'https://teamority.com',
  },
}
```

Static assets required: `/public/og-image.png` (1200x630), `/public/favicon.ico`, `/public/apple-touch-icon.png` (180x180).

### Analytics

Use the `analytics` package (wraps Google Tag Manager or another provider). Analytics is optional -- if `NEXT_PUBLIC_GTM_CONTAINER_ID` is not set, all `analytics.track()` calls are no-ops.

```typescript
// src/components/marketing/cta-button.tsx
import { useAnalytics } from 'use-analytics'

export function CtaButton({ label, location }: { label: string; location: string }) {
  const { track } = useAnalytics()
  return (
    <Button
      onClick={() => {
        track('cta_clicked', { label, location })
        router.push('/sign-in')
      }}
    >
      {label}
    </Button>
  )
}
```

**Required analytics events:**

| Event | Properties | Trigger |
|-------|-----------|---------|
| `page_view` | `page: '/'` | Auto via GTM page view trigger |
| `cta_clicked` | `label, location` | All primary CTA button clicks |
| `pricing_plan_viewed` | `plan: 'free' \| 'pro' \| 'business'` | User focuses on a pricing card |
| `faq_expanded` | `question: string` | FAQ accordion item opens |
| `sign_up_started` | -- | User reaches `/sign-in` from landing page |

### Performance Targets

| Metric | Target |
|--------|--------|
| LCP (Largest Contentful Paint) | < 2.5s on 4G throttled |
| CLS (Cumulative Layout Shift) | < 0.1 |
| INP | < 200ms |
| Lighthouse Performance | >= 90 |
| Lighthouse SEO | 100 |
| Lighthouse Accessibility | >= 95 |

To hit LCP < 2.5s:
- Hero image (if any) must use `<Image priority />` from `next/image`
- No above-the-fold JavaScript bundles except the layout
- Pricing data fetched server-side (ISR) -- no client-side fetch on load

---

## Folder Mapping

```
src/
  app/
    (marketing)/
      layout.tsx              <- Nav + Footer shell
      page.tsx                <- / (landing page)
      pricing/page.tsx
      privacy/page.tsx        <- static TSX content
      terms/page.tsx
      cookies/page.tsx
  components/
    marketing/
      nav.tsx                 <- public navigation
      hero.tsx
      features.tsx
      social-proof.tsx
      pricing-section.tsx     <- reads Plan data from ISR fetch
      faq.tsx
      footer.tsx
      cta-button.tsx          <- analytics-instrumented CTA
```

---

## API

No API endpoints required. Pricing data is fetched server-side during ISR.

---

## Database

No new tables. Landing page reads from:
- `Plan` (active plans, ordered by `orderIndex`)
- `PlanLimit` (limits per plan)
- `PlanBullet` (marketing copy bullets per plan)

All reads are read-only and cached via ISR.

---

## Events

No activity log or audit log events. Frontend analytics events only (see Analytics section above).

---

## Background Jobs

None.

---

## Dependencies

- `NEXT_PUBLIC_APP_URL` env var (canonical URL and OG images)
- `NEXT_PUBLIC_GTM_CONTAINER_ID` env var (optional; analytics)
- `next/image` for optimized images

---

## Edge Cases

| Scenario | Handling |
|----------|---------|
| No active plans in DB | Pricing section shows fallback static copy until plans are seeded |
| ISR revalidation fails | Serve stale pricing data; do not block page render |
| Authenticated user visits `/` | Do not redirect; show landing page normally (fully public) |
| Legal page content needs updating | Edit TSX directly; no CMS in MVP |
| OG image missing from `/public` | Use text-based OG meta fallback; add image to pre-launch checklist |

---

## Acceptance Criteria

- [ ] Landing page renders fully at `/` with all 8 sections (Nav through Footer)
- [ ] Pricing section shows plan names, prices, and feature bullets from the database
- [ ] Primary CTA buttons navigate to `/sign-in`
- [ ] `cta_clicked` analytics event fires on every CTA click
- [ ] `/privacy`, `/terms`, `/cookies` render with appropriate legal content
- [ ] Lighthouse Performance score >= 90 (tested on production build)
- [ ] Lighthouse SEO score = 100
- [ ] OG/Twitter Card meta tags present on all pages (verified with og:debugger)
- [ ] No sign-in required to view any marketing page

---

## Implementation Notes

- Build the `(marketing)/layout.tsx` in Phase 0 alongside the app layout -- it shares the font and global CSS but has no auth wrapper
- Legal page content can be hardcoded TSX in MVP -- no CMS, no MDX required
- The `(marketing)` route group prefix must NOT appear in URLs -- verify Next.js route group parentheses are used correctly
- `export const revalidate = 3600` on the landing page ensures pricing stays fresh without manual redeploys
- Add `robots.ts` and `sitemap.ts` at the app root to include marketing + legal pages; exclude `/api/**` and `/(app)/**`
- Email deliverability setup (SPF, DKIM, DMARC) must be completed before the landing page launches publicly -- magic link sign-up depends on email delivery, and DNS propagation takes 24-48 hours
