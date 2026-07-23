import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertCustomerAccess, assertResourceAccess } from "@/lib/permissions";
import { generatedCode } from "@/lib/query";
import { visitSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertResourceAccess(user, "visits", id, "edit");
    const input = await parseBody(request, visitSchema);
    assertCustomerAccess(user, input.customerId, "edit");
    const db = getDb();
    const current = db.prepare("SELECT report_no AS reportNo FROM visits WHERE id = ?").get(id) as { reportNo: string } | undefined;
    if (!current) throw new ApiError(404, "NOT_FOUND", "拜访报告不存在");
    // 校验关联产品真实存在，避免外键违例直接变成 500
    const productIds = [...new Set(input.productIds)];
    if (productIds.length) {
      const placeholders = productIds.map(() => "?").join(", ");
      const found = (db.prepare(`SELECT COUNT(*) AS count FROM products WHERE id IN (${placeholders})`).get(...productIds) as { count: number }).count;
      if (found !== productIds.length) {
        throw new ApiError(422, "PRODUCT_NOT_FOUND", "包含不存在的产品", { productIds: "包含不存在的产品" });
      }
    }
    const reportNo = input.reportNo || current.reportNo || generatedCode("VR");
    if (db.prepare("SELECT id FROM visits WHERE report_no = ? COLLATE NOCASE AND id <> ? AND deleted_at IS NULL").get(reportNo, id)) {
      throw new ApiError(409, "DUPLICATE_REPORT_NO", "报告编号已存在");
    }
    db.transaction(() => {
      db.prepare(`
        UPDATE visits SET report_no = ?, title = ?, customer_id = ?, visit_date = ?,
          internal_participants = ?, customer_participants = ?, company_profile = ?,
          meeting_notes = ?, follow_up = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(reportNo, input.title, input.customerId, input.visitDate, input.internalParticipants,
        input.customerParticipants, input.companyProfile, input.meetingNotes, input.followUp, input.status, id);
      db.prepare("DELETE FROM visit_products WHERE visit_id = ?").run(id);
      const attach = db.prepare("INSERT OR IGNORE INTO visit_products (visit_id, product_id) VALUES (?, ?)");
      for (const productId of productIds) attach.run(id, productId);
    })();
    writeAudit(user.id, "update", "visit", id, `更新拜访报告 ${reportNo}`);
    return ok({ id, reportNo });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertResourceAccess(user, "visits", id, "edit");
    const db = getDb();
    const row = db.prepare("SELECT report_no AS reportNo FROM visits WHERE id = ?").get(id) as { reportNo: string };
    // 软删除同时释放业务编号（追加 #del-id 后缀），原编号之后可复用
    db.prepare(`
      UPDATE visits SET deleted_at = datetime('now'), updated_at = datetime('now'),
        report_no = report_no || '#del-' || id
      WHERE id = ?
    `).run(id);
    writeAudit(user.id, "delete", "visit", id, `删除拜访报告 ${row.reportNo}`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
