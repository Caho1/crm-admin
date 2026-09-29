import type Database from "better-sqlite3";

/** SQLite 不支持直接删除 NOT NULL，事务内重建，保留数据、索引与自增序号。 */
export function migrateNullableOrderPrice(db: Database.Database) {
  const columns = db.pragma("table_info(orders)") as Array<{ name: string; notnull: number }>;
  if (!columns.find((column) => column.name === "price")?.notnull) return;
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get() as { sql: string };
  const sql = definition.sql.replace(/\bprice\s+REAL\s+NOT\s+NULL/i, "price REAL");
  if (sql === definition.sql) throw new Error("Unsupported orders.price schema");
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'orders' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
  const foreignKeys = db.pragma("foreign_keys", { simple: true });
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").get() as { seq: number } | undefined;
      db.exec(sql.replace(/CREATE TABLE\s+"?orders"?/i, "CREATE TABLE orders_nullable"));
      const names = columns.map(({ name }) => `"${name.replaceAll('"', '""')}"`).join(", ");
      db.exec(`INSERT INTO orders_nullable (${names}) SELECT ${names} FROM orders`);
      db.exec("DROP TABLE orders; ALTER TABLE orders_nullable RENAME TO orders");
      for (const index of indexes) db.exec(index.sql);
      if (sequence) db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'orders'").run(sequence.seq);
      if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Order migration foreign key check failed");
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  }
}
