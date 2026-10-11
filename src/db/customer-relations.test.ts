import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { schemaSql } from "./schema";

test("customer product/competitor relations enforce matching products and preserve shared catalog data", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    db.exec(schemaSql);
    db.exec(`INSERT INTO users (id, username, name, password_hash) VALUES (1, 'test', 'Test', 'unused');
      INSERT INTO customers (id, name, owner_id, created_by) VALUES (1, 'Customer', 1, 1);
      INSERT INTO products (id, class_name, grade) VALUES (1, 'PP', 'A'), (2, 'PC', 'B');
      INSERT INTO product_competitors (id, product_id, grade, manufacturer) VALUES (1, 1, 'C', 'Factory'), (2, 2, 'D', 'Other');
      INSERT INTO customer_products (customer_id, product_id) VALUES (1, 1);`);
    const link = db.prepare("INSERT INTO customer_competitors (customer_id, product_id, competitor_id) VALUES (1, 1, ?)");
    assert.throws(() => link.run(2), /FOREIGN KEY/);
    link.run(1);
    assert.throws(() => link.run(1), /UNIQUE/);
    assert.throws(() => db.exec("DELETE FROM product_competitors WHERE id = 1"), /FOREIGN KEY/);
    db.exec("UPDATE product_competitors SET manufacturer = 'Updated factory' WHERE id = 1");
    assert.deepEqual(db.prepare("SELECT pc.manufacturer FROM customer_competitors cc JOIN product_competitors pc ON pc.id = cc.competitor_id").get(), { manufacturer: "Updated factory" });
    db.exec("DELETE FROM customer_products WHERE customer_id = 1");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM customer_competitors").get() as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM product_competitors").get() as { count: number }).count, 2);
    db.exec(schemaSql); // Safe to run again on an existing database.
  } finally { db.close(); }
});
