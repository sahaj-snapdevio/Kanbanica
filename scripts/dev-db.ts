import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

if (existsSync(".env")) {
  process.loadEnvFile();
}

// Fall back to the standard local dev URL so `pnpm db:local` works without a
// .env. Copying .env.example is still recommended; this just enables zero-config.
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://krova:krova@localhost:54329/krova";

const url = new URL(databaseUrl);
const user = decodeURIComponent(url.username) || "postgres";
const password = decodeURIComponent(url.password) || "password";
const port = Number(url.port) || 54_329;
const database = url.pathname.replace(/^\//, "") || "postgres";
const dataDir = path.resolve(process.cwd(), ".krova-postgres");

const postgres = new EmbeddedPostgres({
  databaseDir: dataDir,
  password,
  persistent: true,
  port,
  user,
});

async function main() {
  const alreadyInitialised = existsSync(path.join(dataDir, "PG_VERSION"));
  if (!alreadyInitialised) {
    console.log(`Initialising Postgres data directory at ${dataDir}`);
    await postgres.initialise();
  }

  await postgres.start();
  console.log(`Postgres running at ${databaseUrl}`);

  if (!alreadyInitialised && database !== "postgres") {
    try {
      await postgres.createDatabase(database);
      console.log(`Created database '${database}'`);
    } catch {
      // Database already exists.
    }
  }

  async function stop(signal: string) {
    console.log(`Received ${signal}; stopping Postgres`);
    await postgres.stop();
    process.exit(0);
  }

  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
}

main().catch((error) => {
  console.error("Failed to start embedded Postgres:", error);
  process.exit(1);
});
