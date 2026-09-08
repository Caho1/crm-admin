import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { ApiError } from "./api";

export function addCondition(
  conditions: string[],
  params: unknown[],
  condition: string,
  ...values: unknown[]
) {
  conditions.push(condition);
  params.push(...values);
}

export function whereSql(conditions: string[]) {
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

export function searchLike(value: string | null) {
  return `%${(value || "").trim()}%`;
}

/** 搜索框按空格拆词，最多 5 个词，避免一长串输入拼出过大的 SQL */
export function searchTerms(value: string | null) {
  return (value || "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
}

export function generatedCode(prefix: string) {
  // 业务统一按北京时间（UTC+8）取日期，避免依赖服务器时区
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const date = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("");
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0")}`.toUpperCase();
  return `${prefix}-${date}-${suffix}`;
}

// 自动生成编号：生成后查重，撞号时重试，避免并发/同毫秒冲突直接报错
export function uniqueCode(prefix: string, exists: (code: string) => boolean) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatedCode(prefix);
    if (!exists(code)) return code;
  }
  throw new ApiError(500, "CODE_GENERATION_FAILED", "编号生成失败，请重试");
}

/**
 * 订单编号 / 客户编号这类业务编号，留空时直接用数据库自增 id 当编号：纯数字、天然唯一，
 * 不会像「日期 + 随机数」那样在同一批导入里撞号。id 要插入后才知道，所以先塞一个占位值，
 * 插入拿到 id 后再把这一行的编号列改回真正的 id。
 */
export function sequentialPlaceholder() {
  return `__pending__${crypto.randomUUID()}`;
}

export function finalizeSequentialCode(db: Database.Database, table: string, column: string, id: number, supplied: string | null) {
  if (supplied) return supplied;
  const code = String(id);
  db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(code, id);
  return code;
}
