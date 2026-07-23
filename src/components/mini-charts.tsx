"use client";

import dynamic from "next/dynamic";
import styles from "./dashboard.module.css";

export type StageDatum = { stage: string; label: string; count: number };
export type TrendDatum = { bucket: string; label: string; title: string; count: number };

// @ant-design/plots（AntV G2）只在浏览器渲染，动态导入跳过 SSR，并让图表库单独分包
const Column = dynamic(() => import("@ant-design/plots").then((mod) => mod.Column), {
  ssr: false,
  loading: () => <div className={styles.chartLoading} />,
});
const Area = dynamic(() => import("@ant-design/plots").then((mod) => mod.Area), {
  ssr: false,
  loading: () => <div className={styles.chartLoading} />,
});

const BRAND = "#1769aa";
const CHART_HEIGHT = 252;

/** 推进中商机阶段分布：竖向柱状图，柱宽统一（上限 24px），柱顶直接标数，故不再显示 y 轴 */
export function StageColumns({ data, emptyText, tooltipName }: { data: StageDatum[]; emptyText: string; tooltipName: string }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return <div className={styles.chartEmpty}>{emptyText}</div>;
  return (
    <div className={styles.chartBody}>
      <Column
        data={data}
        xField="label"
        yField="count"
        height={CHART_HEIGHT}
        insetTop={20}
        style={{ fill: BRAND, maxWidth: 24, radiusTopLeft: 4, radiusTopRight: 4 }}
        label={{ text: (d: StageDatum) => String(d.count), textBaseline: "bottom", dy: -6, fill: "#344054", fontSize: 12, fontWeight: 600 }}
        axis={{
          x: { title: false, line: false, tick: false, labelFill: "#475467", labelFontSize: 13, labelSpacing: 8 },
          y: false,
        }}
        scale={{ y: { domainMin: 0 } }}
        tooltip={{ items: [{ channel: "y", name: tooltipName }] }}
      />
    </div>
  );
}

/** 订单趋势：平滑面积图，渐变填充 + 端点标注 + 十字线悬浮提示，粒度由父组件控制 */
export function TrendArea({ data, emptyText, tooltipName }: { data: TrendDatum[]; emptyText: string; tooltipName: string }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return <div className={styles.chartEmpty}>{emptyText}</div>;
  const max = Math.max(2, ...data.map((item) => item.count)); // 至少 2，避免数值全 1 时曲线贴顶
  return (
    <div className={styles.chartBody}>
      <Area
        data={data}
        xField="label"
        yField="count"
        height={CHART_HEIGHT}
        shapeField="smooth"
        insetTop={14}
        insetLeft={10}
        insetRight={16}
        style={{ fill: "linear-gradient(-90deg, rgba(23, 105, 170, 0.02) 0%, rgba(23, 105, 170, 0.2) 100%)" }}
        line={{ style: { stroke: BRAND, lineWidth: 2, lineCap: "round", lineJoin: "round" } }}
        point={{ sizeField: 4, style: { fill: "#fff", stroke: BRAND, lineWidth: 2 } }}
        label={{ text: "count", selector: "last", textBaseline: "bottom", dy: -10, fill: "#344054", fontSize: 12, fontWeight: 600 }}
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
            labelFormatter: (value: number) => (Number.isInteger(value) ? String(value) : ""),
          },
        }}
        scale={{ y: { domainMin: 0, domainMax: max, nice: true } }}
        tooltip={{ title: (d: TrendDatum) => d.title, items: [{ channel: "y", name: tooltipName }] }}
        interaction={{ tooltip: { crosshairs: true, crosshairsStroke: "#c2cad6", crosshairsLineDash: [4, 4], marker: false } }}
      />
    </div>
  );
}
