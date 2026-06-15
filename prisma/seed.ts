import { existsSync } from "fs";
import { randomUUID } from "crypto";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
} else if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const { db } = await import("../lib/db");

// Platform admin for development. Sign-in stays magic-link — this only
// guarantees the account exists and carries platform-admin rights.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "chintan.dhokai@debutify.com";

const admin = await db.user.upsert({
  where: { email: ADMIN_EMAIL },
  update: { isPlatformAdmin: true, role: "admin", emailVerified: true },
  create: {
    id: randomUUID(),
    name: "Platform Admin",
    email: ADMIN_EMAIL,
    emailVerified: true,
    isPlatformAdmin: true,
    role: "admin",
  },
});

console.log(`Seeded platform admin: ${admin.email} (${admin.id})`);

await db.$disconnect();
