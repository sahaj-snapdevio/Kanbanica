# Drop Debian + Enable Security-Only In-Guest Auto-Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the cube guest matrix to two Ubuntu variants (Ubuntu 24.04 + Ubuntu 24.04 + Docker) and ship a guaranteed-non-disruptive, security-only `unattended-upgrades` policy inside every cube — so long-lived cubes self-patch userspace CVEs without ever bouncing sshd or krova-agent.

**Architecture:** Three real changes plus docs. (1) Delete the `debian-12` entry from the single source of truth `CUBE_IMAGES`; everything else (dropdown, validators, v1 API, build pipeline, image prune) derives automatically. (2) Add `unattended-upgrades` + a security-only/no-reboot policy + a hardened `needrestart` config to the rootfs builder, so NEW cubes ship it. (3) A `pnpm install:unattended-upgrades` retrofit that patches the RUNNING guest of EXISTING cubes in place over the vsock `exec` channel, mirroring `install:agent-fleet`, with a proven no-restart ordering.

**Tech Stack:** TypeScript (config + tsx fleet script), Bash (`setup/images/build-all-images.sh` debootstrap builder), Drizzle ORM, ssh2 + the in-guest vsock `krova-agent` `exec` verb, `unattended-upgrades` 2.9.1 + `needrestart` 3.6 (Ubuntu 24.04 noble), Markdown docs.

---

## Key facts established by research (do not re-litigate)

- **`unattended-upgrades` is absent from EVERY rootfs built today** — it is `Priority: optional`, debootstrap `--include` is `systemd,systemd-sysv,dbus` only, and it is in NO `apt-get install` line. The "DELIBERATELY KEPT" comment at `build-all-images.sh:794` is **false/stale**. Adding it (Phase 2) is required, not optional.
- **`unattended-upgrades` does NOT override `needrestart`.** It has zero needrestart references in its source; service restarts happen only via needrestart's own apt `DPkg::Post-Invoke` hook, which honors the system config. So `$nrconf{restart}="l"` plus `NEEDRESTART_MODE=l` provably prevents any sshd/krova-agent bounce. (needrestart manpage: `NEEDRESTART_MODE` env supersedes config; mode `i` falls back to list-only when non-interactive.)
- **`$nrconf{kernelhints}=-1` does NOT silence** the "Failed to retrieve available kernel versions" line (it only routes it to stderr). **`0` disables the check entirely** — this is the real fix for the user's original symptom, plus `ucodehints=0` for the microcode twin.
- **Dropping `debian-12` strands nothing.** Cubes boot from their immutable per-cube `rootfs.ext4` copy (`firecracker.ts:507` → `cube-boot.ts:262-264`); wake/cold-restart never re-read `CUBE_IMAGES`. The `build:images` prune (`scripts/build-images.ts:385-404`) self-skips with a loud warning while any non-deleted cube still references `debian-12`, and only ever touches the control-plane build artifact + DB row — never `/var/lib/krova/images/*` or per-cube rootfs.
- **No DB migration.** `cubes.imageId` is free-text `TEXT` (default `'ubuntu-24.04'`) — no enum, FK, or CHECK. `pnpm db:generate` produces nothing; do NOT hand-write a migration (Rule 6).
- **Rule 39 quoting:** every config body written into the rootfs uses a double-quoted heredoc delimiter `<<"DELIM"`, and every added comment is apostrophe-free (`dont`, `doesnt`). The `override_rc` uses `qr(...)` regex form specifically to avoid single-quoted perl strings that would break the outer `bash -c '...'` wrapper.

## Canonical config bodies (used identically in Phase 2 and Phase 3 — keep in sync)

**`/etc/needrestart/conf.d/99-krova.conf`:**
```perl
# Krova Cube overrides — see /etc/needrestart/needrestart.conf for full list
$nrconf{kernelhints} = 0;
$nrconf{ucodehints} = 0;
$nrconf{restart} = "l";
$nrconf{override_rc} = {
    qr(^krova-agent.*) => 0,
    qr(^ssh(d)?.*) => 0,
};
```

**`/etc/apt/apt.conf.d/20auto-upgrades`:**
```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
```

**`/etc/apt/apt.conf.d/52unattended-upgrades-krova`:**
```
// Krova Cube policy. Kernel is host-supplied (empty /boot) so a guest reboot
// is meaningless AND Firecracker treats it as shutdown -> auto-relaunch.
// Security-only scope is the Ubuntu package default (50unattended-upgrades);
// we deliberately do NOT redefine Allowed-Origins (apt config lists APPEND,
// not replace, so redefining would only duplicate the security origin).
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
```

---

## Pre-flight (do once, before Task 1)

- [ ] **P0a: Branch.** Current branch is `feat/cube-ipv6-networking` (unrelated IPv6 work). Create a fresh branch off `main`:

```bash
git fetch origin
git switch -c feat/drop-debian-uu origin/main
```

- [ ] **P0b: Check the live fleet for Debian cubes (informs comms, not safety).** This is read-only. From the control-plane host (per CLAUDE.md "ad-hoc queries"):

```bash
KROVA_DB=$(docker ps --filter "name=krova-db" --format '{{.ID}}')
docker exec -i "$KROVA_DB" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
\pset pager off
SELECT id, name, image_id, status FROM cubes WHERE image_id = 'debian-12' AND status <> 'deleted' ORDER BY created_at;
SQL
```

Expected: a (possibly empty) list. If non-empty, those cubes keep booting after the drop but the `build:images` prune will self-skip (keep the `debian-12` artifact + row) and Orbit will render the raw `debian-12` string. No action is required for safety; only decide whether to notify/migrate those customers.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `config/platform.ts` | Modify | Remove `debian-12` from `CUBE_IMAGES`; trim Debian prose/type. The single source of truth that propagates everywhere. |
| `setup/images/build-all-images.sh` | Modify | Remove `debian-12` from the hardcoded fallback arrays + comments; add `unattended-upgrades` + apt.conf.d policy + timer enable; harden the needrestart drop-in. |
| `lib/ssh/cube-guest-network.ts` | Modify | Reword the two-distro JSDoc to Ubuntu-only/historical. |
| `scripts/install-unattended-upgrades-fleet.ts` | **Create** | In-place retrofit of the policy into existing running Ubuntu cubes over vsock `exec`. No-restart guarantee. |
| `package.json` | Modify | Add the `install:unattended-upgrades` script entry. |
| `CLAUDE.md` | Modify | Distro list 3→2; new in-guest-updates passage; new commands-table row. |
| `README.md` | Modify | OS-images caption 3→2; default-security-updates one-liner. |
| `docs/04-build-images.md`, `docs/api/v1.md`, `db/schema/servers.ts` | Modify | Drop `debian-12` prose / JSDoc example. |
| `docs/security/shared-responsibility.md` | **Create** | Host/kernel vs guest-userspace boundary + the auto-update policy + disable/retrofit guidance. |

**Legacy, optional (NOT in the live path — edit only for hygiene):** `setup/images/upload-to-r2.sh`, `setup/server/setup-server.sh`.

---

## Phase 1 — Drop Debian

### Task 1: Remove `debian-12` from the source of truth

**Files:**
- Modify: `config/platform.ts:188-196` (the array entry) + `:137-145` (doc comment) + `:164-173` (type/JSDoc)

- [ ] **Step 1: Delete the `debian-12` entry.** Remove exactly:

```ts
  {
    id: "debian-12",
    label: "Debian 12",
    family: "debian",
    vendor: "debian",
    version: "12",
    codename: "bookworm",
    dockerImage: "debian:bookworm",
  },
```

(So `CUBE_IMAGES` goes from 3 entries to 2: `ubuntu-24.04`, then `ubuntu-24.04-docker`.)

- [ ] **Step 2: Fix the array doc comment.** Replace lines 137-145:

```
 * Intentionally narrow — Debian-family distros that cover the dominant
 * customer demand:
 *   - Ubuntu 24.04: most popular default; what Docker / Dokploy / k3s docs assume
 *   - Debian 12:    minimal alternative for users who prefer Debian
 *   - Ubuntu 24.04 + Docker: same Ubuntu base with Docker Engine + Compose
```

with:

```
 * Intentionally narrow — the two Ubuntu flavors that cover the dominant
 * customer demand:
 *   - Ubuntu 24.04: most popular default; what Docker / Dokploy / k3s docs assume
 *   - Ubuntu 24.04 + Docker: same Ubuntu base with Docker Engine + Compose
```

- [ ] **Step 3: Narrow the `vendor` type + trim the `preinstallDocker` JSDoc.** Replace the `preinstallDocker` JSDoc body lines 164-170 + the `vendor` field 172-173:

```ts
  /** When true, the rootfs builder installs Docker Engine + Compose plugin
   *  from Docker's official apt repo and enables docker.service +
   *  containerd.service at boot. Available on `vendor: "ubuntu"` and
   *  `vendor: "debian"` only — the build script branches on `vendor` to
   *  pick the correct Docker apt repo
   *  (https://download.docker.com/linux/ubuntu vs .../debian). Defaults
   *  to false. */
  preinstallDocker?: boolean;
  /** Vendor / package source name. Matches the systemd `ID=` field. */
  vendor: "ubuntu" | "debian";
```

with:

```ts
  /** When true, the rootfs builder installs Docker Engine + Compose plugin
   *  from Docker's official apt repo and enables docker.service +
   *  containerd.service at boot. Defaults to false. */
  preinstallDocker?: boolean;
  /** Vendor / package source name. Matches the systemd `ID=` field. */
  vendor: "ubuntu";
```

> Note: the build script keeps its `vendor`-keyed Debian branches (they are dead but cheap, and preserve the one-line re-add contract) — only the TS type narrows, since no `CUBE_IMAGES` entry uses `vendor:"debian"` anymore.

- [ ] **Step 4: Verify.**

Run: `pnpm typecheck`
Expected: PASS — narrowing `vendor` to `"ubuntu"` is consistent with the two remaining entries; if any consumer typed against `"debian"` it would fail here (research confirms none do).

Run: `pnpm lint`
Expected: PASS.

### Task 2: Sync the build-script fallback + drop Debian comments

**Files:**
- Modify: `setup/images/build-all-images.sh:987-993` (fallback arrays), `:18` (usage), `:714`, `:218`, `:725-728`

- [ ] **Step 1: Remove the middle element from all 7 fallback arrays.** Replace lines 987-993:

```bash
    KROVA_DISTRO_IDS=("ubuntu-24.04" "debian-12" "ubuntu-24.04-docker")
    KROVA_DISTRO_FAMILIES=("debian" "debian" "debian")
    KROVA_DISTRO_VENDORS=("ubuntu" "debian" "ubuntu")
    KROVA_DISTRO_VERSIONS=("24.04" "12" "24.04")
    KROVA_DISTRO_CODENAMES=("noble" "bookworm" "noble")
    KROVA_DISTRO_DOCKER_IMAGES=("ubuntu:24.04" "debian:bookworm" "ubuntu:24.04")
    KROVA_DISTRO_PREINSTALL_DOCKER=("0" "0" "1")
```

with:

```bash
    KROVA_DISTRO_IDS=("ubuntu-24.04" "ubuntu-24.04-docker")
    KROVA_DISTRO_FAMILIES=("debian" "debian")
    KROVA_DISTRO_VENDORS=("ubuntu" "ubuntu")
    KROVA_DISTRO_VERSIONS=("24.04" "24.04")
    KROVA_DISTRO_CODENAMES=("noble" "noble")
    KROVA_DISTRO_DOCKER_IMAGES=("ubuntu:24.04" "ubuntu:24.04")
    KROVA_DISTRO_PREINSTALL_DOCKER=("0" "1")
```

- [ ] **Step 2: Remove the `debian-12` usage-comment line.** Delete line 18:

```bash
#      ./build-all-images.sh debian-12         # Single distro by id
```

- [ ] **Step 3: Fix the iptables comment at ~line 714.** Replace:

```bash
# iptables (which on Ubuntu 24.04 / Debian 12 is iptables-nft) can talk to
```

with:

```bash
# iptables (which on Ubuntu 24.04 is iptables-nft) can talk to
```

- [ ] **Step 4: Fix the iptables comment at ~line 218** (verify exact text first with `grep -n "Ubuntu 24.04 and Debian 12" setup/images/build-all-images.sh`). Replace the `both our supported guest distros (Ubuntu 24.04 and Debian 12) ship iptables-nft` phrasing with `our supported guest distro (Ubuntu 24.04) ships iptables-nft`.

- [ ] **Step 5: Recast the systemd-networkd Debian anecdote at ~lines 725-728.** Replace:

```bash
# Without enabling systemd-networkd here, the Debian rootfs would boot
# with no networking at all (netplan is Ubuntu-only and the historical
# bug that motivated this rewrite). On Ubuntu, enabling it explicitly is
# idempotent — the netplan first-boot pass enables it too.
```

with:

```bash
# systemd-networkd is the universal renderer; the legacy netplan path it
# replaced only worked on Ubuntus renderer. Enabling it explicitly is
# idempotent — the netplan first-boot pass enables it too.
```

- [ ] **Step 6: Verify syntax.**

Run: `bash -n setup/images/build-all-images.sh`
Expected: no output (SYNTAX OK).

Run: `grep -nE "[A-Za-z]'[A-Za-z]" setup/images/build-all-images.sh`
Expected: no NEW apostrophe contractions in edited lines (Rule 39).

### Task 3: Reword the guest-network JSDoc

**Files:**
- Modify: `lib/ssh/cube-guest-network.ts:4-9`

- [ ] **Step 1: Replace the two-distro JSDoc.** Replace:

```ts
 * The platform supports two guest distros (Ubuntu 24.04 / Debian 12).
 * Earlier code wrote a netplan YAML at `/etc/netplan/99-krova.yaml`,
 * which only Ubuntu understands. Debian silently ignored the file and
 * the cube booted with no IP — SSH, TCP port mappings, and any other
 * host-to-guest networking failed (the vsock-based browser terminal
 * still worked because vsock is independent of eth0).
```

with:

```ts
 * The platform ships an Ubuntu 24.04 guest rootfs. Earlier code wrote a
 * netplan YAML at `/etc/netplan/99-krova.yaml`; the systemd-networkd
 * config below replaced it because systemd-networkd is the universal
 * renderer (the netplan path was renderer-specific). The helper also
 * wipes any stale netplan file so transfers/redeploys do not carry old
 * IPs forward.
```

- [ ] **Step 2: Verify.**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (comment-only change).

- [ ] **Step 3: Commit Phase 1.**

```bash
git add config/platform.ts setup/images/build-all-images.sh lib/ssh/cube-guest-network.ts
git commit -m "feat: drop Debian 12 cube variant; keep Ubuntu 24.04 + Ubuntu+Docker"
```

---

## Phase 2 — Ship security-only unattended-upgrades in the rootfs (NEW cubes)

All edits are inside the `chroot $R env ... bash <<"CHROOT_EOF"` block (lines 658-855) → absolute paths, **no `$R` prefix**.

**Files:**
- Modify: `setup/images/build-all-images.sh` — install block (`:673`), needrestart drop-in (`:804-817`), apt.conf.d writes (after `:817`), enable block (`:729-731`), comments (`:794-796`)

- [ ] **Step 1: Add `unattended-upgrades` to the Server-basics install.** Replace line 673:

```bash
    needrestart command-not-found 2>/dev/null || true
```

with:

```bash
    needrestart command-not-found unattended-upgrades 2>/dev/null || true
```

- [ ] **Step 2: Replace the needrestart drop-in body + its comment block.** Replace lines 804-817:

```bash
# Tame `needrestart` so it doesnt scare or disrupt the customer:
#   - kernelhints = -1 silences "Failed to retrieve available kernel versions"
#     (we have no kernel package — Firecracker supplies vmlinux from the host)
#   - restart = l prints the list of services that need a restart but does NOT
#     auto-restart them. Auto-restart on a microVM has bitten us by bouncing
#     krova-agent and sshd mid-customer-session during routine apt upgrades.
mkdir -p /etc/needrestart/conf.d
cat > /etc/needrestart/conf.d/99-krova.conf <<"NRCONF"
# Krova Cube overrides — see /etc/needrestart/needrestart.conf for full list
# Double-quoted "l" instead of single-quoted because this whole script body
# is inside a `bash -c` outer single-quote wrapper; perl accepts both anyway.
$nrconf{kernelhints} = -1;
$nrconf{restart} = "l";
NRCONF
```

with:

```bash
# Tame `needrestart` so it doesnt scare or disrupt the customer:
#   - kernelhints = 0 disables the kernel-restart check entirely. We have no
#     in-guest kernel package (Firecracker supplies vmlinux from the host), so
#     the check is meaningless; 0 (not -1) is what actually suppresses the
#     "Failed to retrieve available kernel versions" line (-1 only routes it
#     to stderr, where the customer still sees it).
#   - ucodehints = 0 likewise drops the "Failed to check for processor
#     microcode upgrades" twin (no microcode package in a microVM guest).
#   - restart = l lists services needing a restart but does NOT auto-restart
#     them. Auto-restart on a microVM has bitten us by bouncing krova-agent
#     and sshd mid-customer-session during routine apt upgrades.
#   - override_rc pins krova-agent + ssh to never-restart even if the mode is
#     ever flipped to "a" — defense in depth for the customers lifeline.
mkdir -p /etc/needrestart/conf.d
cat > /etc/needrestart/conf.d/99-krova.conf <<"NRCONF"
# Krova Cube overrides — see /etc/needrestart/needrestart.conf for full list
$nrconf{kernelhints} = 0;
$nrconf{ucodehints} = 0;
$nrconf{restart} = "l";
$nrconf{override_rc} = {
    qr(^krova-agent.*) => 0,
    qr(^ssh(d)?.*) => 0,
};
NRCONF
```

- [ ] **Step 3: Add the two apt.conf.d writes immediately after the `NRCONF` line (after line 817, before `apt-get clean`).** Insert:

```bash

# Security-only unattended-upgrades. The daily apt-daily-upgrade.timer applies
# ONLY the distros -security pocket (the package default in
# 50unattended-upgrades), never auto-reboots (a guest reboot is meaningless —
# Firecracker supplies the kernel; the platform treats it as shutdown), and the
# needrestart config above means it never bounces sshd or krova-agent.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<"AUTOUPG"
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
AUTOUPG
cat > /etc/apt/apt.conf.d/52unattended-upgrades-krova <<"UNATTUPG"
// Krova Cube policy. Kernel is host-supplied (empty /boot) so a guest reboot
// is meaningless AND Firecracker treats it as shutdown -> auto-relaunch.
// Security-only scope is the Ubuntu package default (50unattended-upgrades);
// we deliberately do NOT redefine Allowed-Origins (apt config lists APPEND,
// not replace, so redefining would only duplicate the security origin).
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
UNATTUPG
```

- [ ] **Step 4: Enable the apt timers in the chroot.** Replace lines 729-731:

```bash
systemctl enable ssh cron rsyslog ufw systemd-timesyncd \
    systemd-networkd \
    serial-getty@ttyS0.service 2>/dev/null || true
```

with:

```bash
systemctl enable ssh cron rsyslog ufw systemd-timesyncd \
    systemd-networkd apt-daily.timer apt-daily-upgrade.timer \
    serial-getty@ttyS0.service 2>/dev/null || true
```

> Rationale: the package postinst's `systemctl enable` is unreliable inside a chroot with no PID 1 (same caveat the script already documents for docker.service); the explicit enable guarantees the timers are active on first boot.

- [ ] **Step 5: Fix the false "DELIBERATELY KEPT" comment.** Replace lines 794-796:

```bash
# DELIBERATELY KEPT: unattended-upgrades. It provides real security value for
# customers who provision a cube and dont actively manage it — daily timer,
# security-only updates, no auto-reboot by default. Power users can purge it.
```

with:

```bash
# unattended-upgrades is INSTALLED in the Server-basics block above and
# CONFIGURED security-only (no auto-reboot, no service bounce) via the
# /etc/apt/apt.conf.d files written below. It is NOT purged here — it gives
# unmanaged cubes daily CVE patching. Power users can purge it.
```

- [ ] **Step 6: (Optional, Rule 46 spirit) add `unattended-upgrades` to the `required_pkgs` hard-fail list at ~line 827** so a silent apt failure surfaces. Verify the exact list first: `grep -n "required_pkgs=" setup/images/build-all-images.sh`. Append `unattended-upgrades` to the list.

- [ ] **Step 7: Verify syntax + quoting.**

Run: `bash -n setup/images/build-all-images.sh`
Expected: no output (SYNTAX OK).

Run: `grep -n 'kernelhints\|ucodehints\|override_rc\|20auto-upgrades\|52unattended' setup/images/build-all-images.sh`
Expected: the new lines present; `kernelhints = 0`, NOT `-1`.

- [ ] **Step 8: Commit Phase 2.**

```bash
git add setup/images/build-all-images.sh
git commit -m "feat: install security-only unattended-upgrades in cube rootfs; harden needrestart"
```

---

## Phase 3 — Retrofit script for existing running cubes

### Task 4: Create the fleet retrofit script

**Files:**
- Create: `scripts/install-unattended-upgrades-fleet.ts`
- Modify: `package.json` (scripts section)

- [ ] **Step 1: Create `scripts/install-unattended-upgrades-fleet.ts`** with exactly:

```ts
/**
 * One-off: retrofit the security-only unattended-upgrades policy + the tamed
 * needrestart config into the IN-GUEST rootfs of every currently-running
 * Ubuntu cube across every active server, in place, over the vsock `exec`
 * verb. Mirrors scripts/install-agent-fleet.ts.
 *
 * Why this exists:
 *   Cube rootfs files are copied per-cube at provision and are immutable
 *   thereafter, so `pnpm build:images` + Update Images only reaches NEW
 *   cubes. This patches the RUNNING guest of existing cubes. NOTE: a cube
 *   cold-restart boots from the on-disk rootfs (which still lacks the policy
 *   for pre-policy cubes), so re-run after such events.
 *
 * No-restart guarantee:
 *   The needrestart drop-in (restart=l + override_rc on krova-agent + ssh) is
 *   written FIRST, and every apt call runs with NEEDRESTART_MODE=l
 *   DEBIAN_FRONTEND=noninteractive. needrestart honors that env even on a cube
 *   whose rootfs predates the drop-in, so sshd and krova-agent are never
 *   bounced. The script issues no `systemctl restart` against either unit.
 *
 * Idempotent: skips the apt-install on cubes that already have
 * unattended-upgrades (probe via dpkg-query); --force re-runs it. Config files
 * are always (re)written — cheap overwrite, no restart.
 *
 * Run: pnpm install:unattended-upgrades [--force]
 */

import { existsSync } from "fs";
import type { Client } from "ssh2";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const PER_SERVER_CONCURRENCY = 5;
const PROBE_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 10_000;
const APT_TIMEOUT_MS = 120_000;

type Outcome = "skipped" | "updated" | "failed";

// MUST stay byte-identical to setup/images/build-all-images.sh.
const NEEDRESTART_CONF = `# Krova Cube overrides — see /etc/needrestart/needrestart.conf for full list
$nrconf{kernelhints} = 0;
$nrconf{ucodehints} = 0;
$nrconf{restart} = "l";
$nrconf{override_rc} = {
    qr(^krova-agent.*) => 0,
    qr(^ssh(d)?.*) => 0,
};
`;

const AUTO_UPGRADES_CONF = `APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
`;

const UU_KROVA_CONF = `// Krova Cube policy. Kernel is host-supplied (empty /boot) so a guest reboot
// is meaningless AND Firecracker treats it as shutdown -> auto-relaunch.
// Security-only scope is the Ubuntu package default (50unattended-upgrades).
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
`;

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

async function main(): Promise<void> {
  const { eq, and, inArray } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers, cubes } = await import("@/db/schema");
  const { connectToServer, guestExec } = await import("@/lib/ssh");
  const { CUBE_IMAGES } = await import("@/config/platform");

  const force = process.argv.includes("--force");
  const ubuntuImageIds = CUBE_IMAGES.filter((i) => i.vendor === "ubuntu").map(
    (i) => i.id
  );

  const activeServers = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Found ${activeServers.length} active server(s)${force ? " — FORCE mode" : ""}\n`
  );

  let totalCubes = 0;
  let skipped = 0;
  let updated = 0;
  let failed = 0;

  for (const server of activeServers) {
    console.log(`== ${server.hostname} ==`);

    let client: Client;
    try {
      const conn = await connectToServer(server.id);
      client = conn.client;
    } catch (err) {
      console.error(
        `  ✗ SSH connect failed: ${err instanceof Error ? err.message : err}`
      );
      failed++;
      continue;
    }

    try {
      const serverCubes = await db
        .select({ id: cubes.id, name: cubes.name })
        .from(cubes)
        .where(
          and(
            eq(cubes.serverId, server.id),
            eq(cubes.status, "running"),
            eq(cubes.transferState, "idle"),
            inArray(cubes.imageId, ubuntuImageIds)
          )
        );

      console.log(`  ${serverCubes.length} running Ubuntu cube(s)`);
      totalCubes += serverCubes.length;

      for (let i = 0; i < serverCubes.length; i += PER_SERVER_CONCURRENCY) {
        const batch = serverCubes.slice(i, i + PER_SERVER_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((cube) => processCube(client, cube, force, guestExec))
        );

        for (let j = 0; j < results.length; j++) {
          const cube = batch[j];
          const r = results[j];
          if (r.status === "fulfilled") {
            if (r.value === "skipped") {
              skipped++;
              console.log(`  · ${cube.name} — already configured`);
            } else {
              updated++;
              console.log(`  ↑ ${cube.name} — unattended-upgrades configured`);
            }
          } else {
            failed++;
            const msg =
              r.reason instanceof Error ? r.reason.message : String(r.reason);
            console.log(`  ✗ ${cube.name} — ${msg}`);
          }
        }
      }
    } finally {
      client.end();
    }

    console.log("");
  }

  console.log(
    `Done — ${totalCubes} cube(s) total: ${skipped} skipped, ${updated} updated, ${failed} failed`
  );
  process.exit(failed === 0 ? 0 : 1);
}

async function processCube(
  client: Client,
  cube: { id: string; name: string },
  force: boolean,
  guestExec: typeof import("@/lib/ssh").guestExec
): Promise<Outcome> {
  // Idempotency probe: is unattended-upgrades already installed?
  let alreadyInstalled = false;
  if (!force) {
    const probe = await guestExec(
      client,
      cube.id,
      "dpkg-query -W -f='${Status}' unattended-upgrades 2>/dev/null || true",
      PROBE_TIMEOUT_MS
    );
    alreadyInstalled = probe.stdout.includes("install ok installed");
  }

  // STEP 1 — needrestart protection FIRST, before any apt call.
  await guestExec(
    client,
    cube.id,
    `mkdir -p /etc/needrestart/conf.d && echo '${b64(NEEDRESTART_CONF)}' | base64 -d > /etc/needrestart/conf.d/99-krova.conf`,
    WRITE_TIMEOUT_MS
  );

  // STEP 2 — apt periodic + policy config (always (re)written, cheap).
  await guestExec(
    client,
    cube.id,
    `mkdir -p /etc/apt/apt.conf.d && echo '${b64(AUTO_UPGRADES_CONF)}' | base64 -d > /etc/apt/apt.conf.d/20auto-upgrades && echo '${b64(UU_KROVA_CONF)}' | base64 -d > /etc/apt/apt.conf.d/52unattended-upgrades-krova`,
    WRITE_TIMEOUT_MS
  );

  if (alreadyInstalled) {
    return "skipped";
  }

  // STEP 3 — install u-u. NEEDRESTART_MODE=l guarantees no service bounce even
  // on a cube whose rootfs predates the drop-in written in STEP 1.
  await guestExec(
    client,
    cube.id,
    "DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get update -qq && DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y -qq unattended-upgrades",
    APT_TIMEOUT_MS
  );

  // STEP 4 — enable the daily timers. Enabling/starting timer units does not
  // restart krova-agent or sshd.
  await guestExec(
    client,
    cube.id,
    "systemctl enable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true",
    WRITE_TIMEOUT_MS
  );

  return "updated";
}

main().catch((err) => {
  console.error("Retrofit failed:", err);
  process.exit(1);
});
```

> Implementation notes for the executor:
> - `${Status}` in the probe is inside a **regular double-quoted** string — `${}` is NOT interpolated in non-template JS strings, so it reaches `dpkg-query` verbatim. Do not convert that line to a backtick template.
> - The `${b64(...)}` interpolations ARE in backtick templates (intended). Base64 output has no single quotes, so the surrounding `'...'` shell quoting is safe through both the JS layer and the vsock-shipped command.
> - `guestExec` throws on non-zero exit / agent error; STEP 3 therefore surfaces an apt failure as a rejected promise → counted `failed` (fleet continues). STEP 4 has `|| true` so timer-enable is best-effort.
> - No audit/lifecycle logging — matches every sibling `install:*` one-shot (mutates guest-internal package state only, enqueues no jobs).

- [ ] **Step 2: Verify the `guestExec` signature matches.** Confirm `lib/ssh/guest-exec.ts` exports `guestExec(client, cubeId, command, timeoutMs?)` returning `{ exitCode, stdout, stderr }` and that `connectToServer` + `guestExec` are re-exported from `@/lib/ssh`:

Run: `grep -n "export.*guestExec\|export.*connectToServer" lib/ssh/index.ts lib/ssh/guest-exec.ts`
Expected: both symbols exported from `@/lib/ssh`.

- [ ] **Step 3: Add the package.json script.** In `package.json` "scripts", after the `"install:agent-fleet"` line, add:

```json
    "install:unattended-upgrades": "tsx scripts/install-unattended-upgrades-fleet.ts",
```

- [ ] **Step 4: Verify.**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit Phase 3.**

```bash
git add scripts/install-unattended-upgrades-fleet.ts package.json
git commit -m "feat: add pnpm install:unattended-upgrades fleet retrofit"
```

---

## Phase 4 — Docs (Rule 22)

### Task 5: Update CLAUDE.md

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Distro list 3→2.** Find each phrase with `grep -n "Debian 12\|three Debian-family\|Three Debian-family" CLAUDE.md` and edit:
  - "**three Debian-family rootfs flavors** — Ubuntu 24.04 (...), **Debian 12 (...)**, and **Ubuntu 24.04 + Docker**" → "**two Ubuntu rootfs flavors** — Ubuntu 24.04 (...) and Ubuntu 24.04 + Docker (...)".
  - "**Three Debian-family rootfs flavors are supported — Ubuntu 24.04, Debian 12, and Ubuntu 24.04 + Docker**" → "**Two Ubuntu rootfs flavors are supported — Ubuntu 24.04 and Ubuntu 24.04 + Docker**".
  - "the default `iptables-nft` ... ship with **Ubuntu 24.04 and Debian 12**" → "...ship with **Ubuntu 24.04**".
  - Rule 37: "Ubuntu 24.04 **and Debian 12** both ship `iptables-nft`" → "Ubuntu 24.04 ships `iptables-nft`".
  - "To add or remove a **Debian-family** distro, edit ONLY `CUBE_IMAGES`" → "To add or remove a rootfs flavor, edit ONLY `CUBE_IMAGES`".
  - Soften the netplan/Debian "booted with no IP" anecdote in the Guest networking section to historical/renderer-specific.
  - **Do NOT touch** the "Cross-distro support" passage or Rule 46 — those describe the bare-metal HOST OS, not the guest.

- [ ] **Step 2: Add an in-guest-updates passage** under the Image Hosting section (after "Cube guest distro coverage"):

```markdown
**In-guest OS security updates (unattended-upgrades).** Every cube rootfs ships `unattended-upgrades` ENABLED with the Ubuntu package's default **security-only** origin set, a **daily** `apt-daily-upgrade.timer`, **`Automatic-Reboot "false"`** (the kernel is external — a guest reboot is meaningless and Firecracker treats it as shutdown→auto-relaunch), and `needrestart` configured (`/etc/needrestart/conf.d/99-krova.conf`: `restart="l"`, `kernelhints=0`, `ucodehints=0`, `override_rc` pinning `krova-agent`+`ssh`) so a security upgrade **never bounces sshd or krova-agent** mid-session. This is the only path that patches a long-lived cube's userspace CVEs (the per-cube rootfs is immutable; `build:images` only reaches new cubes). Existing cubes provisioned before this policy are retrofitted in place with `pnpm install:unattended-upgrades`. Customer/Krova boundary: Krova owns the host + kernel (swapped on cold-restart); the customer owns guest userspace — see [docs/security/shared-responsibility.md](docs/security/shared-responsibility.md).
```

- [ ] **Step 3: Add the commands-table row** after the `pnpm install:vsock-pty` row (mirror the `install:rclone` two-column format, single physical line):

```
| `pnpm install:unattended-upgrades [--force]` | Retrofit the security-only `unattended-upgrades` policy + tamed `needrestart` config into the IN-GUEST rootfs of every currently-running Ubuntu cube across every active server (mirrors `pnpm install:agent-fleet`'s in-place vsock-`exec` model — patches the RUNNING guest). Daily security-only updates, **no auto-reboot**, `needrestart` set to list-not-restart + `override_rc` so sshd/krova-agent are never bounced mid-session. Writes config unconditionally; skips the apt-install on cubes that already have it (`--force` re-runs). NOTE: a cube cold-restart boots the on-disk rootfs, which for pre-policy cubes still lacks it — re-run after such events, or rebuild images + Update Images for new cubes. Per-server SSH concurrency capped at 5. Idempotent. See docs/security/shared-responsibility.md |
```

- [ ] **Step 4: Verify.** Run: `grep -n "Debian 12\|three Debian" CLAUDE.md` → only HOST-context hits remain (Cross-distro support / Rule 46). 

### Task 6: Update README + other docs + new shared-responsibility doc

**Files:** Modify `README.md`, `docs/04-build-images.md`, `docs/api/v1.md`, `db/schema/servers.ts`; Create `docs/security/shared-responsibility.md`

- [ ] **Step 1: README.md** — in the Image Build Pipeline caption, change "Supported OS images: **Ubuntu 24.04, Debian 12, Ubuntu 24.04 + Docker**" → "Supported OS images: Ubuntu 24.04, Ubuntu 24.04 + Docker". Add a one-liner near the provisioning feature: "Cubes ship with security-only automatic OS updates enabled (daily, no auto-reboot, no service bounce); see docs/security/shared-responsibility.md."

- [ ] **Step 2: docs/04-build-images.md** — remove the `debian-12.ext4.zst ... — Debian users` output line; change ":36" enumeration to "(currently Ubuntu 24.04 and Ubuntu 24.04 + Docker)"; change "the **Ubuntu/Debian** base layers don't re-pull" → "the Ubuntu base layers don't re-pull"; drop the "Debian 12 (lighter alternative...)" clause.

- [ ] **Step 3: docs/api/v1.md** — change "Both supported images (Ubuntu 24.04 and Debian 12) ship cloud-init" → "Both supported images (Ubuntu 24.04 and Ubuntu 24.04 + Docker) ship cloud-init".

- [ ] **Step 4: db/schema/servers.ts:105** — change the JSDoc example key `"debian-12"` → `"ubuntu-24.04-docker"`.

- [ ] **Step 5: Create `docs/security/shared-responsibility.md`** (match the style of `docs/security/host-hardening.md`):

```markdown
# Shared responsibility model — Krova host vs. customer guest

> Audience: customers and operators. Complements
> [host-hardening.md](./host-hardening.md) and the jailer isolation notes in
> CLAUDE.md. It defines who patches what.

## What Krova owns

- **The bare-metal host OS + packages** — kept patched by the operator
  (host-hardening.md). Customers never touch it.
- **Firecracker + the jailer** — the VMM and the per-cube isolation boundary
  (per-cube uid/gid, chroot, PID namespace, cgroup v2; `JAILER_ENABLED`
  fleet-wide). A VMM/guest escape lands as an unprivileged per-cube uid, not
  host root.
- **The guest kernel (vmlinux)** — built by Krova from Linux 6.1.x source and
  supplied by the host at boot. It is NOT a package inside the rootfs, which is
  why the guest has no `linux-image` and `/boot` is empty. The kernel is
  swapped only on a cube **cold-restart** (the dashboard shows a
  "Cold-restart to upgrade" badge when a newer kernel is available). Customers
  cannot `apt upgrade` the kernel — that is Krova's lever.
- **The host network edge** — bridge, iptables DNAT, Caddy reverse proxy,
  Cloudflare for SaaS TLS.

## What the customer owns

- **The guest userspace** — every package, service, and config inside the
  rootfs. You have full root via your SSH key (Krova never SSHes in).
- **Your application** — what you run and which ports you expose.

## In-guest security updates — ON by default

Every cube (Ubuntu 24.04 / Ubuntu 24.04 + Docker) ships with
`unattended-upgrades` **enabled**:

- **Security-only** — the Ubuntu package default applies only the
  `noble-security` pocket. Feature/version updates are NOT auto-installed.
- **Daily** — `apt-daily-upgrade.timer` runs once a day (randomized within an
  hour).
- **No automatic reboot** (`Unattended-Upgrade::Automatic-Reboot "false"`). A
  kernel update inside the guest would be inert anyway (the kernel is external).
- **No service bounce mid-session** — `needrestart` is set to list-only
  (`restart="l"`) with `override_rc` pinning `krova-agent` and `ssh` to
  never-restart. A security upgrade patches the library on disk without
  restarting your live sshd or the platform agent.

**Caveat:** because services are not auto-restarted, a long-running process
(e.g. sshd) keeps the pre-patch library mapped in memory until it is restarted.
Restart the affected service — or cold-restart your cube — to fully apply a
security update.

## Change or disable it (run inside your cube)

```bash
# See what would be upgraded:
sudo unattended-upgrade --dry-run -d

# Disable automatic updates entirely:
sudo systemctl disable --now apt-daily.timer apt-daily-upgrade.timer
# or
sudo apt-get purge -y unattended-upgrades

# Opt INTO auto-restart of services after upgrades (reverses the Krova default;
# WARNING: this can bounce sshd / the platform agent mid-session):
#   edit /etc/needrestart/conf.d/99-krova.conf, set $nrconf{restart} = "a";
```

Docker note: the Docker apt repo is not a distro security origin, so
`docker-ce` is a manual `apt upgrade docker-ce` — `unattended-upgrades` will
not auto-patch it.

## Retrofitting older cubes (operators)

New cubes built after this policy shipped already have it. Existing running
cubes whose rootfs predates it are patched in place with:

```bash
pnpm install:unattended-upgrades        # idempotent; --force re-runs
```

This patches the RUNNING guest over the vsock `exec` channel and never restarts
`krova-agent`/`sshd`. A cube cold-restart boots the on-disk rootfs, so re-run
after such events; the durable fix for the rootfs file is rebuilding images
(`pnpm build:images`) + Update Images per server (new cubes only).
```

- [ ] **Step 6: Verify.**

Run: `pnpm lint`
Expected: PASS (markdown is not linted by Biome, but TS/JSON edits are).

Run: `grep -rn "debian-12\|Debian 12\|three Debian" --include=*.ts --include=*.tsx --include=*.sh --include=*.md . | grep -v node_modules | grep -v migrations/meta`
Expected: only HOST-context hits remain (`lib/worker/handlers/server-install.ts`, `app/api/orbit/servers/[serverId]/health/route.ts`, `docs/05-server-setup.md`, `docs/krova-agent-v1-spec.md`) — all intentionally out of scope (bare-metal host OS / draft spec).

- [ ] **Step 7: Commit Phase 4.**

```bash
git add CLAUDE.md README.md docs/04-build-images.md docs/api/v1.md db/schema/servers.ts docs/security/shared-responsibility.md
git commit -m "docs: drop Debian from distro list; document in-guest security-update policy"
```

---

## Rollout (operator-run — NOT part of the code commits)

These are executed by the operator when ready; they are listed so the plan is complete.

- [ ] **R1: Rebuild images** (covers Phase 1 prune + Phase 2 new policy). Run `pnpm build:images`. Confirm the prune log either prunes `debian-12` OR prints the "Refusing to prune ... active cube(s)" warning (both acceptable; Debian cubes keep booting either way). ~10–25 min, needs Docker.
- [ ] **R2: Update Images** on each active server from the Orbit server-detail page (new cubes pick up the policy + drop Debian).
- [ ] **R3: Smoke-boot a fresh cube** and verify:
  - `systemctl is-enabled apt-daily-upgrade.timer apt-daily.timer` → `enabled`.
  - `unattended-upgrade --dry-run -d 2>&1 | grep -i "allowed origins\|security"` → only the `-security` origin.
  - The original symptom is gone: `apt-get update && apt-get upgrade -y` no longer prints "Failed to retrieve available kernel versions" (nor the microcode twin).
- [ ] **R4: Retrofit existing cubes** in a notified window: `pnpm install:unattended-upgrades`. Then the **no-bounce proof** on a pre-policy cube: capture `systemctl show -p MainPID krova-agent` + the sshd PID, run the retrofit, confirm both PIDs are UNCHANGED and a live SSH/browser-terminal session never dropped.

---

## Residual risks (sign-off before R4)

1. **Patched-on-disk, not-in-RAM:** with `restart="l"`, an upgraded libssl/libc6 is on disk but the old code stays mapped in long-running sshd/krova-agent until restarted. Documented for customers; the platform's natural cold-restart cadence (and `install:agent-fleet`) eventually applies it. Strictly better than today's zero patching. Do NOT "fix" by switching to `restart="a"` (re-introduces the bounce + the glibc StartLimit lockout footgun).
2. **Retrofit touches the live fleet:** `apt-get update`/`install` runs inside every running Ubuntu cube, hitting the customer's mirrors. A slow/blocked mirror times out for that cube (counted `✗`, fleet continues). Run in a notified window; `PER_SERVER_CONCURRENCY=5` stays under sshd `MaxSessions=10`.
3. **Existing Debian cubes:** keep booting from their immutable rootfs but become legacy (no new Debian image), dropdown stops offering Debian, Orbit shows the raw `debian-12` string (cosmetic). Decide on customer comms via the P0b query.

---

## Self-Review

**Spec coverage:** ✅ Drop Debian (Task 1-3 config/script/JSDoc + derived consumers confirmed). ✅ u-u in rootfs for new cubes (Task in Phase 2). ✅ Retrofit for existing cubes (Phase 3). ✅ Original "Failed to retrieve available kernel versions" symptom fixed (Phase 2 Step 2, `kernelhints 0`). ✅ Docs (Phase 4). ✅ No migration (stated). ✅ Rollout + verification (R1-R4).

**Placeholder scan:** No TODO/TBD; every edit shows exact old→new text or complete file content; verification commands have expected output.

**Type/name consistency:** `NEEDRESTART_CONF`/`AUTO_UPGRADES_CONF`/`UU_KROVA_CONF` and the `processCube(client, cube, force, guestExec)` signature are consistent between the script body and its call site; the needrestart/apt.conf.d bodies are byte-identical between Phase 2 (bash) and Phase 3 (TS). `vendor` narrowed to `"ubuntu"` in Task 1 matches the `CUBE_IMAGES.filter(i => i.vendor === "ubuntu")` use in Phase 3.
