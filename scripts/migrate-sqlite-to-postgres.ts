import Sqlite from "better-sqlite3";
import { createHash } from "node:crypto";
import { getPool } from "../src/db/client";
import { migratePostgres } from "../src/db/postgres-schema";
import { objectStore, bucketName, putFile, readFile } from "../src/lib/storage";
const tables = ["users", "sessions", "dict_items", "customers", "customer_members", "contacts", "products", "product_competitors", "visits", "visit_products", "opportunities", "orders", "product_attachments", "audit_logs"];
const blobs: Record<string, Array<[string, string]>> = { contacts: [["card_front_data", "card_front_key"], ["card_back_data", "card_back_key"]], visits: [["attachment_data", "attachment_key"]], product_attachments: [["file_data", "file_key"]] };
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
async function main() {
  const source = process.argv[2];
  if (!source) throw new Error("Usage: migrate-sqlite-to-postgres.ts /path/to/consistent-snapshot.db");
  const sqlite = new Sqlite(source, { readonly: true, fileMustExist: true });
  if (sqlite.pragma("quick_check", { simple: true }) !== "ok") throw new Error("Source integrity check failed");
  if ((sqlite.pragma("foreign_key_check") as unknown[]).length) throw new Error("Source foreign key check failed");
  const pool = getPool(); const db = await pool.connect();
  let files = 0;
  try {
    await db.query("BEGIN");
    await migratePostgres(db);
    for (const table of tables) {
      const count = await db.query(`SELECT COUNT(*) AS count FROM ${table}`);
      if (Number(count.rows[0].count)) throw new Error(`Destination ${table} is not empty; refusing to overwrite data`);
    }
    if (!(await objectStore().bucketExists(bucketName()))) await objectStore().makeBucket(bucketName());
    for (const table of tables) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      for (const original of rows) {
        const row = { ...original };
        for (const [column, keyColumn] of blobs[table] || []) {
          if (!Buffer.isBuffer(row[column])) continue;
          const data = row[column] as Buffer;
          const key = await putFile(data);
          if (hash(await readFile(key, null)) !== hash(data)) throw new Error(`Object checksum mismatch ${table}.${column}`);
          row[column] = null; row[keyColumn] = key; files++;
        }
        const columns = Object.keys(row);
        await db.query(`INSERT INTO ${table} (${columns.map(c=>`"${c}"`).join(",")}) VALUES (${columns.map((_,i)=>`$${i+1}`).join(",")})`, columns.map(c=>row[c]));
        // Read back every field, not just counts. bytea values are verified above.
        const whereColumns = table === "visit_products" ? ["visit_id", "product_id"] : ["id"];
        const result = await db.query(`SELECT * FROM ${table} WHERE ${whereColumns.map((c,i)=>`"${c}"=$${i+1}`).join(" AND ")}`, whereColumns.map(c=>row[c]));
        for (const column of columns) if (result.rows[0][column] !== row[column]) throw new Error(`Field mismatch ${table}.${column}`);
      }
      if (table !== "visit_products") await db.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`);
      console.log(`${table}: ${rows.length} verified`);
    }
    await db.query("COMMIT"); console.log(`Migration committed; ${files} file references verified by SHA-256`);
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); await pool.end(); sqlite.close(); }
}
main().catch(error=>{ console.error(error.message); process.exitCode=1; });
