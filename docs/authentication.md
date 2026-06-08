# Authentication

## Overview

Authentication handles user identity — who you are, how you prove it, and how your session is maintained across devices. Teamority uses **Better Auth** with the **Admin Plugin** as the authentication library, integrated directly into Next.js.

**Powered by:** [Better Auth](https://better-auth.com)

**Auth method: Magic Link (passwordless)**
- User enters their email address → receives a one-time sign-in link → clicks it → session created
- No passwords to remember or manage
- First-time use automatically creates an account (sign up and sign in are the same flow)

**Why Better Auth:**
- Built specifically for Next.js (API Routes + Server Actions)
- Database-backed sessions (more secure than stateless JWT)
- Admin Plugin gives user ban, impersonation, and session revoke out of the box
- Works natively with Prisma + PostgreSQL

---

## Auth Flows

| Flow | Description |
|------|-------------|
| Sign In / Sign Up | User enters email → receives magic link → clicks link → session created (account auto-created on first use) |
| Email Verification | Email is considered verified on first successful magic link use |
| Sign Out | End the current session |
| Session Management | View and revoke active sessions across devices |

---

## 1. Sign In / Sign Up (Magic Link)

### Flow

1. User visits `/sign-in`
2. Enters their email address
3. Clicks `"Send Sign-In Link"`
4. Always shows: `"If this email is valid, a sign-in link has been sent."` — same message regardless of whether the email exists (prevents account enumeration)
5. Better Auth sends a magic link email via SMTP
6. User clicks the link → `GET /api/auth/magic-link/verify?token=:token`
7. Better Auth validates the token:
   - **New user** (email not in DB): account is auto-created, user is redirected to `/onboarding`
   - **Existing user**: session is created, user is redirected to the app (last active workspace or workspace switcher)
8. On expired/invalid token: `"This link has expired or has already been used. Request a new one."` with a button to go back to `/sign-in`

### Magic link rules

- Link is valid for **15 minutes**
- Link is **single-use** — invalidated immediately after the session is created
- If the user requests another link before the first expires, the old link is invalidated
- Rate limited: max **5 magic link requests** per email per 15 minutes (Better Auth built-in)

### Account auto-creation on first use

When a magic link is used and no account exists for that email:
- A `User` record is created with the provided email
- `email_verified` is set to `true` (magic link itself proves email ownership)
- User is redirected to `/onboarding` to complete workspace setup

### Validation

| Field | Rules |
|-------|-------|
| Email | Required, valid email format |

---

## 2. Sign Out

### Single device sign out

- Click avatar → `"Sign Out"`
- Current session is destroyed
- User is redirected to `/sign-in`

### Sign out all devices

- Available from `/settings/sessions`
- Revokes all active sessions across all devices
- User is signed out of the current device too
- Useful after a suspected account compromise

---

## 3. Session Management

Users can view and manage all active sessions on their account.

### Access

- `/settings/sessions`

### Session list

Each active session shows:
- Device type (Desktop / Mobile — inferred from user agent)
- Browser (Chrome, Firefox, Safari, etc.)
- Approximate location (city, country — from IP, best-effort)
- Last active timestamp
- `"Current session"` badge on the active one

### Actions

| Action | Description |
|--------|-------------|
| Revoke session | End a specific session (log out that device) |
| Revoke all other sessions | End all sessions except the current one |

### Session rules

- Database-backed sessions (stored in `Session` table via Better Auth)
- Default TTL: **7 days** (no "remember me" needed — magic link is already low friction)
- Sessions use sliding expiry — TTL resets on each authenticated request
- A banned user's sessions are all revoked immediately by Better Auth Admin Plugin

---

## 4. Account Settings

Available at `/settings/account`

### Profile

- Update Full Name
- Update Avatar:
  - Upload a photo (JPEG, PNG, WebP — max 2MB, min 100×100px)
  - If no photo is uploaded: initials fallback is shown automatically — first + last initial of the user's name, on a deterministic background color derived from the user's `id`
  - See [avatar-system.md](./avatar-system.md) for the full avatar spec (sizes, color palette, stacking, greyed-out state, workspace avatars)
- Email address (read-only — cannot be changed in MVP)

### Danger Zone

- Delete Account
  - Permanently deletes the user's account and all personal data
  - Requires typing email address to confirm
  - **If the user is the Owner of a workspace with other members:**
    - Must transfer ownership first — account deletion is blocked
    - Shown: `"You are the Owner of [Workspace Name]. Transfer ownership to another member before deleting your account."`
    - One prompt per workspace if they own multiple
  - **If the user is the Owner and the sole member of a workspace:**
    - No other member to transfer to — workspace is automatically deleted along with the account
    - Shown: `"Deleting your account will also permanently delete [Workspace Name] and all its data. This cannot be undone."`
    - User must confirm this explicitly before proceeding
    - The cascade deletion follows the same rules as a manual workspace deletion
  - **If the user is not an owner of any workspace:**
    - Account is deleted immediately
    - Their task assignments, comments, and activity log entries are attributed to `"Deleted User"`

---

## 5. Better Auth — Admin Plugin Features

The Better Auth Admin Plugin gives platform admins additional capabilities managed via the Admin Panel:

| Feature | Description |
|---------|-------------|
| Ban user | Immediately revokes all sessions. User cannot sign in. |
| Unban user | Restores sign-in access. |
| Impersonate user | Platform admin can log in as any user for support. Opens a separate session. |
| Revoke sessions | Revoke any user's sessions individually or all at once. |
| List sessions | View all active sessions for any user. |

These are accessed via the Admin Panel — not exposed to customers.

---

## Onboarding Flow (post-auth)

After a new user successfully authenticates for the first time, they go through a guided onboarding:

```
Step 1: Create Workspace
  └── Enter workspace name + upload logo (optional)

Step 2: Create first Space
  └── Enter Space name + pick color
  └── Default List named "List" is auto-created inside the Space

Step 3: Done → land inside the first List
  └── Getting Started checklist is shown pinned above the empty task list
  └── Checklist guides: create task → invite teammate → set due date → try Board view
```

Returning users skip onboarding and go directly to their last active workspace.

**Empty states after onboarding:** Every screen the user can land on with no data has a defined empty state with a clear message and CTA. See [empty-states.md](./empty-states.md) for the full spec of all empty states including the Getting Started checklist.

---

## Data Model

Better Auth manages most of the auth-related tables. The core tables it creates:

```
User
├── id                  (uuid, primary key)
├── name                (string)
├── email               (string, unique)
├── email_verified      (boolean, default: false — set to true on first magic link use)
├── image               (string — avatar URL, nullable)
├── is_platform_admin   (boolean, default: false)  ← custom field added by us
├── banned              (boolean, default: false)   ← managed by Admin Plugin
├── banned_reason       (string, nullable)          ← managed by Admin Plugin
├── created_at          (timestamp)
└── updated_at          (timestamp)

Session
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── token               (string, unique — hashed session token)
├── expires_at          (timestamp)
├── ip_address          (string, nullable)
├── user_agent          (string, nullable)
├── impersonated_by     (uuid, nullable)            ← set during admin impersonation
├── created_at          (timestamp)
└── updated_at          (timestamp)

Account
├── id                  (uuid, primary key)
├── user_id             (foreign key → User)
├── provider            (string — "magic-link")
├── provider_account_id (string — the user's email)
├── created_at          (timestamp)
└── updated_at          (timestamp)

Verification
├── id                  (uuid, primary key)
├── identifier          (string — email address)
├── value               (string — hashed magic link token)
├── expires_at          (timestamp — 15 minutes from creation)
└── created_at          (timestamp)
```

---

## API Endpoints

Better Auth exposes a unified handler at `/api/auth/[...all]` in Next.js. These are the key routes it handles:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/magic-link/send` | Request a magic link for an email address |
| GET | `/api/auth/magic-link/verify?token=` | Verify magic link token, create session |
| POST | `/api/auth/sign-out` | Sign out current session |
| GET | `/api/auth/get-session` | Get current session + user |
| GET | `/api/auth/list-sessions` | List all active sessions for current user |
| POST | `/api/auth/revoke-session` | Revoke a specific session |
| POST | `/api/auth/revoke-other-sessions` | Revoke all sessions except current |

---

## UI Screens

| Screen | Route | Access |
|--------|-------|--------|
| Sign In | `/sign-in` | Unauthenticated — includes one-line explainer: *"We'll email you a secure link — no password needed."* |
| Magic Link Sent | `/sign-in?sent=true` | Unauthenticated (shown after requesting link) |
| Magic Link Verify | `/api/auth/magic-link/verify?token=` | Unauthenticated (handled by Better Auth) |
| Onboarding | `/onboarding` | Authenticated (new user only) |
| Account Settings | `/settings/account` | Authenticated |
| Session Management | `/settings/sessions` | Authenticated |

### Magic Link Sent Screen — UI Spec

Shown immediately after the user clicks "Send Sign-In Link". Reduces abandonment during the email delivery wait.

```
┌─────────────────────────────────────────┐
│                                         │
│            ✉️  Check your email          │
│                                         │
│   We sent a sign-in link to             │
│   jane@example.com                      │
│                                         │
│   ⠋  Waiting for you to click the link  │  ← animated spinner
│   This usually takes under 30 seconds.  │
│                                         │
│   ────────────────────────────────────  │
│                                         │
│   Didn't get it?  [Resend email]        │
│   Wrong email?    [Go back]             │
│                                         │
└─────────────────────────────────────────┘
```

| Element | Detail |
|---------|--------|
| Headline | `"Check your email"` |
| Subtext | `"We sent a sign-in link to [email]"` — shows the exact email submitted |
| Animated indicator | Spinner or pulsing dot next to `"Waiting for you to click the link"` |
| Reassurance copy | `"This usually takes under 30 seconds."` |
| Resend CTA | `"Resend email"` — triggers a new magic link request; disabled for 60s after each send to prevent spam; shows countdown: `"Resend in 45s"` |
| Go back link | `"Wrong email? Go back"` — returns to `/sign-in` with the email field pre-filled |

**Resend throttle:** The Resend button is disabled for 60 seconds after each send (client-side countdown). This is separate from the server-side rate limit of 5 requests per 15 minutes — if the server rate limit is hit, show: `"Too many attempts. Please wait a few minutes before trying again."`

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Magic link abuse | Rate limit: 5 requests per 15 min per email (Better Auth built-in) |
| Email enumeration | Magic link request always shows the same response message |
| Session hijacking | Database-backed sessions; token hashed in DB |
| CSRF | Better Auth handles CSRF protection on all POST routes |
| Token reuse | Magic link tokens are single-use, invalidated immediately on use |
| Token expiry | Magic links expire in 15 minutes |
| Banned users | Sessions revoked immediately on ban; cannot request new magic link |
| Impersonation | Logged in `PlatformAuditLog`; impersonated session marked with `impersonated_by` |
| Account deletion | Requires email confirmation; workspace ownership must be transferred first |

---

## Data Lifecycle

### Archive
- User accounts cannot be archived — they are either active, banned, or deleted.
- **Banned** users are the functional equivalent of a suspended state — account exists but cannot authenticate.

### Soft Delete — User Account
- User account deletion is a **hard delete** — no soft delete or tombstone on the User record.
- Before deletion is allowed, all ownership dependencies must be resolved (transfer workspace ownership).
- There is **no grace period** or recovery after deletion is confirmed.

### Token Lifecycle

| Token type | Expiry | Single-use | On expiry |
|------------|--------|-----------|-----------|
| Magic link | 15 minutes | Yes — invalidated on use | Link shows "expired" error; user requests a new one from `/sign-in` |
| Session token | 7 days (sliding) | No — TTL resets on each request | Session is invalidated; user redirected to sign-in |

### Session Lifecycle
- Sessions use **sliding expiry** — TTL resets on every authenticated request.
- Sessions are hard-deleted from the `Session` table when:
  - User signs out (single session).
  - User revokes a session from settings.
  - User clicks "Sign out all devices".
  - User is banned (all sessions revoked immediately by Admin Plugin).
  - Session TTL expires without activity.

### Recovery Period
- **Banned user:** Recoverable — Admin can unban at any time. All user data is preserved during ban.
- **Deleted user account:** No recovery. Hard delete is permanent and immediate.
- **Expired magic link:** No recovery — user requests a new link from `/sign-in`.
- **Expired session:** No recovery — user requests a new magic link to sign in again.

### Permanent Deletion Rules
- On user account deletion, the following are permanently removed:
  - `User` record
  - All `Session` records for the user
  - All `Account` records
  - All `Verification` records for the user
  - All `WorkspaceMember` records (user removed from all workspaces)
  - All `SpaceMember` records
  - All `UserNotificationPreference`, `UserEmailPreference`, `MutedEntity` records
  - All `PushSubscription` records
  - All `SavedFilter`, `UserListViewPreference`, `UserSearchHistory`, `UserMyTasksPreference` records
  - All `Notification` records where the user is the recipient
- **Tasks and Comments are NOT deleted** — they remain with their content intact, but:
  - Assignee references are set to `null` (unassigned)
  - Reporter reference is kept as the user ID (orphaned reference, shown as "Deleted User" in UI)
  - Comment `author_id` is kept (orphaned — shown as "Deleted User" in UI)
- If the user was the **sole Owner** of a Workspace with other members, deletion is blocked until ownership is transferred.
- If the user was the **sole Owner and sole member** of a Workspace, the workspace is auto-deleted along with the account after explicit confirmation.

---

## Business Rules

1. Email addresses are unique across the platform — one account per email.
2. Magic link is the only authentication method — no passwords, no OAuth providers.
3. First magic link use for an unknown email auto-creates the account — sign up and sign in are the same flow.
4. Magic link tokens are single-use and expire in 15 minutes — a used or expired link cannot be re-used.
5. If a new magic link is requested while a previous one is still valid, the old token is invalidated.
6. A banned user's sessions are revoked immediately — they cannot request a new magic link until unbanned.
7. Magic link requests always return the same response message regardless of whether the email is registered — prevents account enumeration.
8. A user cannot delete their account if they are the sole Owner of a workspace with other members — ownership must be transferred first.
9. Sessions use sliding expiry — TTL is reset on each authenticated request, keeping active users logged in.
10. Magic link requests are rate-limited to 5 per email per 15 minutes to prevent abuse.

---

## Out of Scope (MVP)

- Password-based authentication
- OAuth (Google, GitHub, etc.) — can be added post-MVP if there is user demand
- Two-factor authentication (2FA)
- SSO / SAML
- Account email change
