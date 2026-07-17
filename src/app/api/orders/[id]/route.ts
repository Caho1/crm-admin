import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertCustomerAccess, assertResourceAccess } from "@/lib/permissions";
import { generatedCode } from "@/lib/query";
import { orderSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertResourceAccess(user, "orders", id, "edit");
    const input = await parseBody(request, orderSchema);
    assertCustomerAccess(user, input.customerId, "edit");
    const db = getDb();
    const current = db.prepare("SELECT order_no AS orderNo, owner_id AS ownerId FROM orders WHERE id = ?").get(id) as { orderNo: string; ownerId: number } | undefined;
    if (!current) throw new ApiError(404, "NOT_FOUND", "订单不存在");
    const orderNo = input.orderNo || current.orderNo || generatedCode("SO");
    if (db.prepare("SELECT id FROM orders WHERE order_no = ? AND id <> ?").get(orderNo, id)) throw new ApiError(409, "DUPLICATE_ORDER_NO", "订单编号已存在");
    const ownerId = user.role === "admin" && input.ownerId ? input.ownerId : current.ownerId;
    db.prepare(`
      UPDATE orders SET order_no = ?, order_date = ?, customer_id = ?, product_id = ?,
        quantity = ?, price = ?, currency = ?, destination = ?, trade_terms = ?,
        payment_method = ?, shipment_month = ?, lc_tt_date = ?, actual_shipment_date = ?,
        expected_arrival_date = ?, contract_no = ?, invoice_no = ?, status = ?,
        owner_id = ?, notes = ?, updated_at = datetime('now') WHERE id = ?
    `).run(orderNo, input.orderDate, input.customerId, input.productId, input.quantity,
      input.price, input.currency, input.destination, input.tradeTerms, input.paymentMethod,
      input.shipmentMonth, input.lcTtDate, input.actualShipmentDate, input.expectedArrivalDate,
      input.contractNo, input.invoiceNo, input.status, ownerId, input.notes, id);
    writeAudit(user.id, "update", "order", id, `更新订单 ${orderNo}`);
    return ok({ id, orderNo });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertResourceAccess(user, "orders", id, "edit");
    const db = getDb();
    const row = db.prepare("SELECT order_no AS orderNo FROM orders WHERE id = ?").get(id) as { orderNo: string };
    db.prepare("UPDATE orders SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    writeAudit(user.id, "delete", "order", id, `删除订单 ${row.orderNo}`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
