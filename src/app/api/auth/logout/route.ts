import { destroySession, getCurrentUser } from "@/lib/auth";
import { handleApiError, ok } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export async function POST() {
  try {
    const user = await getCurrentUser();
    await destroySession();
    if (user) writeAudit(user.id, "logout", "session", null, `${user.name} 退出系统`);
    return ok({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
