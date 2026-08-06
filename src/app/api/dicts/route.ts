import { getDb } from "@/db/client";
import { ApiError, created, handleApiError, ok, parseBody, requireApiAdmin, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { dictUsageMap } from "@/lib/dict-usage";
import { DICT_TYPES, isDictType, type DictItem, type DictMap } from "@/lib/dicts";
import { dictItemSchema } from "@/lib/validation";

const SELECT_COLUMNS = `
  id, type, code, label, label_en AS labelEn, label_ko AS labelKo,
  sort_order AS sortOrder, status
`;

// 读取对所有登录用户开放：表单下拉、列表筛选都要用。写入仅管理员。
export async function GET(request: Request) {
  try {
    await requireApiUser();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const includeInactive = searchParams.get("includeInactive") === "1";
    if (type && !isDictType(type)) throw new ApiError(400, "UNKNOWN_DICT_TYPE", "未知的标签分组");

    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (type) {
      conditions.push("type = ?");
      params.push(type);
    }
    if (!includeInactive) conditions.push("status = 'active'");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM dict_items ${where} ORDER BY type, sort_order, id`)
      .all(...params) as DictItem[];

    // 管理页需要知道每个标签被多少条业务数据引用，才能提示能否删除
    if (searchParams.get("withUsage") === "1") {
      const usageByType = new Map(DICT_TYPES.map((item) => [item.type, dictUsageMap(item.type)]));
      for (const row of rows) row.usageCount = usageByType.get(row.type)?.get(row.code) ?? 0;
    }

    // 按分组收拢成 { type: items[] }，前端拿到即可直接渲染下拉
    const grouped: DictMap = Object.fromEntries(DICT_TYPES.map((item) => [item.type, []]));
    for (const row of rows) (grouped[row.type] ||= []).push(row);
    return ok(grouped);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiAdmin();
    const input = await parseBody(request, dictItemSchema);
    const db = getDb();
    const duplicate = db
      .prepare("SELECT id FROM dict_items WHERE type = ? AND code = ? COLLATE NOCASE")
      .get(input.type, input.code);
    if (duplicate) throw new ApiError(409, "DUPLICATE_DICT_CODE", "该分组下已存在相同的选项值");

    const result = db
      .prepare(`
        INSERT INTO dict_items (type, code, label, label_en, label_ko, sort_order, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(input.type, input.code, input.label, input.labelEn, input.labelKo, input.sortOrder, input.status);
    const id = Number(result.lastInsertRowid);
    const groupLabel = DICT_TYPES.find((item) => item.type === input.type)?.label || input.type;
    writeAudit(user.id, "create", "dict_item", id, `新建标签 ${groupLabel} / ${input.label}`);
    return created({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
