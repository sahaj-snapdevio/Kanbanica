import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main() {
  await import("@/lib/env");
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");

  await db.execute(
    sql`INSERT INTO support_ticket_sequence (id, value) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`
  );
  console.log("Support ticket sequence row seeded.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
