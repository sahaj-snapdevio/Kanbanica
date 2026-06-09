# Krova

Hardware-isolated cloud servers — your own kernel, no public IP.

A self-service cloud infrastructure platform for provisioning lightweight, hardware-isolated micro VMs (Cubes) on dedicated bare-metal servers. Each Cube boots its own kernel inside a per-cube sandbox, has no public IP of its own, and is billed by the minute. Create spaces, spin up Cubes with custom resources, manage networking and domains — all from a real-time dashboard or the REST API.

[Features](#features) · [Architecture](#architecture) · [Tech Stack](#tech-stack) · [Getting Started](#getting-started)

---

## What is Krova?

Krova is a cloud platform that lets users provision **Cubes** — lightweight Firecracker microVMs with full root SSH access. Each Cube runs on a dedicated bare-metal server, giving users real hardware performance without the overhead of traditional cloud providers.

Users organize their infrastructure into **Spaces** (personal or team), provision Cubes with custom CPU, RAM, and disk configurations, attach custom domains, and set up TCP port forwarding — all through an intuitive web dashboard with real-time updates.

Billing is credit-based and per-hour. Every space is on a plan tier (a free Trial plus paid monthly plans) that sets per-feature limits. Spaces subscribe to a paid plan via Polar recurring subscriptions and can top up their credit balance with prepaid one-time purchases via Polar; Cubes automatically sleep on zero balance to prevent unexpected charges.

---

## Features

### Instant Cube Provisioning

Spin up a Firecracker microVM in under a second. Choose your vCPU count, memory, disk size, and OS image. Cubes boot on dedicated bare-metal servers with full root SSH access — no shared tenancy.

### Live Cube Resize

- **RAM grow, live** — Hot-plug additional memory into a running Cube via `virtio-mem`, no reboot. Every Cube boots with a 1 GiB memory floor and a 31 GiB virtio-mem region; resizes PATCH `/hotplug/memory` to expand toward the new target.
- **Disk grow, live** — Truncate the host rootfs, refresh Firecracker's drive metadata, then run `resize2fs /dev/vda` inside the guest — all without stopping the VM.
- **CPU change, cold** — vCPU count cannot be hot-changed (Firecracker has no CPU hotplug), so CPU resizes fall back to a single graceful stop / restart cycle with the new config.

### Custom Domains & Networking

- **Domain Mappings** — Point custom domains to any Cube port. Routing runs through **Cloudflare for SaaS**: add a single CNAME from your domain to `dns.krova.cloud` and Krova registers it as a Cloudflare Custom Hostname. Cloudflare manages the visitor-facing TLS certificate and DDoS protection; Caddy host-routes the request to the Cube on the origin. If your domain's DNS is itself on Cloudflare, set that CNAME to **DNS only (grey cloud)**, not Proxied.
- **Clear cache** — Each active custom domain has a one-click **Clear cache** action (and a v1 API endpoint) that purges that hostname's edge cache from Cloudflare — isolated to the single domain, never the whole zone. A short per-domain cooldown keeps within Cloudflare's purge rate limit.
- **Domain locking (verified domains)** — A space can prove it owns a registrable domain (e.g. `acme.com`) by adding one TXT record. Once verified, that domain **and all its subdomains** are locked to the space — no other space can map any hostname under it. Managed from a **Verified Domains** card in space settings; a daily re-check auto-releases the lock if the TXT record disappears.
- **TCP Port Forwarding** — Expose internal Cube ports to the internet with optional CIDR whitelist restrictions
- **SSH Access** — Paste your SSH public key inline when creating a Cube; it's written into `/root/.ssh/authorized_keys` at boot. Krova does not store a per-user key library
- **Dual-stack networking** — Every Cube gets a globally-unique IPv4 + IPv6 address (NAT66 ULA, outbound only) so workloads can reach the IPv6 internet. DNS resolution is **IPv4-first** (the v6 resolvers stay as fallback) with a `timeout:1 single-request-reopen` glibc options line, so name lookups never stall on a flaky/blackholed v6 path

### Snapshots

Save and restore your Cube's disk state. Snapshots are **bundled in the plan** (no per-GB charge) and split into two kinds:

- **Auto snapshots** are system-managed, scheduled by your plan's cadence, and rotated by the daily `snapshot.auto-prune` cron per the plan's retention buckets. You cannot delete them directly — pin one to convert it to a manual snapshot, then delete it.
- **Manual snapshots** are customer-managed and count against the plan's manual cap. Create one from the Cube detail page while the VM is running (live, no downtime). Delete one to make room for another.

**Per-plan defaults** (operator-tunable from Orbit → Plans):

| Plan | Auto cadence | Retention (last / daily / weekly) | Manual cap |
|---|---|---|---|
| Trial | — | — | 0 |
| Starter | every 12h | 4 / 7 / 1 | 1 |
| Pro | every 6h | 8 / 7 / 2 | 2 |
| Business | every 4h | 12 / 14 / 4 | 4 |

**What you can do with any completed snapshot:**

- **Restore** — Roll the source cube's disk back to the snapshot. Original disk is preserved during restore and rolled back on failure.
- **Download as `.cube`** — Materializes the snapshot into a portable archive on the host, uploads to S3, and emails you a 24-hour presigned link. After 24h the archive is auto-deleted; request a new export if you need it again.
- **Clone to a new Cube** — Spins up a fresh cube from the snapshot in any region. Disk can grow but cannot shrink below the source. The new cube starts with a blank network (no custom domains, no TCP port mappings — only SSH).
- **Pin (auto-only)** — Flip an auto snapshot to manual so it survives the daily auto-prune. Counts against your manual cap.
- **Save as Backup** — Promote a snapshot into a long-lived, chargeable backup that survives cube deletion.

**Storage** — Per-cube restic repos at `<env>/snapshot-repos/{cubeId}/` on the S3 backend. Content-addressed deduplication: the first snapshot uploads the full compressed rootfs; every subsequent one uploads only the chunks that changed (~50–200 MB on a mostly-idle cube vs. ~5 GB per full-blob snapshot — a ~20× saving). Each repo is encrypted with a per-cube random password stored AES-256-GCM in `cubes.snapshot_repo_password_enc`. `restic` runs on the bare-metal host over SSH; the worker never holds rootfs bytes.

**Operational crons** — Weekly `restic.prune` (Sundays 04:00 UTC) reclaims orphaned chunks; weekly `restic.check --read-data-subset=2%` (Sundays 06:00 UTC) verifies repo integrity and emails admins on failure. Hourly `snapshot.scheduler` walks every running/sleeping cube and enqueues a snapshot when the cadence has elapsed. Daily `snapshot.auto-prune` (03:30 UTC) runs `restic forget --keep-last/daily/weekly` per cube, scoped to the auto snapshots via one `--tag <id>` per auto snapshot (restic has no `--keep-id` flag), so pinned/manual snapshots are never forget candidates and survive untouched.

**Stale-lock recovery** — A restic process killed mid-operation (host OOM, host down, or a cube transferred off a host killed mid-op) leaves an exclusive lock in the cube's S3 repo that outlives the dead host, blocking every later restic op for that cube with exit 11. Every lock-taking op routes through a shared wrapper that auto-removes a _provably-stale_ lock (only locks older than 45 min — never a live op's lock) and retries once; the operator escape hatch is `pnpm restic:unlock <cubeId>` (dry-run by default).

### Backups (chargeable)

Backups survive cube deletion and are billed per-GB-month. **Trial plans do not get backups.** Two ways to create one:

- **Pre-deletion backup** — When you delete a Cube on a paid plan, the "Preserve backup before deleting" checkbox is **checked by default**. Saves a `.cube` archive plus the full config (CPU/RAM/disk/image/region/domains/TCP mappings) so you can redeploy an identical Cube later.
- **Promote a snapshot to a backup** — Click "Save as Backup" on any completed snapshot. Materializes the snapshot via restic and lands it in the backups prefix. Source cube + source snapshot are both untouched.

**Per-plan backup caps** (operator-tunable):

| Plan | Backups |
|---|---|
| Trial | 0 |
| Starter | 3 |
| Pro | 10 |
| Business | 30 |

**Pricing** — `platform_settings.backup_storage_rate_per_gb_per_month` (default $0.01 / GB / month). Billed hourly by `billing.hourly` against the compressed `.cube` size (what's actually on S3, not the uncompressed disk). A 5 GB backup ≈ $0.05/month.

**Storage** — `.cube` archives at `<env>/backups/{spaceId}/{backupId}.cube`, transferred via `rclone` multipart streams from the bare-metal host. Dedicated page at `/{spaceId}/backups` with config summary, storage cost, redeploy / download / delete.

**Redeploy** — Spin up a new Cube from any backup with the original configuration. Domain mappings and TCP port mappings are automatically re-created when they don't conflict with the source cube; conflicts are logged and skipped on the new cube. Customers re-add them manually if needed.

### Cube Import / Export (`.cube` archives)

Move cubes between accounts, keep an offline archive, or migrate to another Krova instance — every backup can be downloaded as a single portable file and re-imported on demand:

- **Export** — On the Backups page, click **Download** on any completed backup. Krova generates a 15-minute presigned S3 URL; the customer's browser fetches the `.cube` archive directly from storage (no Krova bandwidth cost)
- **Archive format** — Plain tar bundling `manifest.json` (cube config + checksums, `format: "krova-cube-v1"`), `rootfs.ext4.zst` (compressed rootfs), and `checksums.txt`. Extractable with stock Linux tools: `tar xf`, `sha256sum -c`, `zstd -d`, `mount -o loop`
- **Import** — On the Cubes page, click **Import Cube**, select a `.cube` file. The browser parses the manifest locally (no upload yet) and pre-populates a configuration form. Customer adjusts the name, region, optional vCPU/RAM/disk overrides, and picks an **SSH key mode** — "Replace SSH keys" (provide a new key, we overwrite `/root/.ssh/authorized_keys` inside the rootfs) or "Keep existing keys" (the rootfs's existing authorized_keys remain untouched; customer must have the matching private key)
- **Disk override** — Can only grow the imported disk, never shrink (would corrupt ext4). Worker runs `truncate -s` + `resize2fs` on the rootfs offline before boot
- **Multipart upload** — Browser uploads the archive directly to S3 via presigned PUT URLs (8 MB chunks, 4-way parallelism). No bytes proxied through Krova's app server
- **Cleanup** — `cube-imports.reaper` cron sweeps abandoned uploads every 6 hours; orphan S3 objects also surface in `pnpm storage:audit`

### Real-time Dashboard

Status changes, domain updates, and lifecycle events push instantly via WebSocket channels (Pusher or self-hosted Soketi). No polling, no refreshing.

### Outbound Webhooks

Customers register HTTPS endpoints to receive signed POSTs whenever entities in their space change. Per-space, per-event subscriptions, managed at `/{spaceId}/webhooks` (or via the v1 API). Gated by the `webhook.manage` permission.

- **36 events across 7 categories** — cube lifecycle (created, running, sleeping, error, deleted, cold-restarted, transfer.*, resize.*), snapshots, backups, custom domains, TCP port mappings, team members, subscriptions. Billing events (hourly charges, top-ups, plan credit, overage) are intentionally not delivered — query the billing endpoints instead.
- **Stripe-style signatures** — `X-Krova-Signature: t=<unix>,v1=<hmac-sha256>` over `{t}.{rawBody}`. 300 s replay window. Per-endpoint signing secret shown once at create + on rotate.
- **SSRF guarded at create AND at delivery** — every URL is re-resolved on each delivery; RFC 1918, loopback, link-local (incl. 169.254.169.254 metadata), carrier-grade NAT, IPv6 ULA / link-local all blocked.
- **At-most-5 attempts** — 4 retries × 60 s backoff. 10 s per-attempt timeout. Successful deliveries reset the per-endpoint failure counter.
- **Flap auto-disable** — at 50 consecutive failed deliveries the endpoint flips off, an email goes to the space owner, and re-enable from the dashboard resets the counter.
- **30-day delivery retention** — pruned by the daily `job-logs.prune` cron.
- **Dashboard ergonomics** — test-fire button, per-row redeliver, rotate-secret, edit URL/description/events, recent-deliveries inline, "Auto-disabled" + "SSRF blocked" badges.
- **Orbit admin view** at `/orbit/webhooks` lists every space's endpoints with status filter chips for support debugging.

### Team Spaces

Shared workspaces with granular permissions:

- **8 permission types** — `cube.view`, `cube.create`, `cube.manage`, `billing.view`, `billing.manage`, `members.invite`, `members.manage`, `webhook.manage`
- **Cube-level assignments** — Restrict members to specific Cubes
- **Invite system** — Email invites with pre-configured permissions and expiry

### Plans & Tiers

Every space is on a plan — a free default plus operator-defined paid + custom plans. The plan catalog lives in the `plans` DB table (managed via Orbit → Plans). Migration 0037 seeds four public plans (`Trial`, `Starter`, `Pro`, `Business`); operators add, duplicate, rename, archive, and tweak limits from the Orbit UI:

- **Per-feature limits** — Each plan caps per-Cube size (vCPU / RAM / disk), concurrent Cubes, team seats, retained backups, and custom domains (`null` = unlimited). New and existing spaces default to the plan marked `is_default_for_new_spaces = true` (Trial out of the box).
- **Per-space overrides** — Eleven nullable `override_*` columns on the `spaces` row let an operator grant individual customers higher (or lower) caps without duplicating the plan. `effectiveLimits(plan, overrides)` is the merge — for each field, `override ?? plan` wins.
- **Custom plans** — A plan with `visibility = 'custom'` is only visible to spaces in the `plan_space_visibility` join table. Operators duplicate a public plan, edit it, and assign it to specific customers (e.g. enterprise deals).
- **Enforced everywhere** — `lib/plan/` runs the limit check (count current usage under a per-space lock, then guard) on Cube create/wake/resize, member invite, backup keep, and domain add.
- **Paid-plan subscriptions (Polar)** — Spaces subscribe to, upgrade, downgrade, or cancel a paid plan through Polar recurring subscriptions. The Polar webhook is authoritative for subscription state; each active billing period grants the plan's included credit (once per period, with an activation cooldown to stop resubscribe credit farming). An upgrade applies immediately; a downgrade is blocked until the space already fits the lower plan's limits; cancelling drops the space back to the default plan and auto-sleeps Cubes over the new concurrent limit. The hourly `subscription.reconcile` cron heals any divergence from dropped webhooks — sibling-safe because lookups use `subscriptions.list({metadata: {spaceId}})` and the cron verifies via `getSubscription(id)` before synthesizing a terminal event (a Polar customer's `external_id` is per-EMAIL, shared across sibling spaces of the same user, so it must never be used to address a per-space customer record — `spaces.polar_customer_id` is the canonical handle).
- **Postpaid overage (optional, per-space)** — A paid-plan space (any plan with `allowOverage = true`) can opt into postpaid overage so Cubes keep running once the prepaid balance is exhausted, billed up to a customer-set cap on the next subscription invoice via a Polar metered price. The customer picks the cap (per billing period, bounded by `platform_settings`); the hourly worker debits prepaid first, then the overage budget, and when the cap is hit Cubes auto-sleep (same path as zero-balance). Raising the cap mid-period wakes them again. Threshold emails fire at first overage, 50%, 80%, cap-hit, and when the subscription goes `past_due`.
- **Platform-wide tunables** — Processing-fee gross-up, top-up bounds, overage bounds, cooldown days, low-balance threshold floor, and the Polar credit/meter ids all live in the `platform_settings` singleton table (managed via Orbit → Platform Settings). Operators change them without a redeploy; reads are cached for 60 s.

### Credit-Based Billing

Per-hour, per-resource pricing with full transparency:

- **vCPU, RAM, Disk** rates configured in `config/platform.ts` (single source of truth)
- **No overselling** — RAM and disk are sold 1:1 with the host. Every GB you provision is reserved on real ECC RAM / enterprise NVMe; there is no free-disk allowance or thin-provisioning. Only vCPU is oversubscribed (safely, by Firecracker, on dedicated cores).
- **Prorated billing** — Cubes deleted or slept mid-hour are charged for actual usage, not the full hour
- **Sleep storage** — A sleeping Cube stops vCPU + RAM charges but disk continues at `DISK_RATE × diskLimitGb × tier multiplier` per hour. Same per-GB rate AND full-disk basis as the running-disk component (running and sleeping cubes both occupy every allocated GB on the host). Single knob: set `DISK_RATE = 0` in `config/platform.ts` to disable BOTH sleep-storage AND running-disk billing together
- **Auto-sleep** — Cubes automatically sleep when credits hit zero
- **Burn rate** — Real-time cost projection on the dashboard (includes sleep-storage burn so the runway projection accounts for idle spend)
- **Credit top-up (Polar)** — Spaces buy prepaid credit through one-time hosted checkouts via Polar. A small processing fee is grossed up on top of the customer's chosen amount so the space receives the full base as credit and the platform nets Polar's processor cost; the signature-verified `POST /api/webhooks/polar` webhook applies it, with the hourly `billing.topup-reconcile` cron as a backstop. Refunds claw back the base fraction. The same processing-fee gross-up is applied to each paid subscription's monthly charge — the plan's face price (Starter $10 / Pro $30 / Business $100) is what gets credited to the space; Polar bills the customer the face price + the processing fee. When the Polar env is unset, payments are inert and the Orbit admin grant path is unaffected.
- **Low-balance alert** — A configurable per-space threshold (`low_balance_threshold`) controls when the hourly worker emails a low-balance warning.

### Multi-Region Support

Servers are grouped by geographic region. Users select a region when creating a Cube, and the platform automatically finds the best-fit server with available resources.

### Admin Control Panel (Orbit)

Full platform observability and control:

- **Users** — View all accounts, promote/demote admins, user detail with spaces and cubes
- **Servers** — Monitor resource utilization, add new bare-metal hosts, configure overcommit ratios
- **Cubes** — Platform-wide view with force-stop, force-delete, and cross-server transfer (move a Cube to another server in the same region for hardware refresh / rebalancing)
- **Regions** — Geographic region CRUD with server counts
- **Spaces** — View all spaces with credit balances and cube counts
- **Billing** — Platform-wide financials, read-only rate display, grant credits
- **Ports** — Port allocation viewer across all servers
- **Storage** — S3-compatible storage backend management with capacity tracking and health checks (`HeadBucket` probe)
- **Audit Logs** — Every mutation logged with actor, action, entity, metadata, IP, user agent, and source — filterable, searchable, with analytics and truncation

---

## Architecture

### Two-Process Model

Krova runs as two processes sharing a single PostgreSQL database:

```text
┌─────────────────────┐     ┌─────────────────────┐
│                     │     │                     │
│   Next.js Server    │     │   pg-boss Worker    │
│                     │     │                     │
│  • Web UI           │     │  • Cube lifecycle   │
│  • API routes       │     │  • Firecracker mgmt │
│  • Server actions   │     │  • Domain config    │
│  • Auth             │     │  • Billing jobs     │
│                     │     │  • Email delivery   │
└────────┬────────────┘     └────────┬────────────┘
         │                           │
         └───────────┬───────────────┘
                     │
              ┌──────┴──────┐
              │  PostgreSQL  │
              │  + pg-boss   │
              └──────────────┘
```

**Critical invariant:** All infrastructure operations flow through the worker via pg-boss jobs — never directly from Next.js routes.

Cubes can be resized live (RAM grow, disk grow via virtio-mem and online ext4 resize) or cold (any CPU change). Admins can transfer cubes between servers in the same region (used for hardware refresh).

### Cube Lifecycle

```text
pending → booting → running ↔ sleeping
   ↓                    ↓
 error              stopping → deleted
```

1. **Allocate** — Find best-fit server in the selected region, reserve an SSH port (30000–50000)
2. **Boot** — Start Firecracker microVM, configure networking via TAP device on br0
3. **Configure** — Customer's SSH key written into rootfs before boot, vsock agent confirms readiness
4. **Running** — Billing starts (sets `lastBilledAt`), real-time status synced every 2 minutes
5. **Sleep/Wake** — Pause/resume VM via Firecracker API, prorated billing on sleep, billing clock resets on wake
6. **Delete** — Prorated billing for partial hour, then kill process, free ports, cleanup TAP device, iptables, and Caddy routes

### Zero-Key VM Security

Krova uses a **zero-key architecture** for platform management:

| Layer                  | Access Method                            | Who Controls |
| ---------------------- | ---------------------------------------- | ------------ |
| Customer SSH (port 22) | Customer's own keys in `authorized_keys` | Customer     |
| Platform Management    | Virtio-vsock (krova-agent)               | Platform     |

No SSH keys, config files, or management services live inside the VM for platform use. All platform operations use the vsock guest agent (`krova-agent`) — a lightweight Python daemon that listens on vsock port 52 inside the guest. It communicates through Firecracker's virtio-vsock channel, which operates at the hypervisor level — invisible and inaccessible to the customer. A systemd watchdog ensures the agent stays running.

The customer's SSH key is written directly into the rootfs at creation time (before boot). The platform never SSHes into any Cube.

### Networking

Cubes are dual-stack and globally unique fleet-wide via a per-server `servers.bridge_subnet` (`S`, range `[1, 511]`): IPv4 on `198.18.0.0/15` base+offset (the S-th `/24` inside the range — `cubeIpv4Address(S, octet)` = `198.18.0.0 + S×256 + octet`) and IPv6 `fd00:c0be:<S-hex>::<octet>/64` (NAT66 over a ULA, **outbound + DNS only** — inbound stays IPv4). The IPv4 range was rebased off `10.0.0.0/8` onto `198.18.0.0/15` (2026-05-31) so cubes stop colliding with the in-guest CIDRs customer software uses (Docker Swarm overlay `10/8`, k3s/kubeadm `10.x`). The host runs a stateful default-deny INPUT firewall on both families plus dual-stack bridge/NAT (`applyHostNetworking` in `lib/server/cube-network-host.ts`); the address math lives in `lib/server/cube-network.ts` (unit-tested via `pnpm test`). The fleet-wide cutover onto this scheme was completed 2026-05-31; the runtime is now `198.18`-only with fail-loud guards and the one-shot migration tooling has been removed. External access is through:

- **Domain mappings** — Customer domains route through Cloudflare for SaaS (Custom Hostnames); the Caddy reverse proxy on the host then routes the request to `internalIp:port`
- **TCP port mappings** — iptables DNAT forwards `serverPublicIp:hostPort` to `internalIp:cubePort` for any guest service the customer wants to expose (Postgres, Redis, MySQL, MongoDB, raw TCP, etc.). Every mapping draws its host port from a per-server pool of 30000–50000 (`PORT_RANGE` in `lib/server/ports.ts`); the customer picks the cube-side port at creation. Optional CIDR whitelist supports per-mapping IP allowlisting.
- **Customer SSH** — created automatically at cube boot as one of the TCP port mappings above (`isSsh: true`). The platform allocates a host port from the same 30000–50000 pool and installs an iptables forward to the Cube's sshd. The port inside the Cube defaults to 22 (`DEFAULT_CUBE_SSH_PORT` in `config/platform.ts`); if the customer moves sshd to a different port inside their Cube they call `PUT /spaces/{spaceId}/cubes/{cubeId}/ssh-port` with body `{ "cubePort": <int> }` and the worker swaps the iptables rule in place (host port + whitelist preserved) through the `tcp-mapping.update-cube-port` job. The reachability cron's L2 probe reads the live `cubePort` from the SSH mapping row, so health monitoring follows the customer's chosen port automatically. The SSH mapping cannot be deleted via the TCP mappings API — every cube needs SSH access.

### Firecracker VM Management

Each Cube runs as a separate Firecracker process with:

| Resource    | Path                                                  |
| ----------- | ----------------------------------------------------- |
| API socket  | `/var/lib/krova/cubes/{cubeId}/firecracker.sock`      |
| Rootfs      | `/var/lib/krova/cubes/{cubeId}/rootfs.ext4`           |
| Serial log  | `/var/lib/krova/cubes/{cubeId}/serial.log`            |
| Vsock UDS   | `/var/lib/krova/cubes/{cubeId}/vsock.sock`            |
| PID file    | `/var/lib/krova/cubes/{cubeId}/firecracker.pid`       |
| Kernel      | `/var/lib/krova/images/vmlinux` (shared, read-only)   |

VM operations go through the Firecracker REST API via curl over the Unix socket. The worker SSHes into the host server (port 2822) and runs commands there — it never connects to VMs directly.

### Background Jobs

| Job | Schedule | Purpose |
| --- | --- | --- |
| `cube.provision` | On demand | Start Firecracker, configure, boot |
| `cube.delete` | On demand | Kill process, cleanup resources |
| `cube.sleep` / `cube.wake` | On demand | Pause/resume VM via Firecracker API |
| `domain.add` / `domain.remove` | On demand | Register/delete the Cloudflare Custom Hostname + Caddy host route |
| `domain.purge-cache` | On demand | Purge a single custom domain's Cloudflare edge cache (purge-by-hostname) |
| `tcp-mapping.add` / `tcp-mapping.remove` | On demand | Configure iptables port forwarding |
| `tcp-mapping.update-whitelist` | On demand | Refresh CIDR whitelist rules |
| `snapshot.create` | On demand | Back up rootfs into the cube's per-cube restic repo (content-addressed dedup) on the S3 backend |
| `snapshot.restore` | On demand | Stop VM, `restic restore` the snapshot id over rootfs in place |
| `snapshot.delete` | On demand | `restic forget --prune` to release the snapshot + reclaim its unique chunks |
| `snapshot.auto` | Configurable | Automatic snapshots for all running Cubes |
| `restic.prune` | Sundays 04:00 UTC | Weekly per-cube `restic prune` — reclaim orphaned chunks |
| `restic.check` | Sundays 06:00 UTC | Weekly per-cube `restic check --read-data-subset=2%` — repo integrity sweep; admin email on failure |
| `cube-imports.reaper` | Every 6 hours at :10 | Abort abandoned multipart uploads; hard-delete old terminal `cube_imports` rows |
| `storage.cleanup` | On demand | Batch delete objects on an S3 backend (idempotent) |
| `cube.state-sync` | Every 2 min | Sync Firecracker state with DB |
| `cube.stale-check` | Every 5 min | Detect stuck VMs, mark as error |
| `server.reconcile` | Every 10 min | Detect DB↔hypervisor drift: ghost cubes (VM gone) and stale `error` cubes are marked + admin-emailed (never auto-deleted); orphaned host VMs with no DB record are force-destroyed on the host |
| `server.measure-disk` | Hourly at :40 | Measure each host's real non-cube disk overhead (`df_used − du(cubes)`) so cube placement caps reservations at the effective capacity (`totalDiskGb − overhead`) — no overselling. Pure observer; audits only when a host drifts over-allocated |
| `server.reboot-recovery` | On demand | Restart all `running` cubes after a host reboot (triggered by boot-id change in `cube.state-sync` or the `krova-boot-notify` systemd unit) |
| `server.refresh-caddy` | On demand | Snapshot, then re-assert a server's routing — both Cloudflare DNS records, the Origin CA cert, and the full Caddy route set (landing page + every custom domain) — the **Refresh Routing** admin button |
| `server.update-caddy` | On demand | Snapshot, then upgrade Caddy to the platform-pinned `CADDY_VERSION` and verify — the **Update Caddy** admin button |
| `cloudflare.hostname-poll` | Every 1 min | Refresh Cloudflare Custom Hostname status, push `domain.update` |
| `billing.hourly` | Every hour | Charge for running Cubes |
| `billing.topup-reconcile` | Hourly at :30 | Backstop for missed Polar webhooks — heal `pending` credit purchases Polar already marked paid |
| `subscription.reconcile` | Hourly at :15 | Backstop for missed Polar subscription webhooks — poll Polar and heal plan/subscription divergence; expire abandoned pending intents |
| `polar.meter-reconcile` | Every 10 min | Re-report `overage_charge` rows older than 5 min with `polar_meter_reported_at IS NULL` into Polar's metered-billing meter |
| `storage.health-check` | Every 30 min | Probe every active storage backend (`HeadBucket`) and alert at 85% of configured capacity |
| `email.send` | On demand | Deliver transactional emails via the EmailIt API |
| `emailit.sync-contact` | On demand | Sync one user into the EmailIt marketing audience; fired from cube / billing / membership / auth events via `lib/emailit/enqueue-sync.ts` (singleton-keyed per user) |
| `email.events-prune-cron` | Daily 03:20 UTC | Drop `email_events` rows older than 90 days |

All handlers are **idempotent** — safe to retry on failure.

### Real-time Events (Pusher/Soketi)

| Channel                     | Events                              | Access  |
| --------------------------- | ----------------------------------- | ------- |
| `private-cube-{cubeId}`     | `lifecycle.update`, `domain.update` | Members |
| `private-space-{spaceId}`   | `cube.status-change`                | Members |
| `private-server-{serverId}` | Server real-time updates            | Admin   |

Channel auth checks session, space membership, and Cube assignment before granting access. Server channels require admin. Deleted cubes are excluded from channel authorization. Supports Pusher cloud (via `PUSHER_CLUSTER`) or self-hosted Soketi (via `PUSHER_HOST`/`PUSHER_PORT`).

---

## Tech Stack

### Frontend

| Technology                | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| **Next.js 16**            | App Router, React 19, TypeScript strict mode         |
| **Tailwind CSS v4**       | Utility-first styling                                |
| **shadcn/ui**             | Component library (Radix primitives, Phosphor icons) |
| **react-hook-form + Zod** | Form validation                                      |
| **Pusher.js**             | Real-time WebSocket client (Pusher cloud or Soketi)  |
| **Recharts**              | Data visualization                                   |
| **SWR**                   | Client-side data fetching                            |

### Backend

| Technology        | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| **PostgreSQL**    | Primary database                                     |
| **Drizzle ORM**   | Type-safe database queries                           |
| **Better Auth**   | Authentication (magic link + Google OAuth)           |
| **pg-boss**       | Background job queue (PostgreSQL-backed)             |
| **Pusher/Soketi** | Real-time event broadcasting (cloud or self-hosted)  |
| **React Email**   | Transactional email templates                        |
| **EmailIt**       | Email delivery (HTTP API) + marketing audience sync  |

### Infrastructure

| Technology                       | Purpose                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| **Firecracker**                  | MicroVM hypervisor (< 125ms boot, < 5MB overhead)                                          |
| **Caddy**                        | Per-server host-routing reverse proxy                                                      |
| **Cloudflare for SaaS**          | Customer custom-domain TLS via Custom Hostnames                                            |
| **S3-compatible object storage** | Snapshot + backup storage (iDrive E2, Backblaze B2, etc.) — restic for snapshots, host-side rclone for backups |
| **restic**                       | Per-cube content-addressed snapshot repository (pinned via `RESTIC_VERSION`) |
| **@aws-sdk/client-s3**           | Worker-side direct ops (deletion, listing, capacity probe)                                 |
| **ssh2**                         | Node.js SSH to host servers                                                                |
| **AES-256-GCM**                  | Encryption at rest (SSH keys, S3 credentials)                                              |

### Image Build Pipeline

Images are built once via `pnpm build:images` and stay on the Dokploy host's filesystem (under `KROVA_BUILD_OUTDIR`, typically `/opt/krova-build/images`). The `platform_images` table records each artifact's local path, size, and sha256. New bare-metal servers pull images directly from the worker container's filesystem during the `pull_images` setup phase — no object storage, no R2, no developer-laptop-as-source-of-truth. The worker `fastPut`s each image over the existing platform-key SSH connection.

#### Where to run it

- **Inside the Dokploy worker container** (recommended): `Dockerfile.worker` installs the Docker static-binary client and zstd. Configure Dokploy to mount BOTH `/var/run/docker.sock:/var/run/docker.sock` AND a shared host directory at the **same path** in the container (e.g. `/opt/krova-build:/opt/krova-build`). Set env `KROVA_BUILD_OUTDIR=/opt/krova-build/images`. The same-path mount is required because docker bind mounts resolve against the host filesystem when the CLI talks to the host daemon. Mounting docker.sock = root-on-host equivalence; accepted because the worker has no public-facing surface.
- **Disposable x86_64 Linux box**: any Linux host with Docker, Node, and zstd works. Point `DATABASE_URL` and `APP_SECRET` at the production app and run the script. Useful if the Dokploy host has CPU/disk constraints.

```text
pnpm build:images                            Dokploy host filesystem            Bare-metal server
┌──────────────────────┐                  ┌────────────────────────┐         ┌──────────────────────┐
│ build-all-images.sh  │                  │                        │         │                      │
│  (Docker-based)      │     write        │  /opt/krova-build/     │  SFTP   │  /var/lib/krova/     │
│  → zstd compress     │ ───────────────► │     images/            │ ──────► │    images/vmlinux    │
│  → sha256            │                  │      vmlinux           │         │    images/*.ext4     │
│  → platform_images   │                  │      *.ext4.zst        │         │                      │
└──────────────────────┘                  └────────────────────────┘         └──────────────────────┘
   ↑                                                ↑                                  ↑
   build & register                        single source of truth                worker fastPut
                                          (worker reads via bind mount)        decompresses on arrival
```

Supported OS images: Ubuntu 24.04, Ubuntu 24.04 + Docker (Docker Engine + Compose plugin preinstalled from Docker's official apt repo). Cubes ship with security-only automatic OS updates enabled by default (daily, no auto-reboot, no service bounce); see [docs/security/shared-responsibility.md](docs/security/shared-responsibility.md).

### Database Migrations

Schema changes are tracked in `db/migrations/` (SQL files generated by `pnpm db:generate`). Migrations are **run manually** after each deploy via `pnpm db:migrate` (typically `docker exec` into the worker container). drizzle's migrator is idempotent — it tracks applied migrations in `drizzle.__drizzle_migrations` by content hash, so already-applied migrations are skipped.

**Schema-change workflow**:

1. Edit `db/schema/*.ts`
2. `pnpm db:generate` — creates a new migration file under `db/migrations/`
3. Review the generated SQL (manual tweaks possible, e.g. data-preserving renames)
4. Commit the migration file with the schema change
5. Deploy
6. `docker exec -it <worker-container> pnpm db:migrate` to apply

For dev convenience, `pnpm db:push` still works for rapid iteration (no migration file generated). Don't use `db:push` in production.

### Phased Server Provisioning

Adding a bare-metal server is driven from the Orbit UI, not a manual shell script. After filling out hostname / IP / hardware specs, the server detail page exposes a phased stepper:

1. **Bootstrap & Harden SSH** — operator supplies one-shot SSH credentials (port, user, password OR private key). The worker connects, pushes the platform public key, switches sshd to port 2822, disables password auth. Uses an ADD-`Port 2822`-then-REMOVE-`Port 22` pattern with a backgrounded-sleep rollback so a misconfiguration can't lock you out — original port 22 stays open until 2822 is verified reachable with the platform key. Operator creds are encrypted with `APP_SECRET` before going into the pg-boss job and are never persisted on the server.
2. **Install Stack** — Firecracker, Caddy, vhost_vsock, AWS CLI, base packages, Krova directory layout. Idempotent.
3. **Pull Images** — Worker SFTPs each registered `platform_images` artifact from the Dokploy host's filesystem (via bind mount) to `/var/lib/krova/images/` on the bare-metal server, then decompresses on arrival.
4. **Network Setup** — `br0` bridge, IP forwarding, iptables NAT, persisted via systemd-networkd + iptables-persistent.
5. **Verify** — Run a 10-point readiness check; on success the server flips to `active` and accepts cube allocations.

Each phase is idempotent and recoverable: if a phase fails, the operator clicks Retry on the same phase after fixing the underlying issue. No auto-retries (the worker queue is configured `retryLimit: 0`). Live updates push to the UI via Pusher on the `private-server-{serverId}` admin channel.

---

## Database Schema

### Core Tables

| Table                         | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `spaces`                      | Workspaces: credit balance, plan tier, low-balance threshold    |
| `space_memberships`           | User ↔ space associations                                       |
| `member_permissions`          | Granular permission grants                                      |
| `member_cube_assignments`     | Restrict members to specific Cubes                              |
| `cubes`                       | Virtual machines (name, status, resources, image, IP)           |
| `servers`                     | Bare-metal hosts (hostname, IP, resources, region)              |
| `regions`                     | Geographic groupings                                            |
| `allocated_ports`             | Dynamic SSH port allocation (30000–50000)                       |
| `domain_mappings`             | Custom domain → Cube port                                       |
| `tcp_port_mappings`           | TCP port forwarding rules                                       |
| `tcp_mapping_whitelisted_ips` | CIDR whitelist per TCP mapping                                  |
| `ssh_keys`                    | Platform SSH keys (encrypted priv + public + fingerprint)       |
| `platform_images`             | Kernel + rootfs artifacts on Dokploy host filesystem (sha256)   |
| `billing_events`              | Hourly charges, credit/plan grants, top-ups, refund clawbacks   |
| `credit_purchases`            | Prepaid credit purchases via Polar (status, amount, surcharge)  |
| `subscription_intents`        | Customer-initiated plan-subscription checkouts (durable record) |
| `subscription_credit_grants`  | Per-period plan included-credit grants (one per billing period) |
| `lifecycle_logs`              | Entity state change history                                     |
| `audit_logs`                  | Comprehensive mutation audit trail                              |
| `invites`                     | Team invites with permissions and expiry                        |
| `cube_snapshots`              | Disk snapshots (manual + automatic) on an S3 storage backend    |
| `cube_backups`                | Pre-deletion backups with config (JSONB) and storage object key (`.cube` archive) |
| `cube_imports`                | Customer-initiated `.cube` uploads with multipart UploadId, SSH-key mode, and provisioning state |
| `storage_backends`            | S3-compatible buckets with encrypted credentials + capacity     |
| `outbound_webhook_endpoints`  | Customer webhook receivers (URL, encrypted secret, events)      |
| `outbound_webhook_deliveries` | Per-event delivery attempts + status (30-day retention)         |

### Platform Configuration

Three tiers of configuration, in order of operator-friendliness:

**1. `platform_settings` DB singleton (no redeploy needed; edit via Orbit → Platform Settings).** Processing-fee gross-up, credit top-up min/max/default, overage cap min/max + default multiplier, plan-credit cooldown days, low-balance threshold default + floor, Polar credit-product id, Polar overage-meter id. Reads are cached for 60 s.

**2. `plans` DB table (no redeploy needed; edit via Orbit → Plans).** The full plan catalog — limits, prices, included credit, allow-topup, allow-overage, visibility (`public` or `custom`), default flag, Polar product id. Operators add, duplicate, rename, archive, and assign custom plans to specific spaces.

**3. `config/platform.ts` (requires redeploy).** Non-tunable platform constants:

- Product name, logo path, brand strings
- Credit rates (vCPU, RAM, disk) and volume discount tiers
- Cube resource ranges (CPU/RAM/disk min, max, step) and OS images
- Snapshot settings (auto-enabled, cron, max per cube)
- Error notification email addresses
- Polar overage event name (`krova_overage_usd` — must match the meter filter configured in Polar)

---

## Email Notifications

| Template           | Trigger                         |
| ------------------ | ------------------------------- |
| **Magic Link**     | Sign-in request                 |
| **Verify Email**   | Account creation                |
| **Invite**         | Team invite sent                |
| **Credit Granted** | Admin grants credits            |
| **Low Balance**    | Credits below threshold         |
| **Zero Balance**   | All Cubes auto-slept            |
| **Cube Error**     | Provisioning or runtime failure |

All emails use React Email components with a shared Stripe-inspired layout (dark header, monospace font, color-coded severity cards).

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- pnpm 9+

### Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Core required:    DATABASE_URL, APP_SECRET, NEXT_PUBLIC_APP_URL
# Auth required:    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
# Email required:   EMAILIT_API_KEY, EMAILIT_FROM  (HTTP API; not SMTP)
# Real-time required: PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, + PUSHER_CLUSTER or PUSHER_HOST
# Optional:         CLOUDFLARE_* (custom domains), POLAR_* (billing), NEXT_PUBLIC_GTM_CONTAINER_ID
# Deploy-stability:  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY  (build-time; openssl rand -base64 32)
#                    Fixed value across deploys keeps Server Action ids stable so a
#                    browser tab open across a deploy doesn't hit "Failed to find
#                    Server Action". See docs/architecture/integrations.md ("Deployment version-skew recovery").
# Full reference:   docs/02-app-setup.md
# Platform config (rates, resource ranges, etc.) is in config/platform.ts

# Push database schema (dev only — production uses pnpm db:migrate)
pnpm db:push

# Start development (Next.js + worker)
pnpm dev
```

### Server Setup

Adding a bare-metal server is driven from the Orbit admin UI, not a shell script. See [docs/05-server-setup.md](./docs/05-server-setup.md) for the five-phase flow (bootstrap → install → pull_images → network → verify). Each phase is idempotent — a failed phase is recovered by retrying it.

Build VM images once via `pnpm build:images` (inside the worker container) before provisioning the first server — see [docs/04-build-images.md](./docs/04-build-images.md).

The shell scripts under `setup/images/` and `setup/server/` are LEGACY references; the live flow is fully Orbit-driven via the worker.

### Commands

| Command                       | Purpose                                                                  |
| ----------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                    | Start Next.js (Turbopack) + pg-boss worker concurrently                  |
| `pnpm dev:clean`              | Delete `.next` cache and start dev                                       |
| `pnpm dev:next`               | Start Next.js only (no worker)                                           |
| `pnpm build`                  | Production build                                                         |
| `pnpm lint`                   | Biome check (lint + format verification, non-mutating)                   |
| `pnpm lint:fix`               | Biome check `--write` (applies safe lint fixes + reformats)              |
| `pnpm format`                 | Biome format `--write`                                                   |
| `pnpm typecheck`              | TypeScript strict check                                                  |
| `pnpm worker:start`           | Start pg-boss worker only                                                |
| `pnpm worker:deploy`          | `db:migrate && worker:start` — the production worker container's `CMD`   |
| `pnpm make:admin`             | Promote a user to admin                                                  |
| `pnpm build:images`           | Build kernel + rootfs images, register in `platform_images`              |
| `pnpm db:push`                | Push schema changes directly (dev only)                                  |
| `pnpm db:generate`            | Generate a SQL migration file from schema diff                           |
| `pnpm db:migrate`             | Apply pending migrations (runs automatically on worker container boot)   |

---

## License

Proprietary. All rights reserved.
