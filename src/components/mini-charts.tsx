"use client";

import dynamic from "next/dynamic";
import styles from "./dashboard.module.css";

export type TrendDatum = { bucket: string; label: string; title: string; count: number; amount: number };
export type DistributionDatum = { name: string; amount: number; quantity: number; orderCount: number };

// @ant-design/plots（AntV G2）只在浏览器渲染，动态导入跳过 SSR，并让图表库单独分包
const Area = dynamic(() => import("@ant-design/plots").then((mod) => mod.Area), {
  ssr: false,
  loading: () => <div className={styles.chartLoading} />,
});
const Bar = dynamic(() => import("@ant-design/plots").then((mod) => mod.Bar), {
  ssr: false,
  loading: () => <div className={styles.chartLoading} />,
});
const Pie = dynamic(() => import("@ant-design/plots").then((mod) => mod.Pie), {
  ssr: false,
  loading: () => <div className={styles.chartLoading} />,
});

const BRAND = "#1769aa";
// 工作台图表统一高度，调整时同步 dashboard.module.css 的 .chartLoading
const CHART_HEIGHT = 220;
// 分类色板：产品大类/牌号分布用，顺序固定保证同一分类每次颜色一致
const PALETTE = ["#1769aa", "#2f855a", "#b7791f", "#7c4d9e", "#b45309", "#0e7490", "#be123c", "#4d7c0f"];

const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });

/** 面积图基底：订单数与订单金额共用，只是取值字段和格式化不同 */
function TrendChart({
  data,
  field,
  emptyText,
  tooltipName,
  formatValue,
}: {
  data: TrendDatum[];
  field: "count" | "amount";
  emptyText: string;
  tooltipName: string;
  formatValue: (value: number) => string;
}) {
  const total = data.reduce((sum, item) => sum + item[field], 0);
  if (total === 0) return <div className={styles.chartEmpty}>{emptyText}</div>;
  // 至少给个下限，避免数值都很小时曲线贴顶
  const max = Math.max(field === "count" ? 2 : 1, ...data.map((item) => item[field]));
  return (
    <div className={styles.chartBody}>
      <Area
        data={data}
        xField="label"
        yField={field}
        height={CHART_HEIGHT}
        shapeField="smooth"
        insetTop={14}
        insetLeft={10}
        insetRight={16}
        style={{ fill: "linear-gradient(-90deg, rgba(23, 105, 170, 0.02) 0%, rgba(23, 105, 170, 0.2) 100%)" }}
        line={{ style: { stroke: BRAND, lineWidth: 2, lineCap: "round", lineJoin: "round" } }}
        point={{ sizeField: 4, style: { fill: "#fff", stroke: BRAND, lineWidth: 2 } }}
        label={{
          text: (d: TrendDatum) => formatValue(d[field]),
          selector: "last",
          textBaseline: "bottom",
          dy: -10,
          fill: "#344054",
          fontSize: 12,
          fontWeight: 600,
        }}
        axis={{
          x: { title: false, line: false, tick: false, labelFill: "#98a2b3", labelFontSize: 12, labelSpacing: 8 },
          y: {
            title: false,
            line: false,
            tick: false,
            tickCount: 3,
            labelFill: "#98a2b3",
            labelFontSize: 12,
            gridStroke: "#eef1f5",
            gridLineWidth: 1,
            gridLineDash: [0, 0],
            labelFormatter: (value: number) =>
              field === "count" ? (Number.isInteger(value) ? String(value) : "") : compact.format(value),
          },
        }}
        scale={{ y: { domainMin: 0, domainMax: max, nice: true } }}
        tooltip={{
          title: (d: TrendDatum) => d.title,
          items: [{ channel: "y", name: tooltipName, valueFormatter: (value: number) => formatValue(value) }],
        }}
        interaction={{ tooltip: { crosshairs: true, crosshairsStroke: "#c2cad6", crosshairsLineDash: [4, 4], marker: false } }}
      />
    </div>
  );
}

/** 订单数趋势 */
export function TrendArea({ data, emptyText, tooltipName }: { data: TrendDatum[]; emptyText: string; tooltipName: string }) {
  return <TrendChart data={data} field="count" emptyText={emptyText} tooltipName={tooltipName} formatValue={(value) => String(value)} />;
}

/** 订单金额趋势：数值大，轴与标签走紧凑记数（1.2万） */
export function AmountArea({ data, emptyText, tooltipName }: { data: TrendDatum[]; emptyText: string; tooltipName: string }) {
  return <TrendChart data={data} field="amount" emptyText={emptyText} tooltipName={tooltipName} formatValue={(value) => compact.format(value)} />;
}

/** 产品大类占比：环形图，看材料结构（PP / PE / PC / EVA 各占多少） */
export function ProductClassPie({ data, emptyText, tooltipName }: { data: DistributionDatum[]; emptyText: string; tooltipName: string }) {
  const total = data.reduce((sum, item) => sum + item.amount, 0);
  if (total === 0) return <div className={styles.chartEmpty}>{emptyText}</div>;
  return (
    <div className={styles.chartBody}>
      <Pie
        data={data}
        angleField="amount"
        colorField="name"
        height={CHART_HEIGHT}
        innerRadius={0.6}
        radius={0.8}
        scale={{ color: { range: PALETTE } }}
        // 占比标注在扇区外侧，用引导线连回对应扇区；占比过小的扇区不标，避免线条打架
        label={{
          text: (d: DistributionDatum) => (d.amount / total >= 0.03 ? percent.format(d.amount / total) : ""),
          position: "outside",
          connector: true,
          connectorStroke: "#c2cad6",
          connectorLineWidth: 1,
          connectorDistance: 6,
          fill: "#475467",
          fontSize: 12,
          fontWeight: 500,
        }}
        legend={{ color: { position: "right", rowPadding: 6, itemLabelFill: "#475467", itemLabelFontSize: 12 } }}
        tooltip={{
          title: (d: DistributionDatum) => d.name,
          items: [{ channel: "y", name: tooltipName, valueFormatter: (value: number) => full.format(value) }],
        }}
      />
    </div>
  );
}

/** 牌号排行：横向条形，一眼看出哪几个牌号在走量 */
export function GradeBar({ data, emptyText, tooltipName }: { data: DistributionDatum[]; emptyText: string; tooltipName: string }) {
  const total = data.reduce((sum, item) => sum + item.amount, 0);
  if (total === 0) return <div className={styles.chartEmpty}>{emptyText}</div>;
  return (
    <div className={styles.chartBody}>
      <Bar
        data={data}
        xField="name"
        yField="amount"
        height={CHART_HEIGHT}
        // 金额从大到小自上而下排列
        sort={{ reverse: true, by: "y" }}
        style={{ fill: BRAND, maxWidth: 18, radiusTopRight: 4, radiusBottomRight: 4 }}
        label={{ text: (d: DistributionDatum) => compact.format(d.amount), position: "right", fill: "#475467", fontSize: 12 }}
        axis={{
          x: { title: false, line: false, tick: false, labelFill: "#475467", labelFontSize: 12 },
          y: { title: false, line: false, tick: false, labelFill: "#98a2b3", labelFontSize: 12, labelFormatter: (value: number) => compact.format(value), gridStroke: "#eef1f5" },
        }}
        tooltip={{
          title: (d: DistributionDatum) => d.name,
          items: [{ channel: "x", name: tooltipName, valueFormatter: (value: number) => full.format(value) }],
        }}
      />
    </div>
  );
}
