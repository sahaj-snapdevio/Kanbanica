/**
 * One-off: install the krova-vsock-pty helper on every active server.
 *
 * New servers get it during the install phase (`server-install.ts` step
 * "deploy krova-vsock-pty helper"); this retrofits the existing fleet
 * pre-dating the browser-terminal feature. Without the helper, opening
 * a terminal from the dashboard fails at the bridge handler's
 * `client.exec` step with "krova-vsock-pty: command not found".
 *
 * Idempotent — overwrites any existing binary with the current source.
 *
 * Run: pnpm install:vsock-pty
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const REPO_PATH = join(process.cwd(), "setup/server/krova-vsock-pty");

async function main(): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { servers } = await import("@/db/schema");
  const { connectToServer, execCommand } = await import("@/lib/ssh");

  if (!existsSync(REPO_PATH)) {
    console.error(`Source file missing at ${REPO_PATH}`);
    process.exit(1);
  }
  const b64 = Buffer.from(readFileSync(REPO_PATH, "utf-8")).toString("base64");

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Retrofitting krova-vsock-pty on ${rows.length} active server(s)...`
  );

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const result = await execCommand(
          client,
          `echo '${b64}' | base64 -d > /usr/local/bin/krova-vsock-pty && chmod 0755 /usr/local/bin/krova-vsock-pty`,
          15_000
        );
        if (result.exitCode === 0) {
          ok++;
          console.log(`  ok ${row.hostname}`);
        } else {
          failed++;
          console.error(
            `  x ${row.hostname}: exit ${result.exitCode} ${result.stderr.slice(-300) || result.stdout.slice(-300)}`
          );
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
