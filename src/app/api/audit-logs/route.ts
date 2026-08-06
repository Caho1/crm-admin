import { getDb } from "@/db/client";
import { handleApiError, ok, paginationFrom, requireApiAdmin } from "@/lib/api";
import { addCondition, searchLike, whereSql } from "@/lib/query";

export async function GET(request: Request) {
  try {
    await requireApiAdmin();
    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = paginationFrom(searchParams);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (searchParams.get("q")) {
      const value = searchLike(searchParams.get("q"));
      addCondition(conditions, params, "(a.summary LIKE ? OR a.action LIKE ? OR a.entity_type LIKE ? OR u.name LIKE ?)", value, value, value, value);
    }
    if (searchParams.get("action")) addCondition(conditions, params, "a.action = ?", searchParams.get("action"));
    const where = whereSql(conditions);
    const db = getDb();
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where}`).get(...params) as { count: number }).count;
    // 对象列要显示具体名称而不是 dict_item #53：按 entity_type 回表取业务名称，
    // 记录已被删除时取不到名称，前端回退成 #id
    const rows = db.prepare(`
      SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
        a.summary, datetime(a.created_at, '+8 hours') AS createdAt, u.name AS userName,
        CASE a.entity_type
          WHEN 'customer' THEN (SELECT name FROM customers WHERE id = a.entity_id)
          WHEN 'order' THEN (SELECT order_no FROM orders WHERE id = a.entity_id)
          WHEN 'product' THEN (SELECT class_name || ' / ' || grade FROM products WHERE id = a.entity_id)
          WHEN 'visit' THEN (SELECT title FROM visits WHERE id = a.entity_id)
          WHEN 'opportunity' THEN (SELECT name FROM opportunities WHERE id = a.entity_id)
          WHEN 'dict_item' THEN (SELECT label FROM dict_items WHERE id = a.entity_id)
          WHEN 'user' THEN (SELECT name FROM users WHERE id = a.entity_id)
        END AS entityName
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where}
      ORDER BY a.id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    return ok(rows, { page, pageSize, total });
  } catch (error) {
    return handleApiError(error);
  }
}
