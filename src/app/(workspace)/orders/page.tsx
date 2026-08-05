import { redirect } from "next/navigation";

// 订单已并入客户档案页（订单天然绑定客户），不再有独立列表。
// 保留这条路由做重定向，避免旧书签和历史链接落到 404。
export default function OrdersPage() {
  redirect("/customers");
}
