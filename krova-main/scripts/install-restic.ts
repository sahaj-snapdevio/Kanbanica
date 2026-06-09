/**
 * One-off: install the pinned restic binary on every active server.
 * New servers get it during the install phase (`server-install.ts`
 * step "restic"); this retrofits existing ones.
 *
 * restic is required for the snapshot subsystem
 * (`lib/storage/restic/`). Without it, the first snapshot operation
 * on a non-retrofitted server fails with "restic: command not found".
 *
 * Idempotent — checks for the pinned `RESTIC_VERSION` via
 * `restic version` substring match and skips the install when the
 * pinned version is already present. A newer version OR an older
 * version triggers a fresh install (the upstream tarball overwrites
 * `/usr/local/bin/restic` in place).
 *
 * Run: pnpm install:restic
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
  const { RESTIC_VERSION } = await import("@/config/platform");

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Retrofitting restic ${RESTIC_VERSION} on ${rows.length} active server(s)...`
  );

  // Same install logic as the `server-install.ts` "restic" step —
  // duplicated here intentionally because the retrofit runs against
  // already-installed servers (no setup phase context, base-packages
  // step doesn't run).
  //
  // Self-contained, verify-then-install pattern: every prerequisite
  // (curl, bunzip2) is checked at runtime and installed if missing.
  // The retrofit may run against servers that were provisioned
  // before bzip2 was added to base packages — they need it on the
  // fly.
  //
  // CRITICAL: every install step is a simple command on its own line
  // separated by `;` — NEVER `&&`. With `set -e` enabled, a failing
  // command in the MIDDLE of an `&&` chain does NOT trigger the exit
  // (only the FINAL command in the chain does, per the bash -e man
  // page). A previous version chained curl && bunzip2 && install &&
  // rm && echo: when curl silently failed (network blip, GitHub rate
  // limit), the chain broke but the script continued to the trailing
  // mkdir and exited 0, reporting a successful install that hadn't
  // actually happened.
  const installCmd =
    "set -e; " +
    `EXPECTED="restic ${RESTIC_VERSION} "; ` +
    // ── Step 1: ensure prerequisite tools exist (curl + bunzip2). ──
    "ensure_pkg() { " +
    `  local cmd="$1"; ` +
    `  local pkg="$2"; ` +
    `  if command -v "$cmd" >/dev/null 2>&1; then ` +
    "    return 0; " +
    "  fi; " +
    `  echo "Installing missing package: $pkg (provides $cmd)"; ` +
    "  if command -v apt-get >/dev/null 2>&1; then " +
    // Refresh apt cache first — a server that hasn't seen
    // `apt-get update` in months may point at packages that are
    // no longer downloadable from the mirror.
    "    DEBIAN_FRONTEND=noninteractive apt-get update -qq; " +
    `    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg"; ` +
    "  elif command -v dnf >/dev/null 2>&1; then " +
    `    dnf install -y "$pkg"; ` +
    "  elif command -v yum >/dev/null 2>&1; then " +
    `    yum install -y "$pkg"; ` +
    "  else " +
    `    echo "ERROR: no apt-get/dnf/yum and $cmd is missing" >&2; ` +
    "    exit 1; " +
    "  fi; " +
    `  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $pkg install completed but $cmd still missing" >&2; exit 1; }; ` +
    "}; " +
    "ensure_pkg curl curl; " +
    "ensure_pkg bunzip2 bzip2; " +
    // ── Step 2: install restic itself (idempotent on pinned version) ──
    `if command -v restic >/dev/null 2>&1 && restic version 2>/dev/null | grep -qF "$EXPECTED"; then ` +
    `  echo "restic ${RESTIC_VERSION} already installed"; ` +
    "else " +
    `  ARCH=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/'); ` +
    "  cd /tmp; " +
    "  rm -f restic.bz2 restic; " +
    `  curl -fsSL -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_$\{ARCH}.bz2"; ` +
    "  bunzip2 -f restic.bz2; " +
    "  install -m 0755 restic /usr/local/bin/restic; " +
    "  rm -f /tmp/restic; " +
    `  echo "restic installed: $(restic version | head -1)"; ` +
    "fi; " +
    "mkdir -p /var/lib/krova/restic-cache; " +
    "chmod 700 /var/lib/krova/restic-cache; " +
    // ── Step 3: ground-truth verification ──
    `command -v restic >/dev/null 2>&1 || { echo "ERROR: restic not on PATH after install" >&2; exit 1; }; ` +
    `restic version 2>&1 | grep -qF "$EXPECTED" || { echo "ERROR: restic version mismatch — expected $EXPECTED, got: $(restic version 2>&1 | head -1)" >&2; exit 1; }; ` +
    `echo "restic verified at $(command -v restic): $(restic version | head -1)"`;

  let ok = 0;
  let failures = 0;
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const result = await execCommand(client, installCmd, 180_000);
        if (result.exitCode === 0) {
          ok++;
          // The final verification echo "restic verified at <path>:
          // <version>" is the ground-truth post-install line. If it
          // isn't present, something has shifted in the install
          // command — we still report ok (exit was 0) but warn.
          const verified = result.stdout
            .split("\n")
            .find((l) => l.startsWith("restic verified"));
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
