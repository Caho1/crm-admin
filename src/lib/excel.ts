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
  { header: "Quantity", key: "quantity", width: 12 },
  { header: "Price", key: "price", width: 14 },
  { header: "Currency", key: "currency", width: 10 },
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
] as const;

// 客户名单导入：只做客户档案本身 + 主要联系人（第一位），其余联系人、名片图片、
// 协作成员等仍在界面里维护
export const customerExcelColumns = [
  { header: "客户名称（中文）", key: "name", width: 28 },
  { header: "客户名称（英文）", key: "nameEn", width: 30 },
  { header: "客户简称", key: "shortName", width: 16 },
  { header: "客户分类", key: "category", width: 14 },
  { header: "行业", key: "industry", width: 14 },
  { header: "国家", key: "country", width: 12 },
  { header: "地区", key: "region", width: 12 },
  { header: "详细地址", key: "address", width: 30 },
  { header: "客户简介", key: "description", width: 34 },
  { header: "负责人", key: "ownerName", width: 12 },
  { header: "客户状态", key: "status", width: 12 },
  { header: "主要联系人", key: "contactName", width: 14 },
  { header: "联系人英文姓名", key: "contactNameEn", width: 18 },
  { header: "联系人职位", key: "contactTitle", width: 14 },
  { header: "联系电话", key: "contactPhone", width: 18 },
  { header: "联系邮箱", key: "contactEmail", width: 22 },
  { header: "联系人性格爱好", key: "contactPersonality", width: 28 },
] as const;

function styleSheet(worksheet: ExcelJS.Worksheet, lastColumn: string) {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: "A1", to: `${lastColumn}1` };
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
  styleSheet(worksheet, "R");
  worksheet.getColumn("quantity").numFmt = "0.00";
  worksheet.getColumn("price").numFmt = "#,##0.00";
}

export function styleCustomerSheet(worksheet: ExcelJS.Worksheet) {
  styleSheet(worksheet, "Q");
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
  className: ["classi", "class", "分类", "产品大类"],
  grade: ["grade", "牌号", "型号", "产品牌号"],
  quantity: ["quantity", "qty", "数量"],
  price: ["price", "单价", "价格"],
  currency: ["currency", "币种"],
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
};

export const customerHeaderAliases: Record<string, string[]> = {
  name: ["客户名称", "客户名称中文", "客户", "中文名称", "customer", "customername", "name"],
  nameEn: ["客户名称英文", "英文名称", "英文名", "customernameen", "nameen", "englishname"],
  shortName: ["客户简称", "简称", "shortname", "abbreviation", "abbr"],
  category: ["客户分类", "分类", "category"],
  industry: ["行业", "industry"],
  country: ["国家", "country"],
  region: ["地区", "城市", "region"],
  address: ["详细地址", "地址", "address"],
  description: ["客户简介", "简介", "备注", "description"],
  ownerName: ["负责人", "销售负责人", "owner", "ownername"],
  status: ["客户状态", "状态", "status"],
  contactName: ["主要联系人", "联系人", "联系人姓名", "联系人中文姓名", "contact", "contactname"],
  contactNameEn: ["联系人英文姓名", "联系人英文名", "英文姓名", "contactnameen", "contactenglishname"],
  contactTitle: ["联系人职位", "职位", "contacttitle", "title"],
  contactPhone: ["联系电话", "电话", "手机", "contactphone", "phone"],
  contactEmail: ["联系邮箱", "邮箱", "contactemail", "email"],
  contactPersonality: ["联系人性格爱好", "性格爱好", "性格", "爱好", "contactpersonality", "personality"],
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
