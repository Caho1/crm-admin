import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { buildOrderFilters } from "./order-filters";
import { whereSql } from "./query";
import type { SessionUser } from "./types";

const admin: SessionUser = { id: 1, username: "admin", name: "Admin", role: "admin", status: "active" };

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE customers (id INTEGER, name TEXT, owner_id INTEGER, deleted_at TEXT);
    CREATE TABLE products (id INTEGER, grade TEXT, class_name TEXT);
    CREATE TABLE customer_members (customer_id INTEGER, user_id INTEGER);
    CREATE TABLE orders (
      id INTEGER, customer_id INTEGER, product_id INTEGER, currency TEXT, order_nature TEXT,
      status TEXT, order_no TEXT, contract_no TEXT, invoice_no TEXT, destination TEXT, pic TEXT,
      order_date TEXT, deleted_at TEXT
    );
    INSERT INTO customers VALUES (1, 'Example', 1, NULL), (2, 'Other', 2, NULL), (3, 'Deleted', 1, '2026-01-01');
    INSERT INTO products VALUES (1, 'A', 'PP');
  `);
  const insert = db.prepare("INSERT INTO orders (id, customer_id, product_id, currency, order_nature, status, order_no, order_date, deleted_at) VALUES (?, ?, 1, ?, ?, ?, ?, '2026-09-20', ?)");
  insert.run(1, 1, "USD", "成熟", "planned", "SO-1", null);
  insert.run(2, 1, "USD", "开发", "shipped", "SO-2", null);
  insert.run(3, 1, "CNY", "成熟", "shipped", "SO-3", null);
  insert.run(4, 1, "CNY", "开发", "planned", "SO-4", null);
  insert.run(5, 2, "KRW", "成熟", "planned", "SO-5", null);
  insert.run(6, 2, "HKD", "", "planned", "SO-6", null);
  insert.run(7, 1, "USD", "成熟", "planned", "SO-7", "2026-09-20");
  insert.run(8, 3, "USD", "成熟", "planned", "SO-8", null);
  return db;
}

function ids(db: Database.Database, searchParams: URLSearchParams, user = admin) {
  const { conditions, params } = buildOrderFilters(searchParams, user);
  return (db.prepare(`SELECT ord.id FROM orders ord JOIN customers c ON c.id = ord.customer_id
    JOIN products p ON p.id = ord.product_id ${whereSql(conditions)} ORDER BY ord.id`)
    .all(...params) as Array<{ id: number }>).map((row) => row.id);
}

test("four quick filters support all 16 combinations, with OR within dimensions and AND across them", () => {
  const db = fixture();
  try {
    const options = [["currency", "USD"], ["currency", "CNY"], ["orderNature", "成熟"], ["orderNature", "开发"]];
    const orders = [
      [1, "USD", "成熟"], [2, "USD", "开发"], [3, "CNY", "成熟"],
      [4, "CNY", "开发"], [5, "KRW", "成熟"], [6, "HKD", ""],
    ];
    for (let mask = 0; mask < 16; mask++) {
      const selected = options.filter((_, index) => mask & (1 << index));
      const currencies = selected.filter(([key]) => key === "currency").map(([, value]) => value);
      const natures = selected.filter(([key]) => key === "orderNature").map(([, value]) => value);
      const expected = orders.filter(([, currency, nature]) =>
        (!currencies.length || currencies.includes(String(currency))) &&
        (!natures.length || natures.includes(String(nature)))).map(([id]) => id);
      assert.deepEqual(ids(db, new URLSearchParams(selected)), expected, `selection ${mask}`);
    }
  } finally { db.close(); }
});

test("multi-select composes with status/search and preserves access rules and legacy links", () => {
  const db = fixture();
  try {
    assert.deepEqual(ids(db, new URLSearchParams("currency=USD")), [1, 2]);
    assert.deepEqual(ids(db, new URLSearchParams("currency=USD&currency=CNY&status=shipped&q=Example")), [2, 3]);
    assert.deepEqual(ids(db, new URLSearchParams("currency=CNY&orderNature=成熟&status=planned")), []);
    assert.deepEqual(ids(db, new URLSearchParams("currency=USD&currency=USD&currency=")), [1, 2]);
    assert.deepEqual(ids(db, new URLSearchParams({ currency: "USD') OR 1=1 --" })), []);
    const member: SessionUser = { ...admin, id: 2, role: "user" };
    assert.deepEqual(ids(db, new URLSearchParams("currency=USD&orderNature=成熟"), member), []);
    db.prepare("INSERT INTO customer_members VALUES (1, 2)").run();
    assert.deepEqual(ids(db, new URLSearchParams("currency=USD&orderNature=成熟"), member), [1]);
  } finally { db.close(); }
});
