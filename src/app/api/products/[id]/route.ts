import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, parseBody, requireApiAdmin } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { saveCompetitors } from "@/lib/products";
import { productSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireApiAdmin();
    const id = integerId((await context.params).id);
    const input = await parseBody(request, productSchema);
    const db = getDb();
    if (!db.prepare("SELECT id FROM products WHERE id = ?").get(id)) throw new ApiError(404, "NOT_FOUND", "产品不存在");
    if (db.prepare("SELECT id FROM products WHERE class_name = ? COLLATE NOCASE AND grade = ? COLLATE NOCASE AND id <> ?").get(input.className, input.grade, id)) {
      throw new ApiError(409, "DUPLICATE_PRODUCT", "该产品大类和型号/牌号已存在");
    }
    db.transaction(() => {
      db.prepare(`
        UPDATE products SET class_name = ?, grade = ?, brand = ?, supplier = ?,
          application = ?, notes = ?, status = ?, updated_at = datetime('now') WHERE id = ?
      `).run(input.className, input.grade, input.brand, input.supplier, input.application, input.notes, input.status, id);
      saveCompetitors(db, id, input.competitors);
    })();
    writeAudit(user.id, "update", "product", id, `更新产品 ${input.className} / ${input.grade}`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireApiAdmin();
    const id = integerId((await context.params).id);
    const db = getDb();
    const row = db.prepare("SELECT class_name AS className, grade FROM products WHERE id = ?").get(id) as { className: string; grade: string } | undefined;
    if (!row) throw new ApiError(404, "NOT_FOUND", "产品不存在");
    db.prepare("UPDATE products SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").run(id);
    writeAudit(user.id, "disable", "product", id, `停用产品 ${row.className} / ${row.grade}`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
