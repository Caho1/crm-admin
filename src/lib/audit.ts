import { getDb } from "@/db/client";

export async function writeAudit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  summary: string,
) {
  await getDb()
    .prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(userId, action, entityType, entityId, summary);
}
