import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "../src/db/client";

// Never inherit DATABASE_URL. The optional PG runner creates a dedicated loopback cluster.
const directory = mkdtempSync(join(tmpdir(), "crm-regression-"));
const pgUrl = process.env.CRM_TEST_POSTGRES_URL;
if (pgUrl) {
  const url = new URL(pgUrl);
  if (url.hostname !== "127.0.0.1" || !/^\/crm_regression_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error("Regression tests require an isolated loopback PostgreSQL database");
  }
}
process.env.DATABASE_URL = pgUrl || join(directory, "synthetic.db");
Object.assign(globalThis, { AsyncLocalStorage });

export let db: Database;
let client: typeof import("../src/db/client");

export async function setupFixture() {
  client = await import("../src/db/client");
  if (pgUrl) {
    const { migratePostgres } = await import("../src/db/postgres-schema");
    await migratePostgres(client.getPool());
  }
  db = client.getDb();
}

export async function resetFixture() {
  const { schemaSql } = await import("../src/db/schema");
  const tables = [...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1]);
  if (pgUrl) {
    await client.getPool().query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  } else {
    const { getSqliteDb } = await import("../src/db/sqlite");
    const raw = getSqliteDb();
    raw.transaction(() => {
      for (const table of tables.reverse()) raw.prepare(`DELETE FROM ${table}`).run();
      raw.prepare("DELETE FROM sqlite_sequence").run();
    })();
  }
  for (const [id, name, role] of [[1, "Admin", "admin"], [2, "A", "user"], [3, "B", "user"], [4, "C", "user"], [5, "Unrelated", "user"]]) {
    await db.prepare("INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, 'synthetic-unused', ?)").run(`fixture-${id}`, name, role);
    await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(createHash("sha256").update(`fixture-token-${id}`).digest("hex"), id, "2099-01-01T00:00:00Z");
  }
  await db.prepare("INSERT INTO customers (name, owner_id, created_by) VALUES ('Synthetic Customer', 2, 1)").run();
  await db.prepare("INSERT INTO customers (name, owner_id, created_by) VALUES ('External Customer', 4, 1)").run();
  await db.prepare("INSERT INTO products (class_name, grade) VALUES ('PP', 'Synthetic Grade')").run();
}

export async function cleanupFixture() {
  if (pgUrl) await client.getPool().end();
  else (await import("../src/db/sqlite")).getSqliteDb().close();
  rmSync(directory, { recursive: true, force: true });
}

/** Invoke real handlers with synthetic Next request/session stores; no server or browser. */
export async function invoke(handler: (request: Request) => Promise<Response>, path: string, userId = 1, init: RequestInit = {}) {
  const [{ NextRequest }, { createRequestStoreForAPI }, { createWorkStore }, { workAsyncStorage }, { workUnitAsyncStorage }] = await Promise.all([
    import("next/server"),
    import("next/dist/server/async-storage/request-store"),
    import("next/dist/server/async-storage/work-store"),
    import("next/dist/server/app-render/work-async-storage.external"),
    import("next/dist/server/app-render/work-unit-async-storage.external"),
  ]);
  const headers = new Headers(init.headers);
  headers.set("Cookie", `crm_session=fixture-token-${userId}`);
  const request = new NextRequest(`http://127.0.0.1${path}`, { ...init, headers, signal: init.signal ?? undefined });
  const store = createRequestStoreForAPI(request, request.nextUrl, { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined);
  const work = createWorkStore({
    page: `${path}/route`, buildId: "synthetic", deploymentId: "synthetic", previouslyRevalidatedTags: [],
    renderOpts: { cacheComponents: false, supportsDynamicResponse: true, experimental: { isRoutePPREnabled: false, authInterrupts: false }, waitUntil: undefined, onClose: () => {}, onAfterTaskError: undefined },
  });
  return workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, () => handler(request)));
}

export function orderInput(orderNo = "", extra: Record<string, unknown> = {}) {
  return { orderNo, orderDate: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), customerId: 1, productId: 1, quantity: 10, price: 2, currency: "USD", status: "planned", ...extra };
}

export async function createOrder(orderNo = "", extra: Record<string, unknown> = {}) {
  const { POST } = await import("../src/app/api/orders/route");
  return invoke(POST, "/api/orders", 1, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(orderInput(orderNo, extra)) });
}

export async function importOrders(rows: unknown[][], extra: Record<string, string> = {}) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Synthetic Orders");
  sheet.addRow(["Order No.", "Order Date", "Customer", "Classi", "Grade", "Quantity", "Price", "Remark"]);
  for (const row of rows) sheet.addRow(row);
  const file = new File([new Uint8Array(await workbook.xlsx.writeBuffer())], "synthetic.xlsx");
  const body = new FormData();
  body.set("file", file);
  for (const [key, value] of Object.entries(extra)) body.set(key, value);
  const { POST } = await import("../src/app/api/data/orders-import/route");
  return invoke(POST, "/api/data/orders-import", 1, { method: "POST", body });
}

export function importRow(orderNo: unknown = "", customer: unknown = "Synthetic Customer", grade: unknown = "Synthetic Grade", notes: unknown = "") {
  return [orderNo, "2026-10-01", customer, "PP", grade, 10, 2, notes];
}
