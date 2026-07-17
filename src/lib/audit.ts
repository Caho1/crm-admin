import { getDb } from "@/db/client";

export function writeAudit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  summary: string,
) {
  getDb()
    .prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(userId, action, entityType, entityId, summary);
}
