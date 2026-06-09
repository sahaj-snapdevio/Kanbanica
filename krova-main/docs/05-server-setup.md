# Bare-Metal Server Setup

Adding a bare-metal server is driven from the Orbit admin UI, not from a manual SSH session. The worker pushes the platform's SSH key, hardens sshd, installs the Krova hypervisor stack, and pulls images — all in five recoverable phases. Each phase is idempotent; you can retry any phase that fails.

## Prerequisites

**On the bare-metal box** (any dedicated bare-metal provider):

- Linux distro on either side of the apt/dnf split:
  - **Debian family**: Ubuntu 24.04 LTS (default), Debian 12
  - **RHEL family**: AlmaLinux 9, Rocky Linux 9, RHEL 9, CentOS Stream 9
  The bootstrap auto-detects and clears SELinux, firewalld, and ufw on first run, so a fresh image of any of the above flows through the same phases without operator intervention.
- Hardware virtualization enabled in BIOS — verify with `[ -c /dev/kvm ] && echo OK`
- Root SSH access **OR** sudoer with `NOPASSWD` (initial bootstrap creds)
- Outbound internet (package mirrors, github.com, official Caddy / Firecracker / rclone / restic release artifacts, Cloudflare API, your S3-compatible storage endpoint)
- At least 60 GB free on `/var` (kernel + rootfs images + cube workspaces)
- Public IP, reachable from the platform's worker

**In the Krova platform**:

- Worker is deployed and healthy ([03-worker-setup.md](./03-worker-setup.md))
- VM images have been built ([04-build-images.md](./04-build-images.md)) — the `platform_images` table has rows
- A **region** exists (Orbit → Regions → Add)
- A **platform SSH key** exists (Orbit → SSH Keys → Add — paste any private key; the platform derives the public half automatically)
- The `CLOUDFLARE_*` env vars are set on the worker — the `install` phase is **mandatory** Cloudflare-for-SaaS today and will fail without them

## Step 1: Add the server in Orbit

Orbit → Servers → **Add Server**. Fill in:

- **Hostname** — a single DNS label (lowercase letters, digits, hyphens; no dots). The full server domain is **derived** from it as `<hostname>.krova.cloud` (proxied origin) plus a sibling DNS-only `connect.<hostname>.krova.cloud` record. The hostname is immutable after create. Example: `sv-us-east-01`
- **Public IP** — the box's public address
- **Region** — pick one
- **SSH key** — pick the platform key whose public half will be pushed to the box
- **Overcommit ratios** — `maxCpuOvercommit` and `maxRamOvercommit` (default `2` CPU / `1` RAM — RAM `1` means no RAM overselling; raise per box if you intend to overcommit)

The create form does **not** ask for total CPUs / RAM / disk — the bootstrap phase auto-detects these from `nproc` / `/proc/meminfo` / `df -B1G /` and writes them to the `servers` row. Capacity stays at `0` until bootstrap completes; allocation only considers `status='active'` servers, so the gap is safe.

The server is created with `status = inactive` and `setupPhase = bootstrap`. It won't accept Cube allocations until the verify phase completes.

## Step 2: Run the five phases

Open the server detail page. The Setup card replaces the Status section while `setupPhase != ready`. It shows a stepper for all five phases with state icons. Click **Run** on the active phase; the button changes to **Retry** if a phase fails.

### Phase 1 — Bootstrap & Harden SSH

Click **Run**. A sheet asks for the operator's initial SSH credentials:

- **Initial port** — usually 22 on a fresh box
- **Initial user** — usually `root`
- **Authentication** — pick **Password** OR **SSH key** (paste the private key you currently use to log in)

These creds are encrypted with `APP_SECRET` before going into the pg-boss job and are **never persisted on the server record**. Used once, then dropped.

The worker:

1. Connects with your initial creds
2. Checks the box is Linux and `/etc/ssh/sshd_config` is writable
3. Pushes the platform public key to `/root/.ssh/authorized_keys`
4. Backs up `sshd_config` and arms a 5-minute backgrounded-sleep rollback (no `at` dependency — pure `nohup bash -c 'sleep 300 && [ -f marker ] && cp backup config && systemctl reload sshd'`)
5. Adds `Port 2822` to `sshd_config` and reloads — sshd now listens on **both** 22 and 2822
6. Verifies port 2822 works with the platform key (separate connection)
7. Removes `Port 22`, sets `PasswordAuthentication no` and `PermitRootLogin prohibit-password`, reloads
8. Re-verifies 2822
9. Removes the rollback marker (cancels the auto-restore) and the backup file
10. Updates `servers.sshPort = 2822`

If anything between steps 5–8 fails, the rollback subshell restores the original `sshd_config` after 5 minutes. You stay locked out of 2822 but port 22 still works.

### Phase 2 — Install

Installs the hypervisor stack. Runs over the platform key on port 2822. Distro-branched (`apt-get` on Debian/Ubuntu, `dnf`/`yum` on RHEL family). Steps (in order, all idempotent):

1. **Self-heal broken third-party repo state** — removes stale Cloudsmith/COPR fragments
2. **Package cache refresh** — `apt-get update` or `dnf makecache`
3. **Base packages** — curl, wget, tar, zstd, jq, ca-certificates, gnupg, unzip, uuid-runtime, iptables-persistent (Debian/Ubuntu) or iptables-services (RHEL), netcat-openbsd, file, e2fsprogs, plus every host-tool the worker shells out to (see CLAUDE.md Rule 46)
4. **rclone** — pinned to `RCLONE_VERSION` in `config/platform.ts`; backup transfers run host-side multipart through this
5. **restic** — pinned to `RESTIC_VERSION` in `config/platform.ts`; per-cube snapshot repos use this
6. **Krova directory layout** — `/var/lib/krova/{cubes,images,logs}`, `/etc/krova`
7. **Firecracker** — pinned to `FIRECRACKER_VERSION` in `config/platform.ts`
8. **Caddy** — pinned to `CADDY_VERSION` in `config/platform.ts`; Debian/Ubuntu uses Cloudsmith's deb repo, RHEL uses the `@caddy/caddy` COPR
9. **Caddy `--resume`** — systemd override so admin-API changes survive restart
10. **`vhost_vsock` kernel module** — `modprobe` + `/etc/modules-load.d/`
11. **Kernel tuning** — `vm.overcommit_memory=1`, KSM enabled, `vm.swappiness=10`
12. **Timezone** → UTC
13. **Cloudflare for SaaS setup** — creates both the proxied `<hostname>.krova.cloud` and the DNS-only `connect.<hostname>.krova.cloud` records; installs the wildcard Origin CA cert on Caddy
14. **`krova-boot-notify` systemd unit** — POSTs `/api/internal/server-rebooted` on host boot so reboot recovery fires immediately (≤2-min `cube.state-sync` fallback otherwise)
15. **`krova-vsock-pty` helper** — installed at `/usr/local/bin/` for the browser-terminal feature
16. **Verify host tools** — hard-fails the phase if any binary the worker shells out to (`nc`, `file`, `e2fsprogs`, `unzip`, `rclone`, `restic`, etc.) is missing

There is no AWS CLI install — all S3 traffic goes through `rclone` (host-side bulk transfer) or the worker-process `@aws-sdk/client-s3` (lightweight ops).

If a server was provisioned before any of these steps was added (e.g. pre-restic-snapshot fleet), retrofit with the one-shot scripts: `pnpm install:host-tools`, `pnpm install:rclone`, `pnpm install:restic`, `pnpm install:vsock-pty`, `pnpm install:boot-notify`.

### Phase 3 — Pull Images

Iterates `platform_images` rows. For each:

1. Worker reads the local file from `/opt/krova-build/images/...` (via the bind mount)
2. SFTP `fastPut` to `/var/lib/krova/images/<name>.ext4.zst.upload` on the bare-metal
3. Verify sha256 of the upload matches the DB row
4. Decompress `.zst` to the final path (e.g. `/var/lib/krova/images/ubuntu-24.04.ext4`)
5. Move to final path with `chmod 644`

Kernels are skipped if their on-disk sha256 already matches. Rootfs files always re-upload on retry (no recoverable hash post-decompression).

This phase is the slowest — ~4–5 GB total to transfer, network-limited. Expect 5–15 minutes on a fast link.

### Phase 4 — Network

- IP forwarding (`net.ipv4.ip_forward=1`) persisted via `/etc/sysctl.d/99-krova.conf`
- `br0` bridge with the server's gateway address — the S-th `/24` inside `198.18.0.0/15` (`cubeIpv4Gateway(S)`, derived from the server's `bridge_subnet`); dual-stack with the IPv6 ULA gateway too
- iptables MASQUERADE + IPv6 NAT66 for the cube subnet, egress-only FORWARD for `br0`
- Persisted via `iptables-persistent` and a `systemd-networkd` `.netdev`/`.network` pair so the bridge survives reboots

### Phase 5 — Verify

Runs twelve readiness checks ([lib/worker/handlers/server-verify.ts](../lib/worker/handlers/server-verify.ts)):

- Firecracker binary executable
- `/dev/kvm` present
- `br0` bridge up
- Caddy service active
- `vhost_vsock` kernel module loaded
- `krova-vsock-exec` helper present
- Kernel image on disk
- At least one rootfs image present
- `net.ipv4.ip_forward = 1`
- `vm.overcommit_memory = 1`
- KSM enabled
- Timezone is UTC (warn-only)
- ≥20 GB free on `/var/lib/krova`

If all critical checks pass: `setupPhase = ready`, `status = active`. The server now accepts Cube allocations.

If any critical check fails, the phase status flips to `failed` with the error in the UI. Fix the underlying issue (often a Phase 2/3/4 step that didn't fully complete) and click **Retry**.

## Live updates

The Setup card subscribes to the `private-server-{serverId}` Pusher channel (admin-only). Each `claimPhaseRunning` / `completePhase` / `failPhase` triggers a `setup.update` event that calls `router.refresh()` — so you see the stepper progress in real time without refreshing.

If Pusher is misconfigured, just refresh the page manually to see updated phase state.

## Failure recovery

Worker queue is configured `retryLimit: 0` for `SERVER_*` jobs — no auto-retries. The operator must explicitly click **Retry** after fixing the underlying problem.

Phases that get stuck at `setupStatus="running"` (e.g. worker process killed mid-handler) are auto-recovered by the `setup-reaper` cron (every 5 min, threshold 1 hour). Operators can also force-reset via `POST /api/orbit/servers/[serverId]/setup/reset` from the UI.

There is no snapshot-based rollback. Every phase is idempotent, so recovery from a failed phase is to fix the underlying problem and click **Retry** — the phase re-runs cleanly from the start. (Bootstrap additionally arms its own sshd_config rollback marker so a botched SSH hardening can't lock you out — see step 4 above.)

Common failures:

| Failure | Likely cause | Fix |
|---------|-------------|-----|
| Bootstrap: "Cannot write to /etc/ssh/sshd_config" | Initial user isn't root and isn't a NOPASSWD sudoer | Connect as root, or grant NOPASSWD |
| Bootstrap: "Port 2822 verification failed" | Cloud firewall blocks 2822 | Open the port in your provider's firewall, then Retry |
| Install: apt errors | DNS / outbound network down on the bare-metal | Fix connectivity, Retry |
| Pull-images: "Image source missing on worker" | `pnpm build:images` hasn't run yet | Run the build, then Retry |
| Pull-images: sha256 mismatch | Network corruption mid-transfer | Just Retry — SFTP fresh upload |
| Verify: "Caddy active" fails | Caddy install glitched | SSH in manually, fix, click Retry on Verify |
| Verify: "<20 GB free" | Box is too small | Add disk or pick a different box |

## Decommissioning a server

There's no automated decommission flow yet. To remove a server:

1. In Orbit → Servers → (server) → Overview, click **Deactivate** (takes the server out of the allocation pool — no new Cubes are scheduled here; Cubes already running keep running)
2. Migrate or delete the Cubes manually
3. Once empty, delete the server record (Orbit → Servers → ⋯ → Delete)
4. Wipe the bare-metal box separately

The platform doesn't auto-clean the bare-metal — it only forgets about it.
