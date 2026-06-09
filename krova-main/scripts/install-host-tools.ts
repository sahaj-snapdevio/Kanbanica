/**
 * One-off: install the platform's required host-side tools on every
 * active bare-metal server. New servers get these during the `install`
 * setup phase (`server-install.ts` "base packages" step + "verify host
 * tools" gate); this retrofits servers provisioned before any of these
 * tools were pinned in base-packages.
 *
 * The tools shipped here are everything the worker shell-outs to outside
 * coreutils / util-linux / iproute2 / systemd. Specifically:
 *   - netcat-openbsd / nmap-ncat (provides `nc` — ad-hoc TCP probing)
 *   - conntrack / conntrack-tools (provides `conntrack` — flush stale NAT
 *     flows when a freed host port is reused, so it never misroutes)
 *   - file (ext4 magic-byte sanity check after .cube extraction)
 *   - e2fsprogs (`e2fsck`, `resize2fs`, `mkfs.ext4` — cube boot/import/
 *     redeploy/transfer/resize)
 *   - unzip (rclone install step extracts the upstream release zip)
 *   - rsync, bzip2, zstd, curl, gnupg, ca-certificates, python3 — base
 *     packages that may have been omitted on older provisions.
 *
 * Idempotent — apt-get / dnf install of an already-present package is a
 * no-op. Cross-distro: branches on apt-get vs dnf vs yum like every other
 * platform shell step.
 *
 * Run: pnpm install:host-tools
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

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(`Retrofitting host tools on ${rows.length} active server(s)...`);

  // The install + the verification step are bundled into a single shell
  // command so a missing tool surfaces immediately. The verify list
  // matches `server-install.ts` "verify host tools" step exactly — keep
  // them in sync when adding new dependencies.
  const installCmd =
    "set -e; " +
    "if command -v apt-get >/dev/null 2>&1; then " +
    "  DEBIAN_FRONTEND=noninteractive apt-get update -qq; " +
    "  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq " +
    "    curl tar zstd bzip2 unzip rsync " +
    "    iptables-persistent net-tools conntrack ca-certificates gnupg python3 " +
    "    netcat-openbsd file e2fsprogs; " +
    "elif command -v dnf >/dev/null 2>&1; then " +
    "  dnf install -y " +
    "    curl tar zstd bzip2 unzip rsync " +
    "    iptables-services net-tools conntrack-tools ca-certificates gnupg2 python3 " +
    "    nmap-ncat file e2fsprogs; " +
    "elif command -v yum >/dev/null 2>&1; then " +
    "  yum install -y " +
    "    curl tar zstd bzip2 unzip rsync " +
    "    iptables-services net-tools conntrack-tools ca-certificates gnupg2 python3 " +
    "    nmap-ncat file e2fsprogs; " +
    "else " +
    "  echo 'Unsupported distro: no apt-get/dnf/yum found' >&2; " +
    "  exit 1; " +
    "fi; " +
    // Ground-truth verification — same list as the install-phase
    // "verify host tools" step. Any miss exits non-zero with a precise
    // error so the operator knows exactly which package to fetch
    // manually if the apt mirror was lying.
    'REQUIRED="' +
    "curl:curl tar:tar rsync:rsync zstd:zstd " +
    "bunzip2:bzip2 unzip:unzip iptables:iptables ip6tables:iptables " +
    "ip:iproute2 ss:iproute2 netstat:net-tools " +
    "python3:python3 gpg:gnupg nc:netcat-openbsd|nmap-ncat " +
    "conntrack:conntrack|conntrack-tools " +
    "file:file e2fsck:e2fsprogs resize2fs:e2fsprogs " +
    // ionice (util-linux) + nice (coreutils) prefix host-side restic/zstd ops when
    // DISK_IO_STORAGE_TUNING_ENABLED is on — verify them too (Rule 46, matches the
    // server-install "verify host tools" list).
    'sha256sum:coreutils bash:bash ionice:util-linux nice:coreutils"; ' +
    "MISSING=; " +
    "for entry in $REQUIRED; do " +
    `  bin=$(printf '%s' "$entry" | cut -d: -f1); ` +
    `  pkg=$(printf '%s' "$entry" | cut -d: -f2-); ` +
    `  if ! command -v "$bin" >/dev/null 2>&1; then ` +
    `    MISSING="$MISSING|$bin (install $pkg)"; ` +
    "  fi; " +
    "done; " +
    'if [ -n "$MISSING" ]; then ' +
    `  echo "ERROR: required host tools missing — $(printf '%s' "$MISSING" | tr '|' '\\n  ')" >&2; ` +
    "  exit 1; " +
    "fi; " +
    'echo "All required host tools present"';

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const result = await execCommand(client, installCmd, 300_000);
        if (result.exitCode === 0) {
          ok++;
          const verified = result.stdout
            .split("\n")
            .find((l) => l.includes("All required host tools present"));
          console.log(
            `  ok ${row.hostname}${verified ? ` — ${verified.trim()}` : ""}`
          );
        } else {
          failed++;
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
      failed++;
      console.error(
        `  x ${row.hostname}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.log(
    failed === 0
      ? `Done — all ${ok} server(s) ok`
      : `Done — ${ok} ok, ${failed} failed`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Retrofit failed:", err);
  process.exit(1);
});
