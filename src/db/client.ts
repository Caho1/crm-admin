import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { schemaSql } from "./schema";

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
  return connection;
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
