import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pg = require('../node_modules/.pnpm/pg@8.21.0/node_modules/pg/lib/index.js');

const pool = new pg.Pool({ connectionString: 'postgresql://postgres:admin123@localhost:5432/kanbanica' });

const client = await pool.connect();
try {
  await client.query(`ALTER TABLE task ADD COLUMN IF NOT EXISTS space_id text REFERENCES space(id) ON DELETE CASCADE`);
  console.log('Added space_id column');
  await client.query(`ALTER TABLE task ALTER COLUMN list_id DROP NOT NULL`);
  console.log('Made list_id nullable');
  await client.query(`ALTER TABLE task ALTER COLUMN status_id DROP NOT NULL`);
  console.log('Made status_id nullable');
} finally {
  client.release();
  await pool.end();
}
