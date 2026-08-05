import { getDb } from "@/db/client";
import type { DictType } from "./dicts";

// 每类标签实际被哪张表的哪一列引用。删除标签前用它判断是否还有业务数据在用。
const USAGE_SOURCE: Record<DictType, { table: string; column: string; softDelete: boolean }> = {
  customer_category: { table: "customers", column: "category", softDelete: true },
  product_class: { table: "products", column: "class_name", softDelete: false },
  industry: { table: "customers", column: "industry", softDelete: true },
};

export function dictUsageCount(type: DictType, code: string) {
  const source = USAGE_SOURCE[type];
  if (!source) return 0;
  const where = source.softDelete ? `${source.column} = ? AND deleted_at IS NULL` : `${source.column} = ?`;
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM ${source.table} WHERE ${where}`)
    .get(code) as { count: number };
  return row.count;
}

// 一次算出某个分组下所有 code 的引用数，避免在列表里逐行查询
export function dictUsageMap(type: DictType) {
  const source = USAGE_SOURCE[type];
  if (!source) return new Map<string, number>();
  const where = source.softDelete ? "WHERE deleted_at IS NULL" : "";
  const rows = getDb()
    .prepare(`SELECT ${source.column} AS code, COUNT(*) AS count FROM ${source.table} ${where} GROUP BY ${source.column}`)
    .all() as Array<{ code: string; count: number }>;
  return new Map(rows.map((row) => [row.code, row.count]));
}
