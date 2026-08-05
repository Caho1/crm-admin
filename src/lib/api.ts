import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getCurrentUser } from "./auth";
import type { PaginationMeta, SessionUser } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

// meta 允许在分页字段之外附带列表级的汇总（如订单的履约状态计数）
export function ok<T, M extends PaginationMeta = PaginationMeta>(data: T, meta?: M) {
  return NextResponse.json(meta ? { data, meta } : { data });
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, fields: error.fields } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    const fields = Object.fromEntries(
      error.issues.map((issue) => [issue.path.join("."), issue.message]),
    );
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "请检查表单内容", fields } },
      { status: 422 },
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "系统处理失败，请稍后重试" } },
    { status: 500 },
  );
}

export async function parseBody<T>(request: Request, schema: ZodType<T>) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求内容不是有效的 JSON");
  }
  return schema.parse(input);
}

export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "登录已失效，请重新登录");
  return user;
}

export async function requireApiAdmin() {
  const user = await requireApiUser();
  if (user.role !== "admin") {
    throw new ApiError(403, "FORBIDDEN", "当前账号没有管理员权限");
  }
  return user;
}

export function paginationFrom(searchParams: URLSearchParams) {
  const requestedPage = Number(searchParams.get("page") || 1);
  const requestedSize = Number(searchParams.get("pageSize") || 20);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = [10, 20, 50, 100].includes(requestedSize) ? requestedSize : 20;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function integerId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "INVALID_ID", "记录编号无效");
  }
  return id;
}
