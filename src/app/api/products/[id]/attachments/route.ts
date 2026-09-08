import { getDb } from "@/db/client";
import { ApiError, created, handleApiError, integerId, ok, requireApiAdmin, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

// 附件只做存证用（RAPIDS / TDS / COA 等办公文档），10MB 足够宽裕，同时避免 BLOB 撑爆 SQLite
const MAX_SIZE = 10 * 1024 * 1024;

export async function GET(_request: Request, context: Context) {
  try {
    await requireApiUser();
    const id = integerId((await context.params).id);
    const rows = getDb()
      .prepare(`
        SELECT id, file_name AS fileName, mime_type AS mimeType, file_size AS fileSize, created_at AS createdAt
        FROM product_attachments WHERE product_id = ? ORDER BY created_at DESC, id DESC
      `)
      .all(id);
    return ok(rows);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireApiAdmin();
    const id = integerId((await context.params).id);
    const db = getDb();
    if (!db.prepare("SELECT id FROM products WHERE id = ?").get(id)) throw new ApiError(404, "NOT_FOUND", "产品不存在");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(422, "FILE_REQUIRED", "请选择要上传的文件");
    if (file.size === 0 || file.size > MAX_SIZE) throw new ApiError(422, "INVALID_FILE_SIZE", "文件大小不能超过 10MB");
    const data = Buffer.from(await file.arrayBuffer());
    const result = db.prepare(`
      INSERT INTO product_attachments (product_id, file_name, mime_type, file_data, file_size, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, file.name, file.type || "", data, file.size, user.id);
    const attachmentId = Number(result.lastInsertRowid);
    writeAudit(user.id, "update", "product", id, `上传产品附件 ${file.name}`);
    return created({ id: attachmentId, fileName: file.name, mimeType: file.type || "", fileSize: file.size });
  } catch (error) {
    return handleApiError(error);
  }
}
