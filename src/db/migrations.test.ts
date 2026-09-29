import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateNullableOrderPrice } from "./migrations";

test("old price constraint migrates without losing rows, indexes or the autoincrement sequence", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, price REAL NOT NULL CHECK(price >= 0));
      CREATE INDEX price_index ON orders(price);
      INSERT INTO orders VALUES (1, 123.45), (20, 0);
      DELETE FROM orders WHERE id = 20;`);
    migrateNullableOrderPrice(db);
    migrateNullableOrderPrice(db);
    assert.deepEqual(db.prepare("SELECT * FROM orders").all(), [{ id: 1, price: 123.45 }]);
    assert.equal(db.prepare("INSERT INTO orders(price) VALUES (NULL)").run().lastInsertRowid, 21);
    assert.deepEqual(db.prepare("SELECT price FROM orders WHERE id=21").get(), { price: null });
    assert(db.prepare("SELECT name FROM sqlite_master WHERE name='price_index'").get());
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.throws(() => db.prepare("INSERT INTO orders(price) VALUES (-1)").run());
  } finally { db.close(); }
});
