import { getDb } from "@/db/client";
import { ApiError, created, handleApiError, ok, paginationFrom, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { buildOrderFilters } from "@/lib/order-filters";
import { assertCustomerAccess, customerCanEdit } from "@/lib/permissions";
import { uniqueCode, whereSql } from "@/lib/query";
import { orderSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = paginationFrom(searchParams);
    const { conditions, params } = buildOrderFilters(searchParams, user);
    const where = whereSql(conditions);
    const db = getDb();
    const edit = customerCanEdit(user, "c");
    const joins = "FROM orders ord JOIN customers c ON c.id = ord.customer_id JOIN products p ON p.id = ord.product_id";
    const total = (db.prepare(`SELECT COUNT(*) AS count ${joins} ${where}`).get(...params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT ord.id, ord.order_no AS orderNo, ord.order_date AS orderDate,
        ord.customer_id AS customerId, c.name AS customerName,
        ord.product_id AS productId, p.class_name AS className, p.grade,
        ord.quantity, ord.price, ord.quantity * ord.price AS amount, ord.currency, ord.destination,
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
    // 履约概要按当前筛选口径统计全量，不受分页影响
    const statusRows = db
      .prepare(`SELECT ord.status AS status, COUNT(*) AS count ${joins} ${where} GROUP BY ord.status`)
      .all(...params) as Array<{ status: string; count: number }>;
    const statusCounts = Object.fromEntries(statusRows.map((row) => [row.status, row.count]));
    return ok(rows, { page, pageSize, total, statusCounts });
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
    // 外键前置校验：产品不存在时返回 422 字段错误，而不是 SQLite 外键违例的 500
    if (!db.prepare("SELECT id FROM products WHERE id = ?").get(input.productId)) {
      throw new ApiError(422, "PRODUCT_NOT_FOUND", "产品不存在", { productId: "产品不存在" });
    }
    const orderNo = input.orderNo || uniqueCode("SO", (code) =>
      Boolean(db.prepare("SELECT id FROM orders WHERE order_no = ?").get(code)),
    );
    // 业务编号查重不区分大小写；已软删的记录在删除时已释放编号，不参与查重
    if (db.prepare("SELECT id FROM orders WHERE order_no = ? COLLATE NOCASE AND deleted_at IS NULL").get(orderNo)) {
      throw new ApiError(409, "DUPLICATE_ORDER_NO", "订单编号已存在");
    }
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
