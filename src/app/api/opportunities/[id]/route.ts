import { getDb } from "@/db/client";
import { handleApiError, integerId, ok, parseBody, requireApiUser } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertCustomerAccess, assertResourceAccess } from "@/lib/permissions";
import { opportunitySchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertResourceAccess(user, "opportunities", id, "edit");
    const input = await parseBody(request, opportunitySchema);
    assertCustomerAccess(user, input.customerId, "edit");
    const db = getDb();
    const current = db.prepare("SELECT owner_id AS ownerId FROM opportunities WHERE id = ?").get(id) as { ownerId: number };
    const ownerId = user.role === "admin" && input.ownerId ? input.ownerId : current.ownerId;
    db.prepare(`
      UPDATE opportunities SET name = ?, customer_id = ?, product_id = ?, stage = ?,
        estimated_quantity = ?, estimated_amount = ?, currency = ?, owner_id = ?,
        next_action = ?, next_follow_up_date = ?, notes = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(input.name, input.customerId, input.productId || null, input.stage,
      input.estimatedQuantity ?? null, input.estimatedAmount ?? null, input.currency,
      ownerId, input.nextAction, input.nextFollowUpDate, input.notes, input.status, id);
    writeAudit(user.id, "update", "opportunity", id, `更新商机 ${input.name}`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = integerId((await context.params).id);
    assertResourceAccess(user, "opportunities", id, "edit");
    const db = getDb();
    const row = db.prepare("SELECT name FROM opportunities WHERE id = ?").get(id) as { name: string };
    db.prepare("UPDATE opportunities SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    writeAudit(user.id, "delete", "opportunity", id, `删除商机 ${row.name}`);
    return ok({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
