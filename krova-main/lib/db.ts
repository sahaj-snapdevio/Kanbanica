import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";

/**
 * Pooled postgres-js client. `db` is the Drizzle wrapper used everywhere.
 * `dbClient` is the raw postgres-js handle — exported for the rare call
 * site that needs `client.reserve()` to pin a single connection across
 * a multi-statement session (e.g. session-scoped advisory locks where the
 * unlock must run on the same connection that acquired).
 */
export const dbClient = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(dbClient, { schema });
