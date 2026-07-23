import ExcelJS from "exceljs";
import { getDb } from "@/db/client";
import { handleApiError, requireApiUser } from "@/lib/api";
import { orderExcelColumns, styleOrderSheet } from "@/lib/excel";
import { buildOrderFilters } from "@/lib/order-filters";
import { whereSql } from "@/lib/query";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);
    // 与订单列表共用筛选构造函数，保证「导出当前筛选」口径一致（含日期范围与 14 天内到港）
    const { conditions, params } = buildOrderFilters(searchParams, user);
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
