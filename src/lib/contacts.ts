import { storeFile } from "@/lib/storage";
import type { Database } from "@/db/client";
import { ApiError } from "@/lib/api";
import type { ContactInput } from "@/lib/validation";

export type CardSide = "front" | "back";

// 名片是手机拍的照片，前端已压到 1600px / JPEG，留 4MB 上限兜底，避免 BLOB 撑爆 SQLite
const MAX_CARD_BYTES = 4 * 1024 * 1024;

export const CARD_COLUMNS: Record<CardSide, { mime: string; data: string; key: string }> = {
  front: { mime: "card_front_mime", data: "card_front_data", key: "card_front_key" },
  back: { mime: "card_back_mime", data: "card_back_data", key: "card_back_key" },
};

type CardChange = "keep" | "clear" | { mime: string; data: Buffer };

/** data URL 三态解析：undefined 保持原图、空值删除、data:image 覆盖 */
function parseCard(value: string | null | undefined): CardChange {
  if (value === undefined) return "keep";
  if (!value) return "clear";
  // 图片格式不限，浏览器端能压缩的一律是 JPEG，压不动的（HEIC 等）按原格式存
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value);
  if (!match) throw new ApiError(422, "INVALID_CARD_IMAGE", "名片图片格式不支持");
  const data = Buffer.from(match[2], "base64");
  if (data.length === 0) throw new ApiError(422, "INVALID_CARD_IMAGE", "名片图片内容为空");
  if (data.length > MAX_CARD_BYTES) throw new ApiError(422, "CARD_IMAGE_TOO_LARGE", "单张名片图片不能超过 4MB");
  return { mime: match[1] === "image/jpg" ? "image/jpeg" : match[1], data };
}

async function applyCard(db: Database, contactId: number, side: CardSide, change: CardChange) {
  if (change === "keep") return;
  const columns = CARD_COLUMNS[side];
  if (change === "clear") {
    await db.prepare(`UPDATE contacts SET ${columns.mime} = '', ${columns.data} = NULL, ${columns.key} = NULL WHERE id = ?`).run(contactId);
    return;
  }
  const file = await storeFile(change.data);
  await db.prepare(`UPDATE contacts SET ${columns.mime} = ?, ${columns.data} = ?, ${columns.key} = ? WHERE id = ?`).run(change.mime, file.data, file.key, contactId);
}

/**
 * 把表单提交的联系人数组同步到库里：带 id 的更新、不带 id 的新增、
 * 库里有但这次没提交的删除；顺序按数组下标存进 sort_order。
 * 名片走三态（保持 / 删除 / 覆盖），编辑时不重传图片也不会丢原图。
 */
export async function saveContacts(db: Database, customerId: number, contacts: ContactInput[]) {
  const existing = (await db.prepare("SELECT id FROM contacts WHERE customer_id = ?").all(customerId)) as Array<{ id: number }>;
  const existingIds = new Set(existing.map((row) => row.id));
  const keptIds = new Set<number>();

  for (const [index, contact] of contacts.entries()) {
    const front = parseCard(contact.cardFront);
    const back = parseCard(contact.cardBack);
    if (contact.id && existingIds.has(contact.id)) {
      await db.prepare(`
        UPDATE contacts SET name = ?, name_en = ?, title = ?, phone = ?, email = ?, personality = ?, sort_order = ?
        WHERE id = ? AND customer_id = ?
      `).run(contact.name, contact.nameEn, contact.title, contact.phone, contact.email, contact.personality, index, contact.id, customerId);
      await applyCard(db, contact.id, "front", front);
      await applyCard(db, contact.id, "back", back);
      keptIds.add(contact.id);
      continue;
    }
    const frontFile = typeof front === "object" ? await storeFile(front.data) : { data: null, key: null };
    const backFile = typeof back === "object" ? await storeFile(back.data) : { data: null, key: null };
    const inserted = (await db.prepare(`
      INSERT INTO contacts (customer_id, name, name_en, title, phone, email, personality, sort_order,
        card_front_mime, card_front_data, card_back_mime, card_back_data, card_front_key, card_back_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      contact.name,
      contact.nameEn,
      contact.title,
      contact.phone,
      contact.email,
      contact.personality,
      index,
      typeof front === "object" ? front.mime : "",
      frontFile.data,
      typeof back === "object" ? back.mime : "",
      backFile.data,
      frontFile.key, backFile.key,
    ));
    keptIds.add(Number(inserted.lastInsertRowid));
  }

  const remove = db.prepare("DELETE FROM contacts WHERE id = ?");
  for (const row of existing) if (!keptIds.has(row.id)) await remove.run(row.id);
}

/** 详情接口用：名片只返回「有没有」，图片本身走 /api/customers/[id]/contacts/[contactId]/card */
export async function listContacts(db: Database, customerId: number) {
  return (await db.prepare(`
    SELECT id, name, name_en AS nameEn, title, phone, email, personality,
      (card_front_data IS NOT NULL OR card_front_key IS NOT NULL) AS hasCardFront,
      (card_back_data IS NOT NULL OR card_back_key IS NOT NULL) AS hasCardBack
    FROM contacts WHERE customer_id = ? ORDER BY sort_order, id
  `).all(customerId));
}
