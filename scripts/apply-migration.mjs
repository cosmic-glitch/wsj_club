// Apply a SQL migration to the shared Supabase project (rc_* tables only).
//
//   node --env-file=.env.local scripts/apply-migration.mjs supabase/migrations/0001_init.sql
//
// Uses SUPABASE_DB_URL (the direct Postgres connection string from the
// Supabase dashboard, Settings → Database). Runs the file in one
// transaction, so a failed migration leaves nothing half-applied.
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: node --env-file=.env.local scripts/apply-migration.mjs <file.sql>");
  process.exit(1);
}
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local)");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log(`applied ${file}`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(`failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
