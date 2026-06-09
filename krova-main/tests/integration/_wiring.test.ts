import assert from "node:assert/strict";
import { test } from "node:test";

// Wiring smoke: proves the integration harness is correctly assembled —
// .env.test loaded, lib/env validated, the throwaway postgres reachable, and
// the migration chain applied (so real tables exist to query).
test("integration harness: env + db + migrated schema are wired up", async () => {
  // lib/env throws at import if the env is invalid — reaching here proves it parsed.
  const { env } = await import("@/lib/env");
  assert.ok(
    env.DATABASE_URL.includes("krovatest"),
    "must use the throwaway test DB"
  );

  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");

  const ping = await db.execute(sql`select 1 as ok`);
  assert.ok(ping, "db query returned a result");

  // A core table from the migration chain must exist.
  const [{ count }] = (await db.execute(
    sql`select count(*)::int as count from information_schema.tables where table_name = 'cubes'`
  )) as unknown as { count: number }[];
  assert.equal(count, 1, "the 'cubes' table exists (migrations applied)");
});
