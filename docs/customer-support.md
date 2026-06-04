# Customer Support

## Overview

Customer Support gives users a way to get help, report issues, and request features — all from within the Teamority app. It is designed to reduce friction between a user hitting a problem and getting it resolved.

**Three components:**
| Component | Purpose |
|-----------|---------|
| Help Center | Self-serve — articles, guides, FAQs |
| Support Tickets | Direct support — report bugs, ask questions, billing issues |
| Feature Requests | Community — submit and vote on product ideas |

---

## 1. Help Center

A searchable knowledge base of articles that helps users answer questions without needing to contact support.

### Access

- Accessible from the app via the `?` icon or `Help` link in the sidebar footer
- Opens as a side panel inside the app (no full page redirect) so users don't lose their context
- Also accessible as a standalone page: `/help`

### Article structure

Each article has:
- Title
- Category (e.g. Getting Started, Tasks, Spaces, Sprints, Billing)
- Content (rich text — headings, bullet lists, images, code blocks, links)
- Last updated date
- Related articles (2–4 suggested links at the bottom)
- `Was this helpful?` feedback button (Yes / No)

### Categories (MVP)

| Category | Examples |
|----------|---------|
| Getting Started | How to create your first workspace, Invite your team, Create your first task |
| Workspace & Spaces | Managing members, Space permissions, Private spaces |
| Tasks & Lists | Creating tasks, Subtasks, Checklists, Due dates, Dependencies |
| Sprints | Creating a sprint, Adding tasks, Closing a sprint |
| Views | List view, Board view, Calendar view, My Tasks |
| Notifications | Setting up notifications, Muting tasks |
| Account & Security | Change password, Sessions, Profile settings |
| Billing | Plans and pricing, Upgrading, FAQs |

### Search

- Search bar at the top of the Help Center panel
- Searches article titles and content
- Results appear instantly as the user types (minimum 2 characters)
- If no results found: shows `"No articles found for [query]"` + link to `Open a support ticket`

### Article management

- Articles are written and managed by platform admins from the Admin Panel
- Customers cannot create or edit articles
- Article content is managed via a simple rich text editor in the Admin Panel (`/admin/help-center`)

---

## 2. Support Tickets

When the Help Center doesn't resolve the issue, users can submit a support ticket directly from the app.

### Access

- `Help` menu → `Contact Support` or `Open a Ticket`
- Also accessible from within the Help Center: `Didn't find your answer? Contact us`
- Route: `/support/tickets`

### Submit a Ticket

**Required fields:**
- Subject (short title of the issue)
- Category:
  - Bug — something is not working correctly
  - Question — how do I do X
  - Feature Request — I want to suggest something (redirects to Feature Requests section)
  - Billing — plan, payment, or invoice issue

**Optional fields:**
- Description (rich text — details, steps to reproduce, screenshots)
- Attachment (upload a screenshot or file — max 5MB, images only for MVP)

**On submission:**
- Ticket is created with status **Open**
- User receives an in-app notification confirming submission: `"Your ticket #1234 has been submitted. We'll get back to you shortly."`
- User receives a confirmation email with their ticket ID and subject
- Platform admins receive an internal notification of the new ticket

### My Tickets

Users can view all their submitted tickets at `/support/tickets`.

**Ticket list shows:**
- Ticket ID
- Subject
- Category
- Status (Open / In Progress / Resolved)
- Created date
- Last updated date

**Ticket statuses:**

| Status | Meaning |
|--------|---------|
| Open | Submitted, not yet picked up by support |
| In Progress | A support agent is actively working on it |
| Resolved | Issue has been addressed |

### Ticket Detail

Clicking a ticket opens the full thread:

- Original message (user's submission)
- Reply thread — alternating between user and support agent
- Status badge (current status)
- Option to add a reply (if ticket is Open or In Progress)
- If ticket is Resolved: user can reply to reopen it

**Reply composer:**
- Simple text area with basic formatting (bold, lists, links)
- Attach a file (image, max 5MB)
- Submit reply → notifies the assigned support agent

**Notifications on ticket updates:**
- Support agent replies → user receives in-app + email notification
- Status changes to Resolved → user receives in-app + email notification

### Ticket Rules

- Users can have a maximum of **5 open tickets** at a time — prevents spam
- Resolved tickets automatically close after **14 days of no reply** from the user
- If the user replies to a Resolved ticket within 14 days, it reopens as **Open**

---

## 3. Feature Requests

A community board where users can submit product ideas and vote on what matters most. Helps us prioritize the roadmap based on real user demand.

### Access

- `Help` menu → `Feature Requests`
- Route: `/support/feature-requests`

### Submit a Feature Request

**Fields:**
- Title (short description of the feature)
- Description (optional — more detail on the use case and why it matters)
- Category (optional — Tasks / Views / Sprints / Collaboration / Notifications / Other)

**On submission:**
- Feature request is created with status **Under Review**
- User is automatically set as a Voter on their own request
- If an identical or very similar request already exists, the system shows a warning: `"This might already exist — did you mean: [similar request]?"` (basic title similarity check)

### Feature Request Board

**List view of all requests:**
- Each request shows:
  - Title
  - Category
  - Vote count (upvote button + count)
  - Status badge
  - Submitted by (name + avatar)
  - Date submitted
  - Comment count

**Sort options:**
- Most Voted (default)
- Newest
- Recently Updated

**Filter options:**
- Status: All / Under Review / Planned / Shipped / Declined
- Category

### Voting

- Any authenticated user can upvote a feature request
- One vote per user per request (toggle — clicking again removes the vote)
- Upvoting a request subscribes the user to status change notifications for that request
- Vote count is public — visible to all users

### Feature Request Statuses

| Status | Description | Color |
|--------|-------------|-------|
| Under Review | Submitted, team is evaluating | Grey |
| Planned | Confirmed for the roadmap | Blue |
| In Progress | Actively being built | Yellow |
| Shipped | Released in the product | Green |
| Declined | Will not be implemented (reason provided) | Red |

**Status changes:**
- Set by platform admins from the Admin Panel (`/admin/feature-requests`)
- When status changes: all voters receive an in-app + email notification
  - e.g. `"A feature you voted for — Dark Mode — is now Planned!"`
  - e.g. `"A feature you voted for — Export to CSV — has been Shipped!"`

### Comments on Feature Requests

- Users can comment on feature requests to add context or discuss use cases
- Comments are public — visible to all users
- Admin can pin an official response comment (shown at the top with an `Official Response` badge)
- No threading — flat comment list (simpler for MVP)

---

## Data Model

```
HelpArticle
├── id                  (uuid, primary key)
├── title               (string, required)
├── category            (string)
├── content             (text — rich text JSON)
├── is_published        (boolean, default: false)
├── helpful_yes         (integer, default: 0)
├── helpful_no          (integer, default: 0)
├── created_by          (foreign key → User — platform admin)
├── created_at          (timestamp)
└── updated_at          (timestamp)

SupportTicket
├── id                  (uuid, primary key)
├── workspace_id        (foreign key → Workspace, nullable)
├── submitted_by        (foreign key → User)
├── assigned_to         (foreign key → User — platform admin, nullable)
├── subject             (string, required)
├── category            (enum: bug | question | feature_request | billing)
├── status              (enum: open | in_progress | resolved)
├── created_at          (timestamp)
└── updated_at          (timestamp)

SupportTicketMessage
├── id                  (uuid, primary key)
├── ticket_id           (foreign key → SupportTicket)
├── author_id           (foreign key → User)
├── body                (text)
├── attachment_url      (string, nullable)
├── is_internal_note    (boolean, default: false)
└── created_at          (timestamp)

FeatureRequest
├── id                  (uuid, primary key)
├── submitted_by        (foreign key → User)
├── title               (string, required)
├── description         (text, nullable)
├── category            (string, nullable)
├── status              (enum: under_review | planned | in_progress | shipped | declined)
├── decline_reason      (text, nullable — shown publicly when status is declined)
├── vote_count          (integer, default: 0 — denormalized for fast sort)
├── created_at          (timestamp)
└── updated_at          (timestamp)

FeatureRequestVote
├── id                  (uuid, primary key)
├── feature_request_id  (foreign key → FeatureRequest)
├── user_id             (foreign key → User)
└── created_at          (timestamp)

FeatureRequestComment
├── id                  (uuid, primary key)
├── feature_request_id  (foreign key → FeatureRequest)
├── author_id           (foreign key → User)
├── body                (text)
├── is_official         (boolean, default: false — admin pinned response)
└── created_at          (timestamp)
```

---

## API Endpoints

### Help Center

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/help/articles` | List published articles (filterable by category) | Public |
| GET | `/api/help/articles/:id` | Get article detail | Public |
| GET | `/api/help/articles/search?q=` | Search articles | Public |
| POST | `/api/help/articles/:id/feedback` | Submit helpful yes/no | Authenticated user |

### Support Tickets

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/support/tickets` | Submit a new ticket | Authenticated user |
| GET | `/api/support/tickets` | Get current user's tickets | Authenticated user |
| GET | `/api/support/tickets/:id` | Get ticket detail and thread | Ticket owner |
| POST | `/api/support/tickets/:id/messages` | Add a reply to a ticket | Ticket owner |

### Feature Requests

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/feature-requests` | List all feature requests (with sort/filter) | Authenticated user |
| POST | `/api/feature-requests` | Submit a feature request | Authenticated user |
| GET | `/api/feature-requests/:id` | Get feature request detail + comments | Authenticated user |
| POST | `/api/feature-requests/:id/vote` | Upvote a request | Authenticated user |
| DELETE | `/api/feature-requests/:id/vote` | Remove vote | Authenticated user |
| GET | `/api/feature-requests/:id/comments` | Get comments | Authenticated user |
| POST | `/api/feature-requests/:id/comments` | Add a comment | Authenticated user |

---

## UI Screens

| Screen | Route | Access |
|--------|-------|--------|
| Help Center panel | Slide-out from `?` icon (global) | All users |
| Help Center full page | `/help` | All users |
| Article detail | `/help/:articleId` | All users |
| My Tickets list | `/support/tickets` | Authenticated users |
| Ticket detail | `/support/tickets/:id` | Ticket owner |
| Submit ticket form | `/support/tickets/new` | Authenticated users |
| Feature Requests board | `/support/feature-requests` | Authenticated users |
| Feature Request detail | `/support/feature-requests/:id` | Authenticated users |

---

## Data Lifecycle

### Support Tickets

| State | Behavior |
|-------|----------|
| Open | Active — user and admin can reply |
| In Progress | Active — assigned admin working on it |
| Resolved | Locked — no edits; user can reply to reopen within 14 days |
| Auto-closed | After 14 days of no reply on a Resolved ticket — moves to permanent Resolved state |

- **Soft delete:** Tickets are never deleted — they are only status-changed.
- **Recovery:** A Resolved ticket can be reopened by user reply within **14 days**. After 14 days, it is permanently Resolved and cannot be reopened without a new ticket.
- **Permanent deletion:** Support tickets are **not** deleted when a user deletes their account. They are retained for audit purposes with the user referenced as "Deleted User". Tickets are only deleted if the platform admin explicitly purges them (post-MVP operation).

### Help Center Articles

- Articles use a **published/unpublished** flag (`is_published`) — no soft or hard delete in MVP.
- Unpublished articles are invisible to customers but remain in the Admin Panel.
- Platform admins can delete articles from the Admin Panel — **hard delete**, immediate.

### Feature Requests

- Feature requests are **never deleted** — they are status-changed (Under Review → Planned → Shipped / Declined).
- `FeatureRequestVote` and `FeatureRequestComment` records are hard-deleted when:
  - A user deletes their account — their votes and comments are removed.
  - A platform admin explicitly deletes a feature request (hard delete cascades to votes and comments).
- Declined feature requests remain visible on the board with their decline reason — they are not hidden.

### Recovery Period
- **Support Ticket (Resolved):** Reopenable by user reply within **14 days**.
- **Help Article (deleted by admin):** No recovery.
- **Feature Request (deleted by admin):** No recovery — votes and comments cascade-deleted.

---

## Business Rules

1. Users can have a maximum of 5 open tickets at a time — submitting a 6th is blocked with a message to resolve existing tickets first.
2. Resolved tickets automatically close after 14 days of no user reply — a reminder email is sent 2 days before auto-close: `"Your ticket #1234 will close in 2 days if no reply is received."`
3. A user replying to a Resolved ticket within 14 days automatically reopens it as Open.
4. Each user can cast only one vote per feature request — voting again removes the vote.
5. Voting on a feature request automatically subscribes the voter to status change notifications.
6. Feature request status changes notify all voters — status change emails cannot be disabled.
7. When a feature request is Declined, a `decline_reason` must be provided by the admin — it is shown publicly on the request.
8. The `vote_count` field on `FeatureRequest` is denormalized (updated on each vote/unvote) to allow fast sorting by popularity without a COUNT query.
9. Help Center articles are only visible when `is_published = true` — drafts are invisible to customers.
10. Help article search and viewing is public — no authentication required (so users who are locked out can still access help).

---

## Out of Scope (MVP)

- Live chat / real-time support
- Help Center article versioning / history
- Community forum (public discussion threads between users)
- Automatic ticket routing based on category
- SLA tracking and response time targets
- Customer satisfaction (CSAT) rating after ticket resolution
- Integration with third-party helpdesks (Intercom, Zendesk, Freshdesk)
- Feature request merging (combining duplicate requests)
