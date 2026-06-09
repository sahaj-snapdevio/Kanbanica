import { eq } from "drizzle-orm";
import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function makeAdmin() {
  const email = process.argv[2];

  if (!email) {
    console.error("Usage: tsx scripts/make-admin.ts <email>");
    process.exit(1);
  }

  const [{ db }, { user }] = await Promise.all([
    import("@/lib/db"),
    import("@/db/schema/auth"),
  ]);

  const [updated] = await db
    .update(user)
    .set({ role: "admin" })
    .where(eq(user.email, email))
    .returning({ id: user.id, email: user.email, role: user.role });

  if (!updated) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  console.log(`Done — ${updated.email} is now an Orbit admin.`);
  process.exit(0);
}

makeAdmin().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
