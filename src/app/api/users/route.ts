import bcrypt from "bcryptjs";
import { getDb } from "@/db/client";
import { ApiError, created, handleApiError, ok, paginationFrom, parseBody, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { addCondition, searchLike, whereSql } from "@/lib/query";
import { userSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    await requireApiAdmin();
    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = paginationFrom(searchParams);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (searchParams.get("q")) {
      const value = searchLike(searchParams.get("q"));
      addCondition(conditions, params, "(u.username LIKE ? OR u.name LIKE ?)", value, value);
    }
    if (searchParams.get("role")) addCondition(conditions, params, "u.role = ?", searchParams.get("role"));
    if (searchParams.get("status")) addCondition(conditions, params, "u.status = ?", searchParams.get("status"));
    const where = whereSql(conditions);
    const db = getDb();
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).get(...params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT u.id, u.username, u.name, u.role, u.status, u.locale,
        datetime(u.created_at, '+8 hours') AS createdAt,
        datetime(u.updated_at, '+8 hours') AS updatedAt,
        (SELECT COUNT(*) FROM customers c WHERE c.owner_id = u.id AND c.deleted_at IS NULL) AS customerCount,
        (SELECT COUNT(*) FROM opportunities o WHERE o.owner_id = u.id AND o.deleted_at IS NULL) AS opportunityCount,
        (SELECT COUNT(*) FROM orders ord WHERE ord.owner_id = u.id AND ord.deleted_at IS NULL) AS orderCount
      FROM users u ${where}
      ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.status, u.name
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    return ok(rows, { page, pageSize, total });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = await parseBody(request, userSchema);
    if (!input.password) throw new ApiError(422, "PASSWORD_REQUIRED", "新建用户必须设置初始密码", { password: "请输入至少 8 位的初始密码" });
    const db = getDb();
    if (db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(input.username)) {
      throw new ApiError(409, "DUPLICATE_USERNAME", "该登录账号已存在");
    }
    const result = db.prepare(`
      INSERT INTO users (username, name, password_hash, role, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.username, input.name, await bcrypt.hash(input.password, 12), input.role, input.status);
    const id = Number(result.lastInsertRowid);
    writeAudit(admin.id, "create", "user", id, `新建用户 ${input.name}`);
    return created({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
