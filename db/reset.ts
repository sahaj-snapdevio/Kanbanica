import { existsSync } from "node:fs";
import postgres from "postgres";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const { env } = await import("@/lib/env");

const sql = postgres(env.DATABASE_URL);

console.log("Dropping public and drizzle schemas...");
await sql`DROP SCHEMA public CASCADE`;
await sql`CREATE SCHEMA public`;
await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
await sql.end();
console.log("Database reset complete.");
