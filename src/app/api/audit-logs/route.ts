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
    const rows = db.prepare(`
      SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
        a.summary, datetime(a.created_at, '+8 hours') AS createdAt, u.name AS userName
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where}
      ORDER BY a.id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    return ok(rows, { page, pageSize, total });
  } catch (error) {
    return handleApiError(error);
  }
}
