import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { columnMigrations } from "./schema";
import { customerSchema } from "../lib/validation";

test("existing customers retain data when material models are added; legacy edits preserve models", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO customers VALUES (1, 'Existing customer')");
    const migration = columnMigrations.find((item) => item.column === "material_models")!;
    db.exec(migration.ddl);
    assert.deepEqual(db.prepare("SELECT * FROM customers").get(), { id: 1, name: "Existing customer", material_models: "" });
    const update = db.prepare("UPDATE customers SET material_models = COALESCE(?, material_models) WHERE id = 1");
    const parse = (extra: Record<string, unknown>) => customerSchema.parse({ name: "Existing customer", ...extra });
    update.run(parse({ materialModels: "PP H1500\nABS 750SW" }).materialModels);
    update.run(parse({}).materialModels ?? null);
    assert.deepEqual(db.prepare("SELECT material_models FROM customers").get(), { material_models: "PP H1500, ABS 750SW" });
    update.run(parse({ materialModels: "" }).materialModels);
    assert.deepEqual(db.prepare("SELECT material_models FROM customers").get(), { material_models: "" });
    assert.equal(customerSchema.safeParse({ name: "Existing customer", materialModels: "x".repeat(2001) }).success, false);
  } finally {
    db.close();
  }
});
