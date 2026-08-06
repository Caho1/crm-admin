import { CustomerOrders } from "@/components/customer-orders";
import { requirePageUser } from "@/lib/auth";

export const metadata = { title: "订单管理" };

// 全局订单管理页：跨客户查看/筛选所有订单。
// 客户档案页内的订单区块复用同一组件（传 customerId 即为单客户模式）。
export default async function OrdersPage() {
  const user = await requirePageUser();
  return <CustomerOrders canEdit isAdmin={user.role === "admin"} />;
}
