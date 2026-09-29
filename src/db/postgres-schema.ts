import { schemaSql, postMigrationSql } from "./schema";
import type { Pool, PoolClient } from "pg";
export async function migratePostgres(db: Pool | PoolClient) {
  const schema = schemaSql
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "SERIAL PRIMARY KEY")
    .replace(/ COLLATE NOCASE/g, "")
    .replace(/\bBLOB\b/g, "BYTEA")
    .replace(/\bREAL\b/g, "DOUBLE PRECISION")
    .replace(/datetime\('now'\)/g, "to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')");
  await db.query(schema + postMigrationSql);
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS users_username_casefold ON users (lower(username))");
}
