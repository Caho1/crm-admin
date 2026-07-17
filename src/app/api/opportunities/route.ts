import { getDb } from "@/db/client";
import { created, handleApiError, ok, paginationFrom, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertCustomerAccess, customerCanEdit, customerScope } from "@/lib/permissions";
import { addCondition, searchLike, whereSql } from "@/lib/query";
import { opportunitySchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = paginationFrom(searchParams);
    const conditions = ["o.deleted_at IS NULL", "c.deleted_at IS NULL"];
    const params: unknown[] = [];
    const scope = customerScope(user, "c");
    addCondition(conditions, params, scope.sql, ...scope.params);
    if (searchParams.get("q")) {
      const value = searchLike(searchParams.get("q"));
      addCondition(conditions, params, "(o.name LIKE ? OR c.name LIKE ? OR o.next_action LIKE ? OR p.grade LIKE ?)", value, value, value, value);
    }
    if (searchParams.get("stage")) addCondition(conditions, params, "o.stage = ?", searchParams.get("stage"));
    if (searchParams.get("status")) addCondition(conditions, params, "o.status = ?", searchParams.get("status"));
    if (searchParams.get("customerId")) addCondition(conditions, params, "o.customer_id = ?", Number(searchParams.get("customerId")));
    if (searchParams.get("productId")) addCondition(conditions, params, "o.product_id = ?", Number(searchParams.get("productId")));
    const where = whereSql(conditions);
    const db = getDb();
    const edit = customerCanEdit(user, "c");
    const total = (db.prepare(`
      SELECT COUNT(*) AS count FROM opportunities o
      JOIN customers c ON c.id = o.customer_id LEFT JOIN products p ON p.id = o.product_id ${where}
    `).get(...params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT o.id, o.name, o.customer_id AS customerId, c.name AS customerName,
        o.product_id AS productId, p.class_name AS className, p.grade,
        o.stage, o.estimated_quantity AS estimatedQuantity,
        o.estimated_amount AS estimatedAmount, o.currency,
        o.owner_id AS ownerId, owner.name AS ownerName,
        o.next_action AS nextAction, o.next_follow_up_date AS nextFollowUpDate,
        o.notes, o.status, o.created_at AS createdAt, o.updated_at AS updatedAt,
        ${edit.sql} AS canEdit
      FROM opportunities o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN products p ON p.id = o.product_id
      JOIN users owner ON owner.id = o.owner_id
      ${where}
      ORDER BY CASE WHEN o.next_follow_up_date IS NULL THEN 1 ELSE 0 END,
        o.next_follow_up_date, o.updated_at DESC LIMIT ? OFFSET ?
    `).all(...edit.params, ...params, pageSize, offset);
    return ok(rows, { page, pageSize, total });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = await parseBody(request, opportunitySchema);
    assertCustomerAccess(user, input.customerId, "edit");
    const ownerId = user.role === "admin" && input.ownerId ? input.ownerId : user.id;
    const result = getDb().prepare(`
      INSERT INTO opportunities
        (name, customer_id, product_id, stage, estimated_quantity, estimated_amount, currency,
         owner_id, next_action, next_follow_up_date, notes, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.name, input.customerId, input.productId || null, input.stage,
      input.estimatedQuantity ?? null, input.estimatedAmount ?? null, input.currency,
      ownerId, input.nextAction, input.nextFollowUpDate, input.notes, input.status, user.id);
    const id = Number(result.lastInsertRowid);
    writeAudit(user.id, "create", "opportunity", id, `新建商机 ${input.name}`);
    return created({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
