/**
 * One-off: install the pinned rclone binary on every active server.
 * New servers get it during the install phase (`server-install.ts`
 * step "rclone"); this retrofits existing servers — including ones
 * provisioned BEFORE rclone was pinned, which got "latest stable" from
 * the upstream install.sh and may now be on any number of different
 * minor versions.
 *
 * rclone is required for the host-side `.cube` backup + import multipart
 * transfers (`lib/storage/s3-transfer.ts`). Without it, the first backup
 * or import on a non-retrofitted server fails with "rclone: command not
 * found". When it's present at the wrong version, multipart throughput
 * tuning becomes non-reproducible (different `--multi-thread-streams` /
 * `--s3-upload-concurrency` defaults across the fleet).
 *
 * Idempotent — checks for the pinned `RCLONE_VERSION` via the
 * `rclone version` first-line substring match and skips when already at
 * the pin. A newer version OR an older version triggers a fresh install
 * (the upstream zip overwrites `/usr/local/bin/rclone` in place).
 *
 * Run: pnpm install:rclone
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
  const { RCLONE_VERSION } = await import("@/config/platform");

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Retrofitting rclone ${RCLONE_VERSION} on ${rows.length} active server(s)...`
  );

  // Same install logic as the `server-install.ts` "rclone" step —
  // duplicated here so the retrofit is self-sufficient (no setup-phase
  // context, no base-packages step). Self-contained, verify-then-install
  // pattern matching `pnpm install:restic`.
  //
  // CRITICAL: every install step is a simple command on its own line
  // separated by `;` — NEVER `&&`. With `set -e` enabled, a failing
  // command in the MIDDLE of an `&&` chain does NOT trigger the exit
  // (only the FINAL command in the chain does). Semicolons preserve
  // set -e's per-command exit semantics.
  const installCmd =
    "set -e; " +
    `EXPECTED="rclone v${RCLONE_VERSION}"; ` +
    // Step 1: ensure prerequisite tools exist (curl + unzip).
    "ensure_pkg() { " +
    `  local cmd="$1"; ` +
    `  local pkg="$2"; ` +
    `  if command -v "$cmd" >/dev/null 2>&1; then ` +
    "    return 0; " +
    "  fi; " +
    `  echo "Installing missing package: $pkg (provides $cmd)"; ` +
    "  if command -v apt-get >/dev/null 2>&1; then " +
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
    "ensure_pkg unzip unzip; " +
    // Step 2: idempotency gate — skip install when pinned version already
    // present.
    `if command -v rclone >/dev/null 2>&1 && rclone version 2>/dev/null | head -1 | grep -qF "$EXPECTED"; then ` +
    `  echo "rclone ${RCLONE_VERSION} already installed"; ` +
    "else " +
    `  ARCH=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/'); ` +
    "  cd /tmp; " +
    "  rm -rf rclone.zip rclone-extracted; " +
    "  mkdir -p rclone-extracted; " +
    `  curl -fsSL -o rclone.zip "https://github.com/rclone/rclone/releases/download/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-$\{ARCH}.zip"; ` +
    "  unzip -q rclone.zip -d rclone-extracted; " +
    `  install -m 0755 rclone-extracted/rclone-v${RCLONE_VERSION}-linux-$\{ARCH}/rclone /usr/local/bin/rclone; ` +
    "  rm -rf rclone.zip rclone-extracted; " +
    `  echo "rclone installed: $(rclone version | head -1)"; ` +
    "fi; " +
    // Step 3: ground-truth verification.
    `command -v rclone >/dev/null 2>&1 || { echo "ERROR: rclone not on PATH after install" >&2; exit 1; }; ` +
    `rclone version 2>&1 | head -1 | grep -qF "$EXPECTED" || { echo "ERROR: rclone version mismatch — expected $EXPECTED, got: $(rclone version 2>&1 | head -1)" >&2; exit 1; }; ` +
    `echo "rclone verified at $(command -v rclone): $(rclone version | head -1)"`;

  let ok = 0;
  let failures = 0;
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const result = await execCommand(client, installCmd, 300_000);
        if (result.exitCode === 0) {
          ok++;
          const verified = result.stdout
            .split("\n")
            .find((l) => l.startsWith("rclone verified"));
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
