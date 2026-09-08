import { getDb } from "@/db/client";
import { handleApiError, ok, requireApiUser } from "@/lib/api";
import { customerScope } from "@/lib/permissions";

export async function GET() {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const scope = customerScope(user, "c");
    const scalar = (sql: string, extra: unknown[] = []) => {
      const row = db.prepare(sql).get(...extra, ...scope.params) as { count: number };
      return row.count;
    };

    // 币种口径的两张卡（USD 销售 / 人民币采购）统计口径一致，抽成一个函数
    const currencyOrdersThisMonth = (currency: string) => {
      const row = db.prepare(`
        SELECT COUNT(*) AS count, COALESCE(SUM(ord.quantity), 0) AS quantity
        FROM orders ord JOIN customers c ON c.id = ord.customer_id
        WHERE ord.deleted_at IS NULL AND ord.status <> 'cancelled' AND ord.currency = ?
          AND strftime('%Y-%m', ord.order_date) = strftime('%Y-%m', 'now', '+8 hours')
          AND ${scope.sql}
      `).get(currency, ...scope.params) as { count: number; quantity: number };
      return row;
    };

    const stats = {
      customers: scalar(`
        SELECT COUNT(*) AS count FROM customers c
        WHERE c.deleted_at IS NULL AND ${scope.sql}
      `),
      // "开发" 是订单性质字典里固定不变的 code（建后不可改），与「设置 → 标签配置」里的默认种子数据对应
      developingProjects: scalar(`
        SELECT COUNT(*) AS count FROM orders ord
        JOIN customers c ON c.id = ord.customer_id
        WHERE ord.deleted_at IS NULL AND ord.order_nature = '开发'
          AND ${scope.sql}
      `),
      usdOrders: currencyOrdersThisMonth("USD"),
      cnyOrders: currencyOrdersThisMonth("CNY"),
    };

    const recentVisits = db
      .prepare(`
        SELECT v.id, v.report_no AS reportNo, v.title, v.visit_date AS visitDate,
          v.status, v.customer_id AS customerId, c.name AS customerName, u.name AS creatorName
        FROM visits v
        JOIN customers c ON c.id = v.customer_id
        JOIN users u ON u.id = v.created_by
        WHERE v.deleted_at IS NULL AND c.deleted_at IS NULL AND ${scope.sql}
        ORDER BY v.visit_date DESC, v.id DESC
        LIMIT 6
      `)
      .all(...scope.params);

    const shipmentAlerts = db
      .prepare(`
        SELECT ord.id, ord.order_no AS orderNo, c.name AS customerName,
          ord.customer_id AS customerId, p.class_name AS className, p.grade, ord.status,
          ord.actual_shipment_date AS actualShipmentDate,
          ord.expected_arrival_date AS expectedArrivalDate
        FROM orders ord
        JOIN customers c ON c.id = ord.customer_id
        JOIN products p ON p.id = ord.product_id
        WHERE ord.deleted_at IS NULL AND c.deleted_at IS NULL
          AND ord.status NOT IN ('arrived', 'cancelled') AND ${scope.sql}
        ORDER BY COALESCE(ord.expected_arrival_date, '9999-12-31'), ord.order_date DESC
        LIMIT 6
      `)
      .all(...scope.params);

    // 订单趋势改由 /api/dashboard/trend 按粒度单独提供

    return ok({ stats, recentVisits, shipmentAlerts });
  } catch (error) {
    return handleApiError(error);
  }
}
