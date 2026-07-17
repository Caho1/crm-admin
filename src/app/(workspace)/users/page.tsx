import { UserAdmin } from "@/components/user-admin";
import { requirePageAdmin } from "@/lib/auth";

export const metadata = { title: "用户权限" };

export default async function UsersPage() {
  await requirePageAdmin();
  return <UserAdmin />;
}
