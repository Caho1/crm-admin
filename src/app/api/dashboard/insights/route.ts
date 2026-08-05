import { getDb } from "@/db/client";
import { handleApiError, ok, requireApiUser } from "@/lib/api";
import { customerScope } from "@/lib/permissions";

/**
 * 工作台的结构性看板数据（不随趋势粒度变化，单独取）：
 * 目前提供产品维度的分布——按大类看材料结构，按牌号看具体走量。
 * 统一排除已取消订单，口径与金额趋势一致。
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const scope = customerScope(user, "c");

    const productClass = db
      .prepare(`
        SELECT p.class_name AS name,
          COUNT(*) AS orderCount,
          COALESCE(SUM(ord.quantity), 0) AS quantity,
          COALESCE(SUM(ord.quantity * ord.price), 0) AS amount
        FROM orders ord
        JOIN customers c ON c.id = ord.customer_id
        JOIN products p ON p.id = ord.product_id
        WHERE ord.deleted_at IS NULL AND ord.status <> 'cancelled' AND ${scope.sql}
        GROUP BY p.class_name
        ORDER BY amount DESC
      `)
      .all(...scope.params) as Array<{ name: string; orderCount: number; quantity: number; amount: number }>;

    const topGrades = db
      .prepare(`
        SELECT p.class_name || ' / ' || p.grade AS name,
          COUNT(*) AS orderCount,
          COALESCE(SUM(ord.quantity), 0) AS quantity,
          COALESCE(SUM(ord.quantity * ord.price), 0) AS amount
        FROM orders ord
        JOIN customers c ON c.id = ord.customer_id
        JOIN products p ON p.id = ord.product_id
        WHERE ord.deleted_at IS NULL AND ord.status <> 'cancelled' AND ${scope.sql}
        GROUP BY p.id
        ORDER BY amount DESC
        LIMIT 8
      `)
      .all(...scope.params) as Array<{ name: string; orderCount: number; quantity: number; amount: number }>;

    return ok({
      productClass: productClass.map((row) => ({ ...row, amount: Math.round(row.amount) })),
      topGrades: topGrades.map((row) => ({ ...row, amount: Math.round(row.amount) })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
