import { getDb } from "@/db/client";
import { handleApiError, ok, requireApiUser } from "@/lib/api";
import { DICT_TYPES, type DictItem, type DictMap } from "@/lib/dicts";
import { customerScope } from "@/lib/permissions";

export async function GET() {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const scope = customerScope(user, "c");
    const customers = db
      .prepare(`
        SELECT c.id, c.name, c.owner_id AS ownerId
        FROM customers c
        WHERE c.deleted_at IS NULL AND ${scope.sql}
        ORDER BY c.name COLLATE NOCASE
      `)
      .all(...scope.params);
    // 返回全部产品（含已停用）：新建表单在前端过滤停用项，编辑历史单据时仍能正常回显
    const products = db
      .prepare(`
        SELECT id, class_name AS className, grade, brand, status,
          class_name || ' / ' || grade AS label
        FROM products
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, class_name, grade
      `)
      .all();
    const users = db
      .prepare(`
        SELECT id, name, role
        FROM users
        WHERE status = 'active'
        ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, name
      `)
      .all();
    // 只下发启用中的标签：停用项不再出现在新建/编辑下拉框里，
    // 但历史数据里的 code 仍会原样显示（见 dictLabelOf 的兜底）
    const dictRows = db
      .prepare(`
        SELECT id, type, code, label, label_en AS labelEn, label_ko AS labelKo,
          sort_order AS sortOrder, status
        FROM dict_items
        WHERE status = 'active'
        ORDER BY type, sort_order, id
      `)
      .all() as DictItem[];
    const dicts: DictMap = Object.fromEntries(DICT_TYPES.map((item) => [item.type, []]));
    for (const row of dictRows) (dicts[row.type] ||= []).push(row);

    return ok({ customers, products, users, dicts });
  } catch (error) {
    return handleApiError(error);
  }
}
