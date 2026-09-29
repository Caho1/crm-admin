import { getDb } from "@/db/client";
import { ApiError, handleApiError, ok, parseBody, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { handoverSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = await parseBody(request, handoverSchema);
    if (input.fromUserId === input.toUserId) throw new ApiError(422, "SAME_USER", "交出人和接收人不能相同");
    const db = getDb();
    const users = (await db.prepare("SELECT id, name, status FROM users WHERE id IN (?, ?)").all(input.fromUserId, input.toUserId)) as Array<{ id: number; name: string; status: string }>;
    const from = users.find((item) => item.id === input.fromUserId);
    const to = users.find((item) => item.id === input.toUserId);
    if (!from || !to) throw new ApiError(404, "NOT_FOUND", "交接用户不存在");
    if (to.status !== "active") throw new ApiError(409, "TARGET_DISABLED", "接收账号必须处于启用状态");

    const counts = (await db.transaction(async () => {
      const customers = (await db.prepare("UPDATE customers SET owner_id = ?, updated_at = datetime('now') WHERE owner_id = ? AND deleted_at IS NULL").run(input.toUserId, input.fromUserId)).changes;
      const opportunities = (await db.prepare("UPDATE opportunities SET owner_id = ?, updated_at = datetime('now') WHERE owner_id = ? AND deleted_at IS NULL").run(input.toUserId, input.fromUserId)).changes;
      const orders = (await db.prepare("UPDATE orders SET owner_id = ?, updated_at = datetime('now') WHERE owner_id = ? AND deleted_at IS NULL").run(input.toUserId, input.fromUserId)).changes;
      await db.prepare("DELETE FROM customer_members WHERE user_id = ? AND customer_id IN (SELECT id FROM customers WHERE owner_id = ?)").run(input.toUserId, input.toUserId);
      return { customers, opportunities, orders };
    })());
    await writeAudit(admin.id, "handover", "user", input.fromUserId, `${from.name} 的数据交接给 ${to.name}：客户 ${counts.customers}，商机 ${counts.opportunities}，订单 ${counts.orders}`);
    return ok(counts);
  } catch (error) {
    return handleApiError(error);
  }
}
