import ExcelJS from "exceljs";
import { Readable } from "node:stream";

/**
 * 导入文件统一入口：.xlsx 走 Excel 解析，.csv 走 CSV 解析。
 * Windows 的 Excel 导出 CSV 默认是 GBK，直接按 UTF-8 读会整片乱码，
 * 这里先试 UTF-8，发现替换字符再回退 GBK。
 */
export async function readUploadWorksheet(file: File): Promise<ExcelJS.Worksheet | undefined> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  if (/\.csv$/i.test(file.name)) {
    if (buffer.includes(0)) throw new Error("Invalid CSV content");
    await workbook.csv.read(Readable.from(decodeCsv(buffer)), { map: (value: string) => value });
  } else {
    await workbook.xlsx.load(buffer as never);
  }
  return workbook.worksheets[0];
}

function decodeCsv(buffer: Buffer) {
  // 带 BOM 的一定是 UTF-8，去掉 BOM 免得混进第一个表头
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("gbk").decode(buffer);
  } catch {
    return utf8;
  }
}

export const IMPORT_FILE_PATTERN = /\.(xlsx|csv)$/i;

export const orderExcelColumns = [
  { header: "Order No.", key: "orderNo", width: 20 },
  { header: "Order Date", key: "orderDate", width: 14 },
  { header: "Customer", key: "customerName", width: 28 },
  { header: "Classi", key: "className", width: 12 },
  { header: "Grade", key: "grade", width: 14 },
  // 用途是牌号的属性（客户表里是 VLOOKUP 出来的），导入时落到 products.application
  { header: "Application", key: "application", width: 18 },
  { header: "Quantity", key: "quantity", width: 12 },
  { header: "Price", key: "price", width: 14 },
  { header: "Currency", key: "currency", width: 10 },
  { header: "Order Nature", key: "orderNature", width: 14 },
  { header: "Production Base", key: "productionBase", width: 14 },
  { header: "P.I.C", key: "pic", width: 12 },
  { header: "Destination", key: "destination", width: 16 },
  { header: "Terms", key: "tradeTerms", width: 12 },
  { header: "Payment", key: "paymentMethod", width: 14 },
  { header: "Shipment Month", key: "shipmentMonth", width: 16 },
  { header: "LC or TT Date", key: "lcTtDate", width: 16 },
  { header: "Actual Shipment Date", key: "actualShipmentDate", width: 20 },
  { header: "Expected Arrival Date", key: "expectedArrivalDate", width: 20 },
  { header: "Contract No.", key: "contractNo", width: 16 },
  { header: "INVOICE", key: "invoiceNo", width: 16 },
  { header: "Status", key: "status", width: 14 },
  { header: "Remark", key: "notes", width: 20 },
] as const;

function styleSheet(worksheet: ExcelJS.Worksheet) {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  // 末列按实际列数算，加减列时不用再回来改这个字母
  worksheet.autoFilter = { from: "A1", to: `${worksheet.getColumn(worksheet.columnCount).letter}1` };
  const header = worksheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FF172033" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1FF" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: "FF9CB6D9" } } };
  });
}

export function styleOrderSheet(worksheet: ExcelJS.Worksheet) {
  styleSheet(worksheet);
  worksheet.getColumn("quantity").numFmt = "0.00";
  worksheet.getColumn("price").numFmt = "#,##0.00";
}

/** 「(MT)」「（吨）」「USD」这类单位后缀不参与比对：数量(MT) 和 数量、单价 USD 和 单价 是同一列 */
const UNIT_SUFFIX = /(mts?|kgs?|tons?|吨|公斤|usd|cny|rmb|krw|hkd|美元|人民币|韩元|港币|元)$/;

export function normalizeHeader(value: unknown) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._/()（）【】[\]{}·、,，;；:：#*+-]/g, "");
  const stripped = text.replace(UNIT_SUFFIX, "");
  // 整列就叫「MT」「USD」的，剥完是空的，那就按原样比对
  return stripped || text;
}

/**
 * 表头别名：全部写成 normalizeHeader 之后的形态（小写、去标点、去单位后缀）。
 * 对方的表五花八门，中英韩三种叫法都收：认得出就不用用户手动指列。
 * 认不出也不致命——预检前会弹「列对应」让用户自己指，见导入接口的 needsMapping。
 */
export const headerAliases: Record<string, string[]> = {
  orderNo: ["orderno", "ordernumber", "order", "sono", "so", "订单编号", "订单号", "订单编码", "单号", "销售单号", "주문번호"],
  orderDate: ["orderdate", "date", "下单日期", "订单日期", "接单日期", "签约日期", "주문일", "주문일자"],
  customerName: ["customer", "customername", "client", "buyer", "客户", "客户名称", "客户名", "买家", "购买方", "고객", "고객명", "거래처"],
  className: ["classi", "class", "classify", "classification", "category", "productclass", "分类", "产品大类", "大类", "品类", "분류", "제품군"],
  grade: ["grade", "model", "item", "productgrade", "牌号", "型号", "产品牌号", "产品型号", "规格", "그레이드", "제품"],
  // 용도 = 韩语「用途」，客户表里用这一列记这个牌号最终做什么产品
  application: ["application", "용도", "用途", "enduse", "usage", "产品用途", "最终用途"],
  quantity: ["quantity", "qty", "数量", "订单数量", "quantitymt", "수량"],
  price: ["price", "unitprice", "单价", "价格", "成交单价", "단가"],
  currency: ["currency", "币种", "货币", "结算币种", "salesmethod", "통화"],
  orderNature: ["ordernature", "nature", "订单性质", "订单类型", "业务性质"],
  productionBase: ["productionbase", "plant", "factory", "生产基地", "工厂", "产地"],
  // P.I.C = Person In Charge，落成订单上的跟进人（纯文本，不挂系统账号）
  pic: ["pic", "personincharge", "salesrep", "sales", "跟进人", "担当", "业务员", "销售员", "담당자"],
  destination: ["destination", "port", "portofdestination", "目的地", "目的港", "到货地", "도착지"],
  tradeTerms: ["terms", "tradeterms", "incoterms", "priceterm", "贸易条款", "贸易术语", "价格条款"],
  paymentMethod: ["payment", "paymentmethod", "paymentterms", "付款方式", "结算方式", "支付方式", "결제조건"],
  shipmentMonth: ["shipmentmonth", "shippingmonth", "出货月份", "船期月份", "交货月份", "출하월"],
  lcTtDate: ["lcorttdate", "lcttdate", "lcdate", "ttdate", "信用证或电汇日期", "信用证日期", "电汇日期", "收款日期"],
  actualShipmentDate: ["actualshipmentdate", "actualshipment", "shipmentdate", "etd", "atd", "实际出货日期", "实际出运日期", "出货日期", "出运日期", "출하일"],
  expectedArrivalDate: ["expectedarrivaldate", "expectedarrival", "arrivaldate", "eta", "预计到港日期", "预计到港", "到港日期", "预计到货日期", "도착예정일"],
  contractNo: ["contractno", "contract", "contractnumber", "合同号", "合同编号", "계약번호"],
  invoiceNo: ["invoice", "invoiceno", "invoicenumber", "发票号", "发票编号", "商业发票号"],
  status: ["status", "orderstatus", "状态", "订单状态", "상태"],
  notes: ["remark", "remarks", "note", "notes", "comment", "备注", "说明", "비고"],
};

/** 订单导入必须对上的列，其余列留空就是「不改这一项」 */
export const REQUIRED_ORDER_FIELDS = ["orderDate", "customerName", "className", "grade", "quantity"] as const;

/** #N/A、#REF! 这类公式错误值当空处理——源表里用 VLOOKUP 填的列常有查不到的行 */
export function isErrorValue(value: unknown) {
  return Boolean(value && typeof value === "object" && "error" in value);
}

/** Excel 单元格值 → 纯文本：富文本、公式结果、日期都要能正确取到，不能落成 [object Object] */
export function cellToText(value: ExcelJS.CellValue): string {
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

/** 整行读成文本，长度按工作表列数对齐，空单元格留空串 */
export function readRowTexts(worksheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  const row = worksheet.getRow(rowNumber);
  const count = Math.max(worksheet.columnCount, row.cellCount);
  return Array.from({ length: count }, (_, index) => cellToText(row.getCell(index + 1).value));
}

export type HeaderMapping = {
  /** 字段 → 列号（1 开始）。认不出来的字段不在里面 */
  mapping: Record<string, number>;
  /** 列号 → 字段，界面上回显「这一列被认成了什么」 */
  columnField: Record<number, string>;
};

/**
 * 表头文本 → 字段映射。两轮：
 * 1. 精确匹配别名，一列只认一个字段、一个字段只吃一列（先到先得）
 * 2. 剩下的列再做包含匹配，但只用 4 个字符以上的别名——「客户」这种两字别名
 *    去做包含匹配会把「客户编号」也吃进来，宁可留给用户手动指
 */
export function buildHeaderMapping(headerTexts: string[]): HeaderMapping {
  const mapping: Record<string, number> = {};
  const columnField: Record<number, string> = {};
  const normalized = headerTexts.map((text) => normalizeHeader(text));

  const claim = (index: number, field: string) => {
    if (mapping[field] || columnField[index + 1]) return;
    mapping[field] = index + 1;
    columnField[index + 1] = field;
  };

  normalized.forEach((text, index) => {
    if (!text) return;
    for (const [field, aliases] of Object.entries(headerAliases)) {
      if (aliases.includes(text)) {
        claim(index, field);
        break;
      }
    }
  });

  normalized.forEach((text, index) => {
    if (!text || columnField[index + 1]) return;
    for (const [field, aliases] of Object.entries(headerAliases)) {
      if (mapping[field]) continue;
      if (aliases.some((alias) => alias.length >= 4 && text.includes(alias))) {
        claim(index, field);
        break;
      }
    }
  });

  return { mapping, columnField };
}

/**
 * 表头在第几行：很多业务表上面还压着标题行、公司抬头或空行。
 * 前 maxScan 行里挑认出字段最多的那一行，一个都认不出就当第 1 行。
 */
export function detectHeaderRow(worksheet: ExcelJS.Worksheet, maxScan = 10) {
  const limit = Math.min(maxScan, worksheet.rowCount);
  let bestRow = 1;
  let bestScore = 0;
  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const score = Object.keys(buildHeaderMapping(readRowTexts(worksheet, rowNumber)).mapping).length;
    if (score > bestScore) {
      bestScore = score;
      bestRow = rowNumber;
    }
  }
  return { row: bestRow, score: bestScore };
}

function calendarDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

/** 年在前、日/月/年、英文月份和 Excel 日期序号；歧义斜线日期按日/月/年。 */
export function parseExcelDate(value: unknown, date1904 = false): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  let match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (match) return calendarDate(+match[1], +match[2], +match[3]);
  match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return calendarDate(+match[1], +match[2], +match[3]);
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    const first = +match[1], second = +match[2];
    return second > 12 ? calendarDate(+match[3], first, second) : calendarDate(+match[3], second, first);
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  match = text.match(/^(\d{1,2})[\s-]+([a-z]+)[,\s-]+(\d{4})$/i);
  if (match) return calendarDate(+match[3], months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1, +match[1]);
  match = text.match(/^([a-z]+)[\s-]+(\d{1,2})(?:,)?[\s-]+(\d{4})$/i);
  if (match) return calendarDate(+match[3], months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1, +match[2]);
  // Excel 的 1900 日期系统错误地包含 1900-02-29（序号 60），拒绝该值。
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial < (date1904 ? 0 : 1) || serial > 2958465 || (!date1904 && serial === 60)) return null;
    const date = new Date(Date.UTC(date1904 ? 1904 : 1900, 0, 1) + (date1904 ? serial : serial - (serial > 60 ? 2 : 1)) * 86400000);
    return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  return null;
}

export function parseShipmentMonth(value: unknown, orderDate: string | null, date1904 = false) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  const yearMonth = text.match(/^(\d{4})[-/.年](\d{1,2})月?$/);
  if (yearMonth) return calendarDate(+yearMonth[1], +yearMonth[2], 1)?.slice(0, 7) ?? null;
  const month = text.match(/^(\d{1,2})(?:月|월)?$/);
  if (month) return calendarDate(Number(orderDate?.slice(0, 4) || new Date().getFullYear()), +month[1], 1)?.slice(0, 7) ?? null;
  return parseExcelDate(value, date1904)?.slice(0, 7) ?? null;
}

export function parseExcelNumber(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}
