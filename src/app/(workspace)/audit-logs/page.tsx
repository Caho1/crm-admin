import { AuditLogPage } from "@/components/audit-log-page";
import { requirePageAdmin } from "@/lib/auth";

export const metadata = { title: "审计日志" };

export default async function AuditLogsPage() {
  await requirePageAdmin();
  return <AuditLogPage />;
}
