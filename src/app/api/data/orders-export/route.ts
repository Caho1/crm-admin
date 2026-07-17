import ExcelJS from "exceljs";
import { getDb } from "@/db/client";
import { handleApiError, requireApiUser } from "@/lib/api";
import { orderExcelColumns, styleOrderSheet } from "@/lib/excel";
import { customerScope } from "@/lib/permissions";
import { addCondition, searchLike, whereSql } from "@/lib/query";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);
    const conditions = ["ord.deleted_at IS NULL", "c.deleted_at IS NULL"];
    const params: unknown[] = [];
    const scope = customerScope(user, "c");
    addCondition(conditions, params, scope.sql, ...scope.params);
    if (searchParams.get("q")) {
      const value = searchLike(searchParams.get("q"));
      addCondition(conditions, params, "(ord.order_no LIKE ? OR c.name LIKE ? OR p.grade LIKE ? OR ord.contract_no LIKE ? OR ord.invoice_no LIKE ?)", value, value, value, value, value);
    }
    if (searchParams.get("status")) addCondition(conditions, params, "ord.status = ?", searchParams.get("status"));
    if (searchParams.get("customerId")) addCondition(conditions, params, "ord.customer_id = ?", Number(searchParams.get("customerId")));
    if (searchParams.get("productId")) addCondition(conditions, params, "ord.product_id = ?", Number(searchParams.get("productId")));
    if (searchParams.get("shipmentMonth")) addCondition(conditions, params, "ord.shipment_month = ?", searchParams.get("shipmentMonth"));
    const rows = getDb().prepare(`
      SELECT ord.order_no AS orderNo, ord.order_date AS orderDate, c.name AS customerName,
        p.class_name AS className, p.grade, ord.quantity, ord.price, ord.currency,
        ord.destination, ord.trade_terms AS tradeTerms, ord.payment_method AS paymentMethod,
        ord.shipment_month AS shipmentMonth, ord.lc_tt_date AS lcTtDate,
        ord.actual_shipment_date AS actualShipmentDate,
        ord.expected_arrival_date AS expectedArrivalDate, ord.contract_no AS contractNo,
        ord.invoice_no AS invoiceNo, ord.status
      FROM orders ord JOIN customers c ON c.id = ord.customer_id
      JOIN products p ON p.id = ord.product_id
      ${whereSql(conditions)} ORDER BY ord.order_date DESC, ord.id DESC
    `).all(...params);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("订单出货到港");
    worksheet.columns = [...orderExcelColumns];
    for (const row of rows) worksheet.addRow(row);
    styleOrderSheet(worksheet);
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=orders-${new Date().toISOString().slice(0, 10)}.xlsx`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
