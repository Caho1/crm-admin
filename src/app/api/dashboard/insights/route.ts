import { getDb } from "@/db/client";
import { handleApiError, ok, requireApiUser } from "@/lib/api";
import { customerScope } from "@/lib/permissions";

/**
 * 工作台的结构性看板数据（不随趋势粒度变化，单独取）：
 * 客户分类构成看客户画像，热销牌号仍按订单金额看具体走量。
 * 客户分类返回原始 code，标签由前端按标签字典 + 当前语言解析（与其它页面同一套口径）。
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const scope = customerScope(user, "c");

    const customerCategory = db
      .prepare(`
        SELECT c.category AS code, COUNT(*) AS count
        FROM customers c
        WHERE c.deleted_at IS NULL AND ${scope.sql}
        GROUP BY c.category
        ORDER BY count DESC
      `)
      .all(...scope.params) as Array<{ code: string; count: number }>;

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
      customerCategory,
      topGrades: topGrades.map((row) => ({ ...row, amount: Math.round(row.amount) })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
