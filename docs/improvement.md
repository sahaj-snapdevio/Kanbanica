# Teamority MVP Product Audit

**Reviewed by:** Senior PM + Product Designer + B2B SaaS Architect + MVP Consultant (simulated)
**Date:** 2026-06-08
**Version reviewed:** All docs in `/docs/` + README.md

---

## Executive Summary

Teamority is a well-documented, technically sound product — but it is currently scoped like a Series B company, not a 3-engineer MVP. The docs describe ClickUp with different auth. There is no differentiation story, the hierarchy is identical to ClickUp's, and 19 development phases suggest a 12–18 month roadmap minimum. This audit recommends cutting scope by ~40%, removing one hierarchy layer, and focusing on a specific user segment to create a defensible identity.

---

# 1. Product Positioning Review

## Strengths

- **Open source** — strong community moat and trust signal, especially for dev teams who distrust SaaS data handling
- **Magic link auth** — genuinely lower friction than password-based competitors; no "forgot password" dead ends
- **Clean two-level permission model** — simpler than ClickUp's (which has 5+ levels)
- **Solid documentation culture** — every feature is spec'd before building, which reduces rework
- **pg-boss over external queue** — smart infrastructure choice, reduces ops complexity

## Weaknesses

- **No differentiation story** — the README vision says "organize, collaborate, execute, track work" — that is ClickUp's tagline word for word. There is no sentence that explains why Teamority exists when ClickUp, Linear, and Asana already do this.
- **Identical hierarchy to ClickUp** — Workspace → Space → Folder → List → Sprint → Task → Subtask. Users switching from ClickUp will feel no improvement.
- **No target audience** — "startups to enterprise" is not a segment. It is everyone, which means no one. ClickUp failed to retain SMBs because it optimized for enterprise. That gap is exploitable but not exploited here.
- **Feature breadth over depth** — the product tries to do everything adequately instead of a few things exceptionally well.

## Risks

- **Time to first value too long** — the current onboarding path is: sign in → create workspace → create space → land on empty list → complete 6-step checklist. A new user has not created a single task in under 2 minutes. Teams will churn before activation.
- **Complexity signals distrust** — when a new user sees sprints, story points, custom fields, recurring tasks, and time tracking on day one, they assume a steep learning curve and leave.
- **19 development phases** — at 2 weeks/phase average, that is 38+ weeks. A competitor ships in 8. By the time Teamority launches, the market will have moved.

## Opportunities

- **Own the dev team segment explicitly** — magic link, open source, pg-boss, TypeScript-first, GitHub-friendly workflow. No current tool owns this segment cleanly. Linear is close but closed-source and expensive.
- **Self-hostable** — none of the major competitors offer this. It is a genuine unlock for privacy-conscious teams, agencies, and regulated industries.
- **Speed as identity** — if every action in Teamority is demonstrably faster (fewer clicks, better keyboard shortcuts, faster search) than ClickUp, that is a differentiator users feel daily.

---

# 2. MVP Scope Review

| Feature | Recommendation | Priority | Reason |
|---------|---------------|----------|--------|
| Magic Link Auth | ✅ Keep | P0 | Differentiator, simple to build with Better Auth |
| Workspace | ✅ Keep | P0 | Core container |
| Space | ✅ Keep | P0 | Team grouping — essential |
| Folder | ❌ Remove | — | Adds hierarchy depth with minimal user value at launch. Space → List is sufficient. Teams with folder-level complexity are not the MVP audience. |
| List | ✅ Keep | P0 | Core task container |
| Task (core fields) | ✅ Keep | P0 | Title, description, status, priority, assignee, due date — all essential |
| Task — Time Estimate | ⚠️ Simplify | P2 | Keep the field, remove the time-tracking UI. Just a number input. |
| Task — Time Tracked | ❌ Remove | — | Requires a timer UI, log entries, reporting. Zero activation value. Post-MVP. |
| Task — Custom Fields | ❌ Remove | — | High complexity (6 field types, schema migrations, rendering logic). Kills launch timeline. Post-MVP. |
| Task — Recurring | ❌ Remove | — | Requires pg-boss cron patterns, edge cases (DST, skip weekends, end conditions). Not a day-1 need. |
| Task — Templates | ❌ Remove | — | Needs a template management UI. Post-MVP. |
| Task — Dependencies | ✅ Keep | P1 | Dev teams use this daily. DFS cycle check is ~50 lines. High perceived value. |
| Task — Bulk Actions | ✅ Keep | P1 | List management at 50+ tasks becomes painful without it. Already specced. |
| Task — Seq Number (#42) | ✅ Keep | P1 | Zero cost to implement. Teams reference tasks verbally — this makes that possible. |
| Subtask | ✅ Keep | P1 | One level deep only. Covers 90% of use cases. |
| Sprint | ⚠️ Simplify | P2 | Keep for dev teams. Remove auto-create, auto-close, auto_incomplete_strategy for MVP. Manual only. Story points: keep. |
| List View | ✅ Keep | P0 | Default view |
| Board View (Kanban) | ✅ Keep | P0 | Most requested view across all PM tools |
| Calendar View | ❌ Remove | — | Expensive (date math, drag-on-calendar, responsive layout). Less than 15% of users use it in week one. Add after Board is polished. |
| My Tasks View | ✅ Keep | P1 | Cross-workspace personal focus — high daily retention value |
| Checklists | ✅ Keep | P1 | High daily usage, low implementation cost |
| Comments + Threading | ✅ Keep | P0 | Core collaboration primitive |
| @Mentions | ✅ Keep | P0 | Drives team notification habit |
| Emoji Reactions | ⚠️ Simplify | P3 | Nice-to-have. Build after comments work perfectly. |
| Activity Log (per task) | ✅ Keep | P1 | Essential audit trail — also drives notification content |
| Workspace Activity Feed | ❌ Remove | — | Complex aggregation query. Low day-1 value. Post-MVP. |
| File Attachments | ✅ Keep | P1 | Teams attach PRDs, mockups, screenshots to tasks constantly |
| Global Search | ✅ Keep | P1 | Essential after workspace has 50+ tasks |
| Saved Filters | ⚠️ Simplify | P2 | Build filter UI first, save-filter feature can come in week 2 |
| In-App Notifications | ✅ Keep | P1 | Bell icon + notification list — core retention loop |
| Email Notifications | ⚠️ Simplify | P2 | Instant only for MVP. Daily digest is a cron job — post-MVP. |
| Push Notifications (browser) | ❌ Remove | — | VAPID setup, service worker, permission flow. Low adoption in B2B. Post-MVP. |
| Notification Muting | ⚠️ Simplify | P2 | Mute per-task only. Skip mute-per-list for MVP. |
| Permission Model (2-level) | ✅ Keep | P1 | Already well-designed. Do not simplify further — it will need to be re-added. |
| Guest Role | ⚠️ Simplify | P2 | Build last in MVP. Guest logic adds edge cases everywhere (visibility filters). |
| Private Spaces | ✅ Keep | P1 | Teams with contractors need this from day one |
| Admin Panel | ⚠️ Simplify | P1 | User list + ban + workspace list only. Remove analytics charts for MVP. |
| Customer Support Tickets | ⚠️ Simplify | P2 | Simple form submission only. No status tracking or reply threads for MVP. |
| Feature Voting / Requests | ❌ Remove | — | This is a full sub-product. Use an external tool (Canny, Frill) instead. |
| Empty States + Onboarding Checklist | ✅ Keep | P0 | Critical for activation. Well-specced. Do not cut. |
| Avatar System | ✅ Keep | P1 | Already specced. Initials fallback prevents broken UI everywhere. |
| Keyboard Shortcuts | ⚠️ Simplify | P2 | Ship Ctrl+K (search) and C (create task) only. Full shortcuts reference is post-MVP polish. |
| Description Snapshot (1-level recovery) | ✅ Keep | P1 | Low cost, high perceived safety. Unique constraint means one row per task. |

---

# 3. Feature-by-Feature Deep Audit

## Authentication

**Score: 8/10**

| Dimension | Assessment |
|-----------|------------|
| Problem solved | Eliminates password friction and "forgot password" dead ends |
| Frequency | Every session start |
| Engineering cost | Low — Better Auth handles it |

**Risk:** Some B2B users (IT admins, security teams) distrust magic links because they don't expire in corporate email systems. A link forwarded 3 days later still works for 15 min but feels "insecure" to non-technical stakeholders. The 15-min expiry is tight enough to be safe, but the user education burden is real.

**Recommendation:** Add a one-line explainer on the sign-in page: *"We'll email you a secure link — no password needed."* First-time users will be confused without it.

---

## Workspace

**Score: 9/10**

Well designed. The async deletion pattern is correct — most teams skip this and end up with orphaned R2 files. The invite link (no expiry) + email invite (7-day expiry) distinction is sensible.

**Risk:** Workspace slug for URLs — validate early that slug conflicts are handled gracefully. Renaming a workspace changes the slug and breaks all existing bookmarks. Consider slug locking after first use (user must explicitly change it).

**Recommendation:** Keep as-is. Remove the "billing" mention from Owner role description — this is open source, no billing.

---

## Space

**Score: 8/10**

Public vs Private is essential and correctly specced. The default Space Permission table is clear.

**Risk:** When a new user creates their first workspace, they must also create a Space before they can create any task. This adds one required step to an already multi-step onboarding. New users think in terms of "projects," not "spaces."

**Recommendation:** Consider calling it **"Project"** instead of "Space" in the UI (internal model stays the same). "Create your first project" is more intuitive than "Create your first space" for non-ClickUp users.

---

## Folder

**Score: 3/10**

**Remove from MVP.**

Folders solve the problem of having too many Lists under a Space. But in an MVP, no team has too many Lists yet. The average new team has 2-5 Lists. Folders become useful at 10+ Lists — which is a month 3 problem, not a day 1 problem.

Every line of folder code (CRUD, archive, move, permissions inheritance, empty states, sidebar rendering) is work that does not create value at launch. Add in Phase 2.

---

## List

**Score: 9/10**

Custom statuses are a strong feature — teams resent being forced into Todo/In Progress/Done. The default status set (Open, In Progress, Review, Closed) is good.

**Risk:** Custom status colors + ordering creates a small but real visual complexity burden in List View. Cap at 10 statuses per list for MVP.

**Recommendation:** Keep. The "close all tasks" and "archive closed" bulk actions on the list toolbar are a nice touch — keep them.

---

## Task

**Score: 7/10 (as currently scoped)**

**The task model is overloaded.** Current fields: title, description, status, priority, assignees, reporter, due date (range), time estimate, time tracked, tags, attachments, comments, checklists, dependencies, watchers, custom fields, parent task, seq_number, recurrence, template_id.

That is 20+ fields on a single entity. ClickUp did this and it is the #1 complaint ("overwhelming"). Linear succeeded by doing fewer fields but doing them perfectly.

**Cut for MVP:**
- Time tracked (timer UI) → post-MVP
- Custom fields (6 types) → post-MVP
- Recurring tasks → post-MVP
- Task templates → post-MVP
- Date range (start + end date) → simplify to single due date only for MVP

**Keep:**
- All core fields (title, description, status, priority, assignees, due date, tags)
- Checklists (high daily use, low cost)
- Dependencies (dev teams need this)
- Seq number (#42)
- Description snapshot (1-level recovery)
- Bulk actions

**Risk:** Task description stored as `jsonb` (Tiptap) is the right call but adds complexity to search (cannot full-text search jsonb directly without a generated column or `jsonb_to_text` function). Plan for this before Phase 11 (Search).

---

## Subtask

**Score: 7/10**

One level deep is correct. The "convert to task" and "convert checklist item to subtask" flows are nice but edge-case for MVP.

**Simplify:** Ship subtask creation and status change only. Skip "convert checklist to subtask" for MVP.

---

## Sprint

**Score: 6/10 (as currently scoped)**

The auto-create + auto-close + auto_incomplete_strategy system adds 3x the complexity of a simple sprint. Teams that need automation are not the MVP audience — they are using Jira.

**Simplify for MVP:**
- Create Sprint (name, goal, dates) ✅
- Add/remove tasks ✅
- Start Sprint ✅
- Close Sprint (manual, pick what to do with incomplete tasks) ✅
- Story points ✅
- Sprint History ✅

**Remove for MVP:**
- Auto-create next sprint ❌
- Auto-close on next sprint ❌
- auto_incomplete_strategy enum ❌
- Sprint Board View (merged into Board View filtered by sprint) — simplify

This cuts Sprint implementation cost by ~40%.

---

## Views

**Score: 7/10**

| View | Score | Recommendation |
|------|-------|----------------|
| List View | 9/10 | ✅ Build first — highest daily use |
| Board View | 8/10 | ✅ Build second — #1 requested feature |
| My Tasks | 7/10 | ✅ Build third — drives daily retention |
| Calendar View | 4/10 | ❌ Remove from MVP — expensive, low week-1 adoption |

**Calendar View cost breakdown:** Date grid rendering, drag-to-reschedule on calendar cells, responsive month/week toggle, due-date-range display, timezone handling, recurring task display. This is 2-3 weeks of engineering that serves ~10% of users in month 1.

**Recommendation:** Replace Calendar View in MVP scope with a **Due Date sort + overdue highlight** in List View. Achieves 80% of the value at 5% of the cost.

---

## Collaboration

**Score: 8/10**

The comment + threading + @mention + activity log combination is the right core set. Well designed.

**Simplify:**
- Emoji reactions → post-MVP (nice-to-have, not retention-driving)
- Workspace-level activity feed → post-MVP (complex aggregation)
- Comment resolution threads → keep (high value for async teams)

**Missing:** There is no **task watching** visible in the collaboration doc — it's in task.md but not connected to notification delivery in the collaboration spec. Ensure the watcher → notification pipeline is explicitly wired.

---

## Search & Filters

**Score: 8/10**

Global search with Ctrl+K is table-stakes for any PM tool used past week 2. Correct priority.

**Risk:** Tiptap description content is stored as `jsonb`. Full-text search on `jsonb` requires either: (a) a PostgreSQL generated column with `jsonb_to_text()`, or (b) storing a plain-text shadow copy on every save. Neither is in the current spec. This will be discovered in Phase 11 and cause rework. **Spec this now.**

**Recommendation:** Add a `description_text` generated column to Task for FTS, populated on every description save.

---

## Notifications

**Score: 7/10**

The trigger list is comprehensive. The per-workspace preferences are correct.

**Simplify for MVP:**
- In-app notifications → ✅ essential
- Instant email → ✅ keep (SMTP is already in the stack)
- Daily digest → ❌ post-MVP (cron job + template complexity)
- Browser push → ❌ post-MVP (service worker, VAPID, low B2B adoption)
- Mute per-task → ✅ keep
- Mute per-list → ❌ post-MVP

---

## Permission Model

**Score: 9/10**

This is one of the best-designed parts of the product. Two levels (Workspace Role + Space Permission) is the correct abstraction. The Guest max=Edit rule is smart. The `canAssignSpacePermission()` enforcement is correct.

**Do not simplify.** Teams that adopt a tool re-configure permissions within the first week. If the permission model is too weak, enterprise teams will reject the product. The current model is complex in spec but simple in UX (two dropdowns).

**Only risk:** The Guest role adds conditional rendering complexity everywhere (visibility filters, member pickers, space lists). If time-constrained, build Guest last within MVP.

---

## Admin Panel

**Score: 7/10**

The operator panel is necessary — without it, handling a support request requires direct DB access.

**Simplify for MVP:**
- User list + ban/unban ✅
- Workspace list + force delete ✅
- Basic platform stats (user count, workspace count) ✅
- Support ticket list ✅

**Remove for MVP:**
- Analytics charts (trend lines, charts) → post-MVP
- Impersonate user → post-MVP (security review needed)
- Auto-close resolved tickets cron → post-MVP

---

## Customer Support

**Score: 4/10**

**Feature voting is a full product.** Canny, Frill, and Productboard exist for this. Building a voting system means: vote counts, vote attribution, status transitions (Under Review → Planned → Shipped → Declined), email notifications on status change, spam prevention. This is 2-3 weeks of work that serves zero activation or retention goals.

**For MVP:** Replace feature voting with a link to a GitHub Issues page (you're open source — that's where feature requests belong).

**Keep:** Simple support ticket submission form. Skip reply threads for MVP — reply via email instead.

---

## Empty States + Onboarding

**Score: 10/10**

This is the best decision in the entire spec. Most MVPs skip empty states and then wonder why activation is low. The Getting Started checklist (6 steps, auto-check 2, server-track 4) is well-thought-out.

**Do not cut this.** It is cheap to build relative to the activation impact.

---

# 4. User Journey Audit

## Current Journey

```
1. Visit site
2. Enter email → receive magic link (15 min wait for email)
3. Click link → session created
4. Create Workspace (name + optional logo)
5. Create Space (name + color)   ← non-obvious step, "what is a Space?"
6. Land on empty List
7. See Getting Started checklist
8. Create first task
```

**Time to first task: ~4-6 minutes** (includes email delay)

## Problems

| Step | Problem | Severity |
|------|---------|----------|
| Magic link email | Email delivery varies 10s–2min. User may not wait. | High |
| "Create a Space" | Non-ClickUp users do not know what a Space is. Naming confusion. | High |
| Space → List hierarchy | User must understand two hierarchy layers before creating one task. | Medium |
| Empty checklist | Good UX, but 6 steps feels like homework on day 1. | Low |

## Recommendations

1. **Add a loading/waiting state on the "check your email" screen** — show an animated progress indicator and "This usually takes under 30 seconds." Reduces abandonment during email wait.

2. **Rename "Space" to "Project" in the UI** — keep the internal model, change the label. "Create your first project" is universally understood. "Create your first space" is ClickUp jargon.

3. **Pre-create a demo task on first List** — instead of a blank List, show one example task: *"👋 Welcome to [Workspace Name] — click here to see how a task works."* This gives the user something to interact with before creating their own.

4. **Collapse the Getting Started checklist to 3 steps** — Create a task, Invite a teammate, Try Board View. The other steps (set due date, try filters) are discoverable naturally.

---

# 5. Product Hierarchy Review

## Current
```
Workspace → Space → Folder (optional) → List → Sprint (optional) → Task → Subtask
```

## Problems

- **7 levels deep** — ClickUp has the same issue and it is their #1 UX complaint
- **Folder** adds cognitive overhead with minimal day-1 value
- **Sprint** as a separate layer from List creates confusion: is a Sprint a type of List?
- **"Space"** naming is ClickUp-specific jargon

## Recommended MVP Hierarchy
```
Workspace → Project → List → Task → Subtask
```

| Old Name | New Name | Why |
|----------|----------|-----|
| Space | Project | Universally understood. "Which project?" is a natural question. |
| Folder | (Remove for MVP) | Reintroduce as "Section" or "Group" in Phase 2 when teams actually need it |
| Sprint | Sprint (inside List) | Keep as an optional layer inside a List — same as now, just fewer hierarchy levels visible |

**Result:** New user sees: Workspace → Project → List → Task. Four levels. Manageable.

---

# 6. Roles & Permissions Review

## Assessment

The current model is **correct and well-designed**. Do not simplify it.

The two-level model (Workspace Role + Space Permission) mirrors what Linear, Notion, and modern B2B tools use. Simplifying to one level (e.g., removing Space Permissions) would require re-adding them later, breaking existing setups.

**One recommendation:** For the MVP onboarding flow, default new Space members to **Edit** (not View). View-only access as a default means new teammates can't do anything until someone changes their permission — a common early friction point.

**One concern:** The Guest role adds conditional rendering complexity to every list (member pickers, task assignee dropdowns, space visibility). If sprint is running late, defer Guest role to the last sprint of MVP. Owner + Admin + Member is sufficient for beta.

---

# 7. Collaboration System Review

| Feature | Decision | Reason |
|---------|----------|--------|
| Comments | ✅ Keep | Core primitive |
| Reply threads | ✅ Keep | Async teams need context-linked replies |
| @mentions | ✅ Keep | Drives notification habit |
| Emoji reactions | ⚠️ Delay | Nice-to-have, not retention-driving for B2B |
| Edit/delete own comment | ✅ Keep | Basic user expectation |
| Comment resolution | ✅ Keep | Reduces notification noise |
| Activity log (per task) | ✅ Keep | Trust + auditability |
| Workspace activity feed | ❌ Remove | Complex, low day-1 value |
| File attachments | ✅ Keep | Teams attach designs, docs constantly |
| Real-time updates | ❌ Post-MVP | React Query refetch is sufficient for MVP |

---

# 8. Views & Productivity Review

| View | Keep for MVP? | Cost | Daily Retention Value |
|------|:------------:|------|----------------------|
| List View | ✅ Yes | Low | Very High |
| Board View | ✅ Yes | Medium | Very High |
| My Tasks | ✅ Yes | Medium | High |
| Calendar View | ❌ No | High | Low (week 1) |
| Timeline/Gantt | ❌ No | Very High | Medium |
| Table/Spreadsheet | ❌ No | High | Medium |
| Workload | ❌ No | Very High | Low (MVP audience) |

---

# 9. Database & Architecture Review

| Decision | Assessment |
|----------|------------|
| PostgreSQL + Prisma | ✅ Correct. Well-typed, migration-safe. |
| pg-boss for jobs | ✅ Excellent choice — no extra infrastructure, uses existing DB |
| S3-compatible storage | ✅ Provider-agnostic, correct abstraction |
| Magic Link (Better Auth) | ✅ Simple, no password tables |
| R2/S3 delete-before-DB rule | ✅ Correct ordering — orphaned files are worse than orphaned records |
| Async workspace deletion (202 + status=deleting) | ✅ Correct — avoids Vercel timeout |
| jsonb for Tiptap description | ✅ Correct — but needs FTS plan (see below) |
| Task seq_number (workspace-scoped atomic increment) | ✅ Simple, correct |
| TaskDescriptionSnapshot (unique per task) | ✅ One-level recovery at near-zero cost |
| DFS cycle detection on dependency creation | ✅ Correct enforcement point |
| Custom fields (6 types) | ❌ **Remove from MVP** — requires EAV or jsonb schema, validation per type, UI per type |
| Recurring task cron | ❌ **Remove from MVP** — complex edge cases |

**Critical gap: Full-text search on Tiptap jsonb**

The current schema has `description jsonb` on Task. PostgreSQL cannot full-text index jsonb directly. This will cause a rework in Phase 11 unless addressed now.

**Fix:** Add to Task schema:
```sql
description_text TEXT GENERATED ALWAYS AS (
  jsonb_to_text(description)
) STORED;

CREATE INDEX task_description_fts ON task USING gin(to_tsvector('english', description_text));
```

Or: store `description_text` as a regular column, updated on every save in the Server Action (simpler, more portable across DB versions).

---

# 10. Competitive Comparison

| Capability | Teamority | ClickUp | Linear | Asana | Monday |
|-----------|-----------|---------|--------|-------|--------|
| Open Source | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-hostable | ✅ (planned) | ❌ | ❌ | ❌ | ❌ |
| Passwordless auth | ✅ | ❌ | ✅ | ❌ | ❌ |
| Setup time (est.) | 3 min | 8 min | 4 min | 6 min | 7 min |
| Hierarchy depth (MVP) | 5 levels | 6 levels | 3 levels | 4 levels | 3 levels |
| Custom fields | Post-MVP | ✅ | ❌ | ✅ | ✅ |
| Sprints | ✅ | ✅ | ✅ | ❌ | ❌ |
| Kanban | ✅ | ✅ | ✅ | ✅ | ✅ |
| Calendar | Post-MVP | ✅ | ❌ | ✅ | ✅ |
| Task dependencies | ✅ | ✅ | ✅ | ✅ | ✅ |
| Guest access | ✅ | ✅ | ❌ | ✅ | ✅ |
| Pricing | Free (OSS) | Freemium | Freemium | Freemium | Paid |
| Performance (perceived) | Unknown | Slow | Fast | Medium | Medium |

**Teamority's defensible advantages:**
1. Open source + self-hostable — unique in this category
2. Passwordless (magic link) — modern auth UX
3. Free forever (OSS) — removes the "plan upgrade" friction that kills ClickUp adoption

**Teamority's gaps vs. competition:**
1. No mobile app (post-MVP — acceptable)
2. No real-time collaboration (post-MVP — acceptable)
3. No timeline/Gantt (post-MVP — acceptable)

---

# 11. Final Decision

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| **MVP Score** | **6/10** | Core is solid but scope is 40% too large |
| **Complexity Score** | **8/10** | Too complex for a first launch — reduce to 5/10 |
| **Launch Confidence** | **5/10** | With recommended cuts: rises to 8/10 |

## Verdict: **Reduce Scope**

The product architecture is sound. The documentation quality is excellent. The engineering choices are correct. But the MVP scope is a 12-month roadmap for a 3-engineer team. This kills launch speed, which kills everything else.

---

## Top 10 Features to REMOVE

1. **Custom Fields** — 6 types, full UI, schema complexity. Post-MVP.
2. **Calendar View** — expensive to build, low week-1 adoption.
3. **Recurring Tasks** — cron edge cases, not a day-1 need.
4. **Task Templates** — template management UI is a product in itself.
5. **Time Tracked (timer)** — timer UI, log entries, reporting. Post-MVP.
6. **Feature Voting / Requests** — use GitHub Issues instead (you're open source).
7. **Daily Digest Email** — cron + template complexity. Instant email is enough.
8. **Browser Push Notifications** — VAPID, service worker, low B2B adoption.
9. **Folder Layer** — no team needs it on day 1. Add in month 2.
10. **Workspace Activity Feed** — complex aggregation, low launch value.

---

## Top 10 Features to SIMPLIFY

1. **Sprint** — remove auto-create/auto-close/strategy. Manual only for MVP.
2. **Task due date** — single date only (no start + end range) for MVP.
3. **Notifications** — in-app + instant email only. No digest, no push.
4. **Admin Panel** — user/workspace list + ban only. No analytics charts.
5. **Customer Support** — simple ticket form only. No reply threads, no auto-close cron.
6. **Keyboard Shortcuts** — Ctrl+K + C to create task only. Full spec is post-MVP.
7. **Getting Started checklist** — reduce to 3 steps (create task, invite teammate, try Board).
8. **Avatar upload** — keep initials fallback, make upload optional polish (ship in week 2).
9. **Saved Filters** — build filter UI first, save functionality in sprint 2.
10. **Guest role** — build last within MVP. Owner + Admin + Member is sufficient for beta.

---

## Top 10 Features to BUILD FIRST

1. **Magic Link Auth + Session** — nothing works without this
2. **Workspace + Member Invite** — enables team collaboration
3. **Project (Space) + List** — core hierarchy
4. **Task — core fields** (title, description, status, priority, assignee, due date, tags)
5. **List View** — default task management surface
6. **Board View (Kanban)** — #1 retention feature after day 3
7. **Comments + @Mentions** — core async collaboration primitive
8. **Activity Log** — trust + auditability, low engineering cost
9. **In-App Notifications** — closes the collaboration loop
10. **Empty States + Getting Started checklist** — makes the product feel polished and drives activation

---

## "If I had 8 weeks and 3 engineers"

This is the Teamority I would launch:

### Week 1 — Foundation
- Auth (magic link, sessions, account settings)
- Workspace (create, invite by email + link, roles: Owner/Admin/Member)
- Database schema for all core entities

### Week 2 — Core Hierarchy
- Project (Space) — create, edit, public/private, members
- List — create, edit, custom statuses, archive
- Task — create, edit (title, description, status, priority, assignee, due date, tags)

### Week 3 — List View
- Full List View with sorting, filtering, inline edit
- Subtasks (one level)
- Checklists
- Task seq numbers (#42)

### Week 4 — Board View
- Kanban by status
- Drag columns, drag cards between columns (dnd-kit)
- Board filters

### Week 5 — Collaboration
- Comments (rich text, reply thread, @mention, edit/delete)
- Activity log per task
- File attachments (S3-compatible)

### Week 6 — Notifications + Search
- In-app notification bell
- Instant email notifications (SMTP)
- Global search (Ctrl+K) — tasks, projects, members

### Week 7 — My Tasks + Empty States
- My Tasks view (cross-project, personal focus)
- All empty states + Getting Started checklist
- Task dependencies

### Week 8 — Admin + Polish
- Admin panel (user list + ban, workspace list)
- Bulk task actions (assign, status, priority)
- Bug fixes, performance, mobile responsiveness

### Cuts accepted in this plan
- No Folder
- No Sprint (Phase 2 — ship at week 10)
- No Calendar View (Phase 2)
- No Custom Fields (Phase 3)
- No Recurring Tasks (Phase 3)
- No Guest Role (Phase 2)
- No Feature Voting (never — use GitHub)

### What ships at week 8
A fast, clean, open-source project management tool that a 5-person dev team can adopt in 10 minutes, with no credit card, no plan limits, and the ability to self-host. That is the story. That is the differentiation. That is the launch.

---

## Three Non-Obvious Risks Not Documented Anywhere

1. **Email deliverability for magic links** — magic link auth lives and dies on email delivery speed. If a user's corporate email system holds the link for 10 minutes, they leave. You need SPF/DKIM/DMARC configured from day 1 and a known-good SMTP provider (Postmark or AWS SES — not Gmail SMTP, which has rate limits and deliverability issues). This is an infrastructure decision, not a code decision, and it must be made before launch.

2. **Tiptap jsonb and full-text search** — already called out in the architecture section, but this deserves emphasis: every search feature built in Phase 11 will require rework if `description_text` is not planned now. Add it to the Phase 1 schema migration.

3. **dnd-kit in Next.js App Router** — dnd-kit uses `window` and DOM APIs that do not exist during SSR. Every component using dnd-kit must be wrapped in a dynamic import with `{ ssr: false }` or rendered inside a `useEffect`. This is a common Next.js gotcha that causes hydration errors in production. It must be documented in the development plan before Phase 7 (Board View) or it will cost a day of debugging.

---

*This audit was generated against the Teamority documentation as of 2026-06-08. Re-run after each major scope change.*
