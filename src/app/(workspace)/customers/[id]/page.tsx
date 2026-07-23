import { notFound } from "next/navigation";
import { CustomerProfile } from "@/components/customer-profile";
import { requirePageUser } from "@/lib/auth";

export const metadata = { title: "客户详情" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();
  return <CustomerProfile id={numericId} />;
}
