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

    const stats = {
      customers: scalar(`
        SELECT COUNT(*) AS count FROM customers c
        WHERE c.deleted_at IS NULL AND ${scope.sql}
      `),
      visitsThisMonth: scalar(`
        SELECT COUNT(*) AS count FROM visits v
        JOIN customers c ON c.id = v.customer_id
        WHERE v.deleted_at IS NULL
          AND strftime('%Y-%m', v.visit_date) = strftime('%Y-%m', 'now', '+8 hours')
          AND ${scope.sql}
      `),
      opportunities: scalar(`
        SELECT COUNT(*) AS count FROM opportunities o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.deleted_at IS NULL AND o.status = 'active'
          AND o.stage NOT IN ('order', 'lost') AND ${scope.sql}
      `),
      ordersThisMonth: scalar(`
        SELECT COUNT(*) AS count FROM orders ord
        JOIN customers c ON c.id = ord.customer_id
        WHERE ord.deleted_at IS NULL
          AND strftime('%Y-%m', ord.order_date) = strftime('%Y-%m', 'now', '+8 hours')
          AND ${scope.sql}
      `),
      pendingShipment: scalar(`
        SELECT COUNT(*) AS count FROM orders ord
        JOIN customers c ON c.id = ord.customer_id
        WHERE ord.deleted_at IS NULL AND ord.status IN ('planned', 'confirmed')
          AND ${scope.sql}
      `),
      arrivingSoon: scalar(`
        SELECT COUNT(*) AS count FROM orders ord
        JOIN customers c ON c.id = ord.customer_id
        WHERE ord.deleted_at IS NULL AND ord.status NOT IN ('arrived', 'cancelled')
          AND ord.expected_arrival_date BETWEEN date('now', '+8 hours') AND date('now', '+8 hours', '+14 day')
          AND ${scope.sql}
      `),
    };

    const recentVisits = db
      .prepare(`
        SELECT v.id, v.report_no AS reportNo, v.title, v.visit_date AS visitDate,
          v.status, c.name AS customerName, u.name AS creatorName
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
          p.class_name AS className, p.grade, ord.status,
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

    return ok({ stats, recentVisits, shipmentAlerts });
  } catch (error) {
    return handleApiError(error);
  }
}
