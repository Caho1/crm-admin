"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { Descriptions, Empty, Skeleton, Tabs, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { dictLabelOf, type DictMap } from "@/lib/dicts";
import { CustomerOrders } from "./customer-orders";
import { CustomerVisits } from "./customer-visits";
import { useLocale } from "./providers";
import { useCurrentUser } from "./user-context";
import { StatusTag } from "./status-tag";
import resStyles from "./resource-page.module.css";
import styles from "./customer-profile.module.css";

type Detail = {
  customer: Record<string, string | number>;
  contacts: Array<Record<string, string | number>>;
  members: Array<Record<string, string | number>>;
  canEdit?: boolean;
};

export function CustomerProfile({ id }: { id: number }) {
  const { t, locale } = useLocale();
  const currentUser = useCurrentUser();
  const [data, setData] = useState<Detail | null>(null);
  const [dicts, setDicts] = useState<DictMap>({});
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

  useEffect(() => {
    void load();
  }, [load]);

  // 分类 / 行业存的是 code，展示要查字典换成当前语言的名称
  useEffect(() => {
    (async () => {
      try {
        const response = await apiFetch("/api/lookups");
        const payload = await response.json();
        if (response.ok) setDicts(payload.data.dicts || {});
      } catch {
        // 字典拿不到时回退显示原始 code，不阻塞页面
      }
    })();
  }, []);


  if (loading) return <div className={styles.page}><Skeleton active paragraph={{ rows: 10 }} /></div>;

  if (error || !data) {
    return (
      <div className={styles.page}>
        <Link href="/customers" className={styles.back}><ArrowLeftOutlined /> {t("返回客户列表")}</Link>
        <Empty description={error || t("客户详情加载失败")} />
      </div>
    );
  }

  const { customer } = data;
  const location = [customer.country, customer.region].filter(Boolean).join(" / ");
  const categoryLabel = dictLabelOf(dicts.customer_category, String(customer.category || ""), locale);
  const industryLabel = dictLabelOf(dicts.industry, String(customer.industry || ""), locale);

  return (
    <div className={styles.page}>
      <Link href="/customers" className={styles.back}><ArrowLeftOutlined /> {t("返回客户列表")}</Link>

      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{customer.name}</h1>
          <StatusTag value={String(customer.status)} label={{ potential: "潜在客户", active: "活跃客户", inactive: "已停用" }[String(customer.status)]} />
          {categoryLabel ? <Tag color="blue">{categoryLabel}</Tag> : null}
        </div>
        {customer.nameEn ? <div className={styles.nameEn}>{customer.nameEn}</div> : null}
        <div className={styles.headerMeta}>
          <span><b>{t("负责人")}</b> {customer.ownerName}</span>
          {location ? <span><b>{t("国家 / 地区")}</b> {location}</span> : null}
          {industryLabel ? <span><b>{t("行业")}</b> {industryLabel}</span> : null}
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>{t("客户信息")}</h2>
          <Descriptions size="small" column={{ xs: 1, sm: 2 }} colon={false}>
            <Descriptions.Item label={t("客户名称（英文）")} span={{ xs: 1, sm: 2 }}>{customer.nameEn || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("客户分类")}>{categoryLabel || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("客户状态")}><StatusTag value={String(customer.status)} label={{ potential: "潜在客户", active: "活跃客户", inactive: "已停用" }[String(customer.status)]} /></Descriptions.Item>
            <Descriptions.Item label={t("负责人")}>{customer.ownerName}</Descriptions.Item>
            <Descriptions.Item label={t("国家 / 地区")}>{location || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("行业")}>{industryLabel || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("地址")}>{customer.address || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("客户简介")} span={{ xs: 1, sm: 2 }}><span className={resStyles.preWrap}>{customer.description || "-"}</span></Descriptions.Item>
          </Descriptions>
        </div>

        <aside className={styles.card}>
          <h2 className={styles.cardTitle}>{t("客户档案")}</h2>
          <div className={styles.sideBlock}>
            <div className={styles.sideLabel}>{t("联系人")}</div>
            <div className={styles.tagWrap}>
              {data.contacts.length ? data.contacts.map((contact) => (
                <Tag key={contact.id}>{contact.name}{contact.title ? ` · ${contact.title}` : ""}{contact.phone ? ` · ${contact.phone}` : ""}</Tag>
              )) : <span className={resStyles.muted}>{t("暂无联系人")}</span>}
            </div>
          </div>
          <div className={styles.sideBlock}>
            <div className={styles.sideLabel}>{t("协作成员")}</div>
            <div className={styles.tagWrap}>
              {data.members.length ? data.members.map((member) => (
                <Tag key={member.id}>{member.name} · {member.access === "edit" ? t("可编辑") : t("可查看")}</Tag>
              )) : <span className={resStyles.muted}>{t("暂无协作成员")}</span>}
            </div>
          </div>
        </aside>
      </div>

      {/* 订单与拜访都挂在客户档案下，用 tab 切换避免页面纵向过长；
          订单在上（更常用），拜访在后 */}
      <Tabs
        className={styles.recordTabs}
        defaultActiveKey="orders"
        items={[
          {
            key: "orders",
            label: t("订单记录"),
            children: (
              <CustomerOrders
                customerId={id}
                customerName={String(customer.name)}
                canEdit={data.canEdit !== false}
                isAdmin={currentUser.role === "admin"}
                compact
              />
            ),
          },
          {
            key: "visits",
            label: t("拜访记录"),
            children: (
              <CustomerVisits
                customerId={id}
                customerName={String(customer.name)}
                canEdit={data.canEdit !== false}
                onChanged={() => void load()}
              />
            ),
          },
        ]}
      />

    </div>
  );
}
