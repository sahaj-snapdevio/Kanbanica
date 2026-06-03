# Authentication

## Overview

Authentication handles user identity — who you are, how you prove it, and how your session is maintained across devices. Teamority uses **Better Auth** with the **Admin Plugin** as the authentication library, integrated directly into Next.js.

**Powered by:** [Better Auth](https://better-auth.com)

**Why Better Auth:**
- Built specifically for Next.js (API Routes + Server Actions)
- Database-backed sessions (more secure than stateless JWT)
- Admin Plugin gives user ban, impersonation, and session revoke out of the box
- Works natively with Prisma + PostgreSQL

---

## Auth Flows

| Flow | Description |
|------|-------------|
| Sign Up | New user creates an account with email + password |
| Sign In | Existing user logs in with email + password or OAuth |
| OAuth | Sign in / sign up via Google or GitHub |
| Email Verification | Verify email after sign up before accessing the app |
| Forgot Password | Request a password reset link via email |
| Reset Password | Set a new password via the reset link |
| Sign Out | End the current session |
| Session Management | View and revoke active sessions across devices |

---

## 1. Sign Up (Email + Password)

### Flow

1. User visits `/sign-up`
2. Fills in:
   - Full Name (required)
   - Email Address (required)
   - Password (required — min 8 characters, at least one number)
3. Submits form
4. Better Auth creates the user record and a session
5. Verification email is sent to the provided email address
6. User is redirected to `/onboarding` (Create Workspace step)
7. A banner is shown: `"Please verify your email. Check your inbox."` — app is accessible but limited until verified

### Validation

| Field | Rules |
|-------|-------|
| Full Name | Required, 2–100 characters |
| Email | Required, valid email format, must be unique |
| Password | Required, minimum 8 characters, at least one letter and one number |

### On duplicate email

- If the email is already registered: `"An account with this email already exists. Sign in instead?"`
- If the email is registered via OAuth: `"This email is linked to a Google / GitHub account. Sign in with Google / GitHub instead."`

---

## 2. Sign In (Email + Password)

### Flow

1. User visits `/sign-in`
2. Enters email + password
3. Better Auth verifies credentials
4. On success: session is created, user is redirected to `/` (last visited workspace or workspace switcher)
5. On failure: `"Invalid email or password."` — generic message (do not reveal which field is wrong)

### Rate limiting

- Max **5 failed attempts** per email per 15 minutes
- After 5 failures: `"Too many login attempts. Please try again in 15 minutes."`
- Rate limit is per IP + per email to prevent brute force

### Remember me

- Default session duration: **7 days**
- `"Remember me"` checkbox → extends session to **30 days**
- Session is refreshed on each active use (sliding expiry)

---

## 3. OAuth — Google & GitHub

Users can sign up or sign in using their Google or GitHub account. No password needed.

### Flow

1. User clicks `"Continue with Google"` or `"Continue with GitHub"` on sign-in or sign-up page
2. Browser redirects to Google / GitHub OAuth consent screen
3. User approves → redirected back to `/api/auth/callback/:provider`
4. Better Auth handles the callback:
   - **New user** (email not in DB): account is auto-created, user goes to `/onboarding`
   - **Existing user** (email matches): session is created, user is redirected to the app
   - **Email conflict** (email exists with password): accounts are linked automatically — user can now use both password and OAuth to sign in
5. No email verification required for OAuth accounts (email is already verified by Google / GitHub)

### OAuth providers (MVP)

| Provider | Scope requested |
|----------|----------------|
| Google | `email`, `profile` |
| GitHub | `user:email` |

### OAuth button labels

- Sign up page: `"Continue with Google"` / `"Continue with GitHub"`
- Sign in page: same labels — Better Auth handles new vs existing automatically

---

## 4. Email Verification

Every user who signs up with email + password must verify their email address.

### Flow

1. After sign up, a verification email is sent with a **secure token link** valid for **24 hours**
2. User clicks the link → `GET /api/auth/verify-email?token=:token`
3. Better Auth validates the token
4. On success: email is marked as verified, user is redirected to the app with a success toast
5. On expired/invalid token: `"This link has expired. Request a new verification email."`

### Unverified user restrictions

- Can access the app and complete onboarding
- Cannot invite members to their workspace until verified
- A persistent banner is shown: `"Please verify your email to unlock all features. Resend email →"`

### Resend verification email

- Available from the banner or `/settings/account`
- Rate limited: max **3 resend requests** per hour per user

---

## 5. Forgot Password

### Flow

1. User visits `/forgot-password`
2. Enters their email address
3. Clicks `"Send Reset Link"`
4. **Always shows:** `"If an account exists with this email, a reset link has been sent."` — same message regardless of whether the email exists (prevents email enumeration)
5. If the email exists: a password reset email is sent with a **secure token link** valid for **1 hour**
6. User clicks the link → `/reset-password?token=:token`
7. Enters new password + confirm password
8. On success: password is updated, all existing sessions are **revoked**, user is redirected to `/sign-in` with a success message

### Security rules

- Reset token is **single-use** — invalidated immediately after use
- Reset token expires in **1 hour**
- Changing password revokes all active sessions (forces re-login on all devices)

---

## 6. Reset Password

### Flow (from reset link)

1. User clicks the reset link from their email
2. Redirected to `/reset-password?token=:token`
3. Better Auth validates the token silently
4. If invalid/expired: redirect to `/forgot-password` with: `"This reset link has expired. Request a new one."`
5. If valid: show the reset password form
   - New Password (required, same rules as sign up)
   - Confirm Password (must match)
6. On submit: password updated, all sessions revoked, redirect to `/sign-in`

---

## 7. Sign Out

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

## 8. Session Management

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
- Default TTL: 7 days (30 days with Remember Me)
- Sessions are refreshed (TTL reset) on each authenticated request
- A banned user's sessions are all revoked immediately by Better Auth Admin Plugin

---

## 9. Account Settings

Available at `/settings/account`

### Profile

- Update Full Name
- Update Avatar (upload image or use initials as default)
- Email address (read-only — cannot be changed in MVP)

### Password

- Change password (requires current password)
- Changing password revokes all other sessions

### Connected Accounts

- Shows which OAuth providers are linked (Google, GitHub)
- Link a new provider (if signed up via email, user can add Google/GitHub)
- Unlink a provider (only if the account has a password set — cannot unlink if it is the only auth method)

### Danger Zone

- Delete Account
  - Permanently deletes the user's account and all personal data
  - If the user is the **Owner** of any workspace:
    - Must transfer ownership first before deleting account
    - Shown: `"You are the Owner of X workspace(s). Transfer ownership before deleting your account."`
  - If not an owner: account is deleted immediately
  - Requires typing email address to confirm

---

## 10. Better Auth — Admin Plugin Features

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

After a new user successfully authenticates (sign up or first OAuth login), they go through a guided onboarding:

```
Step 1: Create Workspace
  └── Enter workspace name + upload logo (optional)

Step 2: Create first Space
  └── Enter Space name + pick color
  └── Default List named "List" is auto-created inside the Space

Step 3: Done → land inside the Space, ready to create first task
```

Returning users skip onboarding and go directly to their last active workspace.

---

## Data Model

Better Auth manages most of the auth-related tables. The core tables it creates:

```
User
├── id                  (uuid, primary key)
├── name                (string)
├── email               (string, unique)
├── email_verified      (boolean, default: false)
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
├── provider            (string — "credential" | "google" | "github")
├── provider_account_id (string — provider's user ID for OAuth)
├── password            (string, nullable — hashed, only for credential accounts)
├── created_at          (timestamp)
└── updated_at          (timestamp)

Verification
├── id                  (uuid, primary key)
├── identifier          (string — email or user ID)
├── value               (string — hashed token)
├── expires_at          (timestamp)
└── created_at          (timestamp)
```

---

## API Endpoints

Better Auth exposes a unified handler at `/api/auth/[...all]` in Next.js. These are the key routes it handles:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/sign-up/email` | Register with email + password |
| POST | `/api/auth/sign-in/email` | Sign in with email + password |
| GET | `/api/auth/sign-in/social?provider=google` | Initiate Google OAuth |
| GET | `/api/auth/sign-in/social?provider=github` | Initiate GitHub OAuth |
| GET | `/api/auth/callback/:provider` | OAuth callback handler |
| POST | `/api/auth/sign-out` | Sign out current session |
| POST | `/api/auth/forget-password` | Request password reset email |
| POST | `/api/auth/reset-password` | Reset password with token |
| GET | `/api/auth/verify-email?token=` | Verify email address |
| POST | `/api/auth/send-verification-email` | Resend verification email |
| GET | `/api/auth/get-session` | Get current session + user |
| GET | `/api/auth/list-sessions` | List all active sessions for current user |
| POST | `/api/auth/revoke-session` | Revoke a specific session |
| POST | `/api/auth/revoke-other-sessions` | Revoke all sessions except current |

---

## UI Screens

| Screen | Route | Access |
|--------|-------|--------|
| Sign Up | `/sign-up` | Unauthenticated |
| Sign In | `/sign-in` | Unauthenticated |
| Forgot Password | `/forgot-password` | Unauthenticated |
| Reset Password | `/reset-password?token=` | Unauthenticated |
| Email Verification | `/verify-email?token=` | Unauthenticated |
| Onboarding | `/onboarding` | Authenticated (new user) |
| Account Settings | `/settings/account` | Authenticated |
| Session Management | `/settings/sessions` | Authenticated |

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Brute force login | Rate limit: 5 attempts per 15 min per IP + email |
| Password enumeration | Forgot password always shows the same message |
| Session hijacking | Database-backed sessions; token hashed in DB |
| CSRF | Better Auth handles CSRF protection on all POST routes |
| Token reuse | Reset + verification tokens are single-use, invalidated on use |
| Password change | Revokes all sessions to force re-login on all devices |
| Banned users | Sessions revoked immediately on ban |
| Impersonation | Logged in `PlatformAuditLog`; impersonated session marked with `impersonated_by` |
| Account deletion | Requires email confirmation; workspace ownership must be transferred first |

---

## Business Rules

1. Email addresses are unique across the platform — one account per email.
2. OAuth accounts do not require email verification — the OAuth provider has already verified it.
3. If a user signs up via email and later signs in via Google with the same email, the accounts are linked — not duplicated.
4. A banned user's sessions are revoked immediately — they cannot re-authenticate until unbanned.
5. Password reset invalidates all existing sessions — the user must log in again on all devices.
6. Reset tokens and verification tokens are single-use and expire (1 hour for reset, 24 hours for verification).
7. A user cannot delete their account if they are the sole Owner of any workspace — ownership must be transferred first.
8. Verification email resends are rate-limited to 3 per hour to prevent email abuse.
9. Forgot password always returns the same response message regardless of whether the email exists — prevents account enumeration.
10. Sessions use sliding expiry — TTL is reset on each authenticated request, keeping active users logged in.

---

## Out of Scope (MVP)

- Two-factor authentication (2FA / TOTP)
- Magic link sign in (passwordless email link)
- SSO / SAML (enterprise identity providers)
- Passkeys / WebAuthn
- Workspace-level forced 2FA enforcement
- Email address change (post-MVP — requires re-verification flow)
- Account merge (multiple accounts with different emails)
