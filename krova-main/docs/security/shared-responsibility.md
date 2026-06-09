# Shared responsibility model — Krova host vs. customer guest

> Audience: customers and operators. Complements
> [host-hardening.md](./host-hardening.md) and the jailer isolation notes in
> CLAUDE.md. It defines who patches what.

## What Krova owns

- **The bare-metal host OS + packages** — kept patched by the operator
  (host-hardening.md). Customers never touch it.
- **Firecracker + the jailer** — the VMM and the per-cube isolation boundary
  (per-cube uid/gid, chroot, new PID namespace; `JAILER_ENABLED` fleet-wide). A
  VMM/guest escape lands as an unprivileged per-cube uid, not host root. (cgroup
  resource confinement is not applied today — see host-hardening.md.)
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
