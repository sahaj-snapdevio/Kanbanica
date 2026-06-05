# Landing Page

## Overview

The landing page is the public-facing marketing site for Teamority. It is the first thing a visitor sees — its job is to communicate the product's value, build trust, and convert visitors into sign-ups.

**URL:** `/`
**Access:** Public — no authentication required
**Tech:** Built within Next.js (same codebase, separate layout from the app)

---

## Page Sections (in order)

1. [Navigation Bar](#1-navigation-bar)
2. [Hero Section](#2-hero-section)
3. [Social Proof Bar](#3-social-proof-bar)
4. [Features Section](#4-features-section)
5. [How It Works](#5-how-it-works)
6. [Views Showcase](#6-views-showcase)
7. [Testimonials](#7-testimonials)
8. [FAQ Section](#8-faq-section)
9. [Final CTA Banner](#9-final-cta-banner)
10. [Footer](#10-footer)

---

## 1. Navigation Bar

Sticky top navigation bar — stays visible while scrolling.

### Layout

```
[Logo + Teamority]          Features  Help      [Sign In]  [Get Started →]
```

### Elements

| Element | Description |
|---------|-------------|
| Logo | Teamority logo + wordmark — links to `/` |
| Features | Anchor link → scrolls to Features section |
| Help | Links to `/help` (Help Center) |
| Sign In | Link to `/sign-in` |
| Get Started | Primary CTA button → `/sign-up` |

### Behavior

- **Transparent** background at top of page, transitions to a solid white / dark background with a shadow after scrolling 60px
- On mobile: collapses into a hamburger menu (`☰`)
- Mobile menu shows: Features, Help, Sign In, Get Started

---

## 2. Hero Section

The most important section. Communicates the product in one glance.

### Layout

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   Organize work. Ship faster. Together.              │
│                                                      │
│   Teamority brings your team's tasks, sprints,       │
│   and projects into one place — without the          │
│   complexity.                                        │
│                                                      │
│   [Get Started for Free]   [See how it works →]     │
│                                                      │
│   ✅ Free forever   ✅ No credit card required       │
│                                                      │
│   ┌────────────────────────────────────────────┐    │
│   │         App Screenshot / Demo GIF          │    │
│   │         (Board View or Task Panel)         │    │
│   └────────────────────────────────────────────┘    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Content

| Element | Content |
|---------|---------|
| Headline | `"Organize work. Ship faster. Together."` |
| Subheadline | `"Teamority brings your team's tasks, sprints, and projects into one place — without the complexity."` |
| Primary CTA | `"Get Started for Free"` → `/sign-up` |
| Secondary CTA | `"See how it works →"` → anchors to How It Works section |
| Trust nudge | `"✅ Free forever  ✅ No credit card required"` |
| Hero visual | App screenshot or animated GIF showing Board View or the Task detail panel |

### Design notes

- Headline is the largest text on the page (H1)
- Primary CTA is filled button (brand color)
- Secondary CTA is ghost / text button
- Hero visual should show real UI — not abstract illustrations

---

## 3. Social Proof Bar

A simple trust bar below the hero showing logos or numbers.

### Layout

```
──────────────────────────────────────────────────────
   Trusted by teams at                [Logo] [Logo] [Logo] [Logo] [Logo]
──────────────────────────────────────────────────────
```

**OR (if no customer logos yet — early stage):**

```
──────────────────────────────────────────────────────
        500+ teams already using Teamority
   ★★★★★  "Exactly what we needed"   ★★★★★
──────────────────────────────────────────────────────
```

- Use whichever version is appropriate at launch
- Keep it minimal — one row, no borders

---

## 4. Features Section

Highlights the core features of the product in digestible chunks.

### Layout

```
         Everything your team needs to move fast

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  📋 Tasks    │  │  🏃 Sprints  │  │  👁 Views    │
│              │  │              │  │              │
│ Create, pri- │  │ Time-box your│  │ List, Board, │
│ oritize, and │  │ work into    │  │ or Calendar  │
│ track tasks  │  │ focused iter-│  │ — your choice│
│ with full    │  │ ations with  │  │              │
│ detail       │  │ story points │  │              │
└──────────────┘  └──────────────┘  └──────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  💬 Comments │  │  🔔 Notifs   │  │  🔍 Search   │
│              │  │              │  │              │
│ Threaded     │  │ Stay informed│  │ Find anything│
│ comments,    │  │ without the  │  │ instantly    │
│ mentions,    │  │ noise — you  │  │ across your  │
│ reactions    │  │ control what │  │ entire work- │
│ on every task│  │ matters      │  │ space        │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Feature cards (6 cards)

| Icon | Title | Description |
|------|-------|-------------|
| 📋 | Tasks & Subtasks | Create, prioritize, and track work with rich fields — assignees, due dates, priorities, checklists, dependencies, and more. |
| 🏃 | Sprints | Time-box work into focused iterations. Set goals, assign story points, track progress, and close sprints cleanly. |
| 👁 | Multiple Views | See your work your way — List, Board (Kanban), or Calendar. Switch anytime, your preference is saved. |
| 💬 | Collaboration | Threaded comments, @mentions, emoji reactions, and a full activity timeline on every task. |
| 🔔 | Smart Notifications | Stay informed about what matters — configure per-event, per-space, or mute entirely. |
| 🔍 | Powerful Search | Find any task, list, or member instantly across your entire workspace with `Ctrl+K`. |

---

## 5. How It Works

A simple step-by-step walkthrough showing how a team gets started.

### Layout

```
        Get your team up and running in minutes

Step 1          Step 2          Step 3          Step 4
   │               │               │               │
[Create        [Invite         [Organize        [Start
Workspace]      Team]           Work]            Working]
   │               │               │               │
Create your    Invite team-    Create Spaces,   Create tasks,
workspace in   mates by email  Lists, and set   assign people,
30 seconds     or link         up your structure set due dates
```

### Steps

| Step | Title | Description |
|------|-------|-------------|
| 1 | Create Workspace | Sign up and create your workspace in under 30 seconds. No setup required. |
| 2 | Invite Your Team | Invite teammates by email or share an invite link. They join instantly. |
| 3 | Organize Your Work | Create Spaces for each team, Lists for projects, and Tasks for every piece of work. |
| 4 | Start Working | Assign tasks, set priorities and due dates, and watch progress in real time. |

- Each step has a small illustration or icon
- Connected with a horizontal line / arrow on desktop, vertical on mobile

---

## 6. Views Showcase

A visually prominent section showing the three views with an interactive tab switcher.

### Layout

```
        See your work the way you want

[List View]  [Board View]  [Calendar View]      ← tab switcher

┌─────────────────────────────────────────────────┐
│                                                 │
│          App screenshot for selected view       │
│                                                 │
└─────────────────────────────────────────────────┘

List View: Tasks as rows with inline fields — sort, filter, and edit without leaving the view.
```

### Tabs

| Tab | Screenshot shows | Caption |
|-----|-----------------|---------|
| List View | Task list with columns (status, assignee, due date, priority) | `"Tasks as rows with inline fields — sort, filter, and edit without leaving the view."` |
| Board View | Kanban columns with task cards | `"Drag tasks between columns to update status instantly. Perfect for sprint planning."` |
| Calendar View | Monthly calendar with tasks on due dates | `"See what's due when. Drag tasks to reschedule directly from the calendar."` |

- Active tab is highlighted
- Switching tabs swaps the screenshot with a smooth fade or slide transition
- On mobile: show all three screenshots stacked vertically instead of tabs

---

## 7. Testimonials

Social proof from real users. Shown as cards.

### Layout

```
        What teams are saying

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ ★★★★★            │  │ ★★★★★            │  │ ★★★★★            │
│                  │  │                  │  │                  │
│ "We replaced     │  │ "Sprint planning  │  │ "The permission  │
│ three tools with │  │ in Teamority     │  │ model is exactly │
│ Teamority. Best  │  │ finally makes    │  │ what we needed   │
│ decision we made"│  │ sense."          │  │ for client work."│
│                  │  │                  │  │                  │
│ [Avatar]         │  │ [Avatar]         │  │ [Avatar]         │
│ John D.          │  │ Sarah M.         │  │ Alex K.          │
│ Engineering Lead │  │ Product Manager  │  │ Freelancer       │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

- 3 testimonial cards on desktop, carousel on mobile
- Each card: star rating, quote, avatar, name, role
- Testimonial content is static (hardcoded) for MVP — managed via Admin Panel post-MVP

---

## 8. FAQ Section

General product FAQs.

### Layout

Accordion — click to expand each question.

### Questions (MVP)

| Question | Answer summary |
|----------|---------------|
| What is Teamority? | A project management tool for teams of all sizes |
| How is Teamority different from ClickUp / Asana? | Simpler by design, faster to get started, no feature bloat |
| What is Teamority? | A project management tool for teams of all sizes |
| How is Teamority different from ClickUp / Asana? | Simpler by design, faster to get started, open source |
| Is Teamority free? | Yes — Teamority is fully free and open source |
| Is my data secure? | Yes — data is encrypted at rest and in transit |
| Can I self-host Teamority? | Yes — it is open source and can be self-hosted |
| Can I import data from another tool? | Not yet — import is on the roadmap |
| Do you have a mobile app? | Not yet — the web app is mobile-friendly and works in all mobile browsers |

- Accordion style — one open at a time
- Content managed from Admin Panel → Help Center FAQ section post-MVP (static for MVP)

---

## 9. Final CTA Banner

A strong closing call to action before the footer.

### Layout

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│      Ready to bring your team together?              │
│                                                      │
│   Start for free — no credit card required.          │
│                                                      │
│              [Get Started for Free →]                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

| Element | Content |
|---------|---------|
| Headline | `"Ready to bring your team together?"` |
| Subtext | `"Free and open source — get started in minutes."` |
| CTA Button | `"Get Started →"` → `/sign-up` |

- Full-width section with a brand color background
- High contrast button (white on brand color)

---

## 10. Footer

### Layout

```
[Logo + Teamority]

Product          Company          Support          Legal
Features         About            Help Center      Privacy Policy
GitHub           Blog             Contact Us       Terms of Service
Changelog        Careers          Status           Cookie Policy

© 2026 Teamority. All rights reserved.     [Twitter] [GitHub] [LinkedIn]
```

### Footer links

**Product:**
- Features → `/#features`
- GitHub → link to GitHub repository
- Changelog → `/changelog` (post-MVP)

**Company:**
- About → `/about` (post-MVP — static page for MVP)
- Blog → `/blog` (post-MVP)
- Careers → `/careers` (post-MVP)

**Support:**
- Help Center → `/help`
- Contact Us → `/support/tickets/new`
- Status → external status page (post-MVP)

**Legal:**
- Privacy Policy → `/privacy`
- Terms of Service → `/terms`
- Cookie Policy → `/cookies`

**Social icons:** Twitter / X, GitHub, LinkedIn — link to official accounts

---

## Additional Pages (linked from landing page)

| Page | Route | Description |
|------|-------|-------------|
| Privacy Policy | `/privacy` | Legal — data handling and privacy |
| Terms of Service | `/terms` | Legal — usage terms |
| Cookie Policy | `/cookies` | Legal — cookie usage |
| About | `/about` | Company story (static, simple for MVP) |
| Help Center | `/help` | Knowledge base (see [Customer Support](./customer-support.md)) |

> Privacy, Terms, and Cookie pages are **required at launch** — no legal pages = cannot go live.

---

## SEO

| Tag | Value |
|-----|-------|
| `<title>` | `Teamority — Project Management for Modern Teams` |
| `meta description` | `"Organize tasks, run sprints, and collaborate in one place. Simple, fast, and built for teams of all sizes. Free to get started."` |
| `og:title` | `Teamority — Project Management for Modern Teams` |
| `og:description` | Same as meta description |
| `og:image` | Hero screenshot or branded OG image (1200×630px) |
| `og:url` | `https://teamority.com` |
| Canonical | `https://teamority.com` |
| Structured data | `Organization` schema + `SoftwareApplication` schema |

---

## Analytics Events (to track on landing page)

| Event | Trigger |
|-------|---------|
| `page_view` | Landing page loaded |
| `cta_click_hero` | Hero "Get Started" button clicked |
| `cta_click_nav` | Nav "Get Started" button clicked |
| `cta_click_final` | Final CTA banner button clicked |
| `view_tab_switch` | Views showcase tab switched |
| `faq_expand` | FAQ accordion item opened |
| `sign_in_click` | "Sign In" link clicked |

---

## Performance Requirements

| Metric | Target |
|--------|--------|
| Largest Contentful Paint (LCP) | < 2.5s |
| First Input Delay (FID) | < 100ms |
| Cumulative Layout Shift (CLS) | < 0.1 |
| Time to First Byte (TTFB) | < 600ms |
| Lighthouse score | 90+ (Performance, Accessibility, SEO) |

- Hero image / GIF must be optimized (Next.js `<Image>` component with `priority` flag)
- All fonts preloaded
- No blocking third-party scripts on initial paint

---

## Business Rules

1. The landing page must be fully accessible to unauthenticated users — no auth check on any landing page route.
2. If a logged-in user visits `/`, redirect them to `/` of their last active workspace (skip the landing page).
3. Legal pages (`/privacy`, `/terms`, `/cookies`) must be live before public launch.
4. All CTA buttons track analytics events — event fires before navigation (not after).

---

## Out of Scope (MVP)

- Blog (`/blog`)
- Changelog page (`/changelog`)
- Status page
- Careers page
- Affiliate / referral program page
- Interactive product demo (embedded sandbox)
- A/B testing on CTAs
- Live chat widget on landing page
- Localization / multi-language
