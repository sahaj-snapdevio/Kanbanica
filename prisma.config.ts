import { existsSync } from "fs";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: existsSync(".env.local") ? ".env.local" : ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
