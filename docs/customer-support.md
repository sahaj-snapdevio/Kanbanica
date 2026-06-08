# Customer Support

## Overview

Customer Support gives users a way to get help and report issues — all from within the Teamority app.

**Two components:**
| Component | Purpose |
|-----------|---------|
| Help Center | Self-serve — articles, guides, FAQs |
| Support Tickets | Direct support — report bugs, ask questions |

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
- Category (e.g. Getting Started, Tasks, Spaces, Sprints)
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
| Views | List view, Board view, My Tasks |
| Notifications | Setting up notifications, Muting tasks |
| Account & Security | Sessions, Profile settings |

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
├── category            (enum: bug | question)
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
- **Permanent deletion:** Support tickets are **not** deleted when a user deletes their account. They are retained for audit purposes with the user referenced as "Deleted User".

### Help Center Articles

- Articles use a **published/unpublished** flag (`is_published`) — no soft or hard delete in MVP.
- Unpublished articles are invisible to customers but remain in the Admin Panel.
- Platform admins can delete articles from the Admin Panel — **hard delete**, immediate.

---

## Business Rules

1. Users can have a maximum of 5 open tickets at a time — submitting a 6th is blocked with a message to resolve existing tickets first.
2. Resolved tickets automatically close after 14 days of no user reply — a reminder email is sent 2 days before auto-close: `"Your ticket #1234 will close in 2 days if no reply is received."`
3. A user replying to a Resolved ticket within 14 days automatically reopens it as Open.
4. Help Center articles are only visible when `is_published = true` — drafts are invisible to customers.
5. Help article search and viewing is public — no authentication required (so users who are locked out can still access help).

---

## Out of Scope (MVP)

- Feature requests and voting — use GitHub Issues instead (open-source project)
- Live chat / real-time support
- Help Center article versioning / history
- Community forum
- Automatic ticket routing based on category
- SLA tracking and response time targets
- Customer satisfaction (CSAT) rating after ticket resolution
- Integration with third-party helpdesks (Intercom, Zendesk, Freshdesk)
