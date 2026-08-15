import type Database from "better-sqlite3";
import bcrypt from "bcryptjs";

/**
 * 首次建库时的种子数据（演示账号 + 演示业务数据）。
 * 幂等：全部使用 INSERT OR IGNORE / NOT EXISTS 语义，重复执行不会产生重复数据。
 * 构建期由 scripts/setup-db.ts 调用；运行期由 src/db/client.ts 在检测到空库时调用。
 */
export function seedDatabase(db: Database.Database) {
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

    // 竞品对标牌号演示数据：一个自家牌号可以挂多条竞品
    const insertCompetitor = db.prepare(`
      INSERT INTO product_competitors (product_id, grade, manufacturer, notes, sort_order)
      SELECT p.id, ?, ?, ?, ?
      FROM products p
      WHERE p.class_name = ? AND p.grade = ?
        AND NOT EXISTS (
          SELECT 1 FROM product_competitors pc WHERE pc.product_id = p.id AND pc.grade = ?
        )
    `);
    insertCompetitor.run("CJS700", "广州石化", "熔指相近，注塑件表面光泽略低", 0, "PP", "H1500", "CJS700");
    insertCompetitor.run("T30S", "中石化茂名", "通用拉丝料，价格更低", 1, "PP", "H1500", "T30S");
    insertCompetitor.run("PPH-T03", "中石油大庆", "刚性接近，气味控制稍弱", 2, "PP", "H1500", "PPH-T03");
    insertCompetitor.run("F800E", "上海赛科", "薄膜级对标牌号", 0, "PP", "J-560S", "F800E");
    insertCompetitor.run("GPPS-123P", "中新化工", "透明度相当，交期更短", 0, "PS", "GPPS-525", "GPPS-123P");

    const insertCustomer = db.prepare(`
      INSERT INTO customers
        (name, country, region, industry, address, description, owner_id, status, created_by)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = ? AND deleted_at IS NULL)
    `);
    insertCustomer.run("BEST GAIN", "中国", "香港", "塑化贸易", "HONG KONG", "长期 PP 产品客户", userId.sales, "active", userId.admin, "BEST GAIN");
    insertCustomer.run("佛山市顺德区毅龙贸易有限公司", "中国", "佛山", "塑化贸易", "广东省佛山市顺德区容桂街道", "成立于 1996 年，主营 PS 经销", userId.sales, "active", userId.admin, "佛山市顺德区毅龙贸易有限公司");
    insertCustomer.run("한화상사", "韩国", "首尔", "化工贸易", "서울특별시", "韩文演示客户", userId.kim, "potential", userId.admin, "한화상사");
    insertCustomer.run("中山市新塑包装材料有限公司", "中国", "中山", "包装制品", "广东省中山市小榄镇工业大道 18 号", "薄膜与包装材料生产厂，主用 PE / PP", userId.sales, "active", userId.admin, "中山市新塑包装材料有限公司");
    insertCustomer.run("东莞市宏发注塑制品厂", "中国", "东莞", "注塑加工", "广东省东莞市长安镇沙头工业区", "家电外壳注塑，PP / ABS 用量稳定", userId.kim, "active", userId.admin, "东莞市宏发注塑制品厂");

    // 老库里的演示客户建于新增字段之前，只补空值，不覆盖任何已录入内容
    const fillBlank = db.prepare(`
      UPDATE customers
      SET name_en = CASE WHEN name_en = '' THEN ? ELSE name_en END,
          category = CASE WHEN category = '' THEN ? ELSE category END,
          short_name = CASE WHEN short_name = '' THEN ? ELSE short_name END
      WHERE name = ? AND deleted_at IS NULL
    `);
    fillBlank.run("BEST GAIN TRADING CO., LTD.", "trader", "BEST GAIN", "BEST GAIN");
    fillBlank.run("Foshan Shunde Yilong Trading Co., Ltd.", "integrated", "毅龙贸易", "佛山市顺德区毅龙贸易有限公司");
    fillBlank.run("Hanwha Corporation", "factory", "한화상사", "한화상사");
    fillBlank.run("Zhongshan Xinsu Packaging Material Co., Ltd.", "factory", "新塑包装", "中山市新塑包装材料有限公司");
    fillBlank.run("Dongguan Hongfa Injection Molding Factory", "factory", "宏发注塑", "东莞市宏发注塑制品厂");

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
      INSERT INTO contacts (customer_id, name, name_en, title, phone, email, personality, sort_order)
      SELECT ?, ?, ?, ?, ?, ?, ?, 0
      -- 老库里这条演示联系人是以英文名建的，两个名字都要认，避免重复播种
      WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE customer_id = ? AND name IN (?, ?))
    `).run(
      customerId["BEST GAIN"],
      "朴敏洙",
      "Park Min-su",
      "采购经理",
      "+852 5555 1200",
      "purchasing@bestgain.example",
      "做事细致，看重交期与稳定供货；爱好登山、喜欢喝咖啡聊天",
      customerId["BEST GAIN"],
      "朴敏洙",
      "Park Min-su",
    );

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

    // ---- 演示用批量订单 ----
    // 固定种子的伪随机：每次生成同一批数据，配合 order_no 的 INSERT OR IGNORE 保证幂等，
    // 反复执行 db:setup 不会重复插入，也不会让图表数字来回跳。
    const rand = (() => {
      let seedValue = 20260805;
      return () => {
        seedValue |= 0;
        seedValue = (seedValue + 0x6d2b79f5) | 0;
        let t = Math.imul(seedValue ^ (seedValue >>> 15), 1 | seedValue);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
    const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);
    const iso = (date: Date) => date.toISOString().slice(0, 10);

    const demoCustomers = [
      "BEST GAIN",
      "佛山市顺德区毅龙贸易有限公司",
      "中山市新塑包装材料有限公司",
      "东莞市宏发注塑制品厂",
      "한화상사",
    ].filter((name) => customerId[name]);
    const demoProducts = Object.keys(productId);
    const destinations = ["HONGKONG", "SHENZHEN", "NINGBO", "BUSAN", "SHANGHAI"];
    const owners = [userId.sales, userId.kim];

    // 从今天往回 12 个月，每月 5-9 单，覆盖全部履约状态
    const today = new Date("2026-08-05T00:00:00Z");
    let sequence = 0;
    for (let monthsAgo = 11; monthsAgo >= 0; monthsAgo -= 1) {
      const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, 1));
      const ordersThisMonth = 5 + Math.floor(rand() * 5);
      for (let index = 0; index < ordersThisMonth; index += 1) {
        // 当月只取到今天为止，避免出现"未来下单"的订单
        const maxDay = monthsAgo === 0 ? today.getUTCDate() - 1 : 27;
        if (maxDay < 0) continue;
        const orderDate = addDays(monthStart, Math.floor(rand() * (maxDay + 1)));
        if (orderDate > today) continue;
        sequence += 1;
        const orderNo = `SO-${iso(orderDate).replaceAll("-", "")}-D${String(sequence).padStart(3, "0")}`;
        const grade = pick(demoProducts);
        const quantity = [16, 20, 24, 32, 48][Math.floor(rand() * 5)];
        const price = 980 + Math.floor(rand() * 620);
        // 近三个月压缩船期，让「待出货 / 14 天内到港」这类在途看板有真实数据
        const recent = monthsAgo <= 2;
        const shipLead = recent ? 25 + Math.floor(rand() * 25) : 20 + Math.floor(rand() * 20);
        const shipDate = addDays(orderDate, shipLead);
        const arriveDate = addDays(shipDate, recent ? 5 + Math.floor(rand() * 10) : 7 + Math.floor(rand() * 14));

        // 状态按时间推进：早期订单已到港，临近今天的还在待确认/待出货
        let status: string;
        if (arriveDate < today) status = rand() < 0.12 ? "cancelled" : "arrived";
        else if (shipDate < today) status = "shipped";
        else if (orderDate < addDays(today, -10)) status = "confirmed";
        else status = "planned";

        insertOrder.run(
          orderNo,
          iso(orderDate),
          customerId[pick(demoCustomers)],
          productId[grade],
          quantity,
          price,
          pick(destinations),
          pick(["CFR", "FOB", "CIF"]),
          pick(["TT AD", "LC 30D", "TT 30D"]),
          iso(shipDate).slice(0, 7),
          rand() < 0.6 ? iso(addDays(orderDate, 8)) : null,
          status === "shipped" || status === "arrived" ? iso(shipDate) : null,
          status === "planned" ? null : iso(arriveDate),
          `CT${240000 + sequence}`,
          status === "arrived" ? `INV${480000 + sequence}` : "",
          status,
          pick(owners),
          "",
          userId.admin,
        );
      }
    }

    // 标签字典放在最后：默认项 + 把历史自由文本（产品大类、行业）登记成字典项，
    // 否则老数据在改成下拉后会因为选项里没有对应值而显示为空。
    const insertDict = db.prepare(`
      INSERT OR IGNORE INTO dict_items (type, code, label, label_en, label_ko, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const defaultDicts: Array<[string, string, string, string, string, number]> = [
      ["customer_category", "factory", "工厂", "Factory", "공장", 10],
      ["customer_category", "trader", "贸易商", "Trader", "무역상", 20],
      ["customer_category", "integrated", "工贸一体", "Factory + Trader", "공장 겸 무역상", 30],
      ["product_class", "PP", "PP", "PP", "PP", 10],
      ["product_class", "PE", "PE", "PE", "PE", 20],
      ["product_class", "PC", "PC", "PC", "PC", 30],
      ["product_class", "EVA", "EVA", "EVA", "EVA", 40],
    ];
    for (const item of defaultDicts) insertDict.run(...item);

    const backfill = (type: string, sql: string, offset: number) => {
      const values = db.prepare(sql).all() as Array<{ value: string }>;
      for (const [index, row] of values.entries()) {
        insertDict.run(type, row.value, row.value, row.value, row.value, offset + index);
      }
    };
    backfill("product_class", "SELECT DISTINCT class_name AS value FROM products WHERE class_name <> ''", 100);
  });

  seed();
}
