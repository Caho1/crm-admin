import ExcelJS from "exceljs";
import dayjs from "dayjs";
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
    await workbook.csv.read(Readable.from(decodeCsv(buffer)));
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

export function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._/()（）【】-]/g, "");
}

export const headerAliases: Record<string, string[]> = {
  orderNo: ["orderno", "订单编号"],
  orderDate: ["orderdate", "下单日期", "订单日期"],
  customerName: ["customer", "客户", "客户名称"],
  className: ["classi", "class", "classify", "分类", "产品大类"],
  grade: ["grade", "牌号", "型号", "产品牌号"],
  // 용도 = 韩语「用途」，客户表里用这一列记这个牌号最终做什么产品
  application: ["application", "용도", "用途", "enduse", "产品用途"],
  quantity: ["quantity", "qty", "数量", "quantitymt"],
  price: ["price", "单价", "价格"],
  currency: ["currency", "币种", "salesmethod"],
  orderNature: ["ordernature", "订单性质"],
  productionBase: ["productionbase", "生产基地"],
  // P.I.C = Person In Charge，落成订单上的跟进人（纯文本，不挂系统账号）
  pic: ["pic", "跟进人", "担当", "담당자"],
  destination: ["destination", "目的地"],
  tradeTerms: ["terms", "tradeterms", "贸易条款"],
  paymentMethod: ["payment", "paymentmethod", "付款方式"],
  shipmentMonth: ["shipmentmonth", "出货月份"],
  lcTtDate: ["lcorttdate", "lcttdate", "信用证或电汇日期"],
  actualShipmentDate: ["actualshipmentdate", "实际出货日期"],
  expectedArrivalDate: ["expectedarrivaldate", "预计到港日期"],
  contractNo: ["contractno", "合同号"],
  invoiceNo: ["invoice", "invoiceno", "发票号"],
  status: ["status", "状态"],
  notes: ["remark", "notes", "备注"],
};

export function parseExcelDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return dayjs(value).format("YYYY-MM-DD");
  const text = String(value).trim().replace(/[.年]/g, "-").replace(/月/g, "-").replace(/日/g, "").replace(/\//g, "-");
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
}

export function parseShipmentMonth(value: unknown, orderDate: string | null) {
  if (!value) return null;
  if (value instanceof Date) return dayjs(value).format("YYYY-MM");
  const text = String(value).trim();
  if (/^\d{4}-\d{1,2}$/.test(text)) {
    const [year, month] = text.split("-");
    return `${year}-${month.padStart(2, "0")}`;
  }
  const monthMatch = text.match(/^(\d{1,2})(?:月|월)?$/);
  if (monthMatch) {
    const year = orderDate?.slice(0, 4) || String(new Date().getFullYear());
    return `${year}-${monthMatch[1].padStart(2, "0")}`;
  }
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed.format("YYYY-MM") : null;
}

export function parseExcelNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}
