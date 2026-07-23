"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { Descriptions, Empty, Skeleton, Table, Tabs, Tag, type TableProps } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import { StatusTag, statusLabel } from "./status-tag";
import resStyles from "./resource-page.module.css";
import styles from "./customer-profile.module.css";

type Row = Record<string, string | number | null>;
type Detail = {
  customer: Record<string, string | number>;
  contacts: Array<Record<string, string | number>>;
  members: Array<Record<string, string | number>>;
  visits: Array<Record<string, string | number>>;
  opportunities: Row[];
  orders: Row[];
  counts?: { visits: number; opportunities: number; orders: number };
};

// 订单履约概要按 status 汇总的展示顺序（沿用订单 status，不新增字段）
const ORDER_STATUS_FLOW = ["planned", "confirmed", "shipped", "arrived"] as const;

function formatAmount(value: string | number | null) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value));
}

export function CustomerProfile({ id }: { id: number }) {
  const { t } = useLocale();
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

  useEffect(() => {
    void load();
  }, [load]);

  const orderColumns: TableProps<Row>["columns"] = [
    { title: t("订单编号"), dataIndex: "orderNo", width: 150 },
    { title: t("日期"), dataIndex: "orderDate", width: 105 },
    { title: t("产品"), key: "product", width: 130, render: (_, row) => (row.grade ? `${row.className} / ${row.grade}` : "-") },
    { title: t("数量"), dataIndex: "quantity", width: 80, align: "right" },
    { title: t("金额"), key: "amount", width: 140, align: "right", render: (_, row) => <span className={resStyles.money}>{row.amount != null ? `${formatAmount(row.amount)} ${row.currency || ""}` : "-"}</span> },
    { title: t("状态"), dataIndex: "status", width: 96, render: (value) => <StatusTag value={String(value)} /> },
    { title: t("实际出货"), dataIndex: "actualShipmentDate", width: 110, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("预计到港"), dataIndex: "expectedArrivalDate", width: 110, render: (value) => value || <span className={resStyles.muted}>-</span> },
  ];
  const visitColumns: TableProps<Record<string, string | number>>["columns"] = [
    { title: t("日期"), dataIndex: "visitDate", width: 110 },
    { title: t("编号"), dataIndex: "reportNo", width: 150 },
    { title: t("标题"), dataIndex: "title", ellipsis: true },
    { title: t("状态"), dataIndex: "status", width: 90, render: (value) => <StatusTag value={value} /> },
  ];
  const opportunityColumns: TableProps<Row>["columns"] = [
    { title: t("商机"), dataIndex: "name", ellipsis: true },
    { title: t("产品"), key: "product", width: 140, render: (_, row) => (row.grade ? `${row.className} / ${row.grade}` : "-") },
    { title: t("阶段"), dataIndex: "stage", width: 90, render: (value) => <StatusTag value={String(value)} /> },
    { title: t("下次跟进"), dataIndex: "nextFollowUpDate", width: 110, render: (value) => value || "-" },
  ];

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

  // 履约概要：按订单 status 汇总，一眼看出客户整体走到哪个流程
  const orderTotal = data.counts?.orders ?? data.orders.length;
  const statusCounts = data.orders.reduce<Record<string, number>>((acc, order) => {
    const key = String(order.status || "");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className={styles.page}>
      <Link href="/customers" className={styles.back}><ArrowLeftOutlined /> {t("返回客户列表")}</Link>

      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{customer.name}</h1>
          <StatusTag value={String(customer.status)} label={{ potential: "潜在客户", active: "活跃客户", inactive: "已停用" }[String(customer.status)]} />
        </div>
        <div className={styles.headerMeta}>
          <span><b>{t("负责人")}</b> {customer.ownerName}</span>
          {location ? <span><b>{t("国家 / 地区")}</b> {location}</span> : null}
          {customer.industry ? <span><b>{t("行业")}</b> {customer.industry}</span> : null}
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>{t("客户信息")}</h2>
          <Descriptions size="small" column={{ xs: 1, sm: 2 }} colon={false}>
            <Descriptions.Item label={t("客户状态")}><StatusTag value={String(customer.status)} label={{ potential: "潜在客户", active: "活跃客户", inactive: "已停用" }[String(customer.status)]} /></Descriptions.Item>
            <Descriptions.Item label={t("负责人")}>{customer.ownerName}</Descriptions.Item>
            <Descriptions.Item label={t("国家 / 地区")}>{location || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("行业")}>{customer.industry || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("地址")} span={2}>{customer.address || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("客户简介")} span={2}><span className={resStyles.preWrap}>{customer.description || "-"}</span></Descriptions.Item>
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

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t("订单记录")}</h2>
          <span className={styles.sectionCount}>{t("共 {n} 单", { n: orderTotal })}</span>
        </div>
        {orderTotal > 0 ? (
          <div className={styles.summary}>
            {ORDER_STATUS_FLOW.map((status) => (
              <div key={status} className={styles.summaryChip}>
                <span className={styles.summaryNum}>{statusCounts[status] || 0}</span>
                <span className={styles.summaryLabel}>{t(statusLabel(status))}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className={styles.tableFrame}>
          <Table<Row> rowKey="id" size="middle" columns={orderColumns} dataSource={data.orders} pagination={false} scroll={{ x: 920 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无订单")} /> }} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t("往来记录")}</h2>
        </div>
        <div className={styles.card} style={{ padding: "4px 20px 12px" }}>
          <Tabs
            items={[
              { key: "visits", label: `${t("拜访")} ${data.counts?.visits ?? data.visits.length}`, children: <Table rowKey="id" size="small" columns={visitColumns} dataSource={data.visits} pagination={false} scroll={{ x: 620 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无拜访")} /> }} /> },
              { key: "opportunities", label: `${t("商机")} ${data.counts?.opportunities ?? data.opportunities.length}`, children: <Table rowKey="id" size="small" columns={opportunityColumns} dataSource={data.opportunities} pagination={false} scroll={{ x: 620 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无商机")} /> }} /> },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
