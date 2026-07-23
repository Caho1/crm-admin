import { SettingsPage } from "@/components/settings-page";
import { requirePageAdmin } from "@/lib/auth";

export const metadata = { title: "设置" };

export default async function SettingsRoute() {
  await requirePageAdmin();
  return <SettingsPage />;
}
