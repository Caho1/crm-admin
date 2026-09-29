import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postgresSql } from "./postgres-sql";

test("SQL conversion preserves bind values, casing, conflicts and date semantics", () => {
  const sql = postgresSql("SELECT name AS customerName, '?' AS literal FROM customers WHERE name = ? COLLATE NOCASE AND name LIKE ? ORDER BY customerName LIMIT ?");
  assert.match(sql, /lower\(name\) = lower\(\$1\)/);
  assert.match(sql, /name ILIKE \$2/);
  assert.match(sql, /ORDER BY "customerName" LIMIT \$3/);
  assert.match(sql, /'\?' AS "literal"/);
  assert.match(postgresSql("INSERT OR IGNORE INTO customer_members (customer_id, user_id) VALUES (?, ?)", true), /ON CONFLICT DO NOTHING RETURNING id$/);
  assert.doesNotMatch(postgresSql("INSERT OR IGNORE INTO visit_products VALUES (?, ?)", true), /RETURNING/);
});

test("async SQLite transaction rolls back all writes and serializes concurrent work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "crm-async-test-"));
  process.env.DATABASE_URL = join(directory, "test.db");
  const { getDb } = await import("./client");
  const db = getDb();
  try {
    let entered!: () => void;
    const started = new Promise<void>(resolve=>{ entered=resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve=>{ release=resolve; });
    const transaction = db.transaction(async () => {
      await db.prepare("INSERT INTO products (class_name, grade) VALUES (?, ?)").run("TEST", "rollback");
      entered(); await gate;
      throw new Error("rollback fixture");
    })();
    await started;
    const concurrent = db.prepare("INSERT INTO products (class_name, grade) VALUES (?, ?)").run("TEST", "keep");
    release();
    await assert.rejects(transaction, /rollback fixture/);
    await concurrent;
    assert.equal(await db.prepare("SELECT id FROM products WHERE class_name = ? AND grade = ?").get("TEST", "rollback"), undefined);
    assert.ok(await db.prepare("SELECT id FROM products WHERE class_name = ? AND grade = ?").get("TEST", "keep"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
