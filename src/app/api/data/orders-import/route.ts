import ExcelJS from "exceljs";
import type { Database } from "@/db/client";
import { getDb } from "@/db/client";
import { ApiError, handleApiError, ok, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { finalizeSequentialCode, sequentialPlaceholder } from "@/lib/query";
import type { SessionUser } from "@/lib/types";
import {
  IMPORT_FILE_PATTERN,
  REQUIRED_ORDER_FIELDS,
  buildHeaderMapping,
  cellToText,
  cellValue,
  detectHeaderRow,
  headerAliases,
  parseExcelDate,
  parseExcelNumber,
  parseShipmentMonth,
  readRowTexts,
  readUploadWorksheet,
} from "@/lib/excel";

export const runtime = "nodejs";


type ImportedOrder = {
  /** Excel 行号：预检表格按行勾选、提交时按行号过滤都要用它 */
  rowNumber: number;
  /** 订单编号在库里已存在 → 更新那条订单；否则新建 */
  mode: "create" | "update";
  /** 同一个订单编号在文件里出现了不止一次：不拦截，只在预检表格里标红 */
  duplicate: boolean;
  id: number | null;
  /** null = 留空，写库时从自增 id 开始分配可用的纯数字编号 */
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
  price: number | null;
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
  return cellValue(row.getCell(column).value);
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
async function parseOrderRows(
  worksheet: ExcelJS.Worksheet,
  mapping: Record<string, number>,
  db: Database,
  headerRowNumber: number,
  selectedRows: Set<number> | null = null,
): Promise<ParsedOrders> {
  const errors: Array<{ row: number; message: string }> = [];
  const validRows: ImportedOrder[] = [];
  const previewRows: PreviewRow[] = [];
  // 表头原样带回前端：弹窗里显示的就是这份 Excel 自己的列（表头未必在第 1 行）
  const headers = readRowTexts(worksheet, headerRowNumber);
  const rawCells = (row: ExcelJS.Row) =>
    headers.map((_, index) => cellToText(row.getCell(index + 1).value));
  const seenOrderNos = new Set<string>();
  const missingCustomers = new Map<string, string>();
  const missingProducts = new Map<string, ProductRef>();
  // 同一订单编号在文件里出现几次、都在哪几行，供前端弹窗把重复项列清楚
  const orderNoRows = new Map<string, { key: string; rows: number[] }>();

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    if (selectedRows && !selectedRows.has(rowNumber)) continue;
    const row = worksheet.getRow(rowNumber);
    const rawCustomer = String(valueOf(row, mapping, "customerName") ?? "").trim();
    const rawClass = String(valueOf(row, mapping, "className") ?? "").trim();
    const rawGrade = String(valueOf(row, mapping, "grade") ?? "").trim();
    if (!Object.values(mapping).some((column) => cellToText(row.getCell(column).value))) continue;

    const rowErrors: string[] = [];
    const orderDate = parseExcelDate(valueOf(row, mapping, "orderDate"), worksheet.workbook.properties.date1904);
    const customer = (await db.prepare("SELECT id, name FROM customers WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL").get(rawCustomer)) as { id: number; name: string } | undefined;
    const product = (await db.prepare("SELECT id, class_name AS className, grade FROM products WHERE class_name = ? COLLATE NOCASE AND grade = ? COLLATE NOCASE").get(rawClass, rawGrade)) as { id: number; className: string; grade: string } | undefined;
    const quantity = parseExcelNumber(valueOf(row, mapping, "quantity"));
    const price = parseExcelNumber(valueOf(row, mapping, "price"));
    if (!orderDate) rowErrors.push("下单日期格式无法识别或日期不存在，请检查年月日");
    if (!rawCustomer) rowErrors.push("客户名称为必填项，请填写后重新上传");
    if (!rawClass) rowErrors.push("产品大类不能为空");
    if (!rawGrade) rowErrors.push("产品型号不能为空");
    if (!customer && rawCustomer) {
      rowErrors.push(`客户“${rawCustomer}”不存在`);
      missingCustomers.set(rawCustomer.toLowerCase(), rawCustomer);
    }
    if (!product && rawClass && rawGrade) {
      rowErrors.push(`产品“${rawClass} / ${rawGrade}”不存在`);
      missingProducts.set(`${rawClass.toLowerCase()}||${rawGrade.toLowerCase()}`, { className: rawClass, grade: rawGrade });
    }
    if (quantity === null || quantity <= 0) rowErrors.push("数量必须大于 0");
    const rawPrice = valueOf(row, mapping, "price");
    if (rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== "" && (price === null || price < 0)) rowErrors.push("单价必须为不小于 0 的数字，或留空");
    // 可选日期列：留空或「N/A」这类占位符按空值处理；填了别的但解析不出来才算格式错误
    const optionalDate = (field: string, label: string) => {
      const raw = valueOf(row, mapping, field);
      if (isBlankToken(raw)) return null;
      const parsed = parseExcelDate(raw, worksheet.workbook.properties.date1904);
      if (!parsed) rowErrors.push(`${label}格式无效`);
      return parsed;
    };
    const lcTtDate = optionalDate("lcTtDate", "LC/TT 日期");
    const actualShipmentDate = optionalDate("actualShipmentDate", "实际出货日期");
    const expectedArrivalDate = optionalDate("expectedArrivalDate", "预计到港日期");
    const shipmentMonthRaw = valueOf(row, mapping, "shipmentMonth");
    const shipmentMonth = isBlankToken(shipmentMonthRaw) ? null : parseShipmentMonth(shipmentMonthRaw, orderDate, worksheet.workbook.properties.date1904);
    if (!isBlankToken(shipmentMonthRaw) && !shipmentMonth) rowErrors.push("出货月份格式无效");
    const { status, invalid: invalidStatus } = parseStatus(valueOf(row, mapping, "status"));
    if (invalidStatus) rowErrors.push(`状态“${invalidStatus}”无效（可用：待确认 / 待出货 / 已出货 / 已到港 / 已取消）`);
    const suppliedOrderNo = String(valueOf(row, mapping, "orderNo") ?? "").trim();
    // 与界面建单同一口径：不区分大小写；编号已存在则更新那条订单（已软删的编号视为已释放，重新建单）
    const existing = suppliedOrderNo
      ? ((await db.prepare("SELECT id FROM orders WHERE order_no = ? COLLATE NOCASE AND deleted_at IS NULL").get(suppliedOrderNo)) as { id: number } | undefined)
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
      price,
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
async function fillCustomerPic(db: Database, validRows: ImportedOrder[]) {
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
    if (ranked.length) await update.run(ranked[0], ranked[1] ?? "", customerId);
  }
}

/** 写订单本体，不自己开事务——调用方决定要不要跟「新建缺失客户/产品」合并成一个事务 */
async function insertOrders(db: Database, validRows: ImportedOrder[], admin: SessionUser) {
  // 空编号不能占用本批后续手填编号，否则后续行会被误判为更新刚创建的订单。
  const reservedCodes = new Set(validRows.flatMap((row) => row.orderNo ? [row.orderNo] : []));
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
  // 表里出现的产品大类要登记成标签字典项，否则「新建产品」的大类下拉框和列表筛选器里
  // 没有这些选项（空库导入时尤其明显：字典里只有内置的几个默认值）。
  // 表格显示本身会回落到原始 code，所以这一步只影响能不能选、能不能筛。
  const insertClassDict = db.prepare(`
    INSERT OR IGNORE INTO dict_items (type, code, label, label_en, label_ko, sort_order)
    VALUES ('product_class', ?, ?, ?, ?, ?)
  `);
  const classNames = [...new Set(validRows.map((row) => row.className).filter(Boolean))];
  for (const [index, className] of classNames.entries()) {
    await insertClassDict.run(className, className, className, className, 100 + index);
  }

  // 用途写在订单行上，实际是牌号的属性：产品还没填用途时补上，已经填了的不覆盖
  // （系统里手工改过的口径优先于表格里 VLOOKUP 出来的值）
  const fillApplication = db.prepare(
    "UPDATE products SET application = ?, updated_at = datetime('now') WHERE id = ? AND application = ''",
  );
  await fillCustomerPic(db, validRows);
  for (const row of validRows) {
    if (row.application) await fillApplication.run(row.application.slice(0, 500), row.productId);
    // 同一个订单编号勾了多行时，第一行建单、后面几行更新同一条（不然会撞 order_no 的唯一约束）。
    // 所以这里按写库当下的状态重新判定新建还是更新，而不是沿用预检时算好的 mode
    const existingId = row.orderNo
      ? ((await db.prepare("SELECT id FROM orders WHERE order_no = ? COLLATE NOCASE AND deleted_at IS NULL").get(row.orderNo)) as { id: number } | undefined)?.id ?? null
      : null;
    if (existingId === null) {
      createCount += 1;
      const owner = (await db.prepare("SELECT owner_id AS ownerId FROM customers WHERE id = ?").get(row.customerId)) as { ownerId: number };
      const result = (await insert.run(row.orderNo ?? sequentialPlaceholder(), row.orderDate, row.customerId, row.productId, row.quantity,
        row.price, row.currency ?? "USD", row.orderNature ?? "", row.productionBase ?? "", row.pic ?? "",
        row.destination ?? "", row.tradeTerms ?? "", row.paymentMethod ?? "",
        row.shipmentMonth, row.lcTtDate, row.actualShipmentDate, row.expectedArrivalDate,
        row.contractNo ?? "", row.invoiceNo ?? "", row.status ?? (row.actualShipmentDate ? "shipped" : "planned"),
        owner.ownerId, row.notes ?? "", admin.id));
      // 用自增 id 作为编号起点，跳过已有编号及本批手填编号。
      await finalizeSequentialCode(db, "orders", "order_no", Number(result.lastInsertRowid), row.orderNo, reservedCodes);
      continue;
    }
    updateCount += 1;
    // 更新基础字段；单价留空会清空原价格，负责人保持不动。
    const assignments = ["order_date = ?", "customer_id = ?", "product_id = ?", "quantity = ?", "price = ?"];
    const params: unknown[] = [row.orderDate, row.customerId, row.productId, row.quantity, row.price];
    for (const [field, column] of optionalColumns) {
      const value = row[field];
      if (value === null || value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(value);
    }
    assignments.push("updated_at = datetime('now')");
    await db.prepare(`UPDATE orders SET ${assignments.join(", ")} WHERE id = ?`).run(...params, existingId);
  }
  return { createCount, updateCount };
}

async function commitOrders(db: Database, validRows: ImportedOrder[], admin: SessionUser) {
  let result = { createCount: 0, updateCount: 0 };
  await db.transaction(async () => {
    result = (await insertOrders(db, validRows, admin));
  })();
  return result;
}

/** 新建时的兜底与客户名单导入同一口径：负责人落到执行导入的管理员，状态默认潜在客户 */
async function createMissingCustomers(db: Database, names: string[], adminId: number) {
  const insert = db.prepare("INSERT INTO customers (name, owner_id, status, created_by) VALUES (?, ?, 'potential', ?)");
  for (const raw of names) {
    const name = raw.trim().slice(0, 160);
    if (!name) continue;
    const existing = (await db.prepare("SELECT id FROM customers WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL").get(name));
    if (existing) continue;
    await insert.run(name, adminId, adminId);
  }
}

async function createMissingProducts(db: Database, refs: ProductRef[]) {
  const insert = db.prepare("INSERT INTO products (class_name, grade, status) VALUES (?, ?, 'active')");
  for (const ref of refs) {
    const className = String(ref.className ?? "").trim().slice(0, 80);
    const grade = String(ref.grade ?? "").trim().slice(0, 120);
    if (!className || !grade) continue;
    const existing = (await db.prepare("SELECT id FROM products WHERE class_name = ? COLLATE NOCASE AND grade = ? COLLATE NOCASE").get(className, grade));
    if (existing) continue;
    await insert.run(className, grade);
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
  if (value === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { throw new ApiError(422, "INVALID_SELECTION", "勾选行信息无效，请重新预检"); }
  if (!Array.isArray(parsed) || !parsed.every((item) => Number.isInteger(item) && item > 0)) throw new ApiError(422, "INVALID_SELECTION", "勾选行信息无效，请重新预检");
  return new Set(parsed as number[]);
}

function pickSelected(rows: ImportedOrder[], selected: Set<number> | null) {
  return selected ? rows.filter((row) => selected.has(row.rowNumber)) : rows;
}

/**
 * 「列对应」弹窗回传的映射：{ 字段: 列号 }，列号从 1 开始，0 / 越界表示这个字段不取任何列。
 * 同一列被指给两个字段时，后一个不生效——一列只喂一个字段，免得数据被复制到两处。
 */
function parseMappingForm(value: FormDataEntryValue | null, columnCount: number): Record<string, number> {
  if (typeof value !== "string" || !value.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: Record<string, number> = {};
  const usedColumns = new Set<number>();
  for (const [field, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(field in headerAliases)) continue;
    const column = Number(raw);
    if (!Number.isInteger(column) || column < 0 || column > columnCount) continue;
    if (column > 0 && usedColumns.has(column)) continue;
    if (column > 0) usedColumns.add(column);
    result[field] = column;
  }
  return result;
}

/** 表头行往下取几行真实数据当样例，帮用户判断某一列到底是什么 */
function sampleRowsAfter(worksheet: ExcelJS.Worksheet, headerRowNumber: number, columnCount: number, limit = 3) {
  const samples: string[][] = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount && samples.length < limit; rowNumber += 1) {
    const cells = readRowTexts(worksheet, rowNumber).slice(0, columnCount);
    if (cells.some((cell) => cell !== "")) samples.push(cells);
  }
  return samples;
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

    let worksheet: ExcelJS.Worksheet | undefined;
    try {
      worksheet = await readUploadWorksheet(file);
    } catch {
      throw new ApiError(422, "INVALID_FILE_CONTENT", "文件无法读取，可能已损坏或实际格式不符。请用 Excel 重新另存为 .xlsx 或 .csv 后上传");
    }
    if (!worksheet || worksheet.rowCount < 2) throw new ApiError(422, "EMPTY_SHEET", "文件中没有可导入的数据");

    // 表头行：用户在「列对应」弹窗里指定过就听他的，否则前 10 行里自动找
    const suppliedHeaderRow = Number(form.get("headerRow")) || 0;
    const headerRowNumber = Number.isInteger(suppliedHeaderRow) && suppliedHeaderRow > 0 && suppliedHeaderRow <= worksheet.rowCount
      ? suppliedHeaderRow
      : detectHeaderRow(worksheet).row;
    const headerTexts = readRowTexts(worksheet, headerRowNumber);
    const auto = buildHeaderMapping(headerTexts);
    // 手动指定的列覆盖自动识别的结果（0 表示这一列不导入）
    const manual = parseMappingForm(form.get("mapping"), headerTexts.length);
    const mapping: Record<string, number> = { ...auto.mapping, ...manual };
    for (const [field, column] of Object.entries(mapping)) if (!column) delete mapping[field];

    const missing = REQUIRED_ORDER_FIELDS.filter((field) => !mapping[field]);
    // 必要列没认全，或用户主动要求重新对应：不报错，把文件的列摊给前端让用户自己指
    if (missing.length || form.get("remap") === "true") {
      return ok({
        needsMapping: true,
        headerRow: headerRowNumber,
        headers: headerTexts,
        // 表头行往下几行样例，让用户凭内容判断这一列是什么
        samples: sampleRowsAfter(worksheet, headerRowNumber, headerTexts.length),
        // 前 10 行原样，供用户在弹窗里改「表头在第几行」
        sheetHead: Array.from({ length: Math.min(10, worksheet.rowCount) }, (_, index) => ({
          row: index + 1,
          cells: readRowTexts(worksheet, index + 1),
        })),
        mapping,
        fields: Object.keys(headerAliases),
        requiredFields: [...REQUIRED_ORDER_FIELDS],
        missingFields: missing,
      });
    }

    const db = getDb();
    const selectedRows = commit ? parseSelectedRows(form.get("selectedRows")) : null;
    if (selectedRows && !selectedRows.size) throw new ApiError(422, "NO_SELECTED_ROWS", "请至少选择一行有效数据导入");
    const parsed = (await parseOrderRows(worksheet, mapping, db, headerRowNumber, selectedRows));
    if (!parsed.validRows.length && !parsed.errors.length) throw new ApiError(422, "EMPTY_SELECTION", "没有可导入的数据，请检查文件内容或重新勾选行");

    if (!commit) {
      return ok(buildPreviewPayload(parsed));
    }

    // 用户在预检表格里勾掉的行不导入；不传这个字段时默认全导（兼容旧调用）

    if (parsed.errors.length === 0) {
      const rowsToImport = pickSelected(parsed.validRows, selectedRows);
      const { createCount, updateCount } = (await commitOrders(db, rowsToImport, admin));
      await writeAudit(admin.id, "import", "order", null, `从 ${file.name} 导入订单：新增 ${createCount} 条，更新 ${updateCount} 条`);
      return ok({ valid: true, imported: rowsToImport.length, createCount, updateCount, errors: [] });
    }

    // 预检发现的错误是「客户/产品不存在」，且前端已经带着用户确认要新建的名单回来：
    // 新建客户/产品、重新解析、写订单，全部放在同一个事务里；重新解析后还有错，
    // 或写订单本身失败（如编号撞车），都整体回滚，不留下孤儿客户/产品
    const createCustomers = parseJsonArray(form.get("createCustomers")).filter((value): value is string => typeof value === "string" && parsed.missingCustomers.includes(value));
    const createProducts = parseJsonArray(form.get("createProducts")).filter(isProductRef).filter((value) => parsed.missingProducts.some((missing) => missing.className === value.className && missing.grade === value.grade));
    if (createCustomers.length || createProducts.length) {
      let retry: ParsedOrders | null = null;
      let committed: { createCount: number; updateCount: number } | null = null;
      try {
        // db.transaction(fn) 把 fn 的返回值原样透出，借这个把 insertOrders 的结果带出事务
        committed = (await db.transaction(async () => {
          await createMissingCustomers(db, createCustomers, admin.id);
          await createMissingProducts(db, createProducts);
          retry = (await parseOrderRows(worksheet, mapping, db, headerRowNumber, selectedRows));
          if (retry.errors.length) throw new StillInvalidError();
          return (await insertOrders(db, pickSelected(retry.validRows, selectedRows), admin));
        })());
      } catch (error) {
        if (!(error instanceof StillInvalidError)) throw error;
      }
      if (committed && retry) {
        const finalRows = pickSelected((retry as ParsedOrders).validRows, selectedRows);
        await writeAudit(
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
