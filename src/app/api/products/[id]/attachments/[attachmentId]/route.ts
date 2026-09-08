import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, ok, requireApiAdmin, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

type Context = { params: Promise<{ id: string; attachmentId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireApiUser();
    const { id, attachmentId } = await context.params;
    const productId = integerId(id);
    const row = getDb()
      .prepare("SELECT file_name AS fileName, mime_type AS mimeType, file_data AS data FROM product_attachments WHERE id = ? AND product_id = ?")
      .get(integerId(attachmentId), productId) as { fileName: string; mimeType: string; data: Buffer } | undefined;
    if (!row) throw new ApiError(404, "NOT_FOUND", "附件不存在");
    // RFC 5987：中文文件名走 filename*，再给一个纯 ASCII 兜底名
    // inline 而不是 attachment：图片 / PDF 才能被 <img>、<iframe> 直接内嵌预览；
    // 需要另存为文件时前端用 <a download> 触发，同源请求不受这个响应头影响
    const encoded = encodeURIComponent(row.fileName);
    return new Response(new Uint8Array(row.data), {
      headers: {
        "Content-Type": row.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="attachment"; filename*=UTF-8''${encoded}`,
        "Content-Length": String(row.data.length),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireApiAdmin();
    const { id, attachmentId } = await context.params;
    const productId = integerId(id);
    const numericAttachmentId = integerId(attachmentId);
    const db = getDb();
    const row = db
      .prepare("SELECT file_name AS fileName FROM product_attachments WHERE id = ? AND product_id = ?")
      .get(numericAttachmentId, productId) as { fileName: string } | undefined;
    if (!row) throw new ApiError(404, "NOT_FOUND", "附件不存在");
    db.prepare("DELETE FROM product_attachments WHERE id = ? AND product_id = ?").run(numericAttachmentId, productId);
    writeAudit(user.id, "update", "product", productId, `删除产品附件 ${row.fileName}`);
    return ok({ id: numericAttachmentId });
  } catch (error) {
    return handleApiError(error);
  }
}
