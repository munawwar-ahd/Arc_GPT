import { pool } from '../src/server/db.js';

async function check() {
  const c = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'arcgpt_users'");
  console.log('arcgpt_users cols:', c.rows.map((x: any) => x.column_name));
  await pool.end();
}

check().catch(console.error);
