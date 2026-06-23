import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const env = readFileSync('.env', 'utf8');
const dbUrl = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
if (!dbUrl) { console.error('DATABASE_URL not found'); process.exit(1); }

const pg = require('F:/teamority/node_modules/.pnpm/pg@8.21.0/node_modules/pg');
const client = new pg.Client({ connectionString: dbUrl });

try {
  await client.connect();
  console.log('✓ DB connected');

  // --- task table: add list-pin columns ---
  await client.query(`ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "is_pinned_to_list" boolean NOT NULL DEFAULT false`);
  await client.query(`ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "pinned_to_list_by" text`);
  await client.query(`ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "pinned_to_list_at" timestamp with time zone`);
  await client.query(`ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "pinned_to_list_order" integer`);
  await client.query(`CREATE INDEX IF NOT EXISTS "task_pinned_to_list_idx" ON "task" ("list_id", "is_pinned_to_list")`);
  console.log('✓ task list-pin columns added');

  // --- pinned_task table ---
  await client.query(`
    CREATE TABLE IF NOT EXISTS "pinned_task" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "task_id" text NOT NULL REFERENCES "task"("id") ON DELETE CASCADE,
      "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "order_index" integer NOT NULL DEFAULT 0,
      "pinned_at" timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "pinned_task_user_task_idx" ON "pinned_task" ("user_id", "task_id")`);
  await client.query(`CREATE INDEX IF NOT EXISTS "pinned_task_user_workspace_idx" ON "pinned_task" ("user_id", "workspace_id")`);
  console.log('✓ pinned_task table created');

  // Verify
  const taskCols = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='task' AND column_name LIKE '%pin%'"
  );
  console.log('task pin columns:', taskCols.rows.map(r => r.column_name).join(', '));

  const ptExists = await client.query(
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='pinned_task'"
  );
  console.log('pinned_task table exists:', ptExists.rows[0].count === '1' ? 'yes' : 'no');

} catch (e) {
  console.error('Error:', e.message);
} finally {
  await client.end();
}
