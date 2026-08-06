import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, parseBody, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { dictUsageCount } from "@/lib/dict-usage";
import { DICT_TYPES, type DictType } from "@/lib/dicts";
import { dictItemUpdateSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
type DictRow = { id: number; type: DictType; code: string; label: string; status: string };

function loadItem(id: number) {
  const row = getDb()
    .prepare("SELECT id, type, code, label, status FROM dict_items WHERE id = ?")
    .get(id) as DictRow | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "标签不存在");
  return row;
}

/** 日志里写「客户分类」而不是 customer_category */
function typeLabel(type: DictType) {
  return DICT_TYPES.find((item) => item.type === type)?.label || type;
}

// 只改展示名 / 排序 / 启停；code 不可改，改了历史数据就对不上了
export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireApiAdmin();
    const id = integerId((await context.params).id);
    const item = loadItem(id);
    const input = await parseBody(request, dictItemUpdateSchema);
    getDb()
      .prepare(`
        UPDATE dict_items
        SET label = ?, label_en = ?, label_ko = ?, sort_order = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `)
      .run(input.label, input.labelEn, input.labelKo, input.sortOrder, input.status, id);
    // 列表里的开关走的也是这个接口，日志要能看出到底是启停还是改名
    const statusChanged = input.status !== item.status;
    writeAudit(
      user.id,
      statusChanged ? (input.status === "active" ? "enable" : "disable") : "update",
      "dict_item",
      id,
      statusChanged
        ? `${input.status === "active" ? "启用" : "停用"}标签 ${typeLabel(item.type)} / ${input.label}`
        : `更新标签 ${typeLabel(item.type)} / ${input.label}`,
    );
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}

// 没有业务数据引用时物理删除；已被引用则降级为停用，保证历史记录仍能显示原标签
export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireApiAdmin();
    const id = integerId((await context.params).id);
    const item = loadItem(id);
    const usage = dictUsageCount(item.type, item.code);
    const db = getDb();
    if (usage > 0) {
      db.prepare("UPDATE dict_items SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").run(id);
      writeAudit(user.id, "disable", "dict_item", id, `停用标签 ${typeLabel(item.type)} / ${item.label}（被 ${usage} 条数据引用）`);
      return ok({ id, disabled: true, usageCount: usage });
    }
    db.prepare("DELETE FROM dict_items WHERE id = ?").run(id);
    writeAudit(user.id, "delete", "dict_item", id, `删除标签 ${typeLabel(item.type)} / ${item.label}`);
    return ok({ id, disabled: false, usageCount: 0 });
  } catch (error) {
    return handleApiError(error);
  }
}
