import { getPool } from "../src/db/client";
import { migratePostgres } from "../src/db/postgres-schema";
async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try { await client.query("BEGIN"); await migratePostgres(client); await client.query("COMMIT"); console.log("PostgreSQL schema ready"); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
