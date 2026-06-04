# Plans & Pricing

## Overview

Teamority offers tiered subscription plans. Plans control feature access and usage limits per Workspace. Plan configuration (pricing, limits, features) is fully managed by platform admins from the Admin Panel — no code change required to update pricing.

**Three surfaces this module covers:**
| Surface | Description |
|---------|-------------|
| Admin Panel — Plan Config | Platform admins configure plans, pricing, and limits |
| Landing Page — Pricing Section | Public-facing pricing page shown to visitors and logged-out users |
| App — Plan Enforcement | Limits enforced inside the app per workspace's active plan |

---

## 1. Plans

### Default Plans (MVP)

| Plan | Target | Price |
|------|--------|-------|
| **Free** | Individuals and small teams trying the product | $0 / month |
| **Pro** | Growing teams needing more power | Configurable by admin |
| **Business** | Larger teams needing higher limits | Configurable by admin |

Plans are applied per **Workspace** — not per user. Every member of a workspace uses the same plan.

---

## 2. Plan Limits

Each plan has configurable limits. Limits are enforced server-side on every relevant action.

### Limit Categories

| Limit | Free | Pro | Business |
|-------|------|-----|----------|
| Members per Workspace | 5 | 50 | Unlimited |
| Guests per Workspace | 2 | 20 | Unlimited |
| Spaces per Workspace | 3 | 20 | Unlimited |
| Lists per Space | 10 | Unlimited | Unlimited |
| Tasks per Workspace | 1,000 | Unlimited | Unlimited |
| Storage per Workspace | 100 MB | 5 GB | 50 GB |
| Max file size per upload | 5 MB | 25 MB | 100 MB |
| Sprints per List | 3 active history | Unlimited | Unlimited |
| Saved Filters per user | 5 | 20 | Unlimited |
| Activity log retention | 30 days | 1 year | Unlimited |
| Notification retention | 30 days | 90 days | 1 year |

> All default values above are configurable from the Admin Panel — they are not hardcoded.

### Feature Flags per Plan

Some features are gated entirely (on/off) rather than limited by count:

| Feature | Free | Pro | Business |
|---------|------|-----|----------|
| Board View | ✅ | ✅ | ✅ |
| Calendar View | ❌ | ✅ | ✅ |
| Sprints | ❌ | ✅ | ✅ |
| Recurring Tasks | ❌ | ✅ | ✅ |
| Guest Access | ✅ (limited) | ✅ | ✅ |
| Priority Support | ❌ | ❌ | ✅ |
| Admin Panel Impersonation (for support) | ❌ | ✅ | ✅ |

> Feature flags are also configurable from the Admin Panel — not hardcoded.

---

## 3. Admin Panel — Plan Configuration

Platform admins can fully configure plans from `/admin/plans`.

### Plan List Screen

Shows all plans in a table:
- Plan name
- Monthly price
- Annual price
- Member limit
- Status (Active / Hidden)
- Actions: Edit / Hide

### Edit Plan Screen

Each plan has a dedicated edit form with all configurable fields:

**Pricing:**
- Monthly price (USD) — number input
- Annual price (USD) — number input (typically ~20% discount)
- Currency (USD only for MVP)
- Show annual savings badge (toggle) — e.g. `"Save 20%"`

**Display (for landing page Pricing section):**
- Plan display name (e.g. `Pro`, `Business`)
- Tagline (short line under plan name, e.g. `"For growing teams"`)
- Highlighted / recommended (toggle) — marks this plan with a `"Most Popular"` badge on the pricing page
- CTA button label (e.g. `"Get Started"`, `"Start Free Trial"`, `"Contact Sales"`)
- CTA button action (enum: `signup` | `contact_sales`)
- Feature bullet list (ordered list of short feature highlights shown on the pricing card)
  - Each bullet: text + included (✅) or not included (❌)
  - Admins can add, edit, reorder, remove bullets
  - These are display-only marketing bullets — separate from actual enforced limits

**Limits (enforced server-side):**
- Members per workspace (number or `unlimited`)
- Guests per workspace (number or `unlimited`)
- Spaces per workspace (number or `unlimited`)
- Lists per Space (number or `unlimited`)
- Tasks per workspace (number or `unlimited`)
- Storage per workspace (MB / GB input with unit selector, or `unlimited`)
- Max file upload size (MB)
- Sprints per List (number or `unlimited`)
- Saved Filters per user (number or `unlimited`)
- Activity log retention days (number or `unlimited`)
- Notification retention days (number or `unlimited`)

**Feature Flags (enforced server-side):**
- Toggle on/off for each gated feature (Calendar View, Sprints, Recurring Tasks, etc.)

**Visibility:**
- Plan status: Active (shown on pricing page + available for assignment) / Hidden (existing workspaces keep it, but new signups cannot choose it — useful for legacy plans)

### Save & Publish

- Changes to pricing and display take effect on the pricing page **immediately** after saving
- Changes to limits take effect for new actions — existing data is NOT retroactively deleted
  - e.g. if member limit is lowered, existing members over the limit are NOT removed. New invites are blocked until they are under the limit.

---

## 4. Landing Page — Pricing Section

The public pricing page at `/pricing` (also a section on the main landing page).

### Layout

```
┌─────────────────────────────────────────────┐
│              Simple, transparent pricing     │
│         [Monthly]  ●──────  [Annual -20%]   │  ← billing toggle
└─────────────────────────────────────────────┘

┌───────────┐   ┌─────────────────┐   ┌───────────┐
│   Free    │   │   ★ Pro         │   │ Business  │
│   $0/mo   │   │   $12/mo        │   │  $29/mo   │
│           │   │  Most Popular   │   │           │
│ For indiv │   │ For growing     │   │ For large │
│ -uals     │   │ teams           │   │ teams     │
│           │   │                 │   │           │
│ ✅ 5 mem  │   │ ✅ 50 members   │   │ ✅ Unlim. │
│ ✅ 3 sp.  │   │ ✅ 20 spaces    │   │ ✅ Unlim. │
│ ❌ Cal.   │   │ ✅ Calendar     │   │ ✅ Unlim. │
│ ❌ Sprints│   │ ✅ Sprints      │   │ ✅ All    │
│ ...       │   │ ...             │   │ ...       │
│           │   │                 │   │           │
│[Get Start]│   │ [Get Started]   │   │[Get Start]│
└───────────┘   └─────────────────┘   └───────────┘

                   All plans include:
        ✅ Unlimited tasks    ✅ Board view
        ✅ Collaboration      ✅ File attachments
        ✅ Mobile-friendly    ✅ Customer support
```

### Billing toggle

- Monthly / Annual toggle at the top
- Switching to Annual updates all displayed prices to the annual monthly equivalent
- Annual savings badge shown (e.g. `"Save $24/year"`)
- Toggle state is remembered in local storage (persists on page refresh)

### Pricing card

- One card per Active plan (in order: Free → Pro → Business)
- Plan name, tagline, price (monthly or annual based on toggle)
- `"Most Popular"` badge on the highlighted plan
- Feature bullet list (configured in Admin Panel)
- CTA button — action based on plan config:
  - `signup` → redirects to `/sign-up?plan=pro`
  - `contact_sales` → opens a contact form modal or mailto link

### FAQ section (below pricing cards)

Static list of common pricing questions:
- Can I switch plans later?
- What happens when I hit a limit?
- Is there a free trial for Pro?
- Can I cancel anytime?
- Do you offer discounts for nonprofits or students?

FAQ content is managed from the Admin Panel (`/admin/plans/faq`) — same pattern as Help Center articles.

### Pricing data is fetched from API

The pricing page is **not hardcoded** — it fetches plan data from:
```
GET /api/plans  (public, no auth required)
```
This means updating pricing in the Admin Panel instantly updates the public pricing page without a deployment.

---

## 5. Plan Enforcement Inside the App

When a workspace hits a plan limit, the action is blocked with a clear upgrade prompt.

### Enforcement points

| Action | Enforcement |
|--------|-------------|
| Invite member (over member limit) | Block invite. Show: `"You've reached the X member limit on your Free plan. Upgrade to Pro to add more members."` |
| Create Space (over space limit) | Block creation. Show upgrade prompt. |
| Upload file (over storage limit) | Block upload. Show remaining storage + upgrade prompt. |
| Upload file (over max file size) | Block upload. Show: `"Files up to XMB are supported on your plan."` |
| Use Calendar View (not on plan) | Show upgrade prompt overlay instead of the view. |
| Create Sprint (not on plan) | Block with upgrade prompt. |
| Create Recurring Task (not on plan) | Block with upgrade prompt. |

### Upgrade prompt format

```
┌─────────────────────────────────────────┐
│  🔒  This feature is on the Pro plan   │
│                                         │
│  Upgrade to Pro to unlock:              │
│  ✅ Sprints                             │
│  ✅ Calendar View                       │
│  ✅ Recurring Tasks                     │
│  ✅ Up to 50 members                    │
│                                         │
│        [Upgrade to Pro →]               │
│        [Maybe later]                    │
└─────────────────────────────────────────┘
```

- Only Workspace Owner and Admin see the `[Upgrade to Pro →]` button (links to `/pricing`)
- Members and Guests see: `"Contact your workspace admin to upgrade"`
- Prompt is shown as a modal or inline banner depending on context

### Usage indicator

Workspaces approaching limits (80%+ used) see a soft warning:

- Members: shown in Workspace Settings → Members (e.g. `"4 of 5 members used"`)
- Storage: shown in Workspace Settings → Storage (e.g. `"87 MB of 100 MB used"`)
- Tasks: shown in Workspace Settings → Usage

---

## Data Model

```
Plan
├── id                  (uuid, primary key)
├── name                (string — e.g. "free", "pro", "business")
├── display_name        (string — shown on pricing page, e.g. "Pro")
├── tagline             (string, nullable — e.g. "For growing teams")
├── monthly_price_usd   (decimal — 0 for free)
├── annual_price_usd    (decimal — monthly equivalent when billed annually)
├── is_highlighted      (boolean — "Most Popular" badge)
├── cta_label           (string — e.g. "Get Started")
├── cta_action          (enum: signup | contact_sales)
├── status              (enum: active | hidden)
├── order_index         (integer — display order on pricing page)
├── created_at          (timestamp)
└── updated_at          (timestamp)

PlanLimit
├── id                  (uuid, primary key)
├── plan_id             (foreign key → Plan)
├── limit_key           (string — e.g. "max_members", "max_storage_mb", "max_spaces")
├── limit_value         (integer — -1 means unlimited)
└── updated_at          (timestamp)

PlanFeatureFlag
├── id                  (uuid, primary key)
├── plan_id             (foreign key → Plan)
├── feature_key         (string — e.g. "calendar_view", "sprints", "recurring_tasks")
└── is_enabled          (boolean)

PlanBullet
├── id                  (uuid, primary key)
├── plan_id             (foreign key → Plan)
├── text                (string — e.g. "Up to 50 members")
├── is_included         (boolean — ✅ or ❌)
└── order_index         (integer)

Workspace
├── ...
├── plan_id             (foreign key → Plan)
├── plan_override_id    (foreign key → PlanOverride, nullable)
└── ...
```

> **Effective plan resolution:**
> `workspace.plan_override_id` takes precedence over `workspace.plan_id` if a valid (non-expired) override exists.

---

## API Endpoints

### Public (no auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/plans` | Get all active plans with limits, feature flags, and bullets (for pricing page) |

### Authenticated

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/workspaces/:id/plan` | Get current plan + usage stats for a workspace | Member+ |
| GET | `/api/workspaces/:id/usage` | Get current usage vs limits | Member+ |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/plans` | List all plans |
| GET | `/api/admin/plans/:id` | Get plan detail with all limits and flags |
| PATCH | `/api/admin/plans/:id` | Update plan (pricing, display, limits, flags, bullets) |
| PATCH | `/api/admin/plans/:id/bullets` | Update feature bullets (reorder, add, remove) |
| GET | `/api/admin/plans/faq` | Get pricing FAQ items |
| PATCH | `/api/admin/plans/faq` | Update pricing FAQ items |

---

## UI Screens

| Screen | Route | Access |
|--------|-------|--------|
| Public Pricing Page | `/pricing` | Public |
| Pricing section on Landing Page | `/` (section) | Public |
| Workspace Usage & Plan | `/settings/plan` | Owner / Admin |
| Admin — Plan List | `/admin/plans` | Platform Admin |
| Admin — Edit Plan | `/admin/plans/:id/edit` | Platform Admin |
| Admin — Pricing FAQ | `/admin/plans/faq` | Platform Admin |

---

## Data Lifecycle

### Plan Records
- Plan records (`Plan`, `PlanLimit`, `PlanFeatureFlag`, `PlanBullet`) are **never hard-deleted** in MVP.
- Plans can be set to `status = hidden` to retire them — hidden plans are invisible to new signups and the public pricing page but remain valid for workspaces already on them.
- Changing limits or feature flags on a Plan takes effect immediately for all workspaces on that plan.

### Plan Overrides
- `PlanOverride` records use **soft retention** — when an override expires or is removed, `reverted_at` is set on the record. The record is kept for audit history.
- Override history is never deleted individually — it is only removed if the parent Workspace is deleted.

### Data on Plan Downgrade
- **Lowering limits does NOT delete existing data** — it only blocks new actions once the limit is exceeded.
  - Example: Downgrading from Pro (50 members) to Free (5 members) does not remove existing members over the limit. New invites are blocked until membership drops below 5.
  - Example: Reducing storage limit does not delete existing files. New uploads are blocked until storage is below the new limit.
- **Disabling a feature flag does NOT delete feature data:**
  - Disabling Sprints: existing Sprint records are preserved. Sprint UI is hidden. On re-enable, all Sprint data is accessible again.
  - Disabling Calendar View: no data impact (it's a view-only feature, no data stored).
  - Disabling Recurring Tasks: existing recurring task rules are preserved but no new recurrences are generated. On re-enable, recurrence resumes from the next scheduled date.

### Recovery Period
- **Plan downgrade:** No recovery needed — data is never deleted on downgrade.
- **Plan override expiry:** Workspace reverts to base plan automatically. `PlanOverride` record is kept with `reverted_at` set.

---

## Business Rules

1. Plans are applied per Workspace — individual users do not have plans.
2. Pricing page data is fetched from the API at runtime — not hardcoded in the frontend.
3. Lowering a plan limit does NOT retroactively remove existing data — it only blocks new actions once the limit is reached.
4. A platform admin's plan override takes precedence over the workspace's assigned plan.
5. An expired plan override reverts the workspace to its base `plan_id` — not necessarily Free (a workspace could be on Pro with an override that expires, reverting to Pro).
6. Only Workspace Owner and Admin can see the upgrade prompt CTA — Members and Guests see a "contact your admin" message instead.
7. `limit_value = -1` in `PlanLimit` means unlimited — this is the sentinel value used across all limit checks.
8. `is_highlighted = true` on only one plan at a time — the pricing page shows only one "Most Popular" badge. Admin Panel enforces this (selecting a new highlighted plan unsets the previous one).
9. Hidden plans are not returned by `GET /api/plans` — they are invisible to the public pricing page and new signups but remain valid for existing workspaces that already have them.
10. Annual pricing is stored as the monthly equivalent (price per month when billed annually) — the actual annual charge is `annual_price_usd * 12`.

---

## Out of Scope (MVP)

- Stripe payment integration (billing is manual / sales-led in MVP)
- Per-seat pricing (current model is flat per workspace)
- Free trial period (e.g. 14-day Pro trial)
- Promo codes and discounts
- Invoice generation and download
- Automatic plan downgrade when payment fails
- Multi-currency pricing
- Usage-based billing (pay per task / per GB)
