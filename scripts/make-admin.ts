import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { ADMIN_ROLE } from "@/config/platform";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: pnpm make:admin <email>");
    process.exit(1);
  }

  const [{ db }, { user }] = await Promise.all([
    import("@/lib/db"),
    import("@/db/schema"),
  ]);

  const [updated] = await db
    .update(user)
    .set({ role: ADMIN_ROLE, updatedAt: new Date() })
    .where(eq(user.email, email))
    .returning({ email: user.email, role: user.role });

  if (!updated) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  console.log(`${updated.email} is now an Orbit admin.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
