import { handleApiError, ok, requireApiUser } from "@/lib/api";

export async function GET() {
  try {
    return ok(await requireApiUser());
  } catch (error) {
    return handleApiError(error);
  }
}
