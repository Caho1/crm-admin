"use client";

import {
  CalendarOutlined,
  ExportOutlined,
  FunnelPlotOutlined,
  PlusOutlined,
  TeamOutlined,
  TruckOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Empty, Skeleton, Table, type TableProps } from "antd";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "./providers";
import { StatusTag } from "./status-tag";
import styles from "./dashboard.module.css";

type DashboardData = {
  stats: {
    customers: number;
    visitsThisMonth: number;
    opportunities: number;
    ordersThisMonth: number;
    pendingShipment: number;
    arrivingSoon: number;
  };
  recentVisits: Array<Record<string, string | number>>;
  shipmentAlerts: Array<Record<string, string | number | null>>;
};

export function Dashboard() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const { message } = App.useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "工作台加载失败");
      setData(payload.data);
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "工作台加载失败"));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const statItems = data
    ? [
        { label: t("可见客户"), value: data.stats.customers, icon: <TeamOutlined />, color: "#1769aa", bg: "#eaf3fb" },
        { label: t("本月拜访"), value: data.stats.visitsThisMonth, icon: <CalendarOutlined />, color: "#2f855a", bg: "#eaf7ef" },
        { label: t("推进中商机"), value: data.stats.opportunities, icon: <FunnelPlotOutlined />, color: "#9a6700", bg: "#fff4d6" },
        { label: t("本月订单"), value: data.stats.ordersThisMonth, icon: <ExportOutlined />, color: "#7c4d9e", bg: "#f3ecf8" },
        { label: t("待出货"), value: data.stats.pendingShipment, icon: <TruckOutlined />, color: "#b45309", bg: "#fff0e0" },
        { label: t("14 天内到港"), value: data.stats.arrivingSoon, icon: <TruckOutlined />, color: "#b73e3e", bg: "#fdecec" },
      ]
    : [];

  const visitColumns: TableProps<Record<string, string | number>>["columns"] = [
    { title: t("日期"), dataIndex: "visitDate", width: 120 },
    { title: t("客户"), dataIndex: "customerName", ellipsis: true },
    { title: t("报告"), dataIndex: "title", ellipsis: true },
    { title: t("状态"), dataIndex: "status", width: 82, render: (value) => <StatusTag value={value} /> },
  ];

  const shipmentColumns: TableProps<Record<string, string | number | null>>["columns"] = [
    { title: t("订单"), dataIndex: "orderNo", width: 140 },
    { title: t("客户"), dataIndex: "customerName", ellipsis: true },
    { title: t("产品"), key: "product", width: 120, render: (_, row) => `${row.className} / ${row.grade}` },
    { title: t("预计到港"), dataIndex: "expectedArrivalDate", width: 120, render: (value) => value || t("待确认") },
    { title: t("状态"), dataIndex: "status", width: 82, render: (value) => <StatusTag value={String(value)} /> },
  ];

  // locale 变化时 dayjs 全局语言已由 Providers 切换，这里只需按语言选格式
  void locale;

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>{t("工作台")}</h1>
        <div className={styles.date}>{dayjs().format(t("YYYY年M月D日 dddd"))}</div>
      </div>
      {loading && !data ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : data ? (
        <>
          <div className={styles.stats}>
            {statItems.map((item) => (
              <Card key={item.label} className={styles.statCard} styles={{ body: { padding: 16 } }}>
                <div className={styles.statTop}>
                  <span className={styles.statLabel}>{item.label}</span>
                  <span className={styles.statIcon} style={{ color: item.color, background: item.bg }}>{item.icon}</span>
                </div>
                <div className={styles.statValue}>{item.value}</div>
              </Card>
            ))}
          </div>
          <div className={styles.quickActions}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/customers?create=1")}>{t("新建客户")}</Button>
            <Button icon={<CalendarOutlined />} onClick={() => router.push("/visits?create=1")}>{t("新建拜访")}</Button>
            <Button icon={<FunnelPlotOutlined />} onClick={() => router.push("/opportunities?create=1")}>{t("新建商机")}</Button>
            <Button icon={<TruckOutlined />} onClick={() => router.push("/orders?create=1")}>{t("新建订单")}</Button>
          </div>
          <div className={styles.panels}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{t("最近拜访")}</h2>
                <Button type="link" onClick={() => router.push("/visits")}>{t("查看全部")}</Button>
              </div>
              <div className={styles.panelBody}>
                <Table rowKey="id" size="middle" columns={visitColumns} dataSource={data.recentVisits} pagination={false} scroll={{ x: 600 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
              </div>
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{t("出货与到港提醒")}</h2>
                <Button type="link" onClick={() => router.push("/orders")}>{t("查看全部")}</Button>
              </div>
              <div className={styles.panelBody}>
                <Table rowKey="id" size="middle" columns={shipmentColumns} dataSource={data.shipmentAlerts} pagination={false} scroll={{ x: 650 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
              </div>
            </section>
          </div>
        </>
      ) : (
        <Empty description={t("工作台暂时无法加载")}><Button onClick={load}>{t("重新加载")}</Button></Empty>
      )}
    </div>
  );
}
