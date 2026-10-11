import type { Database } from "@/db/client";
import { ApiError } from "./api";
import { attachCompetitors } from "./products";

export type CustomerMaterialInput = { productId: number; competitorIds: number[] };

/** Caller owns the transaction, including customer/contact changes. */
export async function saveCustomerMaterials(db: Database, customerId: number, materials?: CustomerMaterialInput[]) {
  if (materials === undefined) return; // Older clients must not erase relationships.
  const seen = new Set<number>();
  for (const [index, item] of materials.entries()) {
    const path = `materials.${index}`;
    if (seen.has(item.productId)) throw new ApiError(422, "DUPLICATE_MATERIAL", "同一产品请只添加一次", { [`${path}.productId`]: "同一产品请只添加一次" });
    seen.add(item.productId);
    if (!await db.prepare("SELECT id FROM products WHERE id = ?").get(item.productId)) {
      throw new ApiError(422, "INVALID_PRODUCT", "所选产品不存在", { [`${path}.productId`]: "所选产品不存在" });
    }
    for (const competitorId of item.competitorIds) {
      if (!await db.prepare("SELECT id FROM product_competitors WHERE id = ? AND product_id = ?").get(competitorId, item.productId)) {
        throw new ApiError(422, "INVALID_COMPETITOR", "请选择该产品对应的竞争型号", { [`${path}.competitorIds`]: "请选择该产品对应的竞争型号" });
      }
    }
  }
  await db.prepare("DELETE FROM customer_products WHERE customer_id = ?").run(customerId);
  for (const item of materials) {
    await db.prepare("INSERT INTO customer_products (customer_id, product_id) VALUES (?, ?)").run(customerId, item.productId);
    for (const competitorId of new Set(item.competitorIds)) {
      await db.prepare("INSERT INTO customer_competitors (customer_id, product_id, competitor_id) VALUES (?, ?, ?)").run(customerId, item.productId, competitorId);
    }
  }
}

export async function listCustomerMaterials(db: Database, customerId: number) {
  const products = await db.prepare(`SELECT p.id, p.class_name AS className, p.grade, p.brand,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id = ? AND o.product_id = p.id AND o.deleted_at IS NULL) AS orderCount
    FROM customer_products cp JOIN products p ON p.id = cp.product_id
    WHERE cp.customer_id = ? ORDER BY p.class_name, p.grade`).all(customerId, customerId) as Array<{ id: number; className: string; grade: string; brand: string; orderCount: number }>;
  const selected = await db.prepare("SELECT competitor_id AS competitorId FROM customer_competitors WHERE customer_id = ?").all(customerId) as Array<{ competitorId: number }>;
  const ids = new Set(selected.map((row) => row.competitorId));
  return (await attachCompetitors(db, products)).map((product) => ({ ...product, competitors: product.competitors.filter((item) => ids.has(item.id)) }));
}
