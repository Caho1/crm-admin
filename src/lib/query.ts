import crypto from "node:crypto";
import type { Database } from "@/db/client";
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
export async function uniqueCode(prefix: string, exists: (code: string) => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatedCode(prefix);
    if (!(await exists(code))) return code;
  }
  throw new ApiError(500, "CODE_GENERATION_FAILED", "编号生成失败，请重试");
}

/**
 * 留空编号先插入随机占位值，再从自增 id 开始寻找可用的纯数字编号。
 * 手填编号可能已经占用 id，因此最终编号不保证等于 id。
 */
export function sequentialPlaceholder() {
  return `__pending__${crypto.randomUUID()}`;
}

/** 必须在插入行的同一事务内调用。保存点使 PG 唯一冲突后仍可重试，并保留整批回滚能力。 */
export async function finalizeSequentialCode(db: Database, table: string, column: string, id: number, supplied: string | null, reservedCodes: ReadonlySet<string> = new Set()) {
  if (supplied) return supplied;
  for (let candidate = id; Number.isSafeInteger(candidate) && candidate > 0; candidate += 1) {
    const code = String(candidate);
    if (reservedCodes.has(code)) continue;
    await db.prepare("SAVEPOINT sequential_code").run();
    try {
      const result = await db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(code, id);
      if (result.changes !== 1) throw new Error("编号对应的记录不存在");
      await db.prepare("RELEASE SAVEPOINT sequential_code").run();
      return code;
    } catch (error) {
      await db.prepare("ROLLBACK TO SAVEPOINT sequential_code").run();
      await db.prepare("RELEASE SAVEPOINT sequential_code").run();
      const constraintCode = (error as { code?: string }).code;
      if (constraintCode !== "23505" && constraintCode !== "SQLITE_CONSTRAINT_UNIQUE") throw error;
    }
  }
  throw new ApiError(500, "CODE_GENERATION_FAILED", "编号生成失败，请重试");
}
