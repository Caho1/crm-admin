import { getDb } from "@/db/client";
import { ApiError, handleApiError, ok, parseBody, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { handoverSchema } from "@/lib/validation";
import { handoverUserData } from "@/lib/handover";
import type { SessionUser } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = await parseBody(request, handoverSchema);
    if (input.fromUserId === input.toUserId) throw new ApiError(422, "SAME_USER", "交出人和接收人不能相同");
    const db = getDb();
    const users = (await db.prepare("SELECT id, username, name, role, status FROM users WHERE id IN (?, ?)").all(input.fromUserId, input.toUserId)) as SessionUser[];
    const from = users.find((item) => item.id === input.fromUserId);
    const to = users.find((item) => item.id === input.toUserId);
    if (!from || !to) throw new ApiError(404, "NOT_FOUND", "交接用户不存在");
    if (to.status !== "active") throw new ApiError(409, "TARGET_DISABLED", "接收账号必须处于启用状态");

    const counts = await handoverUserData(db, input.fromUserId, to);
    await writeAudit(admin.id, "handover", "user", input.fromUserId, `${from.name} 的数据交接给 ${to.name}：客户 ${counts.customers}，商机 ${counts.opportunities}，订单 ${counts.orders}`);
    return ok(counts);
  } catch (error) {
    return handleApiError(error);
  }
}
