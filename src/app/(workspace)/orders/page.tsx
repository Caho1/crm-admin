import { ResourcePage } from "@/components/resource-page";

export const metadata = { title: "订单 / 出货 / 到港" };

const ORDER_STATUSES = ["planned", "confirmed", "shipped", "arrived", "cancelled"];

// 支持从工作台统计卡带筛选下钻，如 /orders?status=confirmed
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { status } = await searchParams;
  const initialFilter = typeof status === "string" && ORDER_STATUSES.includes(status) ? status : undefined;
  return <ResourcePage resource="orders" initialFilter={initialFilter} />;
}
