import type { Database } from "better-sqlite3";
import type { ProductCompetitorInput } from "@/lib/validation";

export type ProductCompetitorRow = {
  id: number;
  productId: number;
  grade: string;
  manufacturer: string;
  notes: string;
};

/**
 * 把表单提交的竞争型号数组同步到库里：带 id 的更新、不带 id 的新增、
 * 库里有但这次没提交的删除；顺序按数组下标存进 sort_order。
 */
export function saveCompetitors(db: Database, productId: number, competitors: ProductCompetitorInput[]) {
  const existing = db.prepare("SELECT id FROM product_competitors WHERE product_id = ?").all(productId) as Array<{ id: number }>;
  const existingIds = new Set(existing.map((row) => row.id));
  const keptIds = new Set<number>();

  competitors.forEach((competitor, index) => {
    if (competitor.id && existingIds.has(competitor.id)) {
      db.prepare(`
        UPDATE product_competitors SET grade = ?, manufacturer = ?, notes = ?, sort_order = ?
        WHERE id = ? AND product_id = ?
      `).run(competitor.grade, competitor.manufacturer, competitor.notes, index, competitor.id, productId);
      keptIds.add(competitor.id);
      return;
    }
    const inserted = db.prepare(`
      INSERT INTO product_competitors (product_id, grade, manufacturer, notes, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(productId, competitor.grade, competitor.manufacturer, competitor.notes, index);
    keptIds.add(Number(inserted.lastInsertRowid));
  });

  const remove = db.prepare("DELETE FROM product_competitors WHERE id = ?");
  for (const row of existing) if (!keptIds.has(row.id)) remove.run(row.id);
}

/**
 * 给产品列表按 id 批量补上竞争型号。产品编辑弹窗直接吃列表行数据
 * （不像客户那样另拉详情接口），所以竞品必须随列表一起返回。
 */
export function attachCompetitors<T extends { id: number }>(db: Database, rows: T[]) {
  if (!rows.length) return rows.map((row) => ({ ...row, competitors: [] as ProductCompetitorRow[] }));
  const placeholders = rows.map(() => "?").join(", ");
  const competitors = db.prepare(`
    SELECT id, product_id AS productId, grade, manufacturer, notes
    FROM product_competitors WHERE product_id IN (${placeholders})
    ORDER BY product_id, sort_order, id
  `).all(...rows.map((row) => row.id)) as ProductCompetitorRow[];
  const byProduct = new Map<number, ProductCompetitorRow[]>();
  for (const item of competitors) {
    const list = byProduct.get(item.productId);
    if (list) list.push(item);
    else byProduct.set(item.productId, [item]);
  }
  return rows.map((row) => ({ ...row, competitors: byProduct.get(row.id) || [] }));
}
