import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

import postgres from "postgres";
import { env } from "@/lib/env";

const sql = postgres(env.DATABASE_URL);

console.log("Dropping all tables...");
await sql`DROP SCHEMA public CASCADE`;
await sql`CREATE SCHEMA public`;
// Also drop drizzle's migration-tracking schema so `db:migrate` re-runs all
// migrations after reset. Otherwise __drizzle_migrations holds stale hashes
// pointing at tables that no longer exist.
await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
console.log("Schema reset complete.");
await sql.end();
