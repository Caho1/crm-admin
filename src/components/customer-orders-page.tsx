"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { Empty, Skeleton } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { CustomerOrders } from "./customer-orders";
import { useLocale } from "./providers";
import { useCurrentUser } from "./user-context";
import styles from "./customer-profile.module.css";

type Detail = { customer: Record<string, string | number>; canEdit?: boolean };

/** 订单全字段子页：客户档案页的订单区块点「展开全部」进入 */
export function CustomerOrdersPage({ id }: { id: number }) {
  const { t } = useLocale();
  const currentUser = useCurrentUser();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/customers/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "客户详情加载失败");
      setData(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "客户详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className={styles.page}><Skeleton active paragraph={{ rows: 8 }} /></div>;

  if (error || !data) {
    return (
      <div className={styles.page}>
        <Link href={`/customers/${id}`} className={styles.back}><ArrowLeftOutlined /> {t("返回客户档案")}</Link>
        <Empty description={error || t("客户详情加载失败")} />
      </div>
    );
  }

  const { customer } = data;

  return (
    <div className={styles.page}>
      <Link href={`/customers/${id}`} className={styles.back}><ArrowLeftOutlined /> {t("返回客户档案")}</Link>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{customer.name}</h1>
        </div>
        {customer.nameEn ? <div className={styles.nameEn}>{customer.nameEn}</div> : null}
      </div>
      <CustomerOrders
        customerId={id}
        customerName={String(customer.name)}
        canEdit={data.canEdit !== false}
        isAdmin={currentUser.role === "admin"}
      />
    </div>
  );
}
