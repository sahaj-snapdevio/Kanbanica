/**
 * One-off: install krova-boot-notify.service on every active server that
 * predates the boot-notify feature. New servers get it during the install
 * phase; this retrofits existing ones. Idempotent — safe to re-run.
 *
 * Until a server is retrofitted it still recovers via the <=2-minute
 * cube.state-sync boot-id fallback; this only adds the fast path.
 *
 * Run: pnpm install:boot-notify
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
  const { hmacSign } = await import("@/lib/encrypt");
  const { env } = await import("@/lib/env");
  const { bootNotifyInstallScript } = await import(
    "@/lib/worker/handlers/server-install"
  );

  const rows = await db
    .select({ id: servers.id, hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.status, "active"));

  console.log(
    `Retrofitting krova-boot-notify on ${rows.length} active server(s)...`
  );
  for (const row of rows) {
    try {
      const { client } = await connectToServer(row.id);
      try {
        const token = hmacSign(row.id);
        let result;
        try {
          result = await execCommand(
            client,
            bootNotifyInstallScript(row.id, token, env.NEXT_PUBLIC_APP_URL),
            30_000
          );
        } catch {
          // The install command base64-embeds the per-server HMAC token. A
          // raw execCommand error (e.g. a timeout) echoes the full command.
          // Scrub it so the token is never logged.
          throw new Error(
            "boot-notify install command failed (timeout or SSH error)"
          );
        }
        if (result.exitCode === 0) {
          console.log(`  ok ${row.hostname}`);
        } else {
          console.error(
            `  x ${row.hostname}: exit ${result.exitCode} ${result.stderr.slice(-300)}`
          );
        }
      } finally {
        client.end();
      }
    } catch (err) {
      console.error(
        `  x ${row.hostname}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Retrofit failed:", err);
  process.exit(1);
});
