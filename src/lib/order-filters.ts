import { customerScope } from "./permissions";
import { addCondition, searchLike } from "./query";
import type { SessionUser } from "./types";

// 订单列表与订单导出共用同一套筛选口径，避免「导出结果 ≠ 当前筛选」
export function buildOrderFilters(searchParams: URLSearchParams, user: SessionUser) {
  const conditions = ["ord.deleted_at IS NULL", "c.deleted_at IS NULL"];
  const params: unknown[] = [];
  const scope = customerScope(user, "c");
  addCondition(conditions, params, scope.sql, ...scope.params);
  if (searchParams.get("q")) {
    const value = searchLike(searchParams.get("q"));
    addCondition(conditions, params, `(
      ord.order_no LIKE ? OR c.name LIKE ? OR p.grade LIKE ? OR p.class_name LIKE ?
      OR ord.contract_no LIKE ? OR ord.invoice_no LIKE ? OR ord.destination LIKE ?
    )`, value, value, value, value, value, value, value);
  }
  if (searchParams.get("status")) addCondition(conditions, params, "ord.status = ?", searchParams.get("status"));
  if (searchParams.get("customerId")) addCondition(conditions, params, "ord.customer_id = ?", Number(searchParams.get("customerId")));
  if (searchParams.get("productId")) addCondition(conditions, params, "ord.product_id = ?", Number(searchParams.get("productId")));
  if (searchParams.get("shipmentMonth")) addCondition(conditions, params, "ord.shipment_month = ?", searchParams.get("shipmentMonth"));
  if (searchParams.get("dateFrom")) addCondition(conditions, params, "ord.order_date >= ?", searchParams.get("dateFrom"));
  if (searchParams.get("dateTo")) addCondition(conditions, params, "ord.order_date <= ?", searchParams.get("dateTo"));
  // 与工作台「14 天内到港」统计卡同一口径：未到港、未取消，且预计到港落在未来 14 天内
  if (searchParams.get("arrivingSoon") === "1") {
    addCondition(
      conditions,
      params,
      "ord.status NOT IN ('arrived', 'cancelled') AND ord.expected_arrival_date BETWEEN date('now', '+8 hours') AND date('now', '+8 hours', '+14 day')",
    );
  }
  return { conditions, params };
}
