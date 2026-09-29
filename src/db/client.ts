import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient } from "pg";
import { getSqliteDb } from "./sqlite";
import { postgresSql } from "./postgres-sql";

types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);
export type Statement = {
  get: (...params: unknown[]) => Promise<unknown>;
  all: (...params: unknown[]) => Promise<unknown[]>;
  run: (...params: unknown[]) => Promise<{ changes: number; lastInsertRowid: number | bigint }>;
};
export type Database = {
  prepare: (sql: string) => Statement;
  transaction: <T>(work: () => T | Promise<T>) => () => Promise<T>;
};
const globalForDb = globalThis as unknown as { crmAsyncDb?: Database; crmPool?: Pool };
export function isPostgres() { return /^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL || ""); }
export function getPool() {
  if (!isPostgres()) throw new Error("PostgreSQL DATABASE_URL is required");
  return globalForDb.crmPool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
}
function openPostgres(): Database {
  const context = new AsyncLocalStorage<PoolClient>();
  const query = (sql: string, params: unknown[], returning = false) => (context.getStore() || getPool()).query(postgresSql(sql, returning), params);
  return {
    prepare: (sql) => ({
      get: async (...params) => (await query(sql, params)).rows[0],
      all: async (...params) => (await query(sql, params)).rows,
      run: async (...params) => { const result = await query(sql, params, true); return { changes: result.rowCount || 0, lastInsertRowid: result.rows[0]?.id || 0 }; },
    }),
    transaction: (work) => async () => {
      if (context.getStore()) throw new Error("Nested transactions are not supported");
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const result = await context.run(client, work);
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
  };
}
function openSqlite(): Database {
  const raw = getSqliteDb();
  const context = new AsyncLocalStorage<boolean>();
  let pending: Promise<unknown> = Promise.resolve();
  function locked<T>(work: () => T | Promise<T>): Promise<T> {
    if (context.getStore()) return Promise.resolve().then(work);
    const next = pending.then(work);
    pending = next.catch(() => undefined);
    return next;
  }
  return {
    prepare: (sql) => ({
      get: (...params) => locked(() => raw.prepare(sql).get(...params)),
      all: (...params) => locked(() => raw.prepare(sql).all(...params)),
      run: (...params) => locked(() => raw.prepare(sql).run(...params)),
    }),
    transaction: (work) => () => locked(async () => {
      if (context.getStore()) throw new Error("Nested transactions are not supported");
      raw.exec("BEGIN IMMEDIATE");
      try { const result = await context.run(true, work); raw.exec("COMMIT"); return result; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    }),
  };
}
export function getDb(): Database { return globalForDb.crmAsyncDb ||= isPostgres() ? openPostgres() : openSqlite(); }
export function nowIso() { return new Date().toISOString(); }
