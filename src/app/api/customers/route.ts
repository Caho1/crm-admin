import { getDb } from "@/db/client";
import { ApiError, created, handleApiError, ok, paginationFrom, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { customerCanEdit, customerScope } from "@/lib/permissions";
import { addCondition, searchLike, searchTerms, whereSql } from "@/lib/query";
import { customerSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = paginationFrom(searchParams);
    const conditions = ["c.deleted_at IS NULL"];
    const params: unknown[] = [];
    const scope = customerScope(user, "c");
    addCondition(conditions, params, scope.sql, ...scope.params);
    // 关键词按空格拆分，词与词之间是「并且」，每个词在下列字段里任意命中即可：
    // 中英文名 / 地址 / 国家 / 地区 / 简介、负责人与协作成员姓名、联系人姓名电话邮箱、
    // 以及分类和行业的标签文案（这两列存的是 code，要回字典表按标签反查）
    for (const term of searchTerms(searchParams.get("q"))) {
      const value = searchLike(term);
      addCondition(
        conditions,
        params,
        `(
          c.name LIKE ? OR c.name_en LIKE ? OR c.address LIKE ? OR c.country LIKE ?
          OR c.region LIKE ? OR c.description LIKE ? OR c.industry LIKE ? OR c.category LIKE ?
          OR EXISTS (SELECT 1 FROM users u WHERE u.id = c.owner_id AND u.name LIKE ?)
          OR EXISTS (
            SELECT 1 FROM customer_members cm JOIN users mu ON mu.id = cm.user_id
            WHERE cm.customer_id = c.id AND mu.name LIKE ?
          )
          OR EXISTS (
            SELECT 1 FROM contacts ct WHERE ct.customer_id = c.id
              AND (ct.name LIKE ? OR ct.title LIKE ? OR ct.phone LIKE ? OR ct.email LIKE ?)
          )
          OR EXISTS (
            SELECT 1 FROM dict_items d
            WHERE d.type IN ('customer_category', 'industry')
              AND d.code IN (c.category, c.industry)
              AND (d.label LIKE ? OR d.label_en LIKE ? OR d.label_ko LIKE ?)
          )
        )`,
        ...Array<string>(17).fill(value),
      );
    }
    if (searchParams.get("status")) {
      addCondition(conditions, params, "c.status = ?", searchParams.get("status"));
    }
    if (searchParams.get("category")) {
      addCondition(conditions, params, "c.category = ?", searchParams.get("category"));
    }
    if (searchParams.get("industry")) {
      addCondition(conditions, params, "c.industry = ?", searchParams.get("industry"));
    }
    if (searchParams.get("ownerId")) {
      addCondition(conditions, params, "c.owner_id = ?", Number(searchParams.get("ownerId")));
    }
    const where = whereSql(conditions);
    const db = getDb();
    const edit = customerCanEdit(user, "c");
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM customers c ${where}`).get(...params) as { count: number }).count;
    const rows = db
      .prepare(`
        SELECT c.id, c.name, c.name_en AS nameEn, c.category, c.country, c.region,
          c.industry, c.address, c.description,
          c.owner_id AS ownerId, owner.name AS ownerName, c.status,
          c.created_at AS createdAt, c.updated_at AS updatedAt,
          (SELECT GROUP_CONCAT(u.name, '、') FROM customer_members cm
           JOIN users u ON u.id = cm.user_id WHERE cm.customer_id = c.id) AS memberNames,
          (SELECT MAX(v.visit_date) FROM visits v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) AS latestVisitDate,
          (SELECT COUNT(*) FROM opportunities o WHERE o.customer_id = c.id AND o.deleted_at IS NULL) AS opportunityCount,
          (SELECT COUNT(*) FROM orders ord WHERE ord.customer_id = c.id AND ord.deleted_at IS NULL) AS orderCount,
          ${edit.sql} AS canEdit
        FROM customers c
        JOIN users owner ON owner.id = c.owner_id
        ${where}
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...edit.params, ...params, pageSize, offset);
    return ok(rows, { page, pageSize, total });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = await parseBody(request, customerSchema);
    const db = getDb();
    const duplicate = db
      .prepare("SELECT id FROM customers WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL")
      .get(input.name);
    if (duplicate) throw new ApiError(409, "DUPLICATE_CUSTOMER", "已存在同名客户，请先检查客户列表");
    const ownerId = user.role === "admin" && input.ownerId ? input.ownerId : user.id;

    const result = db.transaction(() => {
      const inserted = db.prepare(`
        INSERT INTO customers
          (name, name_en, category, country, region, industry, address, description, owner_id, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.name, input.nameEn, input.category, input.country, input.region, input.industry, input.address, input.description, ownerId, input.status, user.id);
      const customerId = Number(inserted.lastInsertRowid);
      const memberInsert = db.prepare(`
        INSERT OR IGNORE INTO customer_members (customer_id, user_id, access) VALUES (?, ?, 'view')
      `);
      if (user.role === "admin") {
        for (const memberId of input.memberIds) {
          if (memberId !== ownerId) memberInsert.run(customerId, memberId);
        }
      }
      if (input.contactName) {
        db.prepare(`
          INSERT INTO contacts (customer_id, name, title, phone, email) VALUES (?, ?, ?, ?, ?)
        `).run(customerId, input.contactName, input.contactTitle, input.contactPhone, input.contactEmail);
      }
      return customerId;
    })();
    writeAudit(user.id, "create", "customer", result, `新建客户 ${input.name}`);
    return created({ id: result });
  } catch (error) {
    return handleApiError(error);
  }
}
