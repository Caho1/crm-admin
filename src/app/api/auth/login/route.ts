import { createSession, verifyCredentials } from "@/lib/auth";
import { handleApiError, ok, parseBody } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = await parseBody(request, loginSchema);
    const result = await verifyCredentials(input.username, input.password);
    if (!result.ok) {
      const message =
        result.reason === "disabled"
          ? "账号已停用，请联系管理员"
          : "账号或密码不正确";
      return Response.json(
        { error: { code: result.reason === "disabled" ? "ACCOUNT_DISABLED" : "INVALID_CREDENTIALS", message } },
        { status: result.reason === "disabled" ? 403 : 401 },
      );
    }
    await createSession(result.user.id);
    writeAudit(result.user.id, "login", "session", null, `${result.user.name} 登录系统`);
    return ok(result.user);
  } catch (error) {
    return handleApiError(error);
  }
}
