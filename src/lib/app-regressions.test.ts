import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { cleanupFixture, createOrder, db, importOrders, importRow, invoke, resetFixture, setupFixture } from "../../tests/local-fixture";

before(setupFixture);
beforeEach(resetFixture);
after(cleanupFixture);

const richText = (text: string) => ({ richText: [{ text: text.slice(0, 3), font: { bold: true } }, { text: text.slice(3) }] });

test("rich text preview and commit use the same existing customer/product and preserve order links", async () => {
  assert.equal((await createOrder("EXISTING")).status, 201);
  const rows = [importRow(richText("EXISTING"), richText("Synthetic Customer"), richText("Synthetic Grade"), richText("rich remark")), importRow("PLAIN")];
  rows[0][3] = richText("PP");
  const preview = await (await importOrders(rows)).json();
  assert.equal(preview.data.valid, true);
  assert.deepEqual(preview.data.missingCustomers, []);
  assert.deepEqual(preview.data.missingProducts, []);
  assert.equal(preview.data.preview[0].cells[2], "Synthetic Customer");
  const committed = await (await importOrders(rows, { commit: "true", createCustomers: JSON.stringify(["[object Object]"]), createProducts: JSON.stringify([{ className: "[object Object]", grade: "[object Object]" }]) })).json();
  assert.equal(committed.data.createCount, 1);
  assert.equal(committed.data.updateCount, 1);
  const orders = await db.prepare("SELECT order_no, customer_id, product_id, notes FROM orders ORDER BY id").all();
  assert.deepEqual(orders, [{ order_no: "EXISTING", customer_id: 1, product_id: 1, notes: "rich remark" }, { order_no: "PLAIN", customer_id: 1, product_id: 1, notes: "" }]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM customers").get() as { count: number }).count, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM products").get() as { count: number }).count, 1);
});

test("rich text missing references are created using visible text only", async () => {
  const rows = [importRow("NEW", richText("New Synthetic Customer"), richText("New Synthetic Grade"))];
  const preview = await (await importOrders(rows)).json();
  assert.deepEqual(preview.data.missingCustomers, ["New Synthetic Customer"]);
  assert.deepEqual(preview.data.missingProducts, [{ className: "PP", grade: "New Synthetic Grade" }]);
  const response = await importOrders(rows, { commit: "true", createCustomers: JSON.stringify(preview.data.missingCustomers), createProducts: JSON.stringify(preview.data.missingProducts) });
  assert.equal((await response.json()).data.createCount, 1);
  const order = await db.prepare("SELECT c.name, p.grade FROM orders ord JOIN customers c ON c.id = ord.customer_id JOIN products p ON p.id = ord.product_id WHERE ord.order_no = 'NEW'").get();
  assert.deepEqual(order, { name: "New Synthetic Customer", grade: "New Synthetic Grade" });
});

test("manual numeric order numbers and concurrent automatic creation remain unique", async () => {
  assert.equal((await createOrder("2")).status, 201);
  assert.equal((await createOrder()).status, 201);
  const responses = await Promise.all(Array.from({ length: 11 }, () => createOrder()));
  for (const response of responses) assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const rows = await db.prepare("SELECT id, order_no FROM orders ORDER BY id").all() as Array<{ id: number; order_no: string }>;
  assert.equal(rows[0].order_no, "2");
  assert.equal(rows[1].order_no, "3");
  assert.equal(new Set(rows.map((row) => row.order_no)).size, 13);
  assert.ok(rows.every((row) => /^\d+$/.test(row.order_no)));
  assert.equal((await createOrder("2")).status, 409);
});

test("PostgreSQL concurrent allocators wait on the same number and recover from 23505 within their transaction", { skip: !process.env.CRM_TEST_POSTGRES_URL, timeout: 10000 }, async () => {
  const { getPool } = await import("../db/client");
  const { finalizeSequentialCode, sequentialPlaceholder } = await import("./query");
  await createOrder("2");
  let firstReady!: () => void;
  const ready = new Promise<void>((resolve) => { firstReady = resolve; });
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const insert = async () => db.prepare("INSERT INTO orders (order_no, order_date, customer_id, product_id, quantity, owner_id, created_by) VALUES (?, '2026-10-01', 1, 1, 10, 1, 1)").run(sequentialPlaceholder());
  const first = db.transaction(async () => {
    const result = await insert();
    const code = await finalizeSequentialCode(db, "orders", "order_no", Number(result.lastInsertRowid), null);
    assert.equal(code, "3");
    firstReady();
    await gate;
    return code;
  })();
  let second: Promise<string> | undefined;
  try {
    await ready;
    second = db.transaction(async () => {
      const result = await insert();
      // READ COMMITTED cannot see the first transaction's uncommitted number.
      assert.equal(await db.prepare("SELECT id FROM orders WHERE order_no = '3'").get(), undefined);
      return finalizeSequentialCode(db, "orders", "order_no", Number(result.lastInsertRowid), null);
    })();
    let waiting = false;
    const deadline = Date.now() + 5000;
    while (!waiting && Date.now() < deadline) {
      const activity = await getPool().query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE orders SET order_no%' LIMIT 1");
      waiting = activity.rowCount === 1;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true, "the second allocator must actually contend on the uncommitted unique number");
    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), ["3", "4"]);
    assert.deepEqual(await db.prepare("SELECT order_no FROM orders ORDER BY id").all(), [{ order_no: "2" }, { order_no: "3" }, { order_no: "4" }]);
  } finally {
    releaseFirst();
    await Promise.allSettled(second ? [first, second] : [first]);
  }
});

test("batch import reserves later explicit numbers rather than updating earlier automatic rows", async () => {
  const response = await importOrders([importRow(), importRow("1"), importRow(), importRow("4"), importRow()], { commit: "true" });
  const payload = await response.json();
  assert.equal(payload.data.createCount, 5);
  assert.equal(payload.data.updateCount, 0);
  assert.deepEqual((await db.prepare("SELECT order_no FROM orders ORDER BY id").all() as Array<{ order_no: string }>).map((row) => row.order_no), ["2", "1", "3", "4", "5"]);
});

test("batch import skips existing manual numeric numbers without changing the existing order", async () => {
  await createOrder("2", { quantity: 999 });
  const payload = await (await importOrders([importRow(), importRow()], { commit: "true" })).json();
  assert.equal(payload.data.createCount, 2);
  assert.equal(payload.data.updateCount, 0);
  assert.deepEqual(await db.prepare("SELECT order_no, quantity FROM orders ORDER BY id").all(), [{ order_no: "2", quantity: 999 }, { order_no: "3", quantity: 10 }, { order_no: "4", quantity: 10 }]);
});

test("outer transaction rollback removes finalized codes and placeholders", async () => {
  const { finalizeSequentialCode, sequentialPlaceholder } = await import("./query");
  await createOrder("2");
  await assert.rejects(db.transaction(async () => {
    const result = await db.prepare("INSERT INTO orders (order_no, order_date, customer_id, product_id, quantity, owner_id, created_by) VALUES (?, '2026-10-01', 1, 1, 10, 1, 1)").run(sequentialPlaceholder());
    assert.equal(await finalizeSequentialCode(db, "orders", "order_no", Number(result.lastInsertRowid), null), "3");
    throw new Error("synthetic rollback");
  })(), /synthetic rollback/);
  assert.deepEqual(await db.prepare("SELECT order_no FROM orders").all(), [{ order_no: "2" }]);
});

test("failed batch write rolls back new references, prior orders and automatic codes", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const globalDb = globalThis as unknown as { crmAsyncDb: typeof db };
  let writes = 0;
  globalDb.crmAsyncDb = { ...db, prepare(sql) {
    const statement = db.prepare(sql);
    if (/INSERT INTO orders\s/i.test(sql)) return { ...statement, run: async (...params: unknown[]) => {
      if (++writes === 2) throw new Error("synthetic second insert failure");
      return statement.run(...params);
    } };
    return statement;
  } };
  try {
    const rows = [importRow("", "New Synthetic Customer", "New Synthetic Grade"), importRow("", "New Synthetic Customer", "New Synthetic Grade")];
    const response = await importOrders(rows, { commit: "true", createCustomers: JSON.stringify(["New Synthetic Customer"]), createProducts: JSON.stringify([{ className: "PP", grade: "New Synthetic Grade" }]) });
    assert.equal(response.status, 500);
    assert.deepEqual(await db.prepare("SELECT id FROM orders").all(), []);
    assert.equal(await db.prepare("SELECT id FROM customers WHERE name = 'New Synthetic Customer'").get(), undefined);
    assert.equal(await db.prepare("SELECT id FROM products WHERE grade = 'New Synthetic Grade'").get(), undefined);
  } finally { globalDb.crmAsyncDb = db; }
});

async function handover() {
  const { POST } = await import("../app/api/users/handover/route");
  return invoke(POST, "/api/users/handover", 1, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromUserId: 2, toUserId: 3 }) });
}

test("handover blocks inaccessible order customers atomically without broadening access", async () => {
  await createOrder("OWN", { ownerId: 2 });
  await createOrder("EXTERNAL", { ownerId: 2, customerId: 2 });
  const response = await handover();
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.error.code, "HANDOVER_ACCESS_CONFLICT");
  assert.match(payload.error.message, /External Customer/);
  assert.deepEqual(await db.prepare("SELECT owner_id FROM customers ORDER BY id").all(), [{ owner_id: 2 }, { owner_id: 4 }]);
  assert.deepEqual(await db.prepare("SELECT owner_id FROM orders ORDER BY id").all(), [{ owner_id: 2 }, { owner_id: 2 }]);
  assert.deepEqual(await db.prepare("SELECT id FROM customer_members").all(), []);
  const { GET } = await import("../app/api/orders/route");
  assert.deepEqual((await (await invoke(GET, "/api/orders", 3)).json()).data, []);
});

test("handover to an existing view collaborator makes every transferred order visible and preserves grant", async () => {
  await createOrder("OWN", { ownerId: 2 });
  await createOrder("EXTERNAL", { ownerId: 2, customerId: 2 });
  await db.prepare("INSERT INTO customer_members (customer_id, user_id, access) VALUES (2, 3, 'view')").run();
  assert.equal((await handover()).status, 200);
  const { GET } = await import("../app/api/orders/route");
  const received = (await (await invoke(GET, "/api/orders", 3)).json()).data as Array<{ orderNo: string; ownerId: number; canEdit: number }>;
  assert.deepEqual(received.map((order) => order.orderNo).sort(), ["EXTERNAL", "OWN"]);
  assert.ok(received.every((order) => order.ownerId === 3));
  assert.equal(received.find((order) => order.orderNo === "EXTERNAL")!.canEdit, 0);
  assert.deepEqual(await db.prepare("SELECT customer_id, user_id, access FROM customer_members").all(), [{ customer_id: 2, user_id: 3, access: "view" }]);
  assert.deepEqual((await (await invoke(GET, "/api/orders", 5)).json()).data, []);
});

test("PostgreSQL handover rolls back all prior owner writes on a later database failure", { skip: !process.env.CRM_TEST_POSTGRES_URL }, async (t) => {
  t.mock.method(console, "error", () => undefined);
  await createOrder("OWN", { ownerId: 2 });
  await db.prepare("INSERT INTO opportunities (name, customer_id, product_id, owner_id, created_by) VALUES ('Synthetic opportunity', 1, 1, 2, 1)").run();
  const globalDb = globalThis as unknown as { crmAsyncDb: typeof db };
  globalDb.crmAsyncDb = { ...db, prepare(sql) {
    const statement = db.prepare(sql);
    if (sql.startsWith("UPDATE orders SET owner_id")) return { ...statement, run: async (...params: unknown[]) => {
      await statement.run(...params);
      throw new Error("synthetic late handover failure");
    } };
    return statement;
  } };
  try {
    assert.equal((await handover()).status, 500);
    assert.deepEqual(await db.prepare("SELECT owner_id FROM customers ORDER BY id").all(), [{ owner_id: 2 }, { owner_id: 4 }]);
    assert.deepEqual(await db.prepare("SELECT owner_id FROM opportunities").all(), [{ owner_id: 2 }]);
    assert.deepEqual(await db.prepare("SELECT owner_id FROM orders").all(), [{ owner_id: 2 }]);
    assert.deepEqual(await db.prepare("SELECT id FROM customer_members").all(), []);
    assert.deepEqual(await db.prepare("SELECT id FROM audit_logs WHERE action = 'handover'").all(), []);
  } finally { globalDb.crmAsyncDb = db; }
});

test("handover blocks orders of deleted customers even for an admin recipient", async () => {
  await createOrder("DELETED", { ownerId: 2, customerId: 2 });
  await db.prepare("UPDATE customers SET deleted_at = '2026-01-01' WHERE id = 2").run();
  const { handoverUserData } = await import("./handover");
  await assert.rejects(handoverUserData(db, 2, { id: 1, username: "fixture-1", name: "Admin", role: "admin", status: "active" }), { code: "HANDOVER_ACCESS_CONFLICT" });
  assert.deepEqual(await db.prepare("SELECT owner_id FROM orders").all(), [{ owner_id: 2 }]);
});

test("handover also blocks inaccessible opportunity customers", async () => {
  await db.prepare("INSERT INTO opportunities (name, customer_id, product_id, owner_id, created_by) VALUES ('Synthetic opportunity', 2, 1, 2, 1)").run();
  assert.equal((await handover()).status, 409);
  assert.deepEqual(await db.prepare("SELECT owner_id FROM opportunities").all(), [{ owner_id: 2 }]);
});

test("soft-deleted customers disappear from dashboard, hot products, list and export without deleting historical orders", async () => {
  await createOrder("USD", { orderNature: "开发", status: "confirmed" });
  await createOrder("CNY", { currency: "CNY", orderNature: "开发" });
  await createOrder("CANCELLED", { status: "cancelled" });
  await createOrder("OTHER", { customerId: 2, quantity: 5 });
  const { GET: dashboard } = await import("../app/api/dashboard/route");
  const { GET: insights } = await import("../app/api/dashboard/insights/route");
  const { GET: orders } = await import("../app/api/orders/route");
  const { GET: exportOrders } = await import("../app/api/data/orders-export/route");
  const { default: ExcelJS } = await import("exceljs");
  for (const userId of [1, 2]) {
    const before = (await (await invoke(dashboard, "/api/dashboard", userId)).json()).data.stats;
    assert.equal(before.developingProjects, 2);
    assert.equal(before.usdOrders.count, userId === 1 ? 2 : 1);
    assert.equal(before.cnyOrders.count, 1);
  }
  await db.prepare("UPDATE customers SET deleted_at = '2026-01-01' WHERE id = 1").run();
  for (const userId of [1, 2]) {
    const after = (await (await invoke(dashboard, "/api/dashboard", userId)).json()).data;
    assert.equal(after.stats.developingProjects, 0);
    assert.deepEqual(after.stats.cnyOrders, { count: 0, quantity: 0 });
    assert.deepEqual(after.stats.usdOrders, userId === 1 ? { count: 1, quantity: 5 } : { count: 0, quantity: 0 });
    assert.ok(after.shipmentAlerts.every((order: { customerId: number }) => order.customerId !== 1));
    const top = (await (await invoke(insights, "/api/dashboard/insights", userId)).json()).data.topGrades;
    assert.deepEqual(top, userId === 1 ? [{ name: "PP / Synthetic Grade", orderCount: 1, quantity: 5, amount: 10 }] : []);
    const list = (await (await invoke(orders, "/api/orders", userId)).json()).data;
    assert.equal(list.length, userId === 1 ? 1 : 0);
    const exported = await invoke(exportOrders, "/api/data/orders-export", userId);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()) as never);
    assert.equal(workbook.worksheets[0].rowCount - 1, list.length);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM orders").get() as { count: number }).count, 4);
});

test("ordinary users may list/download product attachments but cannot upload, delete or edit products", async () => {
  const { GET, POST } = await import("../app/api/products/[id]/attachments/route");
  const { GET: download, DELETE } = await import("../app/api/products/[id]/attachments/[attachmentId]/route");
  const { PUT } = await import("../app/api/products/[id]/route");
  const bytes = Buffer.from("synthetic attachment only");
  await db.prepare("INSERT INTO product_attachments (product_id, file_name, mime_type, file_data, file_size, uploaded_by) VALUES (1, 'synthetic.txt', 'text/plain', ?, ?, 1)").run(bytes, bytes.length);
  const context = { params: Promise.resolve({ id: "1" }) };
  const attachmentContext = { params: Promise.resolve({ id: "1", attachmentId: "1" }) };
  const listing = await invoke((request) => GET(request, context), "/api/products/1/attachments", 3);
  assert.equal((await listing.json()).data[0].fileName, "synthetic.txt");
  const response = await invoke((request) => download(request, attachmentContext), "/api/products/1/attachments/1", 3);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), bytes.toString());
  assert.equal((await invoke((request) => POST(request, context), "/api/products/1/attachments", 3, { method: "POST" })).status, 403);
  assert.equal((await invoke((request) => DELETE(request, attachmentContext), "/api/products/1/attachments/1", 3, { method: "DELETE" })).status, 403);
  assert.equal((await invoke((request) => PUT(request, context), "/api/products/1", 3, { method: "PUT" })).status, 403);
});
