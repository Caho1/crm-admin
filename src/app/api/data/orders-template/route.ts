import ExcelJS from "exceljs";
import { handleApiError, requireApiUser } from "@/lib/api";
import { orderExcelColumns, styleOrderSheet } from "@/lib/excel";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireApiUser();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("订单导入模板");
    worksheet.columns = [...orderExcelColumns];
    worksheet.addRow({
      orderNo: "SO-20260701-01",
      orderDate: "2026-07-01",
      customerName: "BEST GAIN",
      className: "PP",
      grade: "H1500",
      quantity: 24,
      price: 1230,
      currency: "USD",
      destination: "HONGKONG",
      tradeTerms: "CFR",
      paymentMethod: "TT AD",
      shipmentMonth: "2026-07",
      lcTtDate: "2026-06-10",
      actualShipmentDate: "2026-07-09",
      expectedArrivalDate: "2026-07-19",
      contractNo: "20971598",
      invoiceNo: "40279319",
      status: "shipped",
    });
    styleOrderSheet(worksheet);
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=order-import-template.xlsx",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
