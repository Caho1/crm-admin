"use client";

import { ArrowLeftOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Empty, Skeleton, Tabs, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { dictLabelOf, type DictMap } from "@/lib/dicts";
import { CustomerEditModal } from "./customer-form";
import { CustomerOrders, STATUS_FLOW } from "./customer-orders";
import { CustomerVisits } from "./customer-visits";
import { useLocale } from "./providers";
import { useCurrentUser } from "./user-context";
import { StatusTag, statusLabel } from "./status-tag";
import resStyles from "./resource-page.module.css";
import styles from "./customer-profile.module.css";

type Detail = {
  customer: Record<string, string | number>;
  contacts: Array<Record<string, string | number>>;
  members: Array<Record<string, string | number>>;
  canEdit?: boolean;
  orderStatusCounts?: Record<string, number>;
};

export function CustomerProfile({ id }: { id: number }) {
  const { t, locale } = useLocale();
  const currentUser = useCurrentUser();
  const [data, setData] = useState<Detail | null>(null);
  const [dicts, setDicts] = useState<DictMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // silent：只刷新数据（如订单增删改后同步页头履约概要），不闪骨架屏
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/customers/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "客户详情加载失败");
      setData(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "客户详情加载失败");
    } finally {
      if (!silent) setLoading(false);
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
  const orderStatusCounts = data.orderStatusCounts || {};
  const orderTotal = Object.values(orderStatusCounts).reduce((sum, count) => sum + count, 0);

  return (
    <div className={styles.page}>
      <Link href="/customers" className={styles.back}><ArrowLeftOutlined /> {t("返回客户列表")}</Link>

      <div className={styles.header}>
        <div className={styles.headerMain}>
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
        <div className={styles.headerSide}>
          {/* 订单履约概要放在页头右侧，打开档案第一眼就能看到整体进度 */}
          {orderTotal > 0 ? (
            <div className={styles.summary}>
              {STATUS_FLOW.map((status) => (
                <div key={status} className={styles.summaryChip}>
                  <span className={styles.summaryNum}>{orderStatusCounts[status] || 0}</span>
                  <span className={styles.summaryLabel}>{t(statusLabel(status))}</span>
                </div>
              ))}
            </div>
          ) : null}
          {/* 详情页主操作：有编辑权限时就地开编辑弹窗，不跳回列表页 */}
          {data.canEdit !== false ? (
            <div className={styles.headerActions}>
              <Button type="primary" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>{t("编辑客户")}</Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* 名称 / 状态 / 分类 / 负责人 / 国家地区 / 行业 都已在页头呈现，
          这里只补页头没有的字段，压成一条窄信息条，把纵向空间让给订单表格 */}
      <div className={styles.facts}>
        <div className={styles.fact}>
          <div className={styles.factLabel}>{t("地址")}</div>
          <div className={styles.factValue}>{customer.address || "-"}</div>
        </div>
        <div className={styles.fact}>
          <div className={styles.factLabel}>{t("客户简介")}</div>
          <div className={`${styles.factValue} ${resStyles.preWrap}`}>{customer.description || "-"}</div>
        </div>
        <div className={styles.fact}>
          <div className={styles.factLabel}>{t("联系人")}</div>
          <div className={styles.tagWrap}>
            {data.contacts.length ? data.contacts.map((contact) => (
              <Tag key={contact.id}>{contact.name}{contact.title ? ` · ${contact.title}` : ""}{contact.phone ? ` · ${contact.phone}` : ""}</Tag>
            )) : <span className={resStyles.muted}>-</span>}
          </div>
        </div>
        <div className={styles.fact}>
          <div className={styles.factLabel}>{t("协作成员")}</div>
          <div className={styles.tagWrap}>
            {data.members.length ? data.members.map((member) => (
              <Tag key={member.id}>{member.name} · {member.access === "edit" ? t("可编辑") : t("可查看")}</Tag>
            )) : <span className={resStyles.muted}>-</span>}
          </div>
        </div>
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
                onChanged={() => void load(true)}
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

      {/* 保存后就地刷新详情，不离开当前页面 */}
      <CustomerEditModal
        customerId={id}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}
