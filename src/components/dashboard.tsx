"use client";

import {
  ExperimentOutlined,
  ExportOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Empty, Segmented, Skeleton } from "antd";
import dayjs from "dayjs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { dictLabelOf, type DictItem } from "@/lib/dicts";
import { useLocale } from "./providers";
import { CategoryPie, GradeBar, TrendArea } from "./mini-charts";
import styles from "./dashboard.module.css";

type DashboardData = {
  stats: {
    customers: number;
    developingProjects: number;
    usdOrders: { count: number; quantity: number };
    cnyOrders: { count: number; quantity: number };
  };
  recentVisits: Array<Record<string, string | number>>;
  shipmentAlerts: Array<Record<string, string | number | null>>;
};

function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

type DistributionDatum = { name: string; amount: number; quantity: number; orderCount: number };
type InsightsData = {
  customerCategory: Array<{ code: string; count: number }>;
  topGrades: DistributionDatum[];
};

type TrendGranularity = "year" | "month" | "week";

// 桶 key 转成坐标轴短标签与悬浮提示完整标题。
// 解析不出来时回退成原始 bucket，宁可显示 2026-08 也不要显示 Invalid Date
function formatTrendBucket(bucket: string, granularity: TrendGranularity) {
  if (granularity === "week") {
    const parsed = dayjs(bucket);
    return { label: parsed.isValid() ? parsed.format("M/D") : bucket, title: bucket };
  }
  if (granularity === "month") {
    const parsed = dayjs(`${bucket}-01`);
    return { label: parsed.isValid() ? parsed.format("MMM") : bucket, title: bucket };
  }
  return { label: bucket, title: bucket };
}

export function Dashboard() {
  const { t, locale } = useLocale();
  const { message } = App.useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<TrendGranularity>("month");
  // 数据和它对应的粒度绑在一起存：切换粒度到新数据返回之间，
  // 图表继续用旧粒度渲染旧数据，不会拿新粒度去解析旧的桶 key（会出 Invalid Date）
  const [trend, setTrend] = useState<{ granularity: TrendGranularity; rows: Array<{ bucket: string; newCustomers: number; visits: number }> } | null>(null);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [categoryDict, setCategoryDict] = useState<DictItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardResponse, insightsResponse, lookupsResponse] = await Promise.all([
        apiFetch("/api/dashboard"),
        apiFetch("/api/dashboard/insights"),
        apiFetch("/api/lookups"),
      ]);
      const [payload, insightsPayload, lookupsPayload] = await Promise.all([
        dashboardResponse.json(),
        insightsResponse.json(),
        lookupsResponse.json(),
      ]);
      if (!dashboardResponse.ok) throw new Error(payload.error?.message || "工作台加载失败");
      if (!insightsResponse.ok) throw new Error(insightsPayload.error?.message || "工作台加载失败");
      setData(payload.data);
      setInsights(insightsPayload.data);
      if (lookupsResponse.ok) setCategoryDict(lookupsPayload.data.dicts?.customer_category || []);
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "工作台加载失败"));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 趋势图独立加载：切换粒度时只刷新图表，不动其余面板
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch(`/api/dashboard/trend?granularity=${granularity}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || "趋势数据加载失败");
        if (!cancelled) setTrend({ granularity, rows: payload.data.trend });
      } catch (error) {
        if (!cancelled) message.error(t(error instanceof Error ? error.message : "趋势数据加载失败"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [granularity, message, t]);

  // 「客户总数」下钻客户列表；USD / 人民币两张订单卡下钻全局订单页对应币种、当月的筛选视图
  const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");
  const monthEnd = dayjs().endOf("month").format("YYYY-MM-DD");
  const statItems = data
    ? [
        { label: t("客户总数"), value: data.stats.customers, sub: undefined as string | undefined, icon: <TeamOutlined />, color: "#1769aa", bg: "#eaf3fb", href: "/customers" },
        { label: t("开发项目"), value: data.stats.developingProjects, sub: undefined as string | undefined, icon: <ExperimentOutlined />, color: "#2f855a", bg: "#eaf7ef" },
        {
          label: t("本月 USD 订单"),
          value: data.stats.usdOrders.count,
          sub: t("{n} MT", { n: formatQuantity(data.stats.usdOrders.quantity) }),
          icon: <ExportOutlined />,
          color: "#7c4d9e",
          bg: "#f3ecf8",
          href: `/orders?dateFrom=${monthStart}&dateTo=${monthEnd}&currency=USD`,
        },
        {
          label: t("本月人民币采购订单"),
          value: data.stats.cnyOrders.count,
          sub: t("{n} MT", { n: formatQuantity(data.stats.cnyOrders.quantity) }),
          icon: <ExportOutlined />,
          color: "#b45309",
          bg: "#fff0e0",
          href: `/orders?dateFrom=${monthStart}&dateTo=${monthEnd}&currency=CNY`,
        },
      ]
    : [];



  const customerTrendData = trend?.rows.map((item) => ({ bucket: item.bucket, count: item.newCustomers, ...formatTrendBucket(item.bucket, trend.granularity) })) ?? null;
  const visitTrendData = trend?.rows.map((item) => ({ bucket: item.bucket, count: item.visits, ...formatTrendBucket(item.bucket, trend.granularity) })) ?? null;
  // 客户分类是标签字典驱动的下拉：库里存 code，展示时按当前语言取 label；空分类归到「未分类」
  const categoryData = insights?.customerCategory.map((item) => ({
    name: item.code ? dictLabelOf(categoryDict, item.code, locale) : t("未分类"),
    count: item.count,
  })) ?? null;

  return (
    <div>
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
                  {item.sub ? <div className={styles.statSub}>{item.sub}</div> : null}
                </Card>
              );
              return item.href ? (
                <Link key={item.label} href={item.href} className={styles.statLink}>
                  {card}
                </Link>
              ) : (
                <div key={item.label} className={styles.statPlain}>{card}</div>
              );
            })}
          </div>
          <div className={styles.charts}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{t("新增客户趋势")}</h2>
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
              {customerTrendData ? (
                <TrendArea
                  data={customerTrendData}
                  emptyText={t("暂无客户数据")}
                  tooltipName={t("新增客户")}
                />
              ) : (
                <div className={styles.chartLoading} />
              )}
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{t("拜访活跃度趋势")}</h2>
              </div>
              {visitTrendData ? (
                <TrendArea
                  data={visitTrendData}
                  emptyText={t("暂无拜访数据")}
                  tooltipName={t("拜访数")}
                />
              ) : (
                <div className={styles.chartLoading} />
              )}
            </section>
          </div>
          <div className={styles.charts}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{t("客户分类分布")}</h2>
                <span className={styles.panelHint}>{t("按客户数量")}</span>
              </div>
              {categoryData ? (
                <CategoryPie
                  data={categoryData}
                  emptyText={t("暂无客户数据")}
                  tooltipName={t("客户数")}
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
