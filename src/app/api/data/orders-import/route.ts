import ExcelJS from "exceljs";
import { getDb } from "@/db/client";
import { ApiError, handleApiError, ok, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { generatedCode } from "@/lib/query";
import { IMPORT_FILE_PATTERN, headerAliases, normalizeHeader, parseExcelDate, parseExcelNumber, parseShipmentMonth, readUploadWorksheet } from "@/lib/excel";

export const runtime = "nodejs";

type ImportedOrder = {
  /** 订单编号在库里已存在 → 更新那条订单；否则新建 */
  mode: "create" | "update";
  id: number | null;
  orderNo: string;
  orderDate: string;
  customerId: number;
  customerName: string;
  productId: number;
  className: string;
  grade: string;
  quantity: number;
  price: number;
  /** 以下可选列留空表示「不改」：新建时落默认值，更新时保持库里原值 */
  currency: string | null;
  destination: string | null;
  tradeTerms: string | null;
  paymentMethod: string | null;
  shipmentMonth: string | null;
  lcTtDate: string | null;
  actualShipmentDate: string | null;
  expectedArrivalDate: string | null;
  contractNo: string | null;
  invoiceNo: string | null;
  status: string | null;
};

function valueOf(row: ExcelJS.Row, mapping: Record<string, number>, field: string) {
  const column = mapping[field];
  if (!column) return null;
  const value = row.getCell(column).value;
  if (value && typeof value === "object" && "text" in value) return String(value.text);
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}

// 状态列同时接受英文代码与中文标签；其余非空值视为错误而不是静默回退
const STATUS_ALIASES: Record<string, string> = {
  planned: "planned",
  待确认: "planned",
  confirmed: "confirmed",
  待出货: "confirmed",
  shipped: "shipped",
  已出货: "shipped",
  arrived: "arrived",
  已到港: "arrived",
  cancelled: "cancelled",
  已取消: "cancelled",
};

// 状态留空返回 null：新建时按是否已出货推断，更新时保持库里原状态
function parseStatus(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return { status: null as string | null, invalid: null as string | null };
  const mapped = STATUS_ALIASES[text] ?? STATUS_ALIASES[text.toLowerCase()];
  return mapped ? { status: mapped, invalid: null } : { status: null as string | null, invalid: text };
}

/** 可选文本列：留空返回 null，代表这一列不参与写入 */
function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const form = await request.formData();
    const file = form.get("file");
    const commit = form.get("commit") === "true";
    if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "请选择导入文件");
    if (file.size > 5 * 1024 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", "导入文件不能超过 5MB");
    if (!IMPORT_FILE_PATTERN.test(file.name)) throw new ApiError(422, "INVALID_FILE_TYPE", "仅支持 .xlsx 或 .csv 文件");

    const worksheet = await readUploadWorksheet(file);
    if (!worksheet || worksheet.rowCount < 2) throw new ApiError(422, "EMPTY_SHEET", "文件中没有可导入的数据");

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
      // 可选日期列：填了但解析不出来必须报错，不能静默导入为空
      const optionalDate = (field: string, label: string) => {
        const raw = valueOf(row, mapping, field);
        if (raw === null || String(raw).trim() === "") return null;
        const parsed = parseExcelDate(raw);
        if (!parsed) rowErrors.push(`${label}格式无效`);
        return parsed;
      };
      const lcTtDate = optionalDate("lcTtDate", "LC/TT 日期");
      const actualShipmentDate = optionalDate("actualShipmentDate", "实际出货日期");
      const expectedArrivalDate = optionalDate("expectedArrivalDate", "预计到港日期");
      const shipmentMonthRaw = valueOf(row, mapping, "shipmentMonth");
      const shipmentMonth = shipmentMonthRaw === null || String(shipmentMonthRaw).trim() === ""
        ? null
        : parseShipmentMonth(shipmentMonthRaw, orderDate);
      if (shipmentMonthRaw !== null && String(shipmentMonthRaw).trim() !== "" && !shipmentMonth) rowErrors.push("出货月份格式无效");
      const { status, invalid: invalidStatus } = parseStatus(valueOf(row, mapping, "status"));
      if (invalidStatus) rowErrors.push(`状态“${invalidStatus}”无效（可用：待确认 / 待出货 / 已出货 / 已到港 / 已取消）`);
      const suppliedOrderNo = String(valueOf(row, mapping, "orderNo") ?? "").trim();
      // 与界面建单同一口径：不区分大小写；编号已存在则更新那条订单（已软删的编号视为已释放，重新建单）
      const existing = suppliedOrderNo
        ? (db.prepare("SELECT id FROM orders WHERE order_no = ? COLLATE NOCASE AND deleted_at IS NULL").get(suppliedOrderNo) as { id: number } | undefined)
        : undefined;
      if (suppliedOrderNo && seenOrderNos.has(suppliedOrderNo.toLowerCase())) rowErrors.push(`订单编号“${suppliedOrderNo}”在文件中重复`);
      if (suppliedOrderNo) seenOrderNos.add(suppliedOrderNo.toLowerCase());
      if (rowErrors.length) {
        errors.push({ row: rowNumber, message: rowErrors.join("；") });
        continue;
      }
      validRows.push({
        mode: existing ? "update" : "create",
        id: existing?.id ?? null,
        orderNo: suppliedOrderNo || generatedCode("SO"),
        orderDate: orderDate!,
        customerId: customer!.id,
        customerName: customer!.name,
        productId: product!.id,
        className: product!.className,
        grade: product!.grade,
        quantity: quantity!,
        price: price!,
        currency: optionalText(valueOf(row, mapping, "currency")),
        destination: optionalText(valueOf(row, mapping, "destination")),
        tradeTerms: optionalText(valueOf(row, mapping, "tradeTerms")),
        paymentMethod: optionalText(valueOf(row, mapping, "paymentMethod")),
        shipmentMonth,
        lcTtDate,
        actualShipmentDate,
        expectedArrivalDate,
        contractNo: optionalText(valueOf(row, mapping, "contractNo")),
        invoiceNo: optionalText(valueOf(row, mapping, "invoiceNo")),
        status,
      });
    }

    const createCount = validRows.filter((row) => row.mode === "create").length;
    const updateCount = validRows.length - createCount;

    if (!commit || errors.length) {
      return ok({
        valid: errors.length === 0,
        totalRows: validRows.length + errors.length,
        validCount: validRows.length,
        createCount,
        updateCount,
        errors,
        preview: validRows.slice(0, 20),
      });
    }

    db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO orders
          (order_no, order_date, customer_id, product_id, quantity, price, currency,
           destination, trade_terms, payment_method, shipment_month, lc_tt_date,
           actual_shipment_date, expected_arrival_date, contract_no, invoice_no,
           status, owner_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
      `);
      // 可选列 → 数据库列，更新时只写文件里填了的
      const optionalColumns: Array<[keyof ImportedOrder, string]> = [
        ["currency", "currency"],
        ["destination", "destination"],
        ["tradeTerms", "trade_terms"],
        ["paymentMethod", "payment_method"],
        ["shipmentMonth", "shipment_month"],
        ["lcTtDate", "lc_tt_date"],
        ["actualShipmentDate", "actual_shipment_date"],
        ["expectedArrivalDate", "expected_arrival_date"],
        ["contractNo", "contract_no"],
        ["invoiceNo", "invoice_no"],
        ["status", "status"],
      ];
      for (const row of validRows) {
        if (row.mode === "create") {
          const owner = db.prepare("SELECT owner_id AS ownerId FROM customers WHERE id = ?").get(row.customerId) as { ownerId: number };
          insert.run(row.orderNo, row.orderDate, row.customerId, row.productId, row.quantity,
            row.price, row.currency ?? "USD", row.destination ?? "", row.tradeTerms ?? "", row.paymentMethod ?? "",
            row.shipmentMonth, row.lcTtDate, row.actualShipmentDate, row.expectedArrivalDate,
            row.contractNo ?? "", row.invoiceNo ?? "", row.status ?? (row.actualShipmentDate ? "shipped" : "planned"),
            owner.ownerId, admin.id);
          continue;
        }
        // 更新：必填列（日期 / 客户 / 产品 / 数量 / 单价）总是覆盖，负责人和备注保持不动
        const assignments = ["order_date = ?", "customer_id = ?", "product_id = ?", "quantity = ?", "price = ?"];
        const params: unknown[] = [row.orderDate, row.customerId, row.productId, row.quantity, row.price];
        for (const [field, column] of optionalColumns) {
          const value = row[field];
          if (value === null || value === undefined) continue;
          assignments.push(`${column} = ?`);
          params.push(value);
        }
        assignments.push("updated_at = datetime('now')");
        db.prepare(`UPDATE orders SET ${assignments.join(", ")} WHERE id = ?`).run(...params, row.id);
      }
    })();
    writeAudit(admin.id, "import", "order", null, `从 ${file.name} 导入订单：新增 ${createCount} 条，更新 ${updateCount} 条`);
    return ok({ valid: true, imported: validRows.length, createCount, updateCount, errors: [] });
  } catch (error) {
    return handleApiError(error);
  }
}
