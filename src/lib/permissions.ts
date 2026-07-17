import { getDb } from "@/db/client";
import { ApiError } from "./api";
import type { SessionUser } from "./types";

export type AccessMode = "view" | "edit";
export type CustomerResource = "visits" | "opportunities" | "orders";

export function customerScope(user: SessionUser, alias = "c") {
  if (user.role === "admin") return { sql: "1 = 1", params: [] as number[] };
  return {
    sql: `(
      ${alias}.owner_id = ? OR EXISTS (
        SELECT 1 FROM customer_members scope_cm
        WHERE scope_cm.customer_id = ${alias}.id AND scope_cm.user_id = ?
      )
    )`,
    params: [user.id, user.id],
  };
}

export function customerCanEdit(user: SessionUser, alias = "c") {
  if (user.role === "admin") return { sql: "1", params: [] as number[] };
  return {
    sql: `(CASE WHEN ${alias}.owner_id = ? OR EXISTS (
      SELECT 1 FROM customer_members edit_cm
      WHERE edit_cm.customer_id = ${alias}.id
        AND edit_cm.user_id = ? AND edit_cm.access = 'edit'
    ) THEN 1 ELSE 0 END)`,
    params: [user.id, user.id],
  };
}

export function assertCustomerAccess(
  user: SessionUser,
  customerId: number,
  mode: AccessMode = "view",
) {
  const row = getDb()
    .prepare(`
      SELECT c.id, c.owner_id AS ownerId,
        (SELECT access FROM customer_members cm
         WHERE cm.customer_id = c.id AND cm.user_id = ?) AS memberAccess
      FROM customers c
      WHERE c.id = ? AND c.deleted_at IS NULL
    `)
    .get(user.id, customerId) as
    | { id: number; ownerId: number; memberAccess: "view" | "edit" | null }
    | undefined;

  if (!row) throw new ApiError(404, "NOT_FOUND", "客户不存在或已删除");
  if (user.role === "admin" || row.ownerId === user.id) return row;
  if (row.memberAccess && (mode === "view" || row.memberAccess === "edit")) return row;
  throw new ApiError(403, "FORBIDDEN", "你没有访问该客户的权限");
}

export function assertResourceAccess(
  user: SessionUser,
  resource: CustomerResource,
  resourceId: number,
  mode: AccessMode = "view",
) {
  const row = getDb()
    .prepare(`SELECT customer_id AS customerId FROM ${resource} WHERE id = ? AND deleted_at IS NULL`)
    .get(resourceId) as { customerId: number } | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "记录不存在或已删除");
  assertCustomerAccess(user, row.customerId, mode);
  return row;
}
