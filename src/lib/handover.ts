import type { Database } from "@/db/client";
import { ApiError } from "./api";
import { customerScope } from "./permissions";
import type { SessionUser } from "./types";

/** 不扩大客户授权；接收后不可见的订单/商机阻止整个交接，包括已删除客户的记录。 */
export async function handoverUserData(db: Database, fromUserId: number, to: SessionUser) {
  return db.transaction(async () => {
    const scope = customerScope(to, "c");
    const conflicts = await db.prepare(`
      SELECT c.id, c.name FROM customers c
      WHERE (
        EXISTS (SELECT 1 FROM orders ord WHERE ord.customer_id = c.id AND ord.owner_id = ? AND ord.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM opportunities opp WHERE opp.customer_id = c.id AND opp.owner_id = ? AND opp.deleted_at IS NULL)
      ) AND (c.deleted_at IS NOT NULL OR (c.owner_id <> ? AND NOT ${scope.sql}))
      ORDER BY c.id
    `).all(fromUserId, fromUserId, fromUserId, ...scope.params) as Array<{ id: number; name: string }>;
    if (conflicts.length) {
      const names = conflicts.slice(0, 5).map((customer) => `${customer.name} (#${customer.id})`).join("、");
      throw new ApiError(409, "HANDOVER_ACCESS_CONFLICT", `交接未执行：接收人无法访问 ${conflicts.length} 个关联客户的订单或商机：${names}。请先检查客户是否已删除，或由管理员调整必要的客户协作权限后重试。`);
    }
    const customers = (await db.prepare("UPDATE customers SET owner_id = ?, updated_at = datetime('now') WHERE owner_id = ? AND deleted_at IS NULL").run(to.id, fromUserId)).changes;
    const opportunities = (await db.prepare("UPDATE opportunities SET owner_id = ?, updated_at = datetime('now') WHERE owner_id = ? AND deleted_at IS NULL").run(to.id, fromUserId)).changes;
    const orders = (await db.prepare("UPDATE orders SET owner_id = ?, updated_at = datetime('now') WHERE owner_id = ? AND deleted_at IS NULL").run(to.id, fromUserId)).changes;
    await db.prepare("DELETE FROM customer_members WHERE user_id = ? AND customer_id IN (SELECT id FROM customers WHERE owner_id = ?)").run(to.id, to.id);
    return { customers, opportunities, orders };
  })();
}
