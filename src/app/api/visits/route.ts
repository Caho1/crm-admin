import { getDb } from "@/db/client";
import { ApiError, created, handleApiError, ok, paginationFrom, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertCustomerAccess, customerCanEdit, customerScope } from "@/lib/permissions";
import { addCondition, searchLike, uniqueCode, whereSql } from "@/lib/query";
import { visitSchema } from "@/lib/validation";

// 校验关联产品真实存在，避免 SQLite 外键违例直接变成 500
function assertProductsExist(db: ReturnType<typeof getDb>, productIds: number[]) {
  const ids = [...new Set(productIds)];
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(", ");
  const found = (db.prepare(`SELECT COUNT(*) AS count FROM products WHERE id IN (${placeholders})`).get(...ids) as { count: number }).count;
  if (found !== ids.length) {
    throw new ApiError(422, "PRODUCT_NOT_FOUND", "包含不存在的产品", { productIds: "包含不存在的产品" });
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = paginationFrom(searchParams);
    const conditions = ["v.deleted_at IS NULL", "c.deleted_at IS NULL"];
    const params: unknown[] = [];
    const scope = customerScope(user, "c");
    addCondition(conditions, params, scope.sql, ...scope.params);
    if (searchParams.get("q")) {
      const value = searchLike(searchParams.get("q"));
      addCondition(conditions, params, "(v.title LIKE ? OR v.report_no LIKE ? OR c.name LIKE ? OR v.meeting_notes LIKE ?)", value, value, value, value);
    }
    if (searchParams.get("status")) addCondition(conditions, params, "v.status = ?", searchParams.get("status"));
    if (searchParams.get("customerId")) addCondition(conditions, params, "v.customer_id = ?", Number(searchParams.get("customerId")));
    if (searchParams.get("dateFrom")) addCondition(conditions, params, "v.visit_date >= ?", searchParams.get("dateFrom"));
    if (searchParams.get("dateTo")) addCondition(conditions, params, "v.visit_date <= ?", searchParams.get("dateTo"));
    const where = whereSql(conditions);
    const db = getDb();
    const edit = customerCanEdit(user, "c");
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM visits v JOIN customers c ON c.id = v.customer_id ${where}`).get(...params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT v.id, v.report_no AS reportNo, v.title, v.customer_id AS customerId,
        c.name AS customerName, v.visit_date AS visitDate,
        v.internal_participants AS internalParticipants,
        v.customer_participants AS customerParticipants,
        v.company_profile AS companyProfile, v.meeting_notes AS meetingNotes,
        v.follow_up AS followUp, v.status, v.created_by AS createdBy,
        creator.name AS creatorName, v.created_at AS createdAt, v.updated_at AS updatedAt,
        (SELECT GROUP_CONCAT(p.class_name || ' / ' || p.grade, '、')
         FROM visit_products vp JOIN products p ON p.id = vp.product_id
         WHERE vp.visit_id = v.id) AS productLabels,
        (SELECT json_group_array(product_id) FROM visit_products WHERE visit_id = v.id) AS productIdsJson,
        ${edit.sql} AS canEdit
      FROM visits v
      JOIN customers c ON c.id = v.customer_id
      JOIN users creator ON creator.id = v.created_by
      ${where}
      ORDER BY v.visit_date DESC, v.id DESC LIMIT ? OFFSET ?
    `).all(...edit.params, ...params, pageSize, offset) as Array<Record<string, unknown> & { productIdsJson?: string }>;
    const data = rows.map(({ productIdsJson, ...row }) => ({
      ...row,
      productIds: productIdsJson ? JSON.parse(productIdsJson) : [],
    }));
    return ok(data, { page, pageSize, total });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = await parseBody(request, visitSchema);
    assertCustomerAccess(user, input.customerId, "edit");
    const db = getDb();
    const reportNo = input.reportNo || uniqueCode("VR", (code) =>
      Boolean(db.prepare("SELECT id FROM visits WHERE report_no = ?").get(code)),
    );
    // 查重不区分大小写；已软删的报告编号在删除时已释放，不参与查重
    if (db.prepare("SELECT id FROM visits WHERE report_no = ? COLLATE NOCASE AND deleted_at IS NULL").get(reportNo)) {
      throw new ApiError(409, "DUPLICATE_REPORT_NO", "报告编号已存在");
    }
    assertProductsExist(db, input.productIds);
    const id = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO visits
          (report_no, title, customer_id, visit_date, internal_participants,
           customer_participants, company_profile, meeting_notes, follow_up, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(reportNo, input.title, input.customerId, input.visitDate, input.internalParticipants,
        input.customerParticipants, input.companyProfile, input.meetingNotes, input.followUp, input.status, user.id);
      const visitId = Number(result.lastInsertRowid);
      const attach = db.prepare("INSERT OR IGNORE INTO visit_products (visit_id, product_id) VALUES (?, ?)");
      for (const productId of input.productIds) attach.run(visitId, productId);
      return visitId;
    })();
    writeAudit(user.id, "create", "visit", id, `新建拜访报告 ${reportNo}`);
    return created({ id, reportNo });
  } catch (error) {
    return handleApiError(error);
  }
}
