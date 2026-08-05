import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertResourceAccess } from "@/lib/permissions";

type Context = { params: Promise<{ id: string }> };

// docx 只会是办公室文档，10MB 足够宽裕；限制大小避免 BLOB 撑爆 SQLite
const MAX_SIZE = 10 * 1024 * 1024;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertResourceAccess(user, "visits", id, "view");
    const row = getDb()
      .prepare("SELECT attachment_name AS name, attachment_data AS data FROM visits WHERE id = ? AND deleted_at IS NULL")
      .get(id) as { name: string; data: Buffer | null } | undefined;
    if (!row?.data) throw new ApiError(404, "NOT_FOUND", "附件不存在");
    // RFC 5987：中文文件名走 filename*，再给一个纯 ASCII 兜底名
    const encoded = encodeURIComponent(row.name || "visit-report.docx");
    return new Response(new Uint8Array(row.data), {
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Disposition": `attachment; filename="visit-report.docx"; filename*=UTF-8''${encoded}`,
        "Content-Length": String(row.data.length),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertResourceAccess(user, "visits", id, "edit");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(422, "FILE_REQUIRED", "请选择要上传的文件");
    if (!file.name.toLowerCase().endsWith(".docx")) throw new ApiError(422, "INVALID_FILE_TYPE", "仅支持 .docx 文件");
    if (file.size === 0 || file.size > MAX_SIZE) throw new ApiError(422, "INVALID_FILE_SIZE", "文件大小不能超过 10MB");
    const data = Buffer.from(await file.arrayBuffer());
    getDb()
      .prepare("UPDATE visits SET attachment_name = ?, attachment_data = ?, updated_at = datetime('now') WHERE id = ?")
      .run(file.name, data, id);
    writeAudit(user.id, "update", "visit", id, `上传拜访附件 ${file.name}`);
    return ok({ id, attachmentName: file.name });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertResourceAccess(user, "visits", id, "edit");
    getDb()
      .prepare("UPDATE visits SET attachment_name = '', attachment_data = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(id);
    writeAudit(user.id, "update", "visit", id, "删除拜访附件");
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
