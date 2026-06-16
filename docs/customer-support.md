# Customer Support

## Goal

Provide a two-tier support system: a self-serve Help Center (searchable articles authored by platform admins) and a ticket-based support channel where users can escalate issues. All ticket activity is auditable via `PlatformAuditLog`.

---

## Existing Scope (MVP)

- Help Center with categories and articles (admin-authored)
- Support Tickets: create, reply, auto-close, reopen
- No third-party integration (Intercom, Zendesk) in MVP -- fully in-house
- No AI-assisted responses in MVP

---

## User Flow

### Help Center (User)

1. User clicks "Help" in sidebar -> opens Help Center modal or `/help` page
2. User browses categories (e.g., "Getting Started", "Tasks", "Billing")
3. User opens an article -> reads rich text content
4. If issue not resolved -> "Contact Support" button at article bottom -> pre-fills ticket with article reference

### Support Ticket (User)

1. User navigates to Settings -> Support -> "New Ticket"
2. User enters subject (required, 5-200 chars), body (required, 20-5000 chars), selects category
3. Submit -> `POST /api/support/tickets` -> ticket created with `status=open`
4. User receives confirmation email: "Your ticket #TKT-0042 has been received"
5. Platform admin sees new ticket in Admin Panel -> Tickets tab
6. Admin replies -> `POST /api/admin/support/tickets/:id/messages` -> user receives email notification
7. User replies -> ticket remains `open`; admin receives in-app notification
8. If no reply for 14 days -> pg-boss cron marks ticket `status=closed` automatically
9. User reopens by replying to a closed ticket -> `status` -> `open` again

### Help Center (Admin)

1. Admin -> Admin Panel -> Help Center -> New Article
2. Admin fills title, category, rich text body, publishes (`isPublished=true`)
3. Article visible to all users immediately
4. Admin can unpublish, edit, or delete articles at any time

---

## Technical Design

### Key Rules

- A user may have at most 5 open tickets at a time; 6th submission returns HTTP 422 with `{ error: "Open ticket limit reached (5). Please resolve existing tickets first." }`
- Tickets auto-close after 14 days of inactivity (no new messages). A pg-boss cron runs daily.
- Replying to a closed ticket reopens it unconditionally (no limit on reopens).
- `PlatformAuditLog` records all admin actions: reply, close, reopen, delete.
- All ticket messages are stored as plain text (no Tiptap rich text in MVP).

### Permission Model

- Any authenticated user can create and reply to their own tickets
- Platform admins (`isPlatformAdmin=true`) can read and reply to all tickets
- Users cannot read other users' tickets
- Guests (workspace role) have the same ticket access as Members

### Auto-Close Implementation

```
JOB_NAMES.SUPPORT_TICKET_AUTO_CLOSE = "support.ticket-auto-close"

SupportTicketAutoClosePayload: {
  dryRun?: boolean
}

Schedule: daily cron at 02:00 UTC

Logic:
  SELECT id FROM SupportTicket
  WHERE status = 'OPEN'
    AND updatedAt < NOW() - INTERVAL '14 days'
  FOR EACH:
    UPDATE status = 'CLOSED', closedAt = NOW(), closedReason = 'auto_inactivity'
    INSERT PlatformAuditLog { action: 'ticket.auto_closed', actorType: 'system' }
    Send email to user: "Your ticket has been closed due to inactivity"
```

### Notification Triggers

| Event | Recipient | Channel |
|-------|-----------|---------|
| Ticket created | User | Email (confirmation) |
| Admin replies to ticket | User | Email |
| User replies to ticket | All platform admins | In-app notification |
| Ticket auto-closed | User | Email |
| Ticket reopened by user reply | All platform admins | In-app notification |

---

## Folder Mapping

```
src/
  app/
    (app)/
      [workspaceId]/
        settings/support/        <- user ticket list + new ticket form
    admin/
      support/                   <- admin ticket management
        page.tsx
        [ticketId]/page.tsx
    api/
      support/
        tickets/
          route.ts               <- GET (list own), POST (create)
          [ticketId]/
            route.ts             <- GET (detail), PATCH (close/reopen)
            messages/route.ts    <- POST (user reply)
        help/
          route.ts               <- GET (list published articles)
          [articleId]/route.ts
      admin/
        support/
          tickets/route.ts       <- admin GET all tickets
          tickets/[ticketId]/
            route.ts             <- PATCH (admin close/assign)
            messages/route.ts    <- POST (admin reply)
  lib/
    support/
      tickets.ts                 <- createTicket, replyToTicket, closeTicket
      help-articles.ts           <- createArticle, publishArticle
  lib/worker/handlers/
    support-ticket-auto-close.ts
```

---

## API

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/support/tickets` | List own tickets (paginated) | Authenticated user |
| POST | `/api/support/tickets` | Create a ticket | Authenticated user |
| GET | `/api/support/tickets/:id` | Get ticket detail + messages | Owner only |
| PATCH | `/api/support/tickets/:id` | Close own ticket | Owner only |
| POST | `/api/support/tickets/:id/messages` | Reply to ticket (user) | Owner only |
| GET | `/api/support/help` | List published articles | Any authenticated user |
| GET | `/api/support/help/:id` | Get article detail | Any authenticated user |
| GET | `/api/admin/support/tickets` | List all tickets | Platform admin |
| PATCH | `/api/admin/support/tickets/:id` | Update ticket status | Platform admin |
| POST | `/api/admin/support/tickets/:id/messages` | Admin reply | Platform admin |
| GET | `/api/admin/support/help` | List all articles (incl. unpublished) | Platform admin |
| POST | `/api/admin/support/help` | Create article | Platform admin |
| PATCH | `/api/admin/support/help/:id` | Update article | Platform admin |
| DELETE | `/api/admin/support/help/:id` | Delete article | Platform admin |

**Request: Create Ticket**

```json
POST /api/support/tickets
{
  "subject": "Cannot assign a task to a guest",
  "body": "When I try to assign...",
  "category": "tasks"
}
```

**Response: 201 Created**

```json
{
  "id": "uuid",
  "ticketNumber": "TKT-0042",
  "status": "open",
  "subject": "Cannot assign a task to a guest",
  "createdAt": "2026-06-09T10:00:00Z"
}
```

**Error responses:**
- `422` -- open ticket limit reached (5)
- `401` -- unauthenticated
- `400` -- validation failure

---

## Database

Schema file: `db/schema/support.ts`

```ts
import { pgEnum, pgTable, text, timestamp, boolean, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const supportTicketStatusEnum = pgEnum("support_ticket_status", ["OPEN", "CLOSED"]);
export const supportTicketCategoryEnum = pgEnum("support_ticket_category", [
  "GENERAL", "TASKS", "BILLING", "TECHNICAL", "OTHER",
]);

export const supportTicket = pgTable("support_ticket", {
  id:           text("id").primaryKey(),
  userId:       text("user_id").notNull(),
  ticketNumber: text("ticket_number").notNull().unique(),  // TKT-NNNN, auto-generated
  subject:      text("subject").notNull(),
  status:       supportTicketStatusEnum("status").notNull().default("OPEN"),
  category:     supportTicketCategoryEnum("category").notNull().default("GENERAL"),
  closedAt:     timestamp("closed_at", { withTimezone: true }),
  closedReason: text("closed_reason"),  // "user_closed" | "admin_closed" | "auto_inactivity"
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("support_ticket_user_status_idx").on(t.userId, t.status),
  index("support_ticket_status_updated_idx").on(t.status, t.updatedAt),  // for auto-close cron query
]);

export const supportTicketMessage = pgTable("support_ticket_message", {
  id:       text("id").primaryKey(),
  ticketId: text("ticket_id").notNull().references(() => supportTicket.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  isAdmin:  boolean("is_admin").notNull().default(false),
  body:     text("body").notNull(),  // plain text
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("support_ticket_message_ticket_id_idx").on(t.ticketId),
]);

export const helpArticle = pgTable("help_article", {
  id:          text("id").primaryKey(),
  title:       text("title").notNull(),
  slug:        text("slug").notNull().unique(),
  category:    text("category").notNull(),
  body:        json("body").notNull(),  // Tiptap JSON
  isPublished: boolean("is_published").notNull().default(false),
  authorId:    text("author_id").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  orderIndex:  integer("order_index").notNull().default(0),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("help_article_category_published_idx").on(t.category, t.isPublished),
]);
```

`ticketNumber` generation: use a raw SQL `UPDATE ... RETURNING` inside a transaction to atomically increment and return the next sequence number. Format as `TKT-` + zero-padded 4-digit number (e.g., `TKT-0042`):

```ts
const [{ nextNum }] = await tx.execute<{ nextNum: number }>(sql`
  UPDATE support_ticket_sequence SET value = value + 1 RETURNING value AS "nextNum"
`)
const ticketNumber = `TKT-${String(nextNum).padStart(4, '0')}`
```

---

## Events

| Event | Logged To | Actor |
|-------|-----------|-------|
| `ticket.created` | PlatformAuditLog | user |
| `ticket.replied` (user) | PlatformAuditLog | user |
| `ticket.replied` (admin) | PlatformAuditLog | admin |
| `ticket.closed` (manual) | PlatformAuditLog | user or admin |
| `ticket.closed` (auto) | PlatformAuditLog | system |
| `ticket.reopened` | PlatformAuditLog | user |
| `article.created` | PlatformAuditLog | admin |
| `article.published` | PlatformAuditLog | admin |
| `article.deleted` | PlatformAuditLog | admin |

---

## Background Jobs

| Job Name | Trigger | Schedule | Payload |
|----------|---------|----------|---------|
| `support.ticket-auto-close` | pg-boss cron | Daily 02:00 UTC | `{ dryRun?: boolean }` |

Handler in `src/lib/worker/handlers/support-ticket-auto-close.ts`:
1. Query tickets where `status=OPEN AND updatedAt < NOW() - 14 days`
2. For each: update `status=CLOSED`, `closedAt`, `closedReason='auto_inactivity'`
3. Write `PlatformAuditLog` entry per ticket
4. Send close notification email via `src/lib/email/support-ticket-closed.tsx`

---

## Dependencies

- `PlatformAuditLog` table (admin-panel.md)
- Nodemailer/SMTP for notification emails
- pg-boss worker process for auto-close cron
- Better Auth session for user identity
- `isPlatformAdmin` field on `User` for admin access check

---

## Edge Cases

| Scenario | Handling |
|----------|---------|
| User replies to auto-closed ticket | Ticket reopens; `updatedAt` resets; 14-day timer restarts |
| User deletes account with open tickets | Tickets remain; `userId` preserved; admin can still see and close |
| Admin closes ticket with no messages | Allowed; useful for spam or duplicate tickets |
| Two users race to create 5th ticket | Atomic count check inside transaction; second request gets 422 |
| Help article slug collision | Return 409; require unique slug; suggest slugified title |
| Message body exceeds 5000 chars | Return 400 with `{ error: "Message too long (max 5000 characters)" }` |

---

## Acceptance Criteria

- [ ] User can create a ticket and receives confirmation email within 60 seconds
- [ ] User sees all own tickets with status badges in Settings -> Support
- [ ] User cannot create more than 5 open tickets simultaneously (receives 422)
- [ ] Platform admin sees all tickets in Admin Panel with filter by status/category
- [ ] Admin reply triggers email notification to the ticket owner
- [ ] Replying to a closed ticket reopens it
- [ ] Tickets with no activity for 14 days are automatically closed by cron
- [ ] All admin actions are logged to `PlatformAuditLog` with actor, action, and ticketId
- [ ] Help articles are visible to all authenticated users when `isPublished=true`
- [ ] Platform admin can create, edit, publish, and delete help articles

---

## Implementation Notes

- Implement `src/lib/support/tickets.ts` as the business logic layer; server actions and API routes call it
- Use `db.transaction()` for ticket creation (count check + insert must be atomic)
- `ticketNumber` counter: use `UPDATE ... RETURNING` on a sequence row table (see Database section above)
- Email templates: `src/lib/email/support-ticket-created.tsx`, `support-ticket-reply.tsx`, `support-ticket-closed.tsx` -- use React Email components
- Do NOT use Tiptap for ticket message body in MVP -- plain text only
- Register the auto-close cron in `scripts/worker.ts`:
  ```ts
  boss.schedule(JOB_NAMES.SUPPORT_TICKET_AUTO_CLOSE, '0 2 * * *', {})
  ```
- Add `SUPPORT_TICKET_AUTO_CLOSE` to `JOB_NAMES` and `QUEUE_OPTIONS` before registering the cron
