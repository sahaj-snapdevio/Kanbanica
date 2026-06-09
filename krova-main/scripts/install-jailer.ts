/**
 * One-off: install the Firecracker `jailer` binary + create the jail chroot
 * base dir on every active server. New servers get both during the install
 * phase (`server-install.ts` step "Firecracker + jailer"); this retrofits
 * existing ones provisioned before jailer-mode shipped.
 *
 * The jailer runs each cube's Firecracker under a per-cube unprivileged uid +
 * chroot + PID namespace + cgroup (see lib/ssh/jailer.ts). Without it, a
 * jailed-mode launch fails with "jailer: command not found". It ships in the
 * SAME release tarball as the firecracker binary (FIRECRACKER_VERSION).
 *
 * Idempotent — checks `jailer --version` against the pinned FIRECRACKER_VERSION
 * and skips the download when it already matches. Also (re)creates
 * /var/lib/krova/jail, which the jailer canonicalizes and refuses to create.
 *
 * Run: pnpm install:jailer
 */

import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main(): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers } = await import("@/db/schema");
  const { connectToServer, execCommand } = await import("@/lib/ssh");
  const { FIRECRACKER_VERSION } = await import("@/config/platform");

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Retrofitting jailer ${FIRECRACKER_VERSION} on ${rows.length} active server(s)...`
  );

  // Same logic as the server-install.ts "Firecracker + jailer" step, restated
  // here because the retrofit runs outside the setup-phase context. Every step
  // is its own `;`-separated command (NEVER `&&` under `set -e` — a failing
  // command mid-`&&`-chain does not trip the exit, masking failures).
  const installCmd =
    "set -e; " +
    `EXPECTED="Jailer ${FIRECRACKER_VERSION}"; ` +
    // ── Step 1: prerequisites (curl + tar). ──
    "ensure_pkg() { " +
    `  local cmd="$1"; ` +
    `  local pkg="$2"; ` +
    `  if command -v "$cmd" >/dev/null 2>&1; then return 0; fi; ` +
    `  echo "Installing missing package: $pkg (provides $cmd)"; ` +
    "  if command -v apt-get >/dev/null 2>&1; then " +
    "    DEBIAN_FRONTEND=noninteractive apt-get update -qq; " +
    `    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg"; ` +
    "  elif command -v dnf >/dev/null 2>&1; then " +
    `    dnf install -y "$pkg"; ` +
    "  elif command -v yum >/dev/null 2>&1; then " +
    `    yum install -y "$pkg"; ` +
    "  else " +
    `    echo "ERROR: no apt-get/dnf/yum and $cmd is missing" >&2; exit 1; ` +
    "  fi; " +
    `  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $pkg install completed but $cmd still missing" >&2; exit 1; }; ` +
    "}; " +
    "ensure_pkg curl curl; " +
    "ensure_pkg tar tar; " +
    // ── Step 2: the jail chroot base dir (jailer won't create it). ──
    "mkdir -p /var/lib/krova/jail; " +
    "chmod 750 /var/lib/krova/jail; " +
    // ── Step 3: install the jailer from the FC release tarball (idempotent) ──
    `if command -v jailer >/dev/null 2>&1 && jailer --version 2>/dev/null | grep -qxF "$EXPECTED"; then ` +
    `  echo "jailer ${FIRECRACKER_VERSION} already installed"; ` +
    "else " +
    "  ARCH=$(uname -m); " +
    "  cd /tmp; " +
    `  rm -rf fc.tgz "release-${FIRECRACKER_VERSION}-$\{ARCH}"; ` +
    `  curl -fsSL -o fc.tgz "https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VERSION}/firecracker-${FIRECRACKER_VERSION}-$\{ARCH}.tgz"; ` +
    "  tar xzf fc.tgz; " +
    `  install -m 0755 "release-${FIRECRACKER_VERSION}-$\{ARCH}/jailer-${FIRECRACKER_VERSION}-$\{ARCH}" /usr/local/bin/jailer; ` +
    `  rm -rf fc.tgz "release-${FIRECRACKER_VERSION}-$\{ARCH}"; ` +
    `  echo "jailer installed: $(jailer --version | head -1)"; ` +
    "fi; " +
    // ── Step 4: ground-truth verification ──
    `command -v jailer >/dev/null 2>&1 || { echo "ERROR: jailer not on PATH after install" >&2; exit 1; }; ` +
    `jailer --version 2>&1 | grep -qxF "$EXPECTED" || { echo "ERROR: jailer version mismatch — expected $EXPECTED, got: $(jailer --version 2>&1 | head -1)" >&2; exit 1; }; ` +
    `echo "jailer verified at $(command -v jailer): $(jailer --version | head -1)"`;

  let ok = 0;
  let failures = 0;
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const result = await execCommand(client, installCmd, 180_000);
        if (result.exitCode === 0) {
          ok++;
          const verified = result.stdout
            .split("\n")
            .find((l) => l.startsWith("jailer verified"));
          console.log(
            `  ok ${row.hostname}${verified ? ` — ${verified}` : " (no verification line — investigate)"}`
          );
        } else {
          failures++;
          console.error(`  x ${row.hostname}: exit ${result.exitCode}`);
          if (result.stderr.trim()) {
            console.error(`      stderr: ${result.stderr.trim().slice(-600)}`);
          }
          if (result.stdout.trim()) {
            console.error(`      stdout: ${result.stdout.trim().slice(-600)}`);
          }
        }
      } finally {
        client.end();
      }
    } catch (err) {
      failures++;
      console.error(
        `  x ${row.hostname}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.log(
    failures === 0
      ? `Done — all ${ok} server(s) ok`
      : `Done — ${ok} ok, ${failures} failed`
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Retrofit failed:", err);
  process.exit(1);
});
