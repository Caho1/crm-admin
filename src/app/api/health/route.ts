import { getDb, isPostgres } from "@/db/client";
import { objectStore, bucketName } from "@/lib/storage";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await getDb().prepare("SELECT 1 FROM users LIMIT 1").get();
    if (isPostgres() && !(await objectStore().bucketExists(bucketName()))) throw new Error("Missing bucket");
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
