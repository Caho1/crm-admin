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
