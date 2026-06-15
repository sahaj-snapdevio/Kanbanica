import { existsSync } from "fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
else if (existsSync(".env")) process.loadEnvFile(".env");

const { enqueue } = await import("../lib/worker/boss");

try {
  const id = await enqueue("send-email", { to: "test@example.com", subject: "t", html: "t" });
  console.log("enqueue without start →", id);
} catch (err) {
  console.log("enqueue FAILED:", err instanceof Error ? err.message : err);
}
process.exit(0);
