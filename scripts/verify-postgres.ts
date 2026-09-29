// Destructive fixtures are allowed ONLY in the separately migrated staging database.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb, getPool } from "../src/db/client";

async function main() {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("/crm_staging")) throw new Error("Refusing to run fixtures outside crm_staging");
  const base = process.env.SMOKE_URL || "http://127.0.0.1:3004";
  const pool = getPool();
  const tag = `smoke_${Date.now()}`;
  const password = randomBytes(24).toString("hex");
  const admin = await pool.query("INSERT INTO users(username,name,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id", [tag, "迁移验收虚构管理员", await bcrypt.hash(password, 10)]);
  let cookie = "";
  let checks = 0;
  async function request(path: string, method = "GET", body?: unknown, status = 200, useCookie = cookie) {
    const isForm = body instanceof FormData;
    const response = await fetch(base + path, { method, headers: { ...(useCookie ? { Cookie: useCookie } : {}), ...(body && !isForm ? { "Content-Type": "application/json" } : {}) }, body: isForm ? body : body ? JSON.stringify(body) : undefined });
    const content = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${content.slice(0, 400)}`); checks++;
    return { response, json: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(content) : null, content };
  }
  const login = await request("/api/auth/login", "POST", { username: tag, password });
  cookie = login.response.headers.get("set-cookie")!.split(";")[0];
  for (const path of ["/api/auth/me", "/api/health", "/api/customers", "/api/customers?q=lotte", "/api/customers?productId=1", "/api/products", "/api/orders", "/api/orders?arrivingSoon=1", "/api/opportunities", "/api/visits", "/api/lookups", "/api/dicts?withUsage=1", "/api/users", "/api/users/options", "/api/audit-logs", "/api/dashboard", "/api/dashboard/insights", "/api/dashboard/trend?granularity=year", "/api/dashboard/trend?granularity=month", "/api/dashboard/trend?granularity=week", "/api/data/orders-template", "/api/data/orders-export", "/orders", "/customers", "/dashboard", "/products", "/visits", "/settings"]) await request(path);
  const productBody = { className: "TEST", grade: tag, competitors: [{ grade: "fixture-competitor" }] };
  const product = (await request("/api/products", "POST", productBody, 201)).json.data.id;
  const card = Buffer.from("fixture-card-bytes");
  const customerBody = { name: tag, contacts: [{ name: "验收虚构联系人", cardFront: `data:image/png;base64,${card.toString("base64")}` }] };
  const customer = (await request("/api/customers", "POST", customerBody, 201)).json.data.id;
  const detail = (await request(`/api/customers/${customer}`)).json.data;
  assert.equal(detail.contacts.length, 1); assert.equal(Boolean(detail.contacts[0].hasCardFront), true);
  const cardUrl = `/api/customers/${customer}/contacts/${detail.contacts[0].id}/card`;
  assert.equal((await request(cardUrl)).content, card.toString());
  await request(`/api/customers/${customer}`, "PUT", { ...customerBody, contacts: [{ id: detail.contacts[0].id, name: "验收虚构联系人" }] });
  assert.equal((await request(cardUrl)).content, card.toString());
  await request(`/api/products/${product}`, "PUT", { ...productBody, competitors: [{ grade: "fixture-updated" }] });
  const orderBody = { orderDate: "2026-09-30", customerId: customer, productId: product, quantity: 2, price: null, currency: "USD", orderNature: "开发", status: "planned" };
  const order = (await request("/api/orders", "POST", orderBody, 201)).json.data.id;
  const orderRow = (await request(`/api/orders?customerId=${customer}`)).json.data[0];
  assert.equal(orderRow.price, null); assert.equal(orderRow.amount, null);
  await request(`/api/orders/${order}`, "PUT", { ...orderBody, price: 4.5, orderNo: orderRow.orderNo });
  const filters = [["currency", "USD"], ["currency", "CNY"], ["orderNature", "成熟"], ["orderNature", "开发"]];
  for (let mask=0;mask<16;mask++) {
    const query = new URLSearchParams({ customerId: String(customer) });
    filters.forEach(([key,value],index)=>{ if(mask & 1<<index)query.append(key,value); });
    const rows = (await request(`/api/orders?${query}`)).json.data;
    const currencyOk = !(mask&3) || !!(mask&1), natureOk = !(mask&12) || !!(mask&8);
    assert.equal(rows.length, currencyOk && natureOk ? 1 : 0);
  }
  const visitBody = { title: tag, customerId: customer, visitDate: "2026-09-30", productIds: [product] };
  const visit = (await request("/api/visits", "POST", visitBody, 201)).json.data.id;
  await request(`/api/visits/${visit}`, "PUT", { ...visitBody, productIds: [] });
  const form = (name: string, text: string) => { const f=new FormData(); f.set("file", new File([text],name)); return f; };
  await request(`/api/visits/${visit}/attachment`, "POST", form("fixture.docx", "fixture-visit-bytes"));
  assert.equal((await request(`/api/visits/${visit}/attachment`)).content, "fixture-visit-bytes");
  const attachment = (await request(`/api/products/${product}/attachments`, "POST", form("fixture.txt", "fixture-product-bytes"), 201)).json.data.id;
  assert.equal((await request(`/api/products/${product}/attachments/${attachment}`)).content, "fixture-product-bytes");
  await request(`/api/products/${product}/attachments`);
  await request("/api/data/orders-import", "POST", form("wrong.pdf", "invalid"), 422);
  await request("/api/data/orders-import", "POST", form("corrupt.xlsx", "invalid"), 422);
  const csv = `订单日期,客户名称,产品大类,型号,数量,单价\n2026/09/30,${tag},TEST,${tag},3,\n`;
  const imported = form("fixture.csv", csv); imported.set("commit", "true");
  const importResult = (await request("/api/data/orders-import", "POST", imported)).json.data;
  assert.equal(importResult.imported, 1, JSON.stringify(importResult));
  const missing = (await request("/api/data/orders-import", "POST", form("missing.csv", `订单日期,客户名称,产品大类,型号,数量,单价\n2026/09/30,,TEST,${tag},3,\n`))).json.data;
  assert.ok(missing.errors?.some((e: {message: string})=>e.message.includes("客户")));
  const userName = `${tag}_user`;
  const user = (await request("/api/users", "POST", { username: userName, name: "验收虚构用户", password, role: "user" }, 201)).json.data.id;
  const userLogin = await request("/api/auth/login", "POST", { username: userName, password });
  const userCookie = userLogin.response.headers.get("set-cookie")!.split(";")[0];
  await request(`/api/customers/${customer}`, "GET", undefined, 403, userCookie);
  await request(cardUrl, "GET", undefined, 403, userCookie);
  await request("/api/users", "GET", undefined, 403, userCookie);
  assert.equal((await request("/api/orders", "GET", undefined, 200, userCookie)).json.data.length, 0);
  await request(`/api/users/${user}`, "PUT", { username: userName, name: "验收虚构用户", role: "user", status: "disabled" });
  await request("/api/auth/me", "GET", undefined, 401, userCookie);
  const db = getDb();
  await assert.rejects(db.transaction(async()=>{
    await db.prepare("INSERT INTO products(class_name, grade) VALUES (?, ?)").run(tag, "rollback");
    await db.prepare("INSERT INTO customer_members(customer_id,user_id) VALUES (?,?)").run(-1,-1);
  })());
  assert.equal(await db.prepare("SELECT id FROM products WHERE class_name=? AND grade=?").get(tag,"rollback"), undefined);
  const refs = await pool.query("SELECT file_data,file_key FROM product_attachments WHERE id=$1",[attachment]);
  assert.equal(refs.rows[0].file_data,null); assert.match(refs.rows[0].file_key,/^sha256\//);
  await request(`/api/products/${product}/attachments/${attachment}`, "DELETE");
  await request(`/api/visits/${visit}/attachment`, "DELETE");
  await request(`/api/visits/${visit}/attachment`, "GET",undefined,404);
  await request(`/api/visits/${visit}`, "DELETE");
  await request(`/api/orders/${order}`, "DELETE");
  await request(`/api/customers/${customer}`, "PUT", { name: tag, contacts: [{ id: detail.contacts[0].id, name: "验收虚构联系人", cardFront: null }] });
  await request(cardUrl,"GET",undefined,404);
  await request("/api/auth/logout","POST");
  await request("/api/auth/me","GET",undefined,401);
  console.log(`PASS: ${checks} HTTP checks, all filter combinations, MinIO byte equality, permission checks, transaction rollback. Fixture admin id ${admin.rows[0].id}; staging only.`);
  await pool.end();
}
main().catch(error=>{ console.error(error); process.exit(1); });
