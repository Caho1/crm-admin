import bcrypt from "bcryptjs";
import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, parseBody, requireApiAdmin } from "@/lib/api";
import { invalidateUserSessions } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { resetPasswordSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const admin = await requireApiAdmin();
    const id = integerId((await context.params).id);
    const input = await parseBody(request, resetPasswordSchema);
    const db = getDb();
    const target = db.prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string } | undefined;
    if (!target) throw new ApiError(404, "NOT_FOUND", "用户不存在");
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(await bcrypt.hash(input.password, 12), id);
    invalidateUserSessions(id);
    writeAudit(admin.id, "reset_password", "user", id, `重置 ${target.name} 的密码`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
