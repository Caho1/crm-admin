import { notFound } from "next/navigation";
import { CustomerOrdersPage } from "@/components/customer-orders-page";
import { requirePageUser } from "@/lib/auth";

export const metadata = { title: "订单记录" };

export default async function CustomerOrdersRoute({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();
  return <CustomerOrdersPage id={numericId} />;
}
