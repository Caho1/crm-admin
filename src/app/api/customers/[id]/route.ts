import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertCustomerAccess } from "@/lib/permissions";
import { customerSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertCustomerAccess(user, id, "view");
    const db = getDb();
    const customer = db.prepare(`
      SELECT c.id, c.name, c.country, c.region, c.industry, c.address, c.description,
        c.owner_id AS ownerId, owner.name AS ownerName, c.status,
        c.created_at AS createdAt, c.updated_at AS updatedAt
      FROM customers c JOIN users owner ON owner.id = c.owner_id
      WHERE c.id = ? AND c.deleted_at IS NULL
    `).get(id);
    if (!customer) throw new ApiError(404, "NOT_FOUND", "客户不存在或已删除");
    const contacts = db.prepare("SELECT id, name, title, phone, email FROM contacts WHERE customer_id = ? ORDER BY id").all(id);
    const members = db.prepare(`
      SELECT u.id, u.name, cm.access FROM customer_members cm
      JOIN users u ON u.id = cm.user_id WHERE cm.customer_id = ? ORDER BY u.name
    `).all(id);
    const visits = db.prepare(`
      SELECT id, report_no AS reportNo, title, visit_date AS visitDate, status
      FROM visits WHERE customer_id = ? AND deleted_at IS NULL ORDER BY visit_date DESC LIMIT 20
    `).all(id);
    const opportunities = db.prepare(`
      SELECT o.id, o.name, o.stage, o.estimated_amount AS estimatedAmount, o.currency,
        p.class_name AS className, p.grade, o.next_follow_up_date AS nextFollowUpDate
      FROM opportunities o LEFT JOIN products p ON p.id = o.product_id
      WHERE o.customer_id = ? AND o.deleted_at IS NULL ORDER BY o.updated_at DESC LIMIT 20
    `).all(id);
    const orders = db.prepare(`
      SELECT ord.id, ord.order_no AS orderNo, ord.order_date AS orderDate, ord.quantity,
        ord.price, ord.quantity * ord.price AS amount, ord.currency, ord.status, p.class_name AS className, p.grade,
        ord.actual_shipment_date AS actualShipmentDate,
        ord.expected_arrival_date AS expectedArrivalDate
      FROM orders ord JOIN products p ON p.id = ord.product_id
      WHERE ord.customer_id = ? AND ord.deleted_at IS NULL ORDER BY ord.order_date DESC LIMIT 20
    `).all(id);
    // 页签数量展示真实总数（列表本身最多返回 20 条）
    const countOf = (sql: string) => (db.prepare(sql).get(id) as { count: number }).count;
    const counts = {
      visits: countOf("SELECT COUNT(*) AS count FROM visits WHERE customer_id = ? AND deleted_at IS NULL"),
      opportunities: countOf("SELECT COUNT(*) AS count FROM opportunities WHERE customer_id = ? AND deleted_at IS NULL"),
      orders: countOf("SELECT COUNT(*) AS count FROM orders WHERE customer_id = ? AND deleted_at IS NULL"),
    };
    return ok({ customer, contacts, members, visits, opportunities, orders, counts });
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
        UPDATE customers SET name = ?, country = ?, region = ?, industry = ?, address = ?,
          description = ?, owner_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?
      `).run(input.name, input.country, input.region, input.industry, input.address, input.description, ownerId, input.status, id);
      if (user.role === "admin") {
        // 保留已有成员的 access 等级，避免 edit 权限被重置成 view
        const existing = db.prepare("SELECT user_id AS userId, access FROM customer_members WHERE customer_id = ?").all(id) as Array<{ userId: number; access: string }>;
        const accessOf = new Map(existing.map((member) => [member.userId, member.access]));
        db.prepare("DELETE FROM customer_members WHERE customer_id = ?").run(id);
        const insert = db.prepare("INSERT OR IGNORE INTO customer_members (customer_id, user_id, access) VALUES (?, ?, ?)");
        for (const memberId of input.memberIds) if (memberId !== ownerId) insert.run(id, memberId, accessOf.get(memberId) || "view");
      }
      const firstContact = db.prepare("SELECT id FROM contacts WHERE customer_id = ? ORDER BY id LIMIT 1").get(id) as { id: number } | undefined;
      if (input.contactName) {
        if (firstContact) {
          db.prepare("UPDATE contacts SET name = ?, title = ?, phone = ?, email = ? WHERE id = ?")
            .run(input.contactName, input.contactTitle, input.contactPhone, input.contactEmail, firstContact.id);
        } else {
          db.prepare("INSERT INTO contacts (customer_id, name, title, phone, email) VALUES (?, ?, ?, ?, ?)")
            .run(id, input.contactName, input.contactTitle, input.contactPhone, input.contactEmail);
        }
      } else if (firstContact) {
        db.prepare("DELETE FROM contacts WHERE id = ?").run(firstContact.id);
      }
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
