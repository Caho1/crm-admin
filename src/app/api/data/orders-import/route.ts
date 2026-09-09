import ExcelJS from "exceljs";
import type Database from "better-sqlite3";
import { getDb } from "@/db/client";
import { ApiError, handleApiError, ok, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { finalizeSequentialCode, sequentialPlaceholder } from "@/lib/query";
import type { SessionUser } from "@/lib/types";
import { IMPORT_FILE_PATTERN, headerAliases, normalizeHeader, parseExcelDate, parseExcelNumber, parseShipmentMonth, readUploadWorksheet } from "@/lib/excel";

export const runtime = "nodejs";

/** #N/A、#REF! 这类公式错误值当空处理——源表里用 VLOOKUP 填的列常有查不到的行 */
function isErrorValue(value: unknown) {
  return Boolean(value && typeof value === "object" && "error" in value);
}

/** Excel 单元格值 → 纯文本：富文本、公式结果、日期都要能正确取到，不能落成 [object Object] */
function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (isErrorValue(value)) return "";
  if (typeof value === "object" && "richText" in value) {
    return (value.richText as Array<{ text: string }>).map((part) => part.text).join("").trim();
  }
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  if (typeof value === "object" && "result" in value) {
    return isErrorValue(value.result) ? "" : String(value.result ?? "").trim();
  }
  return String(value).trim();
}


type ImportedOrder = {
  /** Excel 行号：预检表格按行勾选、提交时按行号过滤都要用它 */
  rowNumber: number;
  /** 订单编号在库里已存在 → 更新那条订单；否则新建 */
  mode: "create" | "update";
  /** 同一个订单编号在文件里出现了不止一次：不拦截，只在预检表格里标红 */
  duplicate: boolean;
  id: number | null;
  /** null = 留空，等真正写库时用这条订单自己的自增 id 当编号 */
  orderNo: string | null;
  orderDate: string;
  customerId: number;
  customerName: string;
  productId: number;
  className: string;
  grade: string;
  /** 用途（용도）：写在订单行上，但它是牌号的属性，落库时回填到 products.application */
  application: string | null;
  quantity: number;
  price: number;
  /** 以下可选列留空表示「不改」：新建时落默认值，更新时保持库里原值 */
  currency: string | null;
  orderNature: string | null;
  productionBase: string | null;
  /** 跟进人（P.I.C）：纯文本，不解析成系统账号 */
  pic: string | null;
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
  notes: string | null;
};

type ProductRef = { className: string; grade: string };

type PreviewRow = {
  row: number;
  cells: string[];
  mode: "create" | "update" | null;
  duplicate: boolean;
  error: string | null;
  /** 这一行的问题是不是「只差客户/产品没建」——是的话，勾上「一起新建」它就能导 */
  fixableByCreate: boolean;
};

type ParsedOrders = {
  validRows: ImportedOrder[];
  errors: Array<{ row: number; message: string }>;
  missingCustomers: string[];
  missingProducts: ProductRef[];
  /** 预检弹窗按「文件原样」展示用：表头 + 每行原始单元格 */
  headers: string[];
  previewRows: PreviewRow[];
};

function valueOf(row: ExcelJS.Row, mapping: Record<string, number>, field: string) {
  const column = mapping[field];
  if (!column) return null;
  const value = row.getCell(column).value;
  if (isErrorValue(value)) return null;
  if (value && typeof value === "object" && "text" in value) return String(value.text);
  if (value && typeof value === "object" && "result" in value) {
    return isErrorValue(value.result) ? null : value.result;
  }
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

// 「N/A」「-」等占位符表示确实没有这个日期，不是格式错误，按空值处理
const BLANK_TOKENS = new Set(["n/a", "na", "-", "无", "无。", "无日期"]);
function isBlankToken(value: unknown) {
  const text = String(value ?? "").trim();
  return !text || BLANK_TOKENS.has(text.toLowerCase());
}

// Sales Method 列在这批业务数据里就是币种（USD 现汇销售 / RMB 人民币采购），
// 直接落到订单的 currency 字段；RMB 换算成系统统一使用的 ISO 代码 CNY
const CURRENCY_ALIASES: Record<string, string> = { RMB: "CNY", "人民币": "CNY" };
function parseCurrency(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  return CURRENCY_ALIASES[upper] ?? CURRENCY_ALIASES[text] ?? upper;
}

/** 「客户"X"不存在」「产品"X / Y"不存在」的措辞判定：整份文件的报错是不是全都属于这一类 */
const MISSING_CUSTOMER_PATTERN = /^客户“.+”不存在$/;
const MISSING_PRODUCT_PATTERN = /^产品“.+”不存在$/;
function isOnlyMissingReference(message: string) {
  return message.split("；").every((part) => MISSING_CUSTOMER_PATTERN.test(part) || MISSING_PRODUCT_PATTERN.test(part));
}

/** 逐行解析 + 校验；客户/产品缺失时既计入 errors，也顺带收集去重后的缺失名单供前端提示「是否新建」 */
function parseOrderRows(worksheet: ExcelJS.Worksheet, mapping: Record<string, number>, db: Database.Database): ParsedOrders {
  const errors: Array<{ row: number; message: string }> = [];
  const validRows: ImportedOrder[] = [];
  const previewRows: PreviewRow[] = [];
  // 表头原样带回前端：弹窗里显示的就是这份 Excel 自己的列
  const headers: string[] = [];
  worksheet.getRow(1).eachCell((cell, column) => {
    headers[column - 1] = cellToText(cell.value);
  });
  const rawCells = (row: ExcelJS.Row) =>
    headers.map((_, index) => cellToText(row.getCell(index + 1).value));
  const seenOrderNos = new Set<string>();
  const missingCustomers = new Map<string, string>();
  const missingProducts = new Map<string, ProductRef>();
  // 同一订单编号在文件里出现几次、都在哪几行，供前端弹窗把重复项列清楚
  const orderNoRows = new Map<string, { key: string; rows: number[] }>();

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
    if (!customer && rawCustomer) {
      rowErrors.push(`客户“${rawCustomer}”不存在`);
      missingCustomers.set(rawCustomer.toLowerCase(), rawCustomer);
    }
    if (!product && rawClass && rawGrade) {
      rowErrors.push(`产品“${rawClass} / ${rawGrade}”不存在`);
      missingProducts.set(`${rawClass.toLowerCase()}||${rawGrade.toLowerCase()}`, { className: rawClass, grade: rawGrade });
    }
    if (quantity === null || quantity <= 0) rowErrors.push("数量必须大于 0");
    if (price === null || price < 0) rowErrors.push("单价不能小于 0");
    // 可选日期列：留空或「N/A」这类占位符按空值处理；填了别的但解析不出来才算格式错误
    const optionalDate = (field: string, label: string) => {
      const raw = valueOf(row, mapping, field);
      if (isBlankToken(raw)) return null;
      const parsed = parseExcelDate(raw);
      if (!parsed) rowErrors.push(`${label}格式无效`);
      return parsed;
    };
    const lcTtDate = optionalDate("lcTtDate", "LC/TT 日期");
    const actualShipmentDate = optionalDate("actualShipmentDate", "实际出货日期");
    const expectedArrivalDate = optionalDate("expectedArrivalDate", "预计到港日期");
    const shipmentMonthRaw = valueOf(row, mapping, "shipmentMonth");
    const shipmentMonth = isBlankToken(shipmentMonthRaw) ? null : parseShipmentMonth(shipmentMonthRaw, orderDate);
    if (!isBlankToken(shipmentMonthRaw) && !shipmentMonth) rowErrors.push("出货月份格式无效");
    const { status, invalid: invalidStatus } = parseStatus(valueOf(row, mapping, "status"));
    if (invalidStatus) rowErrors.push(`状态“${invalidStatus}”无效（可用：待确认 / 待出货 / 已出货 / 已到港 / 已取消）`);
    const suppliedOrderNo = String(valueOf(row, mapping, "orderNo") ?? "").trim();
    // 与界面建单同一口径：不区分大小写；编号已存在则更新那条订单（已软删的编号视为已释放，重新建单）
    const existing = suppliedOrderNo
      ? (db.prepare("SELECT id FROM orders WHERE order_no = ? COLLATE NOCASE AND deleted_at IS NULL").get(suppliedOrderNo) as { id: number } | undefined)
      : undefined;
    // 编号重复不再当错误拦下来：预检表格里标红 + 勾选框交给用户决定导哪几行
    if (suppliedOrderNo) seenOrderNos.add(suppliedOrderNo.toLowerCase());
    if (suppliedOrderNo) {
      const key = suppliedOrderNo.toLowerCase();
      const group = orderNoRows.get(key);
      if (group) group.rows.push(rowNumber);
      else orderNoRows.set(key, { key: suppliedOrderNo, rows: [rowNumber] });
    }
    if (rowErrors.length) {
      const message = rowErrors.join("；");
      errors.push({ row: rowNumber, message });
      previewRows.push({
        row: rowNumber,
        cells: rawCells(row),
        mode: null,
        duplicate: false,
        error: message,
        fixableByCreate: isOnlyMissingReference(message),
      });
      continue;
    }
    previewRows.push({
      row: rowNumber,
      cells: rawCells(row),
      mode: existing ? "update" : "create",
      duplicate: false,
      error: null,
      fixableByCreate: false,
    });
    // 没填订单编号的行留到真正写库时再定：那时候这条订单自己的自增 id 才存在，直接拿来当编号
    validRows.push({
      rowNumber,
      mode: existing ? "update" : "create",
      duplicate: false,
      id: existing?.id ?? null,
      orderNo: suppliedOrderNo || null,
      orderDate: orderDate!,
      customerId: customer!.id,
      customerName: customer!.name,
      productId: product!.id,
      className: product!.className,
      grade: product!.grade,
      application: optionalText(valueOf(row, mapping, "application")),
      quantity: quantity!,
      price: price!,
      currency: parseCurrency(valueOf(row, mapping, "currency")),
      orderNature: optionalText(valueOf(row, mapping, "orderNature")),
      productionBase: optionalText(valueOf(row, mapping, "productionBase")),
      pic: optionalText(valueOf(row, mapping, "pic")),
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
      notes: optionalText(valueOf(row, mapping, "notes")),
    });
  }

  // 编号出现两次以上的行统一打上 duplicate 标记（含第一次出现的那行），预检表格里整组标红
  const duplicateKeys = new Set(
    [...orderNoRows.values()].filter((group) => group.rows.length > 1).map((group) => group.key.toLowerCase()),
  );
  for (const row of validRows) row.duplicate = Boolean(row.orderNo && duplicateKeys.has(row.orderNo.toLowerCase()));
  const duplicateRowNumbers = new Set(validRows.filter((row) => row.duplicate).map((row) => row.rowNumber));
  for (const row of previewRows) row.duplicate = duplicateRowNumbers.has(row.row);

  return {
    validRows,
    errors,
    missingCustomers: [...missingCustomers.values()],
    missingProducts: [...missingProducts.values()],
    headers,
    previewRows,
  };
}

function buildPreviewPayload(parsed: ParsedOrders) {
  const createCount = parsed.validRows.filter((row) => row.mode === "create").length;
  const updateCount = parsed.validRows.length - createCount;
  return {
    valid: parsed.errors.length === 0,
    totalRows: parsed.validRows.length + parsed.errors.length,
    validCount: parsed.validRows.length,
    createCount,
    updateCount,
    errors: parsed.errors,
    headers: parsed.headers,
    // 整份文件逐行返回（不截断）：弹窗要按行勾选，且按文件原样展示每一列
    preview: parsed.previewRows,
    missingCustomers: parsed.missingCustomers,
    missingProducts: parsed.missingProducts,
    // 只有当报错清一色是「客户/产品不存在」时，前端才提供「新建缺失项并导入」这个快捷操作；
    // 混了别的错误（日期格式、数量等）说明文件本身还要改，不能靠新建客户/产品糊过去
    onlyMissingReferences: parsed.errors.length > 0 && parsed.errors.every((error) => isOnlyMissingReference(error.message)),
  };
}

/**
 * 把 P.I.C 回填成客户的跟进人。跟进人写在订单行上，但业务上一个客户基本固定一两个人跟，
 * 所以客户档案上也留两个位置。一个客户在这批数据里出现多个 P.I.C 时（大客户按产品线分给
 * 几个人），按单数排序取前两位；超过两个人的，逐单是谁跟的看订单自己那一列。
 * 只在客户跟进人 1 为空时才填（两个位置一起填），系统里手工改过的整个跳过。
 */
function fillCustomerPic(db: Database.Database, validRows: ImportedOrder[]) {
  const tally = new Map<number, Map<string, number>>();
  for (const row of validRows) {
    if (!row.pic) continue;
    const counts = tally.get(row.customerId) ?? new Map<string, number>();
    counts.set(row.pic, (counts.get(row.pic) ?? 0) + 1);
    tally.set(row.customerId, counts);
  }
  const update = db.prepare(
    "UPDATE customers SET pic = ?, pic2 = ?, updated_at = datetime('now') WHERE id = ? AND pic = ''",
  );
  for (const [customerId, counts] of tally) {
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name.slice(0, 60));
    if (ranked.length) update.run(ranked[0], ranked[1] ?? "", customerId);
  }
}

/** 写订单本体，不自己开事务——调用方决定要不要跟「新建缺失客户/产品」合并成一个事务 */
function insertOrders(db: Database.Database, validRows: ImportedOrder[], admin: SessionUser) {
  // 实际落库时的新建/更新条数：同一个编号勾了多行时只会建一条，报数按真实发生的算
  let createCount = 0;
  let updateCount = 0;
  const insert = db.prepare(`
    INSERT INTO orders
      (order_no, order_date, customer_id, product_id, quantity, price, currency,
       order_nature, production_base, pic, destination, trade_terms, payment_method, shipment_month, lc_tt_date,
       actual_shipment_date, expected_arrival_date, contract_no, invoice_no,
       status, owner_id, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // 可选列 → 数据库列，更新时只写文件里填了的
  const optionalColumns: Array<[keyof ImportedOrder, string]> = [
    ["currency", "currency"],
    ["orderNature", "order_nature"],
    ["productionBase", "production_base"],
    ["pic", "pic"],
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
    ["notes", "notes"],
  ];
  // 用途写在订单行上，实际是牌号的属性：产品还没填用途时补上，已经填了的不覆盖
  // （系统里手工改过的口径优先于表格里 VLOOKUP 出来的值）
  const fillApplication = db.prepare(
    "UPDATE products SET application = ?, updated_at = datetime('now') WHERE id = ? AND application = ''",
  );
  fillCustomerPic(db, validRows);
  for (const row of validRows) {
    if (row.application) fillApplication.run(row.application.slice(0, 500), row.productId);
    // 同一个订单编号勾了多行时，第一行建单、后面几行更新同一条（不然会撞 order_no 的唯一约束）。
    // 所以这里按写库当下的状态重新判定新建还是更新，而不是沿用预检时算好的 mode
    const existingId = row.orderNo
      ? (db.prepare("SELECT id FROM orders WHERE order_no = ? COLLATE NOCASE AND deleted_at IS NULL").get(row.orderNo) as { id: number } | undefined)?.id ?? null
      : null;
    if (existingId === null) {
      createCount += 1;
      const owner = db.prepare("SELECT owner_id AS ownerId FROM customers WHERE id = ?").get(row.customerId) as { ownerId: number };
      const result = insert.run(row.orderNo ?? sequentialPlaceholder(), row.orderDate, row.customerId, row.productId, row.quantity,
        row.price, row.currency ?? "USD", row.orderNature ?? "", row.productionBase ?? "", row.pic ?? "",
        row.destination ?? "", row.tradeTerms ?? "", row.paymentMethod ?? "",
        row.shipmentMonth, row.lcTtDate, row.actualShipmentDate, row.expectedArrivalDate,
        row.contractNo ?? "", row.invoiceNo ?? "", row.status ?? (row.actualShipmentDate ? "shipped" : "planned"),
        owner.ownerId, row.notes ?? "", admin.id);
      // 留空的编号在插入时只塞了占位值，这里拿到真正的自增 id 后回填成编号本身
      finalizeSequentialCode(db, "orders", "order_no", Number(result.lastInsertRowid), row.orderNo);
      continue;
    }
    updateCount += 1;
    // 更新：必填列（日期 / 客户 / 产品 / 数量 / 单价）总是覆盖，负责人保持不动
    const assignments = ["order_date = ?", "customer_id = ?", "product_id = ?", "quantity = ?", "price = ?"];
    const params: unknown[] = [row.orderDate, row.customerId, row.productId, row.quantity, row.price];
    for (const [field, column] of optionalColumns) {
      const value = row[field];
      if (value === null || value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(value);
    }
    assignments.push("updated_at = datetime('now')");
    db.prepare(`UPDATE orders SET ${assignments.join(", ")} WHERE id = ?`).run(...params, existingId);
  }
  return { createCount, updateCount };
}

function commitOrders(db: Database.Database, validRows: ImportedOrder[], admin: SessionUser) {
  let result = { createCount: 0, updateCount: 0 };
  db.transaction(() => {
    result = insertOrders(db, validRows, admin);
  })();
  return result;
}

/** 新建时的兜底与客户名单导入同一口径：负责人落到执行导入的管理员，状态默认潜在客户 */
function createMissingCustomers(db: Database.Database, names: string[], adminId: number) {
  const insert = db.prepare("INSERT INTO customers (name, owner_id, status, created_by) VALUES (?, ?, 'potential', ?)");
  for (const raw of names) {
    const name = raw.trim().slice(0, 160);
    if (!name) continue;
    const existing = db.prepare("SELECT id FROM customers WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL").get(name);
    if (existing) continue;
    insert.run(name, adminId, adminId);
  }
}

function createMissingProducts(db: Database.Database, refs: ProductRef[]) {
  const insert = db.prepare("INSERT INTO products (class_name, grade, status) VALUES (?, ?, 'active')");
  for (const ref of refs) {
    const className = String(ref.className ?? "").trim().slice(0, 80);
    const grade = String(ref.grade ?? "").trim().slice(0, 120);
    if (!className || !grade) continue;
    const existing = db.prepare("SELECT id FROM products WHERE class_name = ? COLLATE NOCASE AND grade = ? COLLATE NOCASE").get(className, grade);
    if (existing) continue;
    insert.run(className, grade);
  }
}

function parseJsonArray(value: FormDataEntryValue | null): unknown[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isProductRef(value: unknown): value is ProductRef {
  return Boolean(value && typeof value === "object" && "className" in value && "grade" in value);
}

/** 预检表格里勾选的行号（Excel 行号）；没传返回 null 表示「全导」 */
function parseSelectedRows(value: FormDataEntryValue | null): Set<number> | null {
  const parsed = parseJsonArray(value);
  if (!parsed.length) return null;
  return new Set(parsed.filter((item): item is number => typeof item === "number"));
}

function pickSelected(rows: ImportedOrder[], selected: Set<number> | null) {
  return selected ? rows.filter((row) => selected.has(row.rowNumber)) : rows;
}

/** 「新建缺失项后重新解析仍有错」时用来跳出事务并触发回滚，不落库任何东西 */
class StillInvalidError extends Error {}

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
    const parsed = parseOrderRows(worksheet, mapping, db);

    if (!commit) {
      return ok(buildPreviewPayload(parsed));
    }

    // 用户在预检表格里勾掉的行不导入；不传这个字段时默认全导（兼容旧调用）
    const selectedRows = parseSelectedRows(form.get("selectedRows"));

    if (parsed.errors.length === 0) {
      const rowsToImport = pickSelected(parsed.validRows, selectedRows);
      const { createCount, updateCount } = commitOrders(db, rowsToImport, admin);
      writeAudit(admin.id, "import", "order", null, `从 ${file.name} 导入订单：新增 ${createCount} 条，更新 ${updateCount} 条`);
      return ok({ valid: true, imported: rowsToImport.length, createCount, updateCount, errors: [] });
    }

    // 预检发现的错误是「客户/产品不存在」，且前端已经带着用户确认要新建的名单回来：
    // 新建客户/产品、重新解析、写订单，全部放在同一个事务里；重新解析后还有错，
    // 或写订单本身失败（如编号撞车），都整体回滚，不留下孤儿客户/产品
    const createCustomers = parseJsonArray(form.get("createCustomers")).filter((value): value is string => typeof value === "string");
    const createProducts = parseJsonArray(form.get("createProducts")).filter(isProductRef);
    if (createCustomers.length || createProducts.length) {
      let retry: ParsedOrders | null = null;
      let committed: { createCount: number; updateCount: number } | null = null;
      try {
        // db.transaction(fn) 把 fn 的返回值原样透出，借这个把 insertOrders 的结果带出事务
        committed = db.transaction(() => {
          createMissingCustomers(db, createCustomers, admin.id);
          createMissingProducts(db, createProducts);
          retry = parseOrderRows(worksheet, mapping, db);
          if (retry.errors.length) throw new StillInvalidError();
          return insertOrders(db, pickSelected(retry.validRows, selectedRows), admin);
        })();
      } catch (error) {
        if (!(error instanceof StillInvalidError)) throw error;
      }
      if (committed && retry) {
        const finalRows = pickSelected((retry as ParsedOrders).validRows, selectedRows);
        writeAudit(
          admin.id,
          "import",
          "order",
          null,
          `从 ${file.name} 导入订单（新建客户 ${createCustomers.length} 个、产品 ${createProducts.length} 个）：新增 ${committed.createCount} 条，更新 ${committed.updateCount} 条`,
        );
        return ok({ valid: true, imported: finalRows.length, createCount: committed.createCount, updateCount: committed.updateCount, errors: [] });
      }
      return ok(buildPreviewPayload((retry as ParsedOrders | null) ?? parsed));
    }

    return ok(buildPreviewPayload(parsed));
  } catch (error) {
    return handleApiError(error);
  }
}
