import { getDb } from "@/db/client";
import { ApiError, created, handleApiError, ok, paginationFrom, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertCustomerAccess, customerCanEdit, customerScope } from "@/lib/permissions";
import { addCondition, generatedCode, searchLike, whereSql } from "@/lib/query";
import { orderSchema } from "@/lib/validation";

function orderFilters(searchParams: URLSearchParams, user: Awaited<ReturnType<typeof requireApiUser>>) {
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
  return { conditions, params };
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = paginationFrom(searchParams);
    const { conditions, params } = orderFilters(searchParams, user);
    const where = whereSql(conditions);
    const db = getDb();
    const edit = customerCanEdit(user, "c");
    const joins = "FROM orders ord JOIN customers c ON c.id = ord.customer_id JOIN products p ON p.id = ord.product_id";
    const total = (db.prepare(`SELECT COUNT(*) AS count ${joins} ${where}`).get(...params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT ord.id, ord.order_no AS orderNo, ord.order_date AS orderDate,
        ord.customer_id AS customerId, c.name AS customerName,
        ord.product_id AS productId, p.class_name AS className, p.grade,
        ord.quantity, ord.price, ord.currency, ord.destination,
        ord.trade_terms AS tradeTerms, ord.payment_method AS paymentMethod,
        ord.shipment_month AS shipmentMonth, ord.lc_tt_date AS lcTtDate,
        ord.actual_shipment_date AS actualShipmentDate,
        ord.expected_arrival_date AS expectedArrivalDate,
        ord.contract_no AS contractNo, ord.invoice_no AS invoiceNo,
        ord.status, ord.owner_id AS ownerId, owner.name AS ownerName,
        ord.notes, ord.created_at AS createdAt, ord.updated_at AS updatedAt,
        ${edit.sql} AS canEdit
      ${joins} JOIN users owner ON owner.id = ord.owner_id
      ${where}
      ORDER BY ord.order_date DESC, ord.id DESC LIMIT ? OFFSET ?
    `).all(...edit.params, ...params, pageSize, offset);
    return ok(rows, { page, pageSize, total });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = await parseBody(request, orderSchema);
    assertCustomerAccess(user, input.customerId, "edit");
    const db = getDb();
    const orderNo = input.orderNo || generatedCode("SO");
    if (db.prepare("SELECT id FROM orders WHERE order_no = ?").get(orderNo)) throw new ApiError(409, "DUPLICATE_ORDER_NO", "订单编号已存在");
    const ownerId = user.role === "admin" && input.ownerId ? input.ownerId : user.id;
    const result = db.prepare(`
      INSERT INTO orders
        (order_no, order_date, customer_id, product_id, quantity, price, currency,
         destination, trade_terms, payment_method, shipment_month, lc_tt_date,
         actual_shipment_date, expected_arrival_date, contract_no, invoice_no,
         status, owner_id, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderNo, input.orderDate, input.customerId, input.productId, input.quantity,
      input.price, input.currency, input.destination, input.tradeTerms, input.paymentMethod,
      input.shipmentMonth, input.lcTtDate, input.actualShipmentDate, input.expectedArrivalDate,
      input.contractNo, input.invoiceNo, input.status, ownerId, input.notes, user.id);
    const id = Number(result.lastInsertRowid);
    writeAudit(user.id, "create", "order", id, `新建订单 ${orderNo}`);
    return created({ id, orderNo });
  } catch (error) {
    return handleApiError(error);
  }
}
