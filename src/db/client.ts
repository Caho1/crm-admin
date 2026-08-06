import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { columnMigrations, postMigrationSql, schemaSql } from "./schema";
import { seedDatabase } from "./seed";

const globalForDb = globalThis as unknown as { crmDb?: Database.Database };

function databasePath() {
  const configured = process.env.DATABASE_URL || "./data/crm.db";
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

function openDatabase() {
  const file = databasePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const connection = new Database(file);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("busy_timeout = 5000");
  connection.exec(schemaSql);
  applyColumnMigrations(connection);
  connection.exec(postMigrationSql);
  // 全新安装的库没有任何用户，播种默认账号与演示数据（幂等，老库不受影响）
  const userCount = connection.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    seedDatabase(connection);
  }
  return connection;
}

function applyColumnMigrations(connection: Database.Database) {
  for (const migration of columnMigrations) {
    const columns = connection.prepare(`PRAGMA table_info(${migration.table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === migration.column)) {
      connection.exec(migration.ddl);
    }
  }
}

export function getDb() {
  if (!globalForDb.crmDb) {
    globalForDb.crmDb = openDatabase();
  }
  return globalForDb.crmDb;
}

export function nowIso() {
  return new Date().toISOString();
}
