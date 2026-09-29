import { readFile } from "@/lib/storage";
import { getDb } from "@/db/client";
import { ApiError, handleApiError, integerId, requireApiUser } from "@/lib/api";
import { CARD_COLUMNS, type CardSide } from "@/lib/contacts";
import { assertCustomerAccess } from "@/lib/permissions";

type Context = { params: Promise<{ id: string; contactId: string }> };

// 名片图片单独取，避免客户详情接口把 BLOB 一起带出来
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const params = await context.params;
    const customerId = integerId(params.id);
    const contactId = integerId(params.contactId);
    await assertCustomerAccess(user, customerId, "view");
    const side = (new URL(request.url).searchParams.get("side") || "front") as CardSide;
    if (side !== "front" && side !== "back") throw new ApiError(400, "INVALID_SIDE", "名片只有正面与反面");
    const columns = CARD_COLUMNS[side];
    const row = (await getDb()
      .prepare(`SELECT ${columns.mime} AS mime, ${columns.data} AS data, ${columns.key} AS key FROM contacts WHERE id = ? AND customer_id = ?`)
      .get(contactId, customerId)) as { mime: string; data: Buffer | null; key: string | null } | undefined;
    if (!row || (!row.data && !row.key)) throw new ApiError(404, "NOT_FOUND", "名片图片不存在");
    const data = await readFile(row.key, row.data);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": row.mime || "image/jpeg",
        "Content-Length": String(data.length),
        // 内容变了 URL 上的 v 也会变，可以安全地长缓存（私有，不进共享缓存）
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
