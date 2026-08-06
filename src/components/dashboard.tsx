"use client";

import {
  CalendarOutlined,
  ExportOutlined,
  PlusOutlined,
  TeamOutlined,
  TruckOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Empty, Segmented, Skeleton } from "antd";
import dayjs from "dayjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import { AmountArea, GradeBar, ProductClassPie, TrendArea } from "./mini-charts";
import styles from "./dashboard.module.css";

type DashboardData = {
  stats: {
    customers: number;
    visitsThisMonth: number;
    ordersThisMonth: number;
    pendingShipment: number;
    arrivingSoon: number;
  };
  recentVisits: Array<Record<string, string | number>>;
  shipmentAlerts: Array<Record<string, string | number | null>>;
};

type DistributionDatum = { name: string; amount: number; quantity: number; orderCount: number };
type InsightsData = {
  productClass: DistributionDatum[];
  topGrades: DistributionDatum[];
};

type TrendGranularity = "year" | "month" | "week";

// 桶 key 转成坐标轴短标签与悬浮提示完整标题
function formatTrendBucket(bucket: string, granularity: TrendGranularity) {
  if (granularity === "week") return { label: dayjs(bucket).format("M/D"), title: bucket };
  if (granularity === "month") return { label: dayjs(`${bucket}-01`).format("MMM"), title: bucket };
  return { label: bucket, title: bucket };
}

export function Dashboard() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const { message } = App.useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<TrendGranularity>("month");
  const [trend, setTrend] = useState<Array<{ bucket: string; count: number; amount: number }> | null>(null);
  const [insights, setInsights] = useState<InsightsData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardResponse, insightsResponse] = await Promise.all([
        apiFetch("/api/dashboard"),
        apiFetch("/api/dashboard/insights"),
      ]);
      const [payload, insightsPayload] = await Promise.all([dashboardResponse.json(), insightsResponse.json()]);
      if (!dashboardResponse.ok) throw new Error(payload.error?.message || "工作台加载失败");
      if (!insightsResponse.ok) throw new Error(insightsPayload.error?.message || "工作台加载失败");
      setData(payload.data);
      setInsights(insightsPayload.data);
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "工作台加载失败"));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 订单趋势独立加载：切换粒度时只刷新图表，不动其余面板
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch(`/api/dashboard/trend?granularity=${granularity}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || "订单趋势加载失败");
        if (!cancelled) setTrend(payload.data.trend);
      } catch (error) {
        if (!cancelled) message.error(t(error instanceof Error ? error.message : "订单趋势加载失败"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [granularity, message, t]);

  // 「可见客户」下钻客户列表；三张订单卡下钻全局订单页的对应筛选视图；
  // 拜访没有独立列表，只做展示
  const statItems = data
    ? [
        { label: t("可见客户"), value: data.stats.customers, icon: <TeamOutlined />, color: "#1769aa", bg: "#eaf3fb", href: "/customers" },
        { label: t("本月拜访"), value: data.stats.visitsThisMonth, icon: <CalendarOutlined />, color: "#2f855a", bg: "#eaf7ef" },
        { label: t("本月订单"), value: data.stats.ordersThisMonth, icon: <ExportOutlined />, color: "#7c4d9e", bg: "#f3ecf8", href: `/orders?dateFrom=${dayjs().startOf("month").format("YYYY-MM-DD")}&dateTo=${dayjs().endOf("month").format("YYYY-MM-DD")}` },
        { label: t("待出货"), value: data.stats.pendingShipment, icon: <TruckOutlined />, color: "#b45309", bg: "#fff0e0", href: "/orders?status=confirmed" },
        { label: t("14 天内到港"), value: data.stats.arrivingSoon, icon: <TruckOutlined />, color: "#b73e3e", bg: "#fdecec", href: "/orders?arrivingSoon=1" },
      ]
    : [];



  // locale 变化时 dayjs 全局语言已由 Providers 切换，这里只需按语言选格式
  void locale;

  return (
    <div>
      {/* 栏目名已由顶栏展示，这里只留日期和新建入口 */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderRight}>
          <span className={styles.date}>{dayjs().format(t("YYYY年M月D日 dddd"))}</span>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/customers?create=1")}>{t("新建客户")}</Button>
        </div>
      </div>
      {loading && !data ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : data ? (
        <>
          <div className={styles.stats}>
            {statItems.map((item) => {
              const card = (
                <Card className={styles.statCard} styles={{ body: { padding: "12px 14px" } }}>
                  <div className={styles.statTop}>
                    <span className={styles.statLabel}>{item.label}</span>
                    <span className={styles.statIcon} style={{ color: item.color, background: item.bg }}>{item.icon}</span>
                  </div>
                  <div className={styles.statValue}>{item.value}</div>
                </Card>
              );
              return item.href ? (
                <Link key={item.label} href={item.href} className={styles.statLink}>
                  {card}
                </Link>
              ) : (
                <div key={item.label}>{card}</div>
              );
            })}
          </div>
          <div className={styles.charts}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{t("订单趋势")}</h2>
                <div className={styles.panelHeaderRight}>
                  <Segmented
                    size="small"
                    value={granularity}
                    onChange={(value) => setGranularity(value as TrendGranularity)}
                    options={[
                      { label: t("年度"), value: "year" },
                      { label: t("月"), value: "month" },
                      { label: t("周"), value: "week" },
                    ]}
                  />
                </div>
              </div>
              {trend ? (
                <TrendArea
                  data={trend.map((item) => ({ ...item, ...formatTrendBucket(item.bucket, granularity) }))}
                  emptyText={t("暂无订单数据")}
                  tooltipName={t("订单数")}
                />
              ) : (
                <div className={styles.chartLoading} />
              )}
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{t("订单金额趋势")}</h2>
                <span className={styles.panelHint}>{t("已排除取消订单")}</span>
              </div>
              {trend ? (
                <AmountArea
                  data={trend.map((item) => ({ ...item, ...formatTrendBucket(item.bucket, granularity) }))}
                  emptyText={t("暂无订单数据")}
                  tooltipName={t("订单金额")}
                />
              ) : (
                <div className={styles.chartLoading} />
              )}
            </section>
          </div>
          <div className={styles.charts}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{t("产品大类分布")}</h2>
                <span className={styles.panelHint}>{t("按订单金额")}</span>
              </div>
              {insights ? (
                <ProductClassPie
                  data={insights.productClass}
                  emptyText={t("暂无订单数据")}
                  tooltipName={t("订单金额")}
                />
              ) : (
                <div className={styles.chartLoading} />
              )}
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{t("热销牌号")}</h2>
                <span className={styles.panelHint}>{t("按订单金额")}</span>
              </div>
              {insights ? (
                <GradeBar
                  data={insights.topGrades}
                  emptyText={t("暂无订单数据")}
                  tooltipName={t("订单金额")}
                />
              ) : (
                <div className={styles.chartLoading} />
              )}
            </section>
          </div>
        </>
      ) : (
        <Empty description={t("工作台暂时无法加载")}><Button onClick={load}>{t("重新加载")}</Button></Empty>
      )}
    </div>
  );
}
