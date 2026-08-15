import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { listContacts, saveContacts } from "@/lib/contacts";
import { assertCustomerAccess } from "@/lib/permissions";
import { attachCompetitors } from "@/lib/products";
import { customerSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    const access = assertCustomerAccess(user, id, "view");
    // 详情页据此决定是否显示拜访的新建 / 编辑 / 删除按钮
    // （仅管理员、负责人、可编辑协作成员）
    const canEdit = user.role === "admin" || access.ownerId === user.id || access.memberAccess === "edit";
    const db = getDb();
    const customer = db.prepare(`
      SELECT c.id, c.name, c.name_en AS nameEn, c.short_name AS shortName, c.category, c.country, c.region,
        c.industry, c.address, c.description,
        c.owner_id AS ownerId, owner.name AS ownerName, c.status,
        c.created_at AS createdAt, c.updated_at AS updatedAt
      FROM customers c JOIN users owner ON owner.id = c.owner_id
      WHERE c.id = ? AND c.deleted_at IS NULL
    `).get(id);
    if (!customer) throw new ApiError(404, "NOT_FOUND", "客户不存在或已删除");
    const contacts = listContacts(db, id);
    const members = db.prepare(`
      SELECT u.id, u.name, cm.access FROM customer_members cm
      JOIN users u ON u.id = cm.user_id WHERE cm.customer_id = ? ORDER BY u.name
    `).all(id);
    // 拜访列表由客户页内的 CustomerVisits 自行分页拉取（/api/visits?customerId=），此处不再内联
    // 订单履约概要随详情一次返回，页头直接展示，不依赖订单列表接口
    const orderStatusRows = db.prepare(`
      SELECT status, COUNT(*) AS count FROM orders
      WHERE customer_id = ? AND deleted_at IS NULL GROUP BY status
    `).all(id) as Array<{ status: string; count: number }>;
    const orderStatusCounts = Object.fromEntries(orderStatusRows.map((row) => [row.status, row.count]));
    // 竞品列表：客户下过单或在谈的我方产品，各自挂着的竞争型号。
    // 竞品维护在产品档案里，这里只按客户实际用到的产品聚合，不额外录入。
    const relatedProducts = db.prepare(`
      SELECT p.id, p.class_name AS className, p.grade,
        (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id AND o.customer_id = ? AND o.deleted_at IS NULL) AS orderCount
      FROM products p
      WHERE p.id IN (
        SELECT product_id FROM orders WHERE customer_id = ? AND deleted_at IS NULL
        UNION
        SELECT product_id FROM opportunities WHERE customer_id = ? AND deleted_at IS NULL AND product_id IS NOT NULL
      )
      ORDER BY orderCount DESC, p.class_name, p.grade
    `).all(id, id, id) as Array<{ id: number; className: string; grade: string; orderCount: number }>;
    const competitorProducts = attachCompetitors(db, relatedProducts);
    return ok({ customer, contacts, members, canEdit, orderStatusCounts, competitorProducts });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertCustomerAccess(user, id, "edit");
    const input = await parseBody(request, customerSchema);
    const db = getDb();
    const duplicate = db.prepare(`
      SELECT id FROM customers WHERE name = ? COLLATE NOCASE AND id <> ? AND deleted_at IS NULL
    `).get(input.name, id);
    if (duplicate) throw new ApiError(409, "DUPLICATE_CUSTOMER", "已存在同名客户，请先检查客户列表");
    const current = db.prepare("SELECT owner_id AS ownerId FROM customers WHERE id = ?").get(id) as { ownerId: number };
    const ownerId = user.role === "admin" && input.ownerId ? input.ownerId : current.ownerId;
    db.transaction(() => {
      db.prepare(`
        UPDATE customers SET name = ?, name_en = ?, short_name = ?, category = ?, country = ?, region = ?,
          industry = ?, address = ?, description = ?, owner_id = ?, status = ?,
          updated_at = datetime('now') WHERE id = ?
      `).run(input.name, input.nameEn, input.shortName, input.category, input.country, input.region, input.industry, input.address, input.description, ownerId, input.status, id);
      if (user.role === "admin") {
        // 保留已有成员的 access 等级，避免 edit 权限被重置成 view
        const existing = db.prepare("SELECT user_id AS userId, access FROM customer_members WHERE customer_id = ?").all(id) as Array<{ userId: number; access: string }>;
        const accessOf = new Map(existing.map((member) => [member.userId, member.access]));
        db.prepare("DELETE FROM customer_members WHERE customer_id = ?").run(id);
        const insert = db.prepare("INSERT OR IGNORE INTO customer_members (customer_id, user_id, access) VALUES (?, ?, ?)");
        for (const memberId of input.memberIds) if (memberId !== ownerId) insert.run(id, memberId, accessOf.get(memberId) || "view");
      }
      saveContacts(db, id, input.contacts);
    })();
    writeAudit(user.id, "update", "customer", id, `更新客户 ${input.name}`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertCustomerAccess(user, id, "edit");
    const db = getDb();
    const row = db.prepare("SELECT name FROM customers WHERE id = ? AND deleted_at IS NULL").get(id) as { name: string } | undefined;
    if (!row) throw new ApiError(404, "NOT_FOUND", "客户不存在或已删除");
    db.prepare("UPDATE customers SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    writeAudit(user.id, "delete", "customer", id, `删除客户 ${row.name}`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
