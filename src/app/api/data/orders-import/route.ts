import ExcelJS from "exceljs";
import { getDb } from "@/db/client";
import { ApiError, handleApiError, ok, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { generatedCode } from "@/lib/query";
import { headerAliases, normalizeHeader, parseExcelDate, parseExcelNumber, parseShipmentMonth } from "@/lib/excel";

export const runtime = "nodejs";

type ImportedOrder = {
  orderNo: string;
  orderDate: string;
  customerId: number;
  customerName: string;
  productId: number;
  className: string;
  grade: string;
  quantity: number;
  price: number;
  currency: string;
  destination: string;
  tradeTerms: string;
  paymentMethod: string;
  shipmentMonth: string | null;
  lcTtDate: string | null;
  actualShipmentDate: string | null;
  expectedArrivalDate: string | null;
  contractNo: string;
  invoiceNo: string;
  status: string;
};

function valueOf(row: ExcelJS.Row, mapping: Record<string, number>, field: string) {
  const column = mapping[field];
  if (!column) return null;
  const value = row.getCell(column).value;
  if (value && typeof value === "object" && "text" in value) return String(value.text);
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const form = await request.formData();
    const file = form.get("file");
    const commit = form.get("commit") === "true";
    if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "请选择 Excel 文件");
    if (file.size > 5 * 1024 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", "Excel 文件不能超过 5MB");
    if (!/\.xlsx$/i.test(file.name)) throw new ApiError(422, "INVALID_FILE_TYPE", "仅支持 .xlsx 文件");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) throw new ApiError(422, "EMPTY_SHEET", "Excel 中没有可导入的数据");

    const headerRow = worksheet.getRow(1);
    const mapping: Record<string, number> = {};
    headerRow.eachCell((cell, column) => {
      const normalized = normalizeHeader(cell.value);
      for (const [field, aliases] of Object.entries(headerAliases)) {
        if (aliases.includes(normalized)) mapping[field] = column;
      }
    });
    const required = ["orderDate", "customerName", "className", "grade", "quantity", "price"];
    const missing = required.filter((field) => !mapping[field]);
    if (missing.length) throw new ApiError(422, "MISSING_COLUMNS", `缺少必要列：${missing.join(", ")}`);

    const db = getDb();
    const errors: Array<{ row: number; message: string }> = [];
    const validRows: ImportedOrder[] = [];
    const seenOrderNos = new Set<string>();
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const rawCustomer = String(valueOf(row, mapping, "customerName") ?? "").trim();
      const rawClass = String(valueOf(row, mapping, "className") ?? "").trim();
      const rawGrade = String(valueOf(row, mapping, "grade") ?? "").trim();
      if (!rawCustomer && !rawClass && !rawGrade) continue;

      const rowErrors: string[] = [];
      const orderDate = parseExcelDate(valueOf(row, mapping, "orderDate"));
      const customer = db.prepare("SELECT id, name FROM customers WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL").get(rawCustomer) as { id: number; name: string } | undefined;
      const product = db.prepare("SELECT id, class_name AS className, grade FROM products WHERE class_name = ? COLLATE NOCASE AND grade = ? COLLATE NOCASE").get(rawClass, rawGrade) as { id: number; className: string; grade: string } | undefined;
      const quantity = parseExcelNumber(valueOf(row, mapping, "quantity"));
      const price = parseExcelNumber(valueOf(row, mapping, "price"));
      if (!orderDate) rowErrors.push("下单日期无效");
      if (!customer) rowErrors.push(`客户“${rawCustomer}”不存在`);
      if (!product) rowErrors.push(`产品“${rawClass} / ${rawGrade}”不存在`);
      if (quantity === null || quantity <= 0) rowErrors.push("数量必须大于 0");
      if (price === null || price < 0) rowErrors.push("单价不能小于 0");
      const suppliedOrderNo = String(valueOf(row, mapping, "orderNo") ?? "").trim();
      if (suppliedOrderNo && db.prepare("SELECT id FROM orders WHERE order_no = ?").get(suppliedOrderNo)) rowErrors.push(`订单编号“${suppliedOrderNo}”已存在`);
      if (suppliedOrderNo && seenOrderNos.has(suppliedOrderNo.toLowerCase())) rowErrors.push(`订单编号“${suppliedOrderNo}”在文件中重复`);
      if (suppliedOrderNo) seenOrderNos.add(suppliedOrderNo.toLowerCase());
      if (rowErrors.length) {
        errors.push({ row: rowNumber, message: rowErrors.join("；") });
        continue;
      }
      const actualShipmentDate = parseExcelDate(valueOf(row, mapping, "actualShipmentDate"));
      const statusInput = String(valueOf(row, mapping, "status") ?? "").trim();
      const status = ["planned", "confirmed", "shipped", "arrived", "cancelled"].includes(statusInput)
        ? statusInput
        : actualShipmentDate
          ? "shipped"
          : "planned";
      validRows.push({
        orderNo: suppliedOrderNo || generatedCode("SO"),
        orderDate: orderDate!,
        customerId: customer!.id,
        customerName: customer!.name,
        productId: product!.id,
        className: product!.className,
        grade: product!.grade,
        quantity: quantity!,
        price: price!,
        currency: String(valueOf(row, mapping, "currency") ?? "USD").trim() || "USD",
        destination: String(valueOf(row, mapping, "destination") ?? "").trim(),
        tradeTerms: String(valueOf(row, mapping, "tradeTerms") ?? "").trim(),
        paymentMethod: String(valueOf(row, mapping, "paymentMethod") ?? "").trim(),
        shipmentMonth: parseShipmentMonth(valueOf(row, mapping, "shipmentMonth"), orderDate),
        lcTtDate: parseExcelDate(valueOf(row, mapping, "lcTtDate")),
        actualShipmentDate,
        expectedArrivalDate: parseExcelDate(valueOf(row, mapping, "expectedArrivalDate")),
        contractNo: String(valueOf(row, mapping, "contractNo") ?? "").trim(),
        invoiceNo: String(valueOf(row, mapping, "invoiceNo") ?? "").trim(),
        status,
      });
    }

    if (!commit || errors.length) {
      return ok({ valid: errors.length === 0, totalRows: validRows.length + errors.length, validCount: validRows.length, errors, preview: validRows.slice(0, 20) });
    }

    const inserted = db.transaction(() => {
      const statement = db.prepare(`
        INSERT INTO orders
          (order_no, order_date, customer_id, product_id, quantity, price, currency,
           destination, trade_terms, payment_method, shipment_month, lc_tt_date,
           actual_shipment_date, expected_arrival_date, contract_no, invoice_no,
           status, owner_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
      `);
      for (const row of validRows) {
        const owner = db.prepare("SELECT owner_id AS ownerId FROM customers WHERE id = ?").get(row.customerId) as { ownerId: number };
        statement.run(row.orderNo, row.orderDate, row.customerId, row.productId, row.quantity,
          row.price, row.currency, row.destination, row.tradeTerms, row.paymentMethod,
          row.shipmentMonth, row.lcTtDate, row.actualShipmentDate, row.expectedArrivalDate,
          row.contractNo, row.invoiceNo, row.status, owner.ownerId, admin.id);
      }
      return validRows.length;
    })();
    writeAudit(admin.id, "import", "order", null, `从 ${file.name} 导入 ${inserted} 条订单`);
    return ok({ valid: true, imported: inserted, errors: [] });
  } catch (error) {
    return handleApiError(error);
  }
}
