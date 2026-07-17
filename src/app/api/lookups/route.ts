import { getDb } from "@/db/client";
import { handleApiError, ok, requireApiUser } from "@/lib/api";
import { customerScope } from "@/lib/permissions";

export async function GET() {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const scope = customerScope(user, "c");
    const customers = db
      .prepare(`
        SELECT c.id, c.name, c.owner_id AS ownerId
        FROM customers c
        WHERE c.deleted_at IS NULL AND ${scope.sql}
        ORDER BY c.name COLLATE NOCASE
      `)
      .all(...scope.params);
    const products = db
      .prepare(`
        SELECT id, class_name AS className, grade, brand,
          class_name || ' / ' || grade AS label
        FROM products
        WHERE status = 'active'
        ORDER BY class_name, grade
      `)
      .all();
    const users = db
      .prepare(`
        SELECT id, name, role
        FROM users
        WHERE status = 'active'
        ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, name
      `)
      .all();
    return ok({ customers, products, users });
  } catch (error) {
    return handleApiError(error);
  }
}
