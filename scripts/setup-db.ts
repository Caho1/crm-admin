import bcrypt from "bcryptjs";
import { getDb } from "../src/db/client";

const db = getDb();

const seed = db.transaction(() => {
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (username, name, password_hash, role, status)
    VALUES (?, ?, ?, ?, 'active')
  `);

  insertUser.run("admin", "系统管理员", bcrypt.hashSync("Admin@123", 12), "admin");
  insertUser.run("sales", "刘晖", bcrypt.hashSync("Sales@123", 12), "user");
  insertUser.run("kim", "金载敏", bcrypt.hashSync("Sales@123", 12), "user");

  const users = db
    .prepare("SELECT id, username FROM users")
    .all() as Array<{ id: number; username: string }>;
  const userId = Object.fromEntries(users.map((user) => [user.username, user.id]));

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products
      (class_name, grade, brand, supplier, application, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `);
  insertProduct.run("PP", "H1500", "HANWHA TOTAL", "韩华道达尔", "注塑、家电部件", "常用聚丙烯牌号");
  insertProduct.run("PP", "J-560S", "LOTTE", "乐天化学", "薄膜材料", "客户测试牌号");
  insertProduct.run("PS", "GPPS-525", "INEOS", "英力士", "通用透明制品", "通用级聚苯乙烯");

  const insertCustomer = db.prepare(`
    INSERT INTO customers
      (name, country, region, industry, address, description, owner_id, status, created_by)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = ? AND deleted_at IS NULL)
  `);
  insertCustomer.run("BEST GAIN", "中国", "香港", "塑化贸易", "HONG KONG", "长期 PP 产品客户", userId.sales, "active", userId.admin, "BEST GAIN");
  insertCustomer.run("佛山市顺德区毅龙贸易有限公司", "中国", "佛山", "塑化贸易", "广东省佛山市顺德区", "成立于 1996 年，主营 PS 经销", userId.sales, "active", userId.admin, "佛山市顺德区毅龙贸易有限公司");
  insertCustomer.run("한화상사", "韩国", "首尔", "化工贸易", "서울특별시", "韩文演示客户", userId.kim, "potential", userId.admin, "한화상사");

  const customers = db
    .prepare("SELECT id, name FROM customers WHERE deleted_at IS NULL")
    .all() as Array<{ id: number; name: string }>;
  const customerId = Object.fromEntries(customers.map((customer) => [customer.name, customer.id]));
  const products = db
    .prepare("SELECT id, grade FROM products")
    .all() as Array<{ id: number; grade: string }>;
  const productId = Object.fromEntries(products.map((product) => [product.grade, product.id]));

  db.prepare(`
    INSERT OR IGNORE INTO customer_members (customer_id, user_id, access)
    VALUES (?, ?, 'view')
  `).run(customerId["BEST GAIN"], userId.kim);

  db.prepare(`
    INSERT INTO contacts (customer_id, name, title, phone, email)
    SELECT ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE customer_id = ? AND name = ?)
  `).run(customerId["BEST GAIN"], "Park Min-su", "采购经理", "+852 5555 1200", "purchasing@bestgain.example", customerId["BEST GAIN"], "Park Min-su");

  const insertVisit = db.prepare(`
    INSERT OR IGNORE INTO visits
      (report_no, title, customer_id, visit_date, internal_participants, customer_participants,
       company_profile, meeting_notes, follow_up, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertVisit.run(
    "VR-20260624-01",
    "拜访佛山市顺德区毅龙贸易有限公司出差报告书",
    customerId["佛山市顺德区毅龙贸易有限公司"],
    "2026-06-24",
    "刘晖、金载敏",
    "李总经理、何德志先生",
    "华南地区 PS 经销与改性材料客户",
    "讨论电容膜材料、PP/PE 新产品及样品测试安排。",
    "确认生产排期，跟进样品需求和采购事宜。",
    "completed",
    userId.sales,
  );
  insertVisit.run(
    "VR-20260701-01",
    "BEST GAIN H1500 价格与船期确认",
    customerId["BEST GAIN"],
    "2026-07-01",
    "刘晖",
    "Park Min-su",
    "香港塑化贸易客户",
    "确认 7 月订单价格和香港到港计划。",
    "跟进 LC/TT 日期及发票信息。",
    "completed",
    userId.sales,
  );

  const visit = db.prepare("SELECT id FROM visits WHERE report_no = ?").get("VR-20260624-01") as { id: number };
  db.prepare("INSERT OR IGNORE INTO visit_products (visit_id, product_id) VALUES (?, ?)").run(visit.id, productId["J-560S"]);

  db.prepare(`
    INSERT INTO opportunities
      (name, customer_id, product_id, stage, estimated_quantity, estimated_amount, currency,
       owner_id, next_action, next_follow_up_date, notes, status, created_by)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?
    WHERE NOT EXISTS (SELECT 1 FROM opportunities WHERE name = ? AND deleted_at IS NULL)
  `).run(
    "毅龙电容膜材料测试",
    customerId["佛山市顺德区毅龙贸易有限公司"],
    productId["J-560S"],
    "testing",
    48,
    63360,
    "USD",
    userId.sales,
    "确认测试结果并安排下一批样品",
    "2026-07-18",
    "客户关注耐高温、超薄膜性能",
    userId.sales,
    "毅龙电容膜材料测试",
  );

  const insertOrder = db.prepare(`
    INSERT OR IGNORE INTO orders
      (order_no, order_date, customer_id, product_id, quantity, price, currency, destination,
       trade_terms, payment_method, shipment_month, lc_tt_date, actual_shipment_date,
       expected_arrival_date, contract_no, invoice_no, status, owner_id, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertOrder.run("SO-20260602-01", "2026-06-02", customerId["BEST GAIN"], productId.H1500, 24, 1230, "HONGKONG", "CFR", "TT AD", "2026-07", "2026-06-10", "2026-07-09", "2026-07-19", "20971598", "40279319", "shipped", userId.sales, "首批订单", userId.sales);
  insertOrder.run("SO-20260619-01", "2026-06-19", customerId["BEST GAIN"], productId.H1500, 24, 1160, "HONGKONG", "CFR", "TT AD", "2026-07", null, "2026-07-15", "2026-07-23", "20973397", "40287964", "confirmed", userId.sales, "", userId.sales);
  insertOrder.run("SO-20260619-02", "2026-06-19", customerId["BEST GAIN"], productId.H1500, 24, 1160, "HONGKONG", "CFR", "TT AD", "2026-07", null, "2026-07-15", "2026-07-23", "20973397", "40287961", "confirmed", userId.sales, "", userId.sales);
  insertOrder.run("SO-20260619-03", "2026-06-19", customerId["BEST GAIN"], productId["J-560S"], 16, 1320, "HONGKONG", "CFR", "TT AD", "2026-07", "2026-06-26", null, null, "20973398", "", "planned", userId.sales, "等待确认船期", userId.sales);
});

seed();
console.log("SQLite database is ready with demo data.");
