# Building VM Images

Krova Cubes (Firecracker microVMs) boot from a kernel + a per-OS rootfs. Both are built from this repo via `pnpm build:images`, kept on the Dokploy host's filesystem, and SFTP-delivered to bare-metal servers as part of the phased setup flow.

## When to run

- **First deploy** — once, before provisioning any bare-metal server
- **OS image refresh** — when you want to ship a new Ubuntu or Debian baseline
- **Firecracker version bump** — when you change `FIRECRACKER_VERSION` in `config/platform.ts`
- **Kernel update** — when the script's CI bucket has a newer 6.1 LTS kernel (auto-detected on each build)

## Prerequisites

The worker container (see [03-worker-setup.md](./03-worker-setup.md)) must already be deployed with:

- `Dockerfile.worker` baked image (includes Docker CLI + zstd)
- Bind mounts: `/var/run/docker.sock:/var/run/docker.sock` and `/opt/krova-build:/opt/krova-build`
- Env: `KROVA_BUILD_OUTDIR=/opt/krova-build/images`

Also: at least one **active Storage Box** is NOT required for image hosting (images stay local). Storage Boxes are only needed for snapshots/backups.

## Run the build

```bash
docker exec -it <worker-container> bash
cd /app
pnpm build:images
```

Takes 5–15 minutes (depending on host CPU). The script:

1. Acquires `/tmp/krova-image-build.lock` so two operators can't run simultaneously
2. Preflight checks `docker info`
3. Runs `setup/images/build-all-images.sh`:
   - Builds the kernel from Linux 6.1 LTS source against the Firecracker CI baseline config
   - Builds one rootfs `.ext4` image per entry in `CUBE_IMAGES` in parallel via `docker run` (currently Ubuntu 24.04 and Ubuntu 24.04 + Docker)
4. Compresses each rootfs with `zstd -1 -T0`
5. Computes sha256 of each artifact
6. Upserts a row in `platform_images` (single-slot per name — re-runs overwrite)

After completion, `/opt/krova-build/images/` on the Dokploy host contains:

```
vmlinux                          (~32 MB, kernel)
ubuntu-24.04.ext4.zst            (~400 MB compressed, ~4 GB raw)  — default
ubuntu-24.04-docker.ext4.zst     (~600 MB compressed)             — Ubuntu + Docker preinstalled
```

The platform intentionally ships a narrow set of rootfs flavors — currently
Ubuntu 24.04 (the default for ~80% of customer workloads) and Ubuntu 24.04 + Docker
(Ubuntu base with Docker Engine + Compose plugin preinstalled from Docker's
official apt repo, `docker.service` + `containerd.service` enabled at boot —
for customers who want a ready-to-run container host with no install step on
first boot). To add or remove a distro, edit only `CUBE_IMAGES` in
`config/platform.ts` — `scripts/build-images.ts`, the build script's distro
registry, and the platform_images prune all derive from that single array.
The Docker variant is gated by a per-image `preinstallDocker: true` flag
which the build script propagates as a parallel bash array; the rootfs
builder then runs the upstream Docker apt-repo install steps
(https://docs.docker.com/engine/install/ubuntu/) inside the chroot.

And `platform_images` records the local path, size, and sha256 for each.

## Where images go from here

When you provision a bare-metal server (see [05-server-setup.md](./05-server-setup.md)), Phase 3 (`pull_images`) reads each `platform_images` row, opens SFTP from the worker over the platform key, `fastPut`s the bytes to `/var/lib/krova/images/` on the bare-metal server, then decompresses on arrival. No Storage Box, no R2 — bytes flow directly from the worker's filesystem to the bare-metal server.

## Updating images later

Re-run `pnpm build:images` whenever you want to refresh:

- New rows overwrite old ones in `platform_images`
- Old files in `/opt/krova-build/images/` are replaced in-place
- **Existing bare-metal servers keep their installed images** — bumping `platform_images` does NOT push updates to already-provisioned servers
- **Newly-provisioned servers** pick up the new images during their `pull_images` phase
- **Already-running cubes** keep running their old kernel/rootfs (they have it loaded in memory) — only new Cube boots see the new image

## Disk space

The bind-mounted host directory holds ~4–5 GB total after a build (compressed). Make sure `/opt/krova-build` lives on a partition with at least 10 GB free, ideally more. The build itself temporarily uses additional space inside Docker for layer caches.

## Architecture: Docker-out-of-Docker

The worker container has the Docker CLI but NOT a Docker daemon. The CLI talks to the host's daemon via the mounted `/var/run/docker.sock`. Images and containers spawned by the build script run on the **host**, alongside the worker — they're siblings, not children.

This is why the bind-mount paths must match on both sides: when the in-container CLI runs `docker run -v /opt/krova-build/images/kernel:/out`, the host daemon resolves `/opt/krova-build/images/kernel` against the host filesystem. If that path didn't exist on the host, the build would silently produce empty artifacts.

If `pnpm build:images` is mysteriously producing zero-byte outputs or failing with permission errors, check the bind-mount config first.

## Failure recovery

If the build fails partway:

```bash
# Clear the lock file so you can retry:
rm -f /tmp/krova-image-build.lock

# Optionally clean partial outputs:
rm -rf /opt/krova-build/images/*

# Re-run:
pnpm build:images
```

Docker layer caches on the host persist between runs, so subsequent builds are usually faster (the Ubuntu base layers don't re-pull).
