import bcrypt from "bcryptjs";
import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, parseBody, requireApiAdmin } from "@/lib/api";
import { invalidateUserSessions } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { userSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const admin = await requireApiAdmin();
    const id = integerId((await context.params).id);
    const input = await parseBody(request, userSchema);
    const db = getDb();
    const current = db.prepare("SELECT id, username, name, role, status FROM users WHERE id = ?").get(id) as
      | { id: number; username: string; name: string; role: "admin" | "user"; status: "active" | "disabled" }
      | undefined;
    if (!current) throw new ApiError(404, "NOT_FOUND", "用户不存在");
    if (id === admin.id && (input.status === "disabled" || input.role !== "admin")) {
      throw new ApiError(409, "CANNOT_DISABLE_SELF", "不能停用当前登录账号或取消自己的管理员权限");
    }
    if (db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?").get(input.username, id)) {
      throw new ApiError(409, "DUPLICATE_USERNAME", "该登录账号已存在");
    }
    if (current.role === "admin" && (input.role !== "admin" || input.status === "disabled")) {
      const count = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get() as { count: number }).count;
      if (count <= 1) throw new ApiError(409, "LAST_ADMIN", "系统必须至少保留一个启用的管理员账号");
    }
    if (input.password) {
      db.prepare(`
        UPDATE users SET username = ?, name = ?, password_hash = ?, role = ?, status = ?,
          updated_at = datetime('now') WHERE id = ?
      `).run(input.username, input.name, await bcrypt.hash(input.password, 12), input.role, input.status, id);
    } else {
      db.prepare(`
        UPDATE users SET username = ?, name = ?, role = ?, status = ?,
          updated_at = datetime('now') WHERE id = ?
      `).run(input.username, input.name, input.role, input.status, id);
    }
    if (input.password || input.status === "disabled") invalidateUserSessions(id);
    writeAudit(admin.id, "update", "user", id, `更新用户 ${input.name}`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
