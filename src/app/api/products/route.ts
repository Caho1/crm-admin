import { getDb } from "@/db/client";
import { ApiError, created, handleApiError, ok, paginationFrom, parseBody, requireApiAdmin, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { addCondition, searchLike, whereSql } from "@/lib/query";
import { productSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = paginationFrom(searchParams);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (searchParams.get("q")) {
      const value = searchLike(searchParams.get("q"));
      addCondition(conditions, params, "(p.class_name LIKE ? OR p.grade LIKE ? OR p.brand LIKE ? OR p.supplier LIKE ? OR p.application LIKE ?)", value, value, value, value, value);
    }
    if (searchParams.get("status")) addCondition(conditions, params, "p.status = ?", searchParams.get("status"));
    if (searchParams.get("className")) addCondition(conditions, params, "p.class_name = ?", searchParams.get("className"));
    const where = whereSql(conditions);
    const db = getDb();
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM products p ${where}`).get(...params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT p.id, p.class_name AS className, p.grade, p.brand, p.supplier,
        p.application, p.notes, p.status, p.created_at AS createdAt, p.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM opportunities o WHERE o.product_id = p.id AND o.deleted_at IS NULL) AS opportunityCount,
        (SELECT COUNT(*) FROM orders ord WHERE ord.product_id = p.id AND ord.deleted_at IS NULL) AS orderCount
      FROM products p ${where}
      ORDER BY p.class_name, p.grade LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    return ok(rows, { page, pageSize, total });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiAdmin();
    const input = await parseBody(request, productSchema);
    const db = getDb();
    if (db.prepare("SELECT id FROM products WHERE class_name = ? COLLATE NOCASE AND grade = ? COLLATE NOCASE").get(input.className, input.grade)) {
      throw new ApiError(409, "DUPLICATE_PRODUCT", "该产品大类和型号/牌号已存在");
    }
    const result = db.prepare(`
      INSERT INTO products (class_name, grade, brand, supplier, application, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.className, input.grade, input.brand, input.supplier, input.application, input.notes, input.status);
    const id = Number(result.lastInsertRowid);
    writeAudit(user.id, "create", "product", id, `新建产品 ${input.className} / ${input.grade}`);
    return created({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
