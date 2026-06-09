import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "fs";
import path from "path";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set — see .env.example");
  process.exit(1);
}

const url = new URL(DATABASE_URL);
const user = decodeURIComponent(url.username) || "postgres";
const password = decodeURIComponent(url.password) || "password";
const port = Number(url.port) || 54_329;
const database = url.pathname.replace(/^\//, "") || "postgres";
const dataDir = path.resolve(process.cwd(), ".pgdata");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
});

async function main() {
  const alreadyInitialised = existsSync(path.join(dataDir, "PG_VERSION"));
  if (!alreadyInitialised) {
    console.log(`Initialising data directory at ${dataDir}`);
    await pg.initialise();
  }

  await pg.start();
  console.log(`Embedded Postgres listening on port ${port}`);

  if (!alreadyInitialised && database !== "postgres") {
    try {
      await pg.createDatabase(database);
      console.log(`Created database '${database}'`);
    } catch {
      // Database already exists
    }
  }

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, stopping Postgres...`);
    try {
      await pg.stop();
    } catch (err) {
      console.error("Error stopping Postgres:", err);
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start embedded Postgres:", err);
  process.exit(1);
});
