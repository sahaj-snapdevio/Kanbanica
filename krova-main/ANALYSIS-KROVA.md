# Krova — Complete Technical & Business Analysis

> Generated: 2026-06-11 | Codebase: `krova-main` | Analyst: Claude Sonnet 4.6

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Folder Structure Analysis](#3-folder-structure-analysis)
4. [Feature Analysis](#4-feature-analysis)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Database Analysis](#6-database-analysis)
7. [API Analysis](#7-api-analysis)
8. [Frontend Analysis](#8-frontend-analysis)
9. [Backend Analysis](#9-backend-analysis)
10. [Third-Party Integrations](#10-third-party-integrations)
11. [Security Review](#11-security-review)
12. [Code Quality Review](#12-code-quality-review)
13. [Performance Review](#13-performance-review)
14. [Missing Features & TODOs](#14-missing-features--todos)
15. [Project Workflow](#15-project-workflow)
16. [Architecture Diagrams](#16-architecture-diagrams)
17. [Business Understanding](#17-business-understanding)
18. [Executive Summary](#18-executive-summary)

---

## 1. Project Overview

### What This Project Does

**Krova** is a self-service cloud infrastructure platform. Users provision lightweight, hardware-isolated virtual machines called **Cubes** on dedicated bare-metal servers. Each Cube is a Firecracker microVM that boots its own Linux kernel inside a per-cube security sandbox — no shared processes, no public IP by default.

### Main Purpose

Krova sits between consumer VPS providers (DigitalOcean, Linode) and raw bare-metal hosting. The key differentiators are:

- **VM-grade isolation** using Firecracker (the same tech behind AWS Lambda/Fargate) rather than containers
- **Per-minute billing** with full transparency — users see exact cost per vCPU, RAM, and disk
- **No public IP by default** — all external access flows through a platform-managed edge (Caddy + Cloudflare for SaaS), dramatically reducing the attack surface
- **Custom domain routing** with automatic TLS via Cloudflare

### Target Users

| Segment                      | Use Case                                 |
| ---------------------------- | ---------------------------------------- |
| **Indie developers**         | Cheap, isolated dev/staging environments |
| **Startups**                 | Secure compute without DevOps overhead   |
| **Agencies**                 | Isolated per-client infrastructure       |
| **Security-conscious teams** | VM isolation with full root SSH access   |
| **Platform engineers**       | Firecracker-based microVM platforms      |

---

## 2. Tech Stack

### Frontend

| Technology            | Version         | Purpose                              |
| --------------------- | --------------- | ------------------------------------ |
| Next.js               | 16 (App Router) | Full-stack React framework           |
| React                 | 19              | UI rendering                         |
| TypeScript            | 6 (strict)      | Type safety                          |
| Tailwind CSS          | v4              | Utility-first styling                |
| shadcn/ui             | latest          | Component library (Radix primitives) |
| React Hook Form + Zod | —               | Form validation                      |
| pusher-js             | —               | Real-time WebSocket client           |
| SWR                   | —               | Client-side data fetching & cache    |
| xterm.js + addon-fit  | —               | In-browser terminal emulator         |
| Recharts              | —               | Data visualization (billing charts)  |
| sonner                | —               | Toast notifications                  |
| next-themes           | —               | Dark/light mode                      |
| date-fns              | —               | Date manipulation                    |
| embla-carousel-react  | —               | Carousel component                   |

### Backend

| Technology         | Version | Purpose                                       |
| ------------------ | ------- | --------------------------------------------- |
| Node.js            | 22      | Runtime                                       |
| PostgreSQL         | 15+     | Primary database                              |
| Drizzle ORM        | 0.45    | Type-safe DB queries + migrations             |
| Better Auth        | 1.6     | Authentication (magic link + Google OAuth)    |
| pg-boss            | 12      | PostgreSQL-backed background job queue        |
| Pusher (server)    | 5       | Real-time event broadcasting                  |
| React Email        | 6       | Transactional email template rendering        |
| ssh2               | —       | Node.js SSH client for host server management |
| @aws-sdk/client-s3 | —       | S3-compatible object storage                  |
| @polar-sh/sdk      | —       | Payment processing                            |
| Biome              | 2.4     | Linting + code formatting                     |

### Infrastructure (External)

| Technology                                                | Purpose                                           |
| --------------------------------------------------------- | ------------------------------------------------- |
| **Firecracker**                                           | MicroVM hypervisor (< 125ms boot, < 5MB overhead) |
| **Caddy**                                                 | Per-server reverse proxy + TLS (Let's Encrypt)    |
| **Cloudflare for SaaS**                                   | Custom-domain TLS + DDoS protection               |
| **S3-compatible storage** (iDrive E2, Backblaze B2, etc.) | Snapshot + backup storage                         |
| **restic**                                                | Content-addressed snapshot deduplication          |
| **rclone**                                                | Multipart upload pipeline for backups             |

### External Services

| Service             | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| **Polar**           | Subscription billing, credit top-ups, overage metering |
| **EmailIt**         | Transactional email delivery + marketing contact sync  |
| **Pusher / Soketi** | WebSocket real-time updates + in-browser terminal      |
| **Google OAuth**    | Social login alternative                               |
| **Cloudflare API**  | Custom hostname DNS + cache purge                      |

### Deployment

| Technology         | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| **Dokploy**        | Docker Swarm orchestration                          |
| **GitHub Actions** | CI (lint, typecheck, unit tests, integration tests) |
| **Docker**         | Containerized worker process                        |
| **pg-boss**        | Persistent job queue (survives restarts)            |

---

## 3. Folder Structure Analysis

```
krova-main/
├── app/                          ← Next.js App Router
│   ├── (auth)/                   ← Login, signup, invite acceptance
│   ├── (dashboard)/[spaceId]/    ← Authenticated app (per-space)
│   │   ├── cubes/                ← Cube list + create + detail
│   │   ├── billing/              ← Billing overview + plan selection
│   │   ├── members/              ← Team members management
│   │   ├── settings/             ← Space settings + audit logs
│   │   ├── backups/              ← Backup list + redeploy
│   │   └── webhooks/             ← Outbound webhook management
│   ├── (orbit)/orbit/            ← Admin panel (Orbit)
│   │   ├── cubes/                ← Fleet-wide cube management
│   │   ├── servers/              ← Bare-metal server management
│   │   ├── spaces/               ← All customer spaces
│   │   ├── users/                ← User management + ban/impersonate
│   │   ├── plans/                ← Plan catalog management
│   │   ├── billing/              ← Platform billing overview
│   │   ├── subscriptions/        ← Subscription tracking
│   │   ├── storage/              ← S3 backend management
│   │   ├── regions/              ← Region management
│   │   ├── domains/              ← Custom domain management
│   │   ├── audit-logs/           ← Full audit trail
│   │   ├── queues/               ← pg-boss queue status
│   │   ├── ports/                ← Allocated TCP ports
│   │   ├── ssh-keys/             ← Platform SSH keys
│   │   └── platform-settings/   ← Global platform configuration
│   ├── (landing)/               ← Public marketing site
│   │   ├── page.tsx              ← Homepage
│   │   ├── pricing/              ← Pricing calculator
│   │   ├── docs/                 ← API documentation page
│   │   └── privacy|terms|aup|cookies|security/  ← Legal pages
│   ├── (terminal)/              ← Full-viewport terminal UI
│   ├── actions/                 ← Next.js Server Actions (customer)
│   └── api/
│       ├── v1/                  ← Public REST API
│       ├── orbit/               ← Admin-only API routes
│       ├── spaces/              ← Internal space API
│       ├── pusher/              ← WebSocket auth + diagnostics
│       └── webhooks/            ← Inbound webhooks (Polar, EmailIt)
│
├── components/
│   ├── ui/                      ← shadcn/ui primitives
│   ├── orbit/                   ← Orbit (admin) components
│   ├── billing/                 ← Billing sheets + plan comparison
│   ├── landing/                 ← Homepage illustrations + animations
│   └── *.tsx                    ← Domain-specific shared components
│
├── lib/
│   ├── auth.ts                  ← Better Auth configuration
│   ├── auth-core.ts             ← Cube access check logic
│   ├── db.ts                    ← Drizzle database client
│   ├── billing.ts               ← Core billing math
│   ├── billing/                 ← Sub-modules: topup, refund, overage, subscription
│   ├── cloudflare/              ← Cloudflare API client (DNS, cache, custom hostnames)
│   ├── cube-actions/            ← Cube lifecycle business logic
│   ├── cubes/                   ← Cube utilities (CPU weight, disk I/O, NUMA, QoS)
│   ├── domains/                 ← Domain claim service + cache purge
│   ├── email/                   ← Email templates (React Email components + templates)
│   ├── emailit/                 ← EmailIt API client + contact sync
│   ├── payments/                ← Payment provider abstraction (Polar)
│   ├── server/                  ← Host server utilities (networking, NUMA, disk)
│   ├── ssh/                     ← SSH client + Firecracker + jailer management
│   ├── storage/                 ← S3, restic, rclone abstractions
│   ├── snapshots/               ← Snapshot retention policy + failure policy
│   └── plan/                    ← Plan limits, usage, visibility
│
├── db/
│   ├── schema/                  ← Drizzle schema files (one per domain)
│   └── migrations/              ← 77 SQL migration files
│
├── hooks/                       ← Custom React hooks (Pusher, cube status, mobile)
│
├── config/
│   └── platform.ts              ← Pricing rates, resource ranges, tier discounts
│
├── docs/
│   ├── architecture/            ← System design documents
│   ├── security/                ← Host hardening + shared responsibility
│   ├── superpowers/             ← Feature plans, design specs, rollout runbooks
│   ├── audits/                  ← Stability + disk I/O audits
│   └── *.md                     ← Setup guides (DB, app, worker, images, server)
│
├── setup/
│   ├── images/                  ← Kernel + rootfs build scripts
│   └── server/                  ← Host-side binaries (vsock-exec, vsock-pty)
│
├── Dockerfile.worker            ← Worker container image
├── dokploy/worker-stack.yml     ← Docker Swarm deployment spec
├── drizzle.config.ts            ← ORM + migration configuration
├── biome.jsonc                  ← Linting + formatting rules
└── .github/workflows/ci.yml     ← CI pipeline
```

---

## 4. Feature Analysis

### 4.1 Cube Lifecycle Management

| Feature                   | How It Works                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create Cube**           | User selects image, vCPU, RAM, disk, region → server allocated by free-capacity score → pg-boss `cube.provision` job runs via SSH → Firecracker launched in jailer chroot → guest agent handshake |
| **Sleep / Wake**          | Sleep: Firecracker paused (process suspended), prorated charge, disk continues billing. Wake: resume (fast) or cold-boot if process dead                                                          |
| **Cold Restart**          | SIGKILL + relaunch; picks up new kernel version; no data loss                                                                                                                                     |
| **Resize**                | vCPU: cold restart required. RAM: live virtio-mem hot-plug (no restart). Disk: live ext4 online resize                                                                                            |
| **Delete**                | Optional pre-deletion backup → terminate process → free ports → wipe rootfs → delete DB record                                                                                                    |
| **Cross-Server Transfer** | Snapshot source → restore on destination → flip `serverId` + re-route all domains/TCP mappings atomically                                                                                         |
| **Error Recovery**        | `cube.error-recovery-scan` cron (5 min) finds error-state cubes → `cube.error-recovery` probes host → attempts revive (max 3 attempts)                                                            |

### 4.2 Snapshots & Backups

| Feature                 | How It Works                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Auto Snapshots**      | Hourly cron checks per-plan cadence; creates restic snapshot of cube disk; per-plan retention (keep-last, keep-daily, keep-weekly) |
| **Manual Snapshots**    | Customer-created, capped per plan; permanently retained until deleted                                                              |
| **Restore**             | restic dump → e2fsck → atomic replace of live rootfs → cube wakes from restored state                                              |
| **Export as `.cube`**   | tar archive: manifest.json + rootfs.ext4.zst + checksums → S3 → presigned download URL                                             |
| **Clone to New Cube**   | Copy snapshot to any server; optional disk growth; inject new SSH key                                                              |
| **Pin Auto → Manual**   | Convert auto snapshot to manual to prevent it being pruned                                                                         |
| **Pre-Deletion Backup** | Full `.cube` blob stored in S3 before cube is deleted; can be redeployed as new cube                                               |
| **Backup Redeploy**     | Download `.cube` → provision new cube → inject new SSH key → re-create domains + TCP mappings                                      |

### 4.3 Billing & Subscriptions

| Feature              | How It Works                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Hourly Billing**   | Cron charges every `running` cube: `(vcpus × $0.001 + ramGb × $0.0025 + diskGb × $0.00005) × tierMultiplier` |
| **Prorated Charges** | On lifecycle change (sleep/delete/resize), fractional hours since last billing, clamped to 1 hour            |
| **Sleep Storage**    | Sleeping cubes continue paying disk rate — prevents "infinite free parking"                                  |
| **Volume Discounts** | 1-2 vCPU: 1.0×; 3-4: 0.95×; 5-8: 0.85×; 9+: 0.8×                                                             |
| **Plans**            | Operator-managed in Orbit; includes monthly credit grant, resource limits, snapshot config                   |
| **Credit Top-ups**   | One-time Polar checkout; processing fee gross-upped so customer receives full face amount                    |
| **Postpaid Overage** | Optional per-space cap; three-bucket cascade: prepaid → overage budget → auto-sleep                          |
| **Overage Metering** | Reports `krova_overage_usd` meter events to Polar; `polar.meter-reconcile` cron replays missed events        |

### 4.4 Networking

| Feature                 | How It Works                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| **Private IPv4**        | 198.18.0.0/15 per-server bridge; cube IP derived from server subnet + per-cube octet                     |
| **Private IPv6**        | ULA fd00:c0be:S::octet; NAT66 outbound; no inbound IPv6                                                  |
| **SSH Port Mapping**    | Automatic per-cube iptables DNAT; customer can change via `PUT /ssh-port`                                |
| **Custom TCP Mappings** | Customer maps any cube port → allocated host port (30000–50000); optional CIDR whitelist per mapping     |
| **Custom Domains**      | Cloudflare Custom Hostnames; Caddy routes verified domain to cube's private IP:port                      |
| **Domain Cache Purge**  | Customer or admin triggers Cloudflare cache purge; per-domain cooldown prevents rate-limit abuse         |
| **Space Domain Claims** | Space claims ownership of a registrable domain via DNS TXT challenge; auto-releases on failure threshold |

### 4.5 Real-time & Terminal

| Feature                 | How It Works                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Live Cube Status**    | `cube.reachability` cron (1 min): L1 vsock ping, L2 SSH check, L3 guest metrics; broadcasts via Pusher           |
| **In-Browser Terminal** | xterm.js + Soketi; framed binary protocol over WebSocket; vsock PTY on host; session auto-cleans on idle/timeout |
| **Job Log Streaming**   | Each worker step emits `job.log` Pusher events; UI streams real-time provisioning progress                       |

### 4.6 Team & Spaces

| Feature                  | How It Works                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Spaces**               | Isolation boundary; separate billing, cubes, members, domains per space                                         |
| **Member Invites**       | Magic-link email invite; accepted invite creates `spaceMemberships` + `memberPermissions` rows                  |
| **Granular Permissions** | 8 permission types: cube (view/create/manage), billing (view/manage), members (invite/manage), webhook (manage) |
| **Cube-Level Access**    | Optional: restrict member to specific cubes via `memberCubeAssignments`                                         |
| **API Keys**             | Per-space, scoped to creator's permissions; single-use secret (shown once); hashed SHA-256                      |
| **Ownership Transfer**   | Owner can transfer to any member; demotes transferor to regular member                                          |

### 4.7 Webhooks & Audit

| Feature               | How It Works                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Outbound Webhooks** | Per-space endpoint; 36 event types; HMAC-SHA256 signed; up to 4 retries; auto-disabled at 50 consecutive failures |
| **Delivery History**  | 30-day retention; per-event status, response code, attempts                                                       |
| **SSRF Guard**        | URL re-resolved on every delivery; blocks RFC1918/loopback/link-local/169.254.169.254                             |
| **Audit Logs**        | Every mutation logged: actor (user/admin/system), entity, metadata, IP, user agent, source                        |

### 4.8 Admin (Orbit)

Full platform administration including fleet server management, user management, billing oversight, plan catalog, subscription tracking, and infrastructure monitoring.

---

## 5. Authentication & Authorization

### Login Methods

| Method           | Implementation            | Notes                                                                          |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------ |
| **Magic Link**   | Better Auth built-in      | Passwordless; first use auto-creates account; disposable email + MX validation |
| **Google OAuth** | Better Auth Google plugin | Updates profile image on every login; `overrideUserInfoOnSignIn: true`         |

### Session Management

- Cookie-based sessions via Better Auth
- 60-second cache + DB re-verification of `banned` / `role` status (bounds stale-session window)
- Admin impersonation: 3600s session with `impersonatedBy` marker; cannot impersonate other admins
- All sessions revocable individually or in bulk from profile page

### Roles & Permissions

**Platform Level:**

| Role          | How Set               | Capabilities                                     |
| ------------- | --------------------- | ------------------------------------------------ |
| `admin`       | `user.role = 'admin'` | Full Orbit access, impersonation, global billing |
| Standard user | `user.role = null`    | Normal product access                            |

**Space Level:**

| Role       | How Set                           | Capabilities                                |
| ---------- | --------------------------------- | ------------------------------------------- |
| **Owner**  | `spaceMemberships.isOwner = true` | All permissions, transfer ownership         |
| **Member** | `isOwner = false`                 | Only explicitly granted `memberPermissions` |

**8 Permission Types:**

```
cube.view       — see cubes
cube.create     — create new cubes
cube.manage     — modify/sleep/wake/delete cubes
billing.view    — view billing history
billing.manage  — subscribe, top-up, manage overage
members.invite  — send invites
members.manage  — change permissions, remove members
webhook.manage  — create/edit outbound webhooks
```

**Cube-Level Restriction (optional):**

- No `memberCubeAssignments` rows → member sees all cubes in the space
- With rows → member restricted to assigned cubes only

---

## 6. Database Analysis

### Complete Table Inventory (35 tables)

#### Authentication & Users

| Table          | Key Fields                                    | Purpose                             |
| -------------- | --------------------------------------------- | ----------------------------------- |
| `user`         | id, email, name, role, banned, marketingOptIn | User accounts (Better Auth managed) |
| `session`      | userId, token, expiresAt, impersonatedBy      | Active sessions                     |
| `account`      | userId, providerId (google), accessToken      | OAuth provider links                |
| `verification` | identifier, value, expiresAt                  | Email verification tokens           |

#### Spaces & Membership

| Table                   | Key Fields                                                           | Purpose                        |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------ |
| `spaces`                | id, name, creditBalance, planId, polarCustomerId, subscriptionStatus | Team workspace + billing state |
| `spaceMemberships`      | userId, spaceId, isOwner                                             | User ↔ Space link              |
| `memberPermissions`     | membershipId, permission (pgEnum)                                    | Granular access control        |
| `memberCubeAssignments` | membershipId, cubeId                                                 | Optional per-cube restrictions |
| `invites`               | email, spaceId, token, permissions, status                           | Pending invitations            |
| `apiKeys`               | spaceId, keyHashSha256, label, lastUsedAt                            | API key records                |

#### Cubes (VMs)

| Table                      | Key Fields                                                                                                              | Purpose                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `cubes`                    | id, spaceId, serverId, status, vcpus, ramMb, diskLimitGb, internalIp, internalIpv6, jailerUid, launchMode, lastBilledAt | Core VM entity              |
| `allocatedPorts`           | serverId, port, cubeId, purpose                                                                                         | TCP port pool (30000–50000) |
| `tcpPortMappings`          | cubeId, cubePort, hostPort, isSsh, status                                                                               | Port forwarding rules       |
| `tcpMappingWhitelistedIps` | mappingId, cidr                                                                                                         | CIDR whitelist per mapping  |
| `cubeTerminalSessions`     | cubeId, status, jobId, expiredAt                                                                                        | Browser terminal sessions   |
| `cubeImports`              | spaceId, uploadState, provisionState                                                                                    | .cube file upload tracking  |

#### Servers (Bare-Metal)

| Table            | Key Fields                                                                                                            | Purpose                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `servers`        | id, hostname, publicIp, regionId, status, setupPhase, totalCpus, totalRamMb, bridgeSubnet, diskTopology, numaTopology | Host server registry                      |
| `regions`        | id, name, slug                                                                                                        | Geographic groupings                      |
| `sshKeys`        | name, encryptedPrivateKey, publicKey, fingerprint                                                                     | Platform SSH keys (AES-256-GCM encrypted) |
| `platformImages` | name, kind (kernel/rootfs), sha256, version                                                                           | Kernel + rootfs artifact registry         |

#### Snapshots & Backups

| Table             | Key Fields                                                                            | Purpose                 |
| ----------------- | ------------------------------------------------------------------------------------- | ----------------------- |
| `cubeSnapshots`   | cubeId, name, status, sizeBytes, storagePath, kind (auto/manual), storageBackendId    | restic snapshot records |
| `cubeBackups`     | spaceId, originalCubeId, cubeConfig (JSONB), sizeBytes, storagePath, storageBackendId | Full .cube blob records |
| `storageBackends` | endpoint, region, bucket, accessKeyIdEnc, secretAccessKeyEnc, usedBytes, capacityGb   | S3-compatible buckets   |

#### Billing & Payments

| Table                      | Key Fields                                                   | Purpose                           |
| -------------------------- | ------------------------------------------------------------ | --------------------------------- |
| `billingEvents`            | spaceId, cubeId, amount, type (pgEnum), polarMeterReportedAt | Ledger of all charges + credits   |
| `creditPurchases`          | spaceId, providerOrderId, amount, surchargeAmount, status    | One-time top-up orders            |
| `subscriptionIntents`      | spaceId, planId, providerCheckoutId, status                  | Plan subscription checkouts       |
| `subscriptionCreditGrants` | spaceId, providerSubscriptionId, periodEnd, amount           | Per-period included credit grants |

#### Plans

| Table                 | Key Fields                                                                                                                                 | Purpose                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `plans`               | name, priceUsd, includedCreditUsd, maxConcurrentCubes, maxVcpus, maxRamMb, maxDiskGb, autoSnapshotCadenceHours, polarProductId, visibility | Plan catalog           |
| `planSpaceVisibility` | planId, spaceId                                                                                                                            | Custom plan assignment |

#### Domains

| Table               | Key Fields                                                                        | Purpose                       |
| ------------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| `domainMappings`    | cubeId, domain, port, status, cloudflareHostnameId, verificationStatus, tlsStatus | Custom domain routing         |
| `spaceDomainClaims` | spaceId, domain, token, status, verifiedAt                                        | Space domain ownership claims |

#### Platform & Configuration

| Table                       | Key Fields                                                                                            | Purpose                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `platformSettings`          | paymentFeePercent, creditTopupMinUsd, diskQosTiers (JSONB), polarCreditProductId, polarOverageMeterId | Singleton platform config                   |
| `outboundWebhookEndpoints`  | spaceId, url, encryptedSecret, events[], enabled, consecutiveFailures                                 | Customer webhook subscriptions              |
| `outboundWebhookDeliveries` | endpointId, event, payload, status, responseStatus                                                    | Delivery history                            |
| `auditLogs`                 | action, category, actorType, actorId, entityType, entityId, spaceId, metadata (JSONB)                 | Full mutation audit trail                   |
| `jobLogs`                   | jobId, jobName, entityId, sequence, level, message, stdout, stderr, durationMs                        | Worker step logs                            |
| `idempotencyKeys`           | key, responseStatus, responseBody, expiresAt                                                          | API idempotency cache                       |
| `emailEvents`               | userId, type, timestamp                                                                               | Email delivery events (bounces, complaints) |
| `disposableEmailDomains`    | domain                                                                                                | Blocklist for signup validation             |

### Key Relationships

```
user ─── spaceMemberships ─── spaces ─── plans
              │                  │
         memberPermissions    cubes ─── servers ─── regions
         memberCubeAssignments   │
                              cubeSnapshots ─── storageBackends
                              cubeBackups    ─── storageBackends
                              domainMappings
                              tcpPortMappings ─── allocatedPorts
                              billingEvents
```

### ERD Key Notes

- All IDs are UUIDs
- All tables have `createdAt`; mutable tables have `updatedAt`
- Soft deletes: `status` field (e.g., `deleted`, `archived`) — no `deletedAt` pattern
- Hard deletes: cubes, snapshots, backups deleted immediately from DB when purged
- Per-space advisory locks on billing mutations (no double-billing races)
- Sensitive credentials AES-256-GCM encrypted before storage (`sshKeys`, `storageBackends`, `outboundWebhookEndpoints`)

---

## 7. API Analysis

### Public REST API — `/api/v1`

**Authentication:** `X-API-KEY: kro_<base64url>` header  
**Rate limit:** 10 mutating requests / 60s / IP; `429` with `Retry-After` header  
**Idempotency:** Optional `Idempotency-Key` header on POST endpoints (24h TTL)

#### Unauthenticated

| Method | Endpoint        | Description                            |
| ------ | --------------- | -------------------------------------- |
| GET    | `/images`       | List available OS images               |
| GET    | `/pricing`      | Hourly rates + volume tier multipliers |
| GET    | `/regions`      | Active regions                         |
| GET    | `/openapi.json` | OpenAPI 3.1 spec                       |

#### Cubes

| Method | Endpoint                             | Permission  | Description         |
| ------ | ------------------------------------ | ----------- | ------------------- |
| GET    | `/spaces/:id/cubes`                  | cube.view   | Paginated cube list |
| POST   | `/spaces/:id/cubes`                  | cube.create | Create cube         |
| GET    | `/spaces/:id/cubes/:cubeId`          | cube.view   | Cube detail         |
| DELETE | `/spaces/:id/cubes/:cubeId`          | cube.manage | Delete cube         |
| POST   | `/spaces/:id/cubes/:cubeId/sleep`    | cube.manage | Sleep cube          |
| POST   | `/spaces/:id/cubes/:cubeId/wake`     | cube.manage | Wake cube           |
| PUT    | `/spaces/:id/cubes/:cubeId/ssh-port` | cube.manage | Change SSH port     |

#### Cube Imports

| Method | Endpoint                                       | Description                |
| ------ | ---------------------------------------------- | -------------------------- |
| POST   | `/spaces/:id/cubes/imports`                    | Initiate .cube file upload |
| GET    | `/spaces/:id/cubes/imports/:importId`          | Poll import status         |
| DELETE | `/spaces/:id/cubes/imports/:importId`          | Cancel import              |
| POST   | `/spaces/:id/cubes/imports/:importId/complete` | Finalize + provision       |

#### Snapshots

| Method | Endpoint                                          | Permission  |
| ------ | ------------------------------------------------- | ----------- |
| GET    | `/spaces/:id/cubes/:cubeId/snapshots`             | cube.view   |
| POST   | `/spaces/:id/cubes/:cubeId/snapshots`             | cube.manage |
| DELETE | `/spaces/:id/cubes/:cubeId/snapshots/:snapshotId` | cube.manage |
| POST   | `/spaces/:id/cubes/:cubeId/restore`               | cube.manage |

#### Domains, TCP Mappings, Webhooks

All follow standard REST CRUD pattern under `/spaces/:id/cubes/:cubeId/domains`, `/tcp-mappings`, and `/spaces/:id/webhooks`. Full list in `docs/api/v1.md`.

#### Backups

| Method | Endpoint                                 | Description                   |
| ------ | ---------------------------------------- | ----------------------------- |
| GET    | `/spaces/:id/backups/:backupId/download` | Presigned S3 URL (15 min TTL) |

---

### Internal Admin API — `/api/orbit`

Admin-only routes (require `role === 'admin'`). Cover:

- **Cubes:** bulk list, force-stop, force-delete, cold-restart, resize, transfer, job logs, VM console
- **Servers:** CRUD, 6-phase setup, health check, update images, refresh Caddy, view logs
- **Storage:** S3 backend CRUD, health check, orphan audit
- **Users:** profile, ban/unban, impersonate, sessions, email events
- **Spaces:** view/edit, billing controls, subscription resync
- **Billing:** space-wise summary, overage backlog
- **Plans:** CRUD, provision in Polar
- **Audit Logs:** filter + truncate
- **Queues:** pg-boss queue status
- **Ports:** allocated port registry
- **Domains:** admin cache purge

---

### Inbound Webhooks

| Endpoint                             | Source                | Verification                           |
| ------------------------------------ | --------------------- | -------------------------------------- |
| `POST /api/webhooks/polar`           | Polar payment events  | HMAC-SHA256 (`POLAR_WEBHOOK_SECRET`)   |
| `POST /api/webhooks/emailit`         | Email delivery events | HMAC-SHA256 (`EMAILIT_WEBHOOK_SECRET`) |
| `POST /api/internal/server-rebooted` | Host server boot      | Internal key                           |

---

## 8. Frontend Analysis

### Pages

| Route Group                                    | Pages                                                                                                                                   | Auth            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `(landing)`                                    | `/`, `/pricing`, `/security`, `/docs/api`, `/privacy`, `/terms`, `/aup`, `/cookies`                                                     | Public          |
| `(auth)`                                       | `/login`, `/signup`, `/invite/[token]`, `/post-auth`                                                                                    | Unauthenticated |
| `(dashboard)/[spaceId]`                        | `/cubes`, `/cubes/new`, `/cubes/[cubeId]` (detail tabs), `/billing`, `/billing/plans`, `/members`, `/settings`, `/backups`, `/webhooks` | Authenticated   |
| `(orbit)/orbit`                                | Full admin panel (20+ pages)                                                                                                            | Admin only      |
| `(terminal)/[spaceId]/cubes/[cubeId]/terminal` | Full-viewport terminal                                                                                                                  | Authenticated   |

### Key Components

| Component                          | Purpose                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `cube-list.tsx`                    | Table of cubes with live status badges                                  |
| `cube-detail-*.tsx`                | Tabbed cube detail (overview, connect, networking, snapshots, activity) |
| `cube-terminal-client.tsx`         | xterm.js terminal (handles stdin/stdout/resize/exit frames)             |
| `space-billing.tsx`                | Credit balance, burn rate, billing history                              |
| `domain-mappings.tsx`              | Add/remove custom domains with status indicators                        |
| `tcp-mappings.tsx`                 | TCP port mapping management                                             |
| `members-page.tsx`                 | Team member list + permission management                                |
| `orbit/servers-table.tsx`          | Fleet server management                                                 |
| `billing/plan-selection-sheet.tsx` | Plan comparison + checkout                                              |

### State Management

**Pattern:** Server-first (React Server Components) + minimal client state

```
Server Components (default)
    ↓ data fetched at request time via Drizzle
    ↓ auth checked in layout/page via Better Auth
Client Components (leaf nodes only)
    ↓ useState for UI state (modal open/close, form inputs)
    ↓ SWR for auto-refreshing data (terminal sessions, live status)
    ↓ Pusher for real-time events (cube status, job logs, domain updates)
```

- No global state library (Zustand/Redux)
- Server Actions for mutations (typed, auth-checked on server)
- Pusher events trigger SWR `mutate()` to refresh specific queries

### Routing

- Next.js App Router file-based routing
- Dynamic segment `[spaceId]` for workspace scoping
- `[cubeId]` nested under space
- Route groups `(auth)`, `(dashboard)`, `(orbit)`, `(landing)`, `(terminal)` for layout isolation
- Tab state synced to URL via `useTabParam` hook

---

## 9. Backend Analysis

### Services / Business Logic Layer

| Module             | Location                                                 | Responsibility                                                           |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Billing math**   | `lib/billing.ts`, `lib/cost.ts`, `lib/cost-shared.ts`    | Hourly rates, tier multipliers, cost projections                         |
| **Plan limits**    | `lib/plan/limits.ts`, `lib/plan/usage.ts`                | Enforce per-plan caps, compute effective overrides                       |
| **Cube actions**   | `lib/cube-actions/`                                      | Sleep, wake, domain, snapshots, TCP, SSH port business logic             |
| **SSH management** | `lib/ssh/`                                               | Connect to host, run Firecracker, manage jailer, configure guest network |
| **Storage**        | `lib/storage/`                                           | S3 operations, restic commands, rclone, cube archive format              |
| **Cloudflare**     | `lib/cloudflare/`                                        | Custom hostnames, DNS, cache purge                                       |
| **Email**          | `lib/email/`, `lib/emailit/`                             | Template rendering, send via EmailIt API                                 |
| **Auth helpers**   | `lib/api/auth-helpers.ts`, `lib/actions/auth-helpers.ts` | Session extraction, permission checks                                    |
| **Audit**          | `lib/audit.ts`                                           | Write audit log entries                                                  |
| **Domain claims**  | `lib/domains/`                                           | TXT verification, coverage logic, cache purge                            |

### Worker System (pg-boss)

**78 background job handlers** organized into queues:

| Queue Category     | Key Jobs                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| **Cube lifecycle** | provision, delete, sleep, wake, cold-restart, resize, transfer, error-recovery, state-sync, reachability |
| **Snapshots**      | create, restore, delete, export, prune, scheduler, stale-check                                           |
| **Backups**        | create, delete, redeploy, stale-check                                                                    |
| **Billing**        | hourly charge, topup reconcile, polar meter reconcile                                                    |
| **Networking**     | domain add/remove/cache-purge, TCP mapping add/remove/enable/disable/whitelist                           |
| **Server setup**   | 6-phase idempotent: bootstrap → install → pull_images → network → reboot → verify                        |
| **Webhooks**       | outbound delivery with retries                                                                           |
| **Email**          | send, outbox reap, events prune                                                                          |
| **Maintenance**    | restic prune/check, storage health-check/cleanup, terminal reaper, job-log prune                         |

**Key architectural invariants:**

1. All infrastructure operations go through pg-boss — never directly from API routes
2. Per-space advisory locks on billing mutations
3. Every handler is idempotent (safe to retry on at-least-once delivery)
4. Guarded-connect pattern: any SSH failure rolls DB state back to terminal state
5. `withCubeHeartbeat()` prevents stale-check false positives on slow operations

### Middleware / Auth Guards

| Guard                                    | Used In            | Logic                                                         |
| ---------------------------------------- | ------------------ | ------------------------------------------------------------- |
| `requireSession()`                       | API routes         | Session from cookie/header; 401 if missing                    |
| `requireAdmin()`                         | Orbit API routes   | `user.role === 'admin'`; 403 otherwise                        |
| `requireSpaceMember()`                   | Space API routes   | Member of space; 403 otherwise                                |
| `requirePermission()`                    | Feature API routes | Permission in `memberPermissions` or `isOwner`; 403 otherwise |
| `requireCubeAccess()`                    | Cube API routes    | No assignments = allowed; with assignments = check list       |
| `requireActionMembershipAndPermission()` | Server Actions     | Same logic for server-side mutations                          |

---

## 10. Third-Party Integrations

### Polar (Payments)

- **Role:** Subscription billing, credit top-ups, postpaid overage metering
- **Pattern:** Polar-hosted checkout → webhook → server processes event
- **Events handled:** `subscription.synced`, `subscription.renewal_paid`, `subscription.refunded`, `topup.paid`, `topup.refunded`, `checkout.expired`, `customer.deleted`
- **Overage:** Custom meter `krova_overage_usd` reported hourly; `polar.meter-reconcile` cron replays missed events

### EmailIt

- **Role:** Transactional email + marketing audience sync
- **Templates:** magic-link, verify-email, invite, credit-granted, low-balance, zero-balance, cube-error, cube-resized, cube-transferred, domain-claim-released, overage-started, overage-50%, overage-80%, overage-cap-hit, overage-past-due, snapshot-export-ready, webhook-auto-disabled, security-digest
- **Contact sync:** Queued pg-boss job; custom fields for email_verified, last_active_at, marketing opt-in

### Cloudflare

- **Custom Hostnames:** Per-domain TLS certificate issuance via Cloudflare for SaaS
- **DNS:** CNAME records for custom domains pointing to `dns.krova.cloud`
- **Cache Purge:** Per-hostname purge with cooldown + rate-limit protection
- **Origin cert:** Wildcard Origin CA cert for the server → Cloudflare edge leg

### Pusher / Soketi

- **Channels:** `private-cube-{id}`, `private-space-{id}`, `private-server-{id}`, `presence-terminal-{sessionId}`
- **Auth:** `/api/pusher/auth` validates membership + permission before issuing channel token
- **Terminal:** `client-stdin`, `client-resize` events from browser; `cube-stdout` events to browser

### S3-Compatible Storage

- **Multiple backends:** DB-managed `storageBackends` table; no env-var credentials
- **Encrypted credentials:** AES-256-GCM using `APP_SECRET`
- **Restic repos:** `<env>/snapshot-repos/<cubeId>/` — deduplicated, per-cube encrypted
- **Backup blobs:** `<env>/backups/<spaceId>/<backupId>.cube` — full archives

---

## 11. Security Review

### Strengths

| Area                          | Implementation                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **SQL injection**             | None possible — Drizzle ORM parameterized queries throughout                                               |
| **Webhook integrity**         | HMAC-SHA256 verification on all inbound webhooks (Polar, EmailIt)                                          |
| **Outbound SSRF**             | `lib/webhook-ssrf.ts` re-resolves hostname on delivery; blocks RFC1918/loopback/link-local/169.254.169.254 |
| **Secrets storage**           | SSH keys, S3 credentials, webhook secrets AES-256-GCM encrypted in DB                                      |
| **Session security**          | Cookie-based sessions; 60s cache + DB reverification of ban/role status                                    |
| **Input validation**          | Zod schemas on all API inputs; server-side only                                                            |
| **Disposable email blocking** | DB blocklist + DNS MX lookup on signup                                                                     |
| **Cloud-init isolation**      | Disabled by default; per-cube opt-in; no default distro user created                                       |
| **Unattended upgrades**       | Security-only pocket; `krova-agent` + `sshd` pinned to no-restart                                          |
| **iptables default-deny**     | Stateful default-deny on host INPUT; explicit allow-list                                                   |

### Firecracker Security Model

| Layer                   | Implementation                                                             |
| ----------------------- | -------------------------------------------------------------------------- |
| **Per-cube UID/GID**    | Unique unprivileged uid (base 100,000) per cube via jailer                 |
| **Chroot isolation**    | Per-cube jailer chroot at `/var/lib/krova/jail/firecracker/<cubeId>/root/` |
| **PID namespace**       | `--new-pid-ns` — escape lands as unprivileged user in chroot               |
| **Seccomp**             | Firecracker default restrictive seccomp filter; never `--no-seccomp`       |
| **KSM disabled**        | No cross-VM page deduplication (side-channel risk)                         |
| **nx_huge_pages=never** | KVM iTLB-multihit mitigation                                               |
| **CPU cgroup fairness** | `cpu.weight` + `io.max` per cube (work-conserving)                         |
| **NUMA pinning**        | Per-NUMA-node cpuset assignment                                            |

### Known Risks & Gaps

| Risk                        | Severity | Status                                                                                      |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| **SMT enabled by default**  | Medium   | Documented — operator can disable; costs 50% throughput                                     |
| **No E2E tests in CI gate** | Low      | E2E script exists; not in PR gate                                                           |
| **Per-space billing loop**  | Low      | If one space throws, subsequent spaces skip that billing window; reconcile cron compensates |
| **No Renovate/Dependabot**  | Low      | Manual dependency updates                                                                   |
| **No SBOM**                 | Low      | No compliance audit artifact                                                                |

---

## 12. Code Quality Review

### Strengths

- **TypeScript strict mode** end-to-end; minimal `any` casts
- **Single source of truth:** Platform constants in `config/platform.ts`; billing event types in `lib/billing-events.ts`; webhook events in catalogue; cube network math in `lib/server/cube-network.ts`
- **Comprehensive unit tests** for pure functions (billing math, CPUID masking, network address derivation, restic commands)
- **Migration smoke tests** in CI (throwaway PostgreSQL 18 container, full migration chain)
- **Integration tests** with real DB, no live external calls
- **Biome** for linting + formatting (replaces ESLint + Prettier; faster, zero config drift)
- **Operational automation:** server setup fully automated; image builds deterministic; fleet-wide maintenance via cron jobs
- **Well-documented architecture** in `docs/architecture/` + `docs/security/` + `docs/superpowers/`
- **Idempotency everywhere:** DB status transitions, webhook dedup, API idempotency keys, pg-boss job dedup

### Anti-Patterns / Weaknesses

| Issue                                     | Impact   | Recommendation                                                                                                     |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| **No domain package boundaries**          | Moderate | A feature change touches `app/`, `lib/`, `db/schema/`, `components/` with no clear module boundary                 |
| **Error messages inconsistent**           | Low      | Some mutations return generic "Plan change failed"; `polarErrorDetail()` pattern exists but not applied everywhere |
| **Billing loop not per-space idempotent** | Low      | Per-space billing in a flat loop; single throw skips subsequent spaces                                             |
| **Documentation drift risk**              | Low      | CLAUDE.md summaries reference markdown docs that may drift                                                         |
| **No chaos/failure injection tests**      | Low      | No coverage for Polar API hang, Postgres unavailable, S3 down                                                      |

### Refactoring Opportunities

1. Extract `lib/billing-types.ts` as shared type source (DB schema + UI currently define overlapping enums)
2. Per-space idempotent billing job with `singletonKey` (isolate space billing failures)
3. E2E tests in CI gate (Playwright, critical flows only)
4. `packages/` monorepo structure for shared domain logic

---

## 13. Performance Review

### Potential Bottlenecks

| Area                   | Issue                                    | Mitigation                                                                         |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| **Billing cron**       | Scans all `running` cubes at top of hour | Index on `(status, spaceId)` + per-space advisory lock + parallel space processing |
| **Reachability cron**  | 1-minute interval, all cubes             | Batched 10 servers in parallel; vsock check is lightweight TCP CONNECT             |
| **Domain polling**     | Cloudflare Custom Hostname status        | 1-min fast poll + 30-min slow-poll for active rows; cached status in DB            |
| **Snapshot creation**  | restic backup of running cube disk       | Firecracker paused during snapshot → disk quiesced; S3 upload async                |
| **Terminal WebSocket** | High-throughput terminal output          | Chunked ≤64 KB frames; Soketi handles fan-out; xterm.js renders efficiently        |

### Database Optimization

| Table                       | Strategy                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `cubes`                     | Composite indexes: `(status, spaceId)`, `(status)`, `(serverId)`, `(transferState)`, per-server unique port+IP constraints |
| `billingEvents`             | Indexes: `cubeId`, `createdAt`, `(spaceId, type)`, `(spaceId, createdAt)`                                                  |
| `domainMappings`            | Partial unique index: `(domain)` where `verificationStatus = 'verified'`                                                   |
| `auditLogs`                 | Periodic truncation via Orbit admin action                                                                                 |
| `jobLogs`                   | Daily prune cron: errors >90d, info/warn >30d, per-entity cap 5000 rows                                                    |
| `outboundWebhookDeliveries` | 30-day retention pruned daily                                                                                              |

### Frontend Optimization

- Server Components by default → minimal JS sent to browser
- No hydration waterfalls (data fetched server-side before render)
- `next/image` with `priority` on landing page hero
- Static landing pages with cache headers
- SWR + Pusher for targeted re-fetches (no full-page polling)

---

## 14. Missing Features & TODOs

### Features Appearing Incomplete

| Feature                               | Evidence                                                         | Status                                           |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| **IPv6 public per-cube**              | 6-phase plan in `docs/superpowers/plans/`                        | Planned — phases 1-6 documented; not yet shipped |
| **Dedicated IPs**                     | `docs/superpowers/plans/2026-06-01-dedicated-ips.md`             | Planned                                          |
| **CPU NUMA placement**                | Design spec exists; `NUMA_PLACEMENT_ENABLED = true` toggle       | Partial — toggle in config, handler implemented  |
| **Disk I/O QoS tiers**                | `disk-qos-tiers` in platformSettings; cron deploys               | Shipped (2026-06-05 deployment runbook)          |
| **Log aggregation / AI digest**       | `docs/superpowers/plans/2026-06-04-log-aggregation-ai-digest.md` | Planned                                          |
| **Prepaid → PAYG billing**            | `docs/superpowers/plans/2026-06-05-prepaid-payg-billing.md`      | In design                                        |
| **Stripe migration**                  | `docs/audits/2026-06-05-polar-to-stripe-evaluation.md`           | Evaluated, not decided                           |
| **Custom domain self-hosted ingress** | Design spec exists                                               | Planned                                          |
| **Homepage revamp**                   | Design spec exists                                               | Planned                                          |

### TODOs in Code (Notable)

- `TODO: remove Stripe SDK reference` — Stripe code stub remains from early billing iteration
- Some error messages generic (see Code Quality section)
- E2E tests exist but not gated in CI

### Dead Code

- Stripe SDK imported as a dependency but not actively used (replaced by Polar)
- Some legacy `lifecycle_logs` references in orbit components (superseded by `auditLogs`)

---

## 15. Project Workflow

### User Journey

```
1. SIGNUP
   └─ /signup → email → magic link → /post-auth → create space (onboarding)

2. FIRST CUBE
   └─ /[spaceId]/cubes/new
       ├─ Select image (Ubuntu 24.04 / +Docker)
       ├─ Set vCPU, RAM, Disk
       ├─ Paste SSH public key
       └─ Submit → pg-boss provision job → real-time progress via Pusher
                → SSH into cube on port 2822

3. MANAGE CUBE
   ├─ Dashboard: live status (running/sleeping/error) via Pusher
   ├─ Terminal tab: in-browser xterm.js terminal (vsock PTY)
   ├─ Networking tab: add custom domain, TCP port mappings
   ├─ Snapshots tab: create/restore/export/clone snapshots
   └─ Activity tab: full mutation + lifecycle log

4. BILLING
   ├─ View burn rate + runway on /billing
   ├─ Top-up credits (Polar checkout)
   ├─ Subscribe to plan (included monthly credits + higher limits)
   └─ Enable postpaid overage (optional)

5. TEAM
   ├─ /members → invite by email → magic-link invite
   ├─ Set granular permissions per member
   └─ Optionally restrict member to specific cubes
```

### Admin (Orbit) Journey

```
1. ADD SERVER
   └─ /orbit/servers/new → hostname/IP/region → 6-phase automated setup
      (bootstrap → install → pull_images → network → reboot → verify → ready)

2. MANAGE FLEET
   ├─ Monitor cube states, reachability, error recovery
   ├─ Force operations (stop/delete/transfer) on any cube
   ├─ Update images fleet-wide (cold-restarts all running cubes)
   └─ View live job logs per operation

3. BILLING OVERSIGHT
   ├─ /orbit/billing: space-wise charge summary, overage backlog
   ├─ /orbit/subscriptions: MRR, active/past-due/canceled
   ├─ Grant credits to spaces directly
   └─ Manage plans + provision in Polar

4. USER MANAGEMENT
   ├─ /orbit/users: view all accounts
   ├─ Ban/unban accounts
   ├─ Impersonate user (3600s session) for support
   └─ Send magic-link on behalf of user
```

### System Flow (Cube Provision)

```
User clicks "Create Cube"
        │
        ▼
Server Action: createCube()
  ├─ Validate plan limits (advisory lock)
  ├─ Allocate server (best-fit by free capacity + region)
  ├─ Insert cube row (status = pending)
  └─ Enqueue pg-boss job: cube.provision
        │
        ▼
Worker: cube.provision
  ├─ SSH to host server
  ├─ Allocate jailer UID (globally unique)
  ├─ Allocate private IPv4 + IPv6
  ├─ Copy rootfs.ext4 to per-cube path
  ├─ Build Firecracker config (CPU, RAM, disk, network, vsock, entropy)
  ├─ Launch via jailer (chroot + PID namespace)
  ├─ Wait for vsock agent handshake
  ├─ Configure guest network (systemd-networkd, resolv.conf)
  ├─ Add iptables DNAT rule for SSH port
  ├─ (Optional) run cloud-init
  ├─ Update cube status → running
  └─ Emit Pusher event: cube.status-change → dashboard updates
```

---

## 16. Architecture Diagrams

### System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        CUSTOMER                                  │
│  Browser ──── HTTPS ──── Cloudflare ──── Next.js (App Router)   │
│                                              │                   │
│                          ┌───────────────────┤                   │
│                          │                   │                   │
│                   Server Actions          API Routes             │
│                          │              /api/v1/* (REST)         │
│                          │              /api/orbit/* (Admin)     │
│                          └───────────────────┤                   │
│                                              │                   │
│                                        PostgreSQL                │
│                                              │                   │
│                                         pg-boss                  │
│                                              │                   │
│                                    ┌─────────┴──────────┐       │
│                                    │   Worker Process    │       │
│                                    │  (78 job handlers)  │       │
│                                    └─────────┬──────────┘       │
│                                              │                   │
│                    ┌─────────────────────────┼──────────┐       │
│                    │                         │          │       │
│               SSH (2822)              Pusher/Soketi    S3       │
│                    │                    (WebSocket)  (Restic/   │
│              Bare-Metal Server              │         Backups)  │
│          ┌──────────────────┐         Browser xterm.js          │
│          │  Caddy Proxy      │              │                   │
│          │  Firecracker VMs  │──── vsock ───┘                   │
│          │   Cube 1          │                                   │
│          │   Cube 2  ...     │                                   │
│          └──────────────────┘                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Authentication Flow

```
User enters email
       │
       ▼
Better Auth ──── Email validation ──── Disposable domain check
       │                                   MX lookup (3s timeout)
       │
       ▼ (if valid)
EmailIt ──── Send magic-link email
       │
User clicks link
       │
       ▼
Better Auth verifies token
       │
       ├── New user → create account → /post-auth → onboarding
       └── Existing user → restore session → /[spaceId]

Session cookie set (60s DB cache, re-verify ban/role)
```

### Billing Flow

```
Every Hour (pg-boss cron)
       │
       ▼
Per-space advisory lock acquired
       │
       ▼
Charge every running cube:
  amount = (vcpus × $0.001 + ramGb × $0.0025 + diskGb × $0.00005) × tierMultiplier

       │
       ▼
Three-bucket cascade:
  ┌─── creditBalance > amount? ──── YES ──── Debit creditBalance
  │                                          Write billingEvent(hourly_charge)
  │    NO
  │
  ├─── overageEnabled + overageBudgetRemaining > 0?
  │         YES ──── Debit overage budget
  │                  Write billingEvent(overage_charge)
  │                  Report to Polar meter (async)
  │    NO
  │
  └─── Auto-sleep all running cubes
       Send low-balance email
```

### Database Entity Relationships

```
user (1) ────────── (*) spaceMemberships (*) ─────── (1) spaces
                              │                             │
                    memberPermissions              plans (pricing + limits)
                    memberCubeAssignments                   │
                                                      billingEvents
                                                      creditPurchases
                                                      subscriptionCreditGrants
                                                            │
spaces (1) ──────────── (*) cubes (*) ─────── (1) servers
                               │                      │
                        cubeSnapshots             regions
                        cubeBackups
                        domainMappings ──── Cloudflare for SaaS
                        tcpPortMappings ──── iptables DNAT
                        cubeTerminalSessions
```

### Request Lifecycle (API v1)

```
HTTP Request: POST /api/v1/spaces/:id/cubes
       │
       ▼
Rate limit check (10 req/60s/IP)
       │
       ▼
Idempotency key check (24h cache)
       │
       ▼
API key extraction + validation
  kro_<base64url> → SHA-256 → lookup apiKeys table
  Membership check → cube.create permission?
       │
       ▼
Zod input validation
       │
       ▼
Business logic (createCube):
  Plan limit check (advisory lock)
  Server allocation (best-fit)
  DB insert (status = pending)
  pg-boss enqueue
       │
       ▼
Response { id, status: "pending", ... }

[Async] Worker provisions cube → Pusher event → client updates
```

---

## 17. Business Understanding

### Presenting to a Client

**What is Krova?**

Krova is a cloud infrastructure platform similar to DigitalOcean or AWS Lightsail, but with a key difference: every virtual machine (which Krova calls a "Cube") runs in its own hardware-isolated sandbox using the same technology that powers AWS Lambda. This means your workloads are protected from noisy neighbours and security vulnerabilities that can affect shared container platforms.

**What can you do with it?**

- Spin up a Linux server in under 2 minutes with full root SSH access
- Scale resources up or down without interrupting your workload
- Point your own domain at any Cube with automatic TLS, protected by Cloudflare
- Take snapshots of your Cube at any time, and restore or clone them
- Invite your team with fine-grained permissions

**Why does it matter for your business?**

- Pay only for what you use — billed by the minute, no hidden fees
- No public IP by default — dramatically reduced attack surface
- Volume discounts as your usage grows
- Full control: your own kernel, your own software stack

---

### Presenting to a Project Manager

**Project type:** B2B/B2D (developer-focused) SaaS infrastructure platform

**Technical scope:**

- Full-stack Next.js 16 application with a separate background worker process
- 35 database tables, 77 migrations, comprehensive audit logging
- 78 background job handlers covering the complete infrastructure lifecycle
- Real-time updates via WebSocket (Pusher/Soketi)
- Integration with Polar (billing), EmailIt (email), Cloudflare (domains), multiple S3 backends

**Development maturity:** Production-ready. Active audit trails in `docs/audits/` (2026-06-02, 2026-06-05), documented rollout runbooks, CI pipeline with unit + integration tests.

**Active work streams (June 2026):**

- IPv6 public addresses per cube (6-phase rollout planned)
- Disk I/O QoS tiers (recently shipped)
- Prepaid → PAYG billing model redesign (in design)
- Homepage revamp

**Risk areas:**

- Polar → Stripe migration being evaluated (billing provider change = high complexity)
- E2E tests not gated in CI

---

### Presenting to a Developer

**Architecture in one sentence:** A Next.js 16 + pg-boss two-process application where the web process handles requests and the worker process asynchronously drives all infrastructure operations via SSH to bare-metal hosts running Firecracker microVMs.

**Key patterns you need to know:**

1. **Never call infrastructure directly from API routes.** Everything goes through pg-boss. Routes insert jobs, workers execute them.

2. **Idempotency is non-negotiable.** Every handler can be retried. Use DB status transitions (`UPDATE ... WHERE status='pending'`) as atomic locks. Use the guarded-connect pattern for SSH — if it fails, roll back the DB row in the catch block.

3. **Billing is credit-based.** `spaces.creditBalance` is the wallet. The `billingEvents` table is the ledger. Never modify the balance without writing a billing event first. Use the three-bucket cascade (prepaid → overage → auto-sleep).

4. **Permission model is two-level.** Owner bypasses everything. Member needs explicit `memberPermissions` grant. Cube-level: no `memberCubeAssignments` = unrestricted; with rows = restricted.

5. **Real-time is via Pusher channels.** Push from worker jobs after committing DB changes. Auth checked on channel subscription via `/api/pusher/auth`.

6. **Secrets are AES-256-GCM encrypted.** `APP_SECRET` is the master key. Loss = unrecoverable. SSH keys, S3 credentials, snapshot repo passwords all encrypted at rest.

7. **The `config/platform.ts` file is the single source of truth for pricing.** Changing it requires a redeploy. All runtime-tunable settings live in the `platformSettings` DB table.

---

## 18. Executive Summary

### Strengths

| Strength                         | Detail                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Strong security foundation**   | Firecracker jailer isolation with per-cube UID/chroot/PID-namespace; host firewall; KSM disabled; seccomp filters                       |
| **Production-grade reliability** | 78 idempotent job handlers; pg-boss at-least-once delivery; per-space advisory locks; stale-lock auto-recovery; guarded-connect pattern |
| **Transparent billing**          | Credit-based ledger with full audit trail; prorated charges; volume discounts; detailed burn-rate projections                           |
| **Excellent documentation**      | Architecture docs, security docs, rollout runbooks, design specs for every planned feature                                              |
| **Comprehensive test coverage**  | Unit tests for all pure functions; migration smoke tests; integration tests; CI gates                                                   |
| **Operational automation**       | 6-phase automated server setup; fleet-wide image updates; maintenance crons for pruning, verification, reconciliation                   |
| **Clean data model**             | 35 well-normalized tables; encrypted credentials; full audit trail; no orphan objects (S3 cleanup cron)                                 |
| **Real-time UX**                 | Live cube status, in-browser terminal, job log streaming — no page reloads                                                              |

### Weaknesses

| Weakness                                      | Impact                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **No domain package boundaries**              | Large flat `lib/` directory; feature changes touch many files across the codebase                               |
| **E2E tests not in CI gate**                  | Critical user flows (cube provision, billing checkout, domain setup) not automatically regression-tested on PRs |
| **Billing loop not fully isolated per space** | One failing space can skip subsequent spaces in the hourly billing loop                                         |
| **Stripe migration evaluation unresolved**    | Polar → Stripe is under evaluation; a billing provider change is the highest-risk refactor in the system        |
| **No Renovate/Dependabot**                    | Dependency updates manual; supply chain risk grows over time                                                    |

### Risks

| Risk                                        | Likelihood | Severity | Mitigation                                                                           |
| ------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------ |
| **APP_SECRET loss**                         | Low        | Critical | Encrypted credentials become unrecoverable; back up APP_SECRET separately            |
| **PostgreSQL single point of failure**      | Low        | High     | pg-boss and the app both depend on Postgres; no read-replica or HA documented        |
| **Polar API outage**                        | Medium     | Medium   | Subscription events missed; `subscription.reconcile` cron heals within 1h            |
| **Cloudflare rate-limit on domain polling** | Low        | Low      | Per-domain cooldown + slow-poll implemented                                          |
| **Host server compromise**                  | Low        | High     | Firecracker jailer limits blast radius; per-cube isolation prevents lateral movement |
| **SMT-enabled timing side-channels**        | Low        | Medium   | Documented decision; operator can disable at cost of 50% throughput                  |

### Recommendations

**Immediate (low-effort, high-value):**

1. Add E2E tests for critical paths (cube provision, billing checkout) to the CI gate
2. Enable Renovate or Dependabot for automated dependency updates
3. Apply `polarErrorDetail()` consistently to all plan-change error paths

**Short-term (moderate effort):** 4. Per-space idempotent billing job with `singletonKey` (isolates billing failures) 5. Document operational runbook: troubleshooting guide, rollback procedures, incident response 6. Add SBOM generation (cyclonedx) for compliance readiness

**Long-term (architectural):** 7. Resolve Polar → Stripe decision; if migrating, do it as a phased dual-write with feature flags 8. Extract `packages/` structure for shared domain logic (billing-types, plan-limits, cube-state) to enforce module boundaries 9. PostgreSQL HA setup (read replica + automated failover) before significant scale

### Final Verdict

Krova is a **well-engineered, production-quality infrastructure platform** with exceptional attention to security, billing integrity, and operational automation. The codebase shows clear architectural thinking: idempotency enforced at every layer, single sources of truth, encrypted credentials, comprehensive audit trails, and thorough documentation. The main areas for improvement are organizational (module boundaries, E2E test coverage, dependency management) rather than fundamental design issues. The core compute, billing, and security foundations are solid.

---

_End of analysis. Total codebase: ~1,100 files, 77 migrations, 35 DB tables, 78 worker handlers, 3 API surfaces._
