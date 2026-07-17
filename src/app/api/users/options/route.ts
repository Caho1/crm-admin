import { getDb } from "@/db/client";
import { handleApiError, ok, requireApiAdmin } from "@/lib/api";

export async function GET() {
  try {
    await requireApiAdmin();
    const rows = getDb().prepare(`
      SELECT id, username, name, status
      FROM users
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, name
    `).all();
    return ok(rows);
  } catch (error) {
    return handleApiError(error);
  }
}
