import ExcelJS from "exceljs";
import { getDb } from "@/db/client";
import { ApiError, handleApiError, ok, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { IMPORT_FILE_PATTERN, customerHeaderAliases, normalizeHeader, readUploadWorksheet } from "@/lib/excel";

export const runtime = "nodejs";

/** Excel 列 → customers 表列，值只在单元格非空时写入（留空即不改） */
const TEXT_FIELDS: Array<{ field: string; column: string; label: string; max: number }> = [
  { field: "nameEn", column: "name_en", label: "客户名称（英文）", max: 160 },
  { field: "shortName", column: "short_name", label: "客户简称", max: 80 },
  // 行业是手填字段，按原文入库，不再校验是否在标签配置里
  { field: "industry", column: "industry", label: "行业", max: 120 },
  { field: "country", column: "country", label: "国家", max: 80 },
  { field: "region", column: "region", label: "地区", max: 80 },
  { field: "address", column: "address", label: "详细地址", max: 240 },
  { field: "description", column: "description", label: "客户简介", max: 2000 },
];

const STATUS_ALIASES: Record<string, string> = {
  potential: "potential",
  潜在客户: "potential",
  潜在: "potential",
  active: "active",
  活跃客户: "active",
  活跃: "active",
  inactive: "inactive",
  已停用: "inactive",
  停用: "inactive",
};

type ImportedCustomer = {
  rowNumber: number;
  mode: "create" | "update";
  id: number | null;
  name: string;
  /** customers 表列 → 值，只含文件里填了的列 */
  columns: Record<string, string>;
  ownerId: number | null;
  contact: { name: string; nameEn: string; title: string; phone: string; email: string; personality: string } | null;
  // 预检表格展示用
  categoryLabel: string;
  ownerName: string;
  status: string;
};

function cellText(row: ExcelJS.Row, mapping: Record<string, number>, field: string) {
  const column = mapping[field];
  if (!column) return "";
  const value = row.getCell(column).value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
  if (typeof value === "object" && "richText" in value) {
    return (value.richText as Array<{ text: string }>).map((part) => part.text).join("").trim();
  }
  return String(value).trim();
}

/** 标签列同时接受 code 与三语 label，统一转成库里存的 code */
function dictResolver(type: string) {
  const rows = getDb()
    .prepare("SELECT code, label, label_en AS labelEn, label_ko AS labelKo FROM dict_items WHERE type = ?")
    .all(type) as Array<{ code: string; label: string; labelEn: string; labelKo: string }>;
  const index = new Map<string, { code: string; label: string }>();
  for (const item of rows) {
    for (const key of [item.code, item.label, item.labelEn, item.labelKo]) {
      if (key) index.set(key.trim().toLowerCase(), { code: item.code, label: item.label });
    }
  }
  return (text: string) => index.get(text.trim().toLowerCase()) || null;
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
      for (const [field, aliases] of Object.entries(customerHeaderAliases)) {
        if (aliases.includes(normalized)) mapping[field] = column;
      }
    });
    if (!mapping.name) throw new ApiError(422, "MISSING_COLUMNS", "缺少必要列：客户名称（中文）");

    const db = getDb();
    const resolveCategory = dictResolver("customer_category");
    const errors: Array<{ row: number; message: string }> = [];
    const validRows: ImportedCustomer[] = [];
    const seenNames = new Set<string>();

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const name = cellText(row, mapping, "name");
      // 整行空白直接跳过（Excel 常见的尾部空行）
      const hasAnyValue = Object.keys(customerHeaderAliases).some((field) => cellText(row, mapping, field));
      if (!hasAnyValue) continue;

      const rowErrors: string[] = [];
      if (!name) rowErrors.push("客户名称（中文）不能为空");
      else if (name.length < 2) rowErrors.push("客户名称至少 2 个字符");
      else if (name.length > 160) rowErrors.push("客户名称超过 160 字");
      if (name && seenNames.has(name.toLowerCase())) rowErrors.push(`客户“${name}”在文件中重复`);
      if (name) seenNames.add(name.toLowerCase());

      const existing = name
        ? (db.prepare("SELECT id, status FROM customers WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL").get(name) as { id: number; status: string } | undefined)
        : undefined;

      const columns: Record<string, string> = {};
      for (const item of TEXT_FIELDS) {
        const text = cellText(row, mapping, item.field);
        if (!text) continue;
        if (text.length > item.max) rowErrors.push(`${item.label}超过 ${item.max} 字`);
        else columns[item.column] = text;
      }

      const categoryText = cellText(row, mapping, "category");
      let categoryLabel = "";
      if (categoryText) {
        const matched = resolveCategory(categoryText);
        if (!matched) rowErrors.push(`客户分类“${categoryText}”不在标签配置中`);
        else {
          columns.category = matched.code;
          categoryLabel = matched.label;
        }
      }

      const statusText = cellText(row, mapping, "status");
      if (statusText) {
        const status = STATUS_ALIASES[statusText] ?? STATUS_ALIASES[statusText.toLowerCase()];
        if (!status) rowErrors.push(`客户状态“${statusText}”无效（可用：潜在客户 / 活跃客户 / 已停用）`);
        else columns.status = status;
      }

      const ownerText = cellText(row, mapping, "ownerName");
      let owner: { id: number; name: string } | null = null;
      if (ownerText) {
        owner = (db.prepare("SELECT id, name FROM users WHERE name = ? COLLATE NOCASE").get(ownerText) as { id: number; name: string } | undefined) || null;
        if (!owner) rowErrors.push(`负责人“${ownerText}”不存在`);
      }

      const contactName = cellText(row, mapping, "contactName");
      const contactEmail = cellText(row, mapping, "contactEmail");
      const otherContactFields = ["contactNameEn", "contactTitle", "contactPhone", "contactPersonality"]
        .map((field) => cellText(row, mapping, field));
      if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) rowErrors.push("邮箱格式不正确");
      if (!contactName && (contactEmail || otherContactFields.some(Boolean))) {
        rowErrors.push("填写了联系人信息时，主要联系人不能为空");
      }

      if (rowErrors.length) {
        errors.push({ row: rowNumber, message: rowErrors.join("；") });
        continue;
      }

      validRows.push({
        rowNumber,
        mode: existing ? "update" : "create",
        id: existing?.id ?? null,
        name,
        columns,
        ownerId: owner?.id ?? null,
        contact: contactName
          ? {
              name: contactName,
              nameEn: cellText(row, mapping, "contactNameEn"),
              title: cellText(row, mapping, "contactTitle"),
              phone: cellText(row, mapping, "contactPhone"),
              email: contactEmail,
              personality: cellText(row, mapping, "contactPersonality"),
            }
          : null,
        categoryLabel,
        ownerName: owner?.name ?? "",
        status: columns.status || existing?.status || "potential",
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
        preview: validRows.slice(0, 20).map((row) => ({
          mode: row.mode,
          name: row.name,
          nameEn: row.columns.name_en || "",
          shortName: row.columns.short_name || "",
          category: row.categoryLabel,
          industry: row.columns.industry || "",
          ownerName: row.ownerName,
          status: row.status,
          contactName: row.contact?.name || "",
        })),
      });
    }

    db.transaction(() => {
      for (const row of validRows) {
        let customerId = row.id;
        if (row.mode === "create") {
          // 新建时才需要兜底：负责人默认落到执行导入的管理员，状态默认潜在客户
          const inserted = db.prepare(`
            INSERT INTO customers
              (name, name_en, short_name, category, country, region, industry, address, description, owner_id, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            row.name,
            row.columns.name_en ?? "",
            row.columns.short_name ?? "",
            row.columns.category ?? "",
            row.columns.country ?? "",
            row.columns.region ?? "",
            row.columns.industry ?? "",
            row.columns.address ?? "",
            row.columns.description ?? "",
            row.ownerId ?? admin.id,
            row.columns.status ?? "potential",
            admin.id,
          );
          customerId = Number(inserted.lastInsertRowid);
        } else {
          // 更新：只覆盖文件里填了的列，留空的列保持库里原值
          const assignments: string[] = [];
          const params: unknown[] = [];
          for (const [column, value] of Object.entries(row.columns)) {
            assignments.push(`${column} = ?`);
            params.push(value);
          }
          if (row.ownerId) {
            assignments.push("owner_id = ?");
            params.push(row.ownerId);
          }
          if (assignments.length) {
            assignments.push("updated_at = datetime('now')");
            db.prepare(`UPDATE customers SET ${assignments.join(", ")} WHERE id = ?`).run(...params, customerId);
          }
        }

        // 联系人同样是「填了才动」：更新排在最前的那位，没有就新建；
        // 其余联系人与名片图片不受导入影响（Excel 里带不了图）
        if (row.contact && customerId) {
          const first = db
            .prepare("SELECT id FROM contacts WHERE customer_id = ? ORDER BY sort_order, id LIMIT 1")
            .get(customerId) as { id: number } | undefined;
          if (first) {
            db.prepare("UPDATE contacts SET name = ?, name_en = ?, title = ?, phone = ?, email = ?, personality = ? WHERE id = ?")
              .run(row.contact.name, row.contact.nameEn, row.contact.title, row.contact.phone, row.contact.email, row.contact.personality, first.id);
          } else {
            db.prepare(`
              INSERT INTO contacts (customer_id, name, name_en, title, phone, email, personality, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            `).run(customerId, row.contact.name, row.contact.nameEn, row.contact.title, row.contact.phone, row.contact.email, row.contact.personality);
          }
        }
      }
    })();

    writeAudit(admin.id, "import", "customer", null, `从 ${file.name} 导入客户：新增 ${createCount} 条，更新 ${updateCount} 条`);
    return ok({ valid: true, imported: validRows.length, createCount, updateCount, errors: [] });
  } catch (error) {
    return handleApiError(error);
  }
}
