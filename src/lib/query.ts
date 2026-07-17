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
