import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { ADMIN_ROLE } from "@/config/platform";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main() {
  const [email, password, name = "Admin"] = process.argv.slice(2);

  if (!email || !password) {
    console.error("Usage: pnpm create:admin <email> <password> [name]");
    console.error(
      "  e.g. pnpm create:admin admin@example.com secret123 'Super Admin'"
    );
    process.exit(1);
  }

  const [{ db }, { user, account }] = await Promise.all([
    import("@/lib/db"),
    import("@/db/schema"),
  ]);

  // Check if user already exists
  const [existing] = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.email, email));

  if (existing) {
    // Already exists — just set the password and promote to admin
    const hashed = await hashPassword(password);
    const now = new Date();

    await db
      .update(user)
      .set({ role: ADMIN_ROLE, updatedAt: now })
      .where(eq(user.id, existing.id));

    // Upsert credential account
    const [existingAccount] = await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.userId, existing.id));

    if (existingAccount) {
      await db
        .update(account)
        .set({ password: hashed, updatedAt: now })
        .where(eq(account.id, existingAccount.id));
    } else {
      await db.insert(account).values({
        id: randomUUID(),
        userId: existing.id,
        accountId: email,
        providerId: "credential",
        password: hashed,
        createdAt: now,
        updatedAt: now,
      });
    }

    console.log(
      `✓ Existing user ${email} promoted to admin with new password.`
    );
    process.exit(0);
  }

  // Create brand new admin user
  const userId = randomUUID();
  const hashed = await hashPassword(password);
  const now = new Date();

  await db.insert(user).values({
    id: userId,
    email,
    name,
    emailVerified: true,
    role: ADMIN_ROLE,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(account).values({
    id: randomUUID(),
    userId,
    accountId: email,
    providerId: "credential",
    password: hashed,
    createdAt: now,
    updatedAt: now,
  });

  console.log(`✓ Admin user created: ${email} (name: "${name}")`);
  console.log("  Login at /admin/login with the password you provided.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
