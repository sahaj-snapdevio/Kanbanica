# Landing Page

## Goal

A public marketing site that converts visitors into sign-ups. It communicates Kanbanica's value proposition and drives users to the magic-link sign-up flow. It must be visually polished, fast (LCP < 2.5s), SEO-indexed, and analytics-instrumented from day 1.

---

## Visual Design Philosophy

The landing page must feel like a modern SaaS product -- not a boilerplate. Key principles:

- **Depth over flatness**: layered sections with subtle gradients, shadows, and background patterns instead of solid flat blocks.
- **Brand colour as accent**: indigo (`#6366F1`) used boldly in hero, CTAs, and highlights -- not just as a button colour.
- **Motion as polish**: subtle entrance animations on scroll (fade-up, stagger) and micro-interactions on hover.
- **Structured light**: soft radial gradients and dot/grid patterns in backgrounds give sections visual texture without heavy imagery.
- **App preview as hero graphic**: a real-looking mock of the Kanbanica UI (not a generic placeholder) is the main hero image -- this immediately shows the product.

---

## Section Specs

### 1. Navigation

**Layout:** Full-width sticky bar. Transparent on load, transitions to white/95 with border and shadow on scroll.

**Left:** `Kanbanica` wordmark in brand indigo, bold. Optionally a small Kanban-square icon SVG before the name.

**Centre:** Nav links -- Features, How it works, FAQ. Hidden on mobile.

**Right:** `Sign in` (ghost button) + `Get Started Free` (filled indigo button with arrow icon).

**Behaviour:**

- Scroll threshold: add `border-b shadow-sm bg-white/95 backdrop-blur` at `scrollY > 8px`.
- Mobile: hamburger menu that reveals a full-screen overlay with the same links.

---

### 2. Hero Section

**Layout:** Centred text + below-the-fold app screenshot mock. Full viewport height on desktop.

**Background:**

- White base.
- A large soft radial gradient blob centred behind the headline: `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.15) 0%, transparent 70%)`.
- A subtle dot-grid pattern as a full-section background overlay (SVG pattern, low opacity ~4%).

**Content (top, centred):**

- Small pill badge above headline: indigo border + light indigo bg + label `"Now in early access"` with a pulsing green dot on the left.
- Headline (h1): large, bold, two lines:
  - Line 1 (dark): `Project management`
  - Line 2 (indigo gradient): `your team will actually use`
  - The indigo line uses a gradient text effect: `bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent`.
- Sub-headline: one sentence, muted, max-width 560px.
- CTA row: primary button (indigo, large, with arrow) + secondary outline button, side by side.
- Trust line below CTAs: small muted text `"No credit card required -- Magic link sign-in"`.

**App screenshot mock (below text, ~70% viewport width, centred):**

- Rounded-xl container with `border shadow-2xl` and a subtle inner glow: `ring-1 ring-indigo-100`.
- Fake browser chrome bar at top: three traffic-light dots + a URL-bar placeholder `"kanbanica.com/acme/engineering/backlog"`.
- Inside: a realistic mock of the List View showing:
  - Left sidebar (narrow, 56px icon-only rail) with icons stacked vertically.
  - Main content area: breadcrumb `"Engineering > Backlog"`, view switcher tabs (List / Board / Calendar), filter bar.
  - Task rows: 5-6 rows with status pills, priority badges, assignee avatars, due dates.
  - Status pills use actual Kanbanica priority colours (Urgent=red, High=orange, Medium=yellow, Low=blue).
- The mock fades out at the bottom via a `bg-gradient-to-b from-transparent to-white` overlay, so it blends into the next section.

**Entrance animation:**

- Headline and sub-headline: `fade-in-up` 0.6s, delay 0s.
- CTA buttons: `fade-in-up` 0.6s, delay 0.15s.
- App mock: `fade-in-up` 0.8s, delay 0.3s + a very subtle scale from 0.97 to 1.

---

### 3. Social Proof Bar

**Layout:** Full-width strip, `bg-[#f9fafb]` with top/bottom border.

**Content:** Single centred line: `"500+ teams already managing their work with Kanbanica"` with the number bolded.

**Optional enhancement:** 5 small greyscale company logo placeholders (SVG rectangles) evenly spaced on larger screens. On mobile, just the text.

---

### 4. Features Section

**Layout:** `bg-[#f9fafb]`, full padding. Section label + heading centred. 6-card grid (2 cols on tablet, 3 cols on desktop).

**Background:** Subtle grid-line pattern (1px lines, 3% opacity) as section background.

**Cards:**

- White background, `border border-[#e5e7eb]`, `rounded-xl`, `p-6`, `shadow-sm`.
- Hover: `shadow-md` + `border-indigo-200` + `translate-y-[-2px]` transition.
- Icon container: `size-10 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500` with the Lucide icon in white inside.
- Title: `text-base font-semibold`.
- Description: `text-sm text-muted-foreground leading-relaxed`.

**Card entrance:** staggered `fade-in-up` on scroll -- each card delays by `index * 80ms`.

---

### 5. How It Works Section

**Layout:** White background. Section label + heading centred. Hierarchy hint row. 4-step grid.

**Hierarchy hint row:**

- `Workspace -> Space -> List -> Task` rendered as a horizontal breadcrumb chain.
- Each label in a `rounded-lg border bg-[#f9fafb] px-3 py-1.5 font-medium` pill.
- Arrows between them using `ChevronRight` icon.
- Below the chain, a small example row in muted text: `"Acme Inc -> Engineering -> Backlog -> Fix login bug"`.

**Step cards:**

- White bg, `border rounded-xl p-6 shadow-sm`.
- Large step number (`text-5xl font-bold`) in a gradient text `from-indigo-200 to-violet-200` (very light, decorative).
- Step title: `text-sm font-semibold`.
- Step description: `text-sm text-muted-foreground`.
- Connecting line between cards on desktop: a dashed horizontal line `border-t-2 border-dashed border-indigo-100` drawn via a pseudo-element or absolutely-positioned div.

---

### 6. Views Showcase Section

**Layout:** `bg-[#f9fafb]`, centred. Section label + heading + subtext. Tab switcher (List / Board / My Tasks).

**Tab bar:** shadcn `<Tabs>` with custom active style -- active tab gets indigo bg + white text. Inactive tabs are ghost with hover.

**Tab panels:**
Each tab panel is a card with a `border shadow-sm rounded-xl` and realistic mock content:

- **List tab:** Rows of tasks with inline status/priority/assignee fields. The first 2 rows have a subtle indigo left border to show "selected". A `+ Add task` row at the bottom.
- **Board tab:** 4 Kanban columns (Todo, In Progress, Review, Done). Each column has a coloured header dot. Cards inside show title + priority badge + assignee avatar. Use `grid-cols-4 gap-3`.
- **My Tasks tab:** Grouped sections (Overdue in red, Due Today in amber, This Week in foreground). Each task row has a checkbox + task name + breadcrumb context (Space > List).

**Transition between tabs:** The tab content uses `tw-animate-css` `animate-fade-in` so switching feels smooth.

---

### 7. Testimonials Section

**Layout:** White background, 3-column grid on desktop.

**Cards:**

- White bg, `border rounded-xl p-6 shadow-sm`.
- Top: 5 gold stars (`fill-amber-400`).
- Quote text: `text-sm leading-relaxed text-foreground/80` with proper curly quotes.
- Bottom: avatar (initials, indigo bg) + name + role. Separated by a `border-t`.

**Background texture:** A very faint large indigo circle (`size-96 rounded-full bg-indigo-50 blur-3xl opacity-60`) absolutely positioned in the centre of the section as a decorative glow.

---

### 8. FAQ Section

**Layout:** `bg-[#f9fafb]`, narrow centred column (`max-w-2xl`). 7 questions in a single accordion.

**Accordion items:**

- White bg cards, `border rounded-lg shadow-sm`.
- Trigger: `text-sm font-semibold`, custom chevron that rotates on open.
- Content: `text-sm text-muted-foreground leading-relaxed`.

---

### 9. Final CTA Banner

**Layout:** Full-width section containing a `rounded-2xl` card -- NOT just a coloured div.

**Card background:**

- `bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600` (rich indigo to violet gradient).
- A subtle radial noise/grain texture overlay at 8% opacity (CSS SVG filter or a PNG overlay).
- Two large decorative blurred circles at the corners: `size-64 bg-white/10 rounded-full blur-3xl` -- one top-left, one bottom-right.

**Content (centred):**

- Heading: `text-3xl font-bold text-white`.
- Sub-text: `text-white/70`.
- CTA button: white background, indigo text, `font-semibold`. On hover: slightly off-white bg.
- Small note below button: `text-white/50 text-sm`.

---

### 10. Footer

**Layout:** `bg-[#f9fafb]`, `border-t`. 4-column grid (brand col + Product + Company + Legal).

**Brand column:**

- `Kanbanica` wordmark in indigo bold.
- One-line tagline in muted text.

**Link columns:** Three columns (Product, Company, Legal) with `text-xs uppercase font-semibold tracking-wide` column headers and `text-sm text-muted-foreground` links.

**Bottom strip:** `border-t mt-8 pt-6` -- copyright left-aligned, `Privacy` and `Terms` links right-aligned.

---

## Background Patterns (Implementation)

Use inline SVG `data:` URIs as CSS `background-image` values -- no external image files required.

**Dot grid pattern (hero, features):**

```css
background-image: url("data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='1' fill='%236366f1' fill-opacity='0.04'/%3E%3C/svg%3E");
background-size: 20px 20px;
```

**Line grid pattern (features section):**

```css
background-image:
  linear-gradient(rgba(99, 102, 241, 0.04) 1px, transparent 1px),
  linear-gradient(90deg, rgba(99, 102, 241, 0.04) 1px, transparent 1px);
background-size: 40px 40px;
```

---

## Animations

Use `tw-animate-css` classes (already installed). Apply via Intersection Observer so animations only fire when sections enter the viewport.

| Element           | Class                        | Delay                            |
| ----------------- | ---------------------------- | -------------------------------- |
| Section headings  | `animate-fade-in-up`         | 0ms                              |
| Feature cards     | `animate-fade-in-up`         | 0 / 80 / 160 / 240 / 320 / 400ms |
| Step cards        | `animate-fade-in-up`         | 0 / 120 / 240 / 360ms            |
| Hero app mock     | `animate-fade-in-up` + scale | 300ms                            |
| Testimonial cards | `animate-fade-in-up`         | 0 / 100 / 200ms                  |

Implement via a `useInView` hook (Intersection Observer, no extra lib) that adds `opacity-100 translate-y-0` to elements that start at `opacity-0 translate-y-4`.

---

## Routing

```
app/
  (marketing)/
    layout.tsx       <- Nav + Footer shell; no auth check
    page.tsx         <- Landing page (/)
    privacy/page.tsx <- Privacy Policy (static TSX)
    terms/page.tsx   <- Terms of Service (static TSX)
    cookies/page.tsx <- Cookie Policy (static TSX)
  (auth)/
  (app)/
```

---

## Rendering Strategy

SSG for all marketing pages. `export const dynamic = 'force-static'` on each page.

---

## SEO

```typescript
export const metadata: Metadata = {
  title: "Kanbanica -- Project Management for Modern Teams",
  description:
    "Organise work across Workspaces, Spaces, Lists, and Tasks. Sprints, board views, comments, and smart notifications built in.",
  openGraph: {
    title: "Kanbanica",
    description: "...",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kanbanica",
    images: ["/og-image.png"],
  },
  alternates: { canonical: "https://kanbanica.com" },
};
```

---

## Performance Targets

| Metric                   | Target                 |
| ------------------------ | ---------------------- |
| LCP                      | < 2.5s on 4G throttled |
| CLS                      | < 0.1                  |
| INP                      | < 200ms                |
| Lighthouse Performance   | >= 90                  |
| Lighthouse SEO           | 100                    |
| Lighthouse Accessibility | >= 95                  |

Rules:

- No heavy animation libraries (no Framer Motion). Use CSS transitions + `tw-animate-css` only.
- Hero app mock is pure HTML/CSS -- no images, no canvas.
- All icons from `lucide-react` (tree-shaken, no icon sprite sheet).
- Dot/grid patterns are inline SVG data URIs -- zero network requests.

---

## Analytics Events

| Event             | Trigger                                        |
| ----------------- | ---------------------------------------------- |
| `cta_clicked`     | Every primary CTA button click                 |
| `faq_expanded`    | FAQ accordion item opens                       |
| `sign_up_started` | User navigates to `/sign-in` from landing page |

---

## Acceptance Criteria

- [ ] All 10 sections render correctly
- [ ] Hero gradient blob and dot-grid background visible
- [ ] App mock renders with realistic task rows, status pills, priority badges
- [ ] Feature cards have gradient icon containers and hover lift effect
- [ ] CTA banner uses indigo-to-violet gradient with decorative blobs
- [ ] Scroll-triggered fade-in-up animations fire once per element
- [ ] Sticky nav transitions correctly on scroll
- [ ] Primary CTAs navigate to `/sign-in`
- [ ] `/privacy`, `/terms`, `/cookies` render
- [ ] No external image dependencies (patterns are inline SVG)
- [ ] Lighthouse Performance >= 90 on production build
