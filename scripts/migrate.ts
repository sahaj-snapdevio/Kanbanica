import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Production-safe migration runner.
//
// `drizzle-kit` is a devDependency and is absent from --prod images, so we run
// migrations with the runtime `drizzle-orm` migrator against ./db/migrations.
// This is what the docker-compose `migrate` service invokes (via the worker
// image, which already bundles db/migrations + tsx + drizzle-orm).

if (existsSync(".env")) {
  process.loadEnvFile();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Cannot run migrations.");
  process.exit(1);
}

async function main() {
  // A dedicated single-connection client that closes when done.
  const client = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(client);

  console.log("[migrate] applying migrations from ./db/migrations …");
  await migrate(db, { migrationsFolder: "./db/migrations" });
  console.log("[migrate] done.");

  await client.end();
}

main().catch((error) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
