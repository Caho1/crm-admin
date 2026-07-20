"use client";

import styles from "./dashboard.module.css";

export type StageDatum = { stage: string; label: string; count: number };
export type TrendDatum = { month: string; label: string; count: number };

/** 推进中商机阶段分布：横向条形图，按销售管道顺序展示，零依赖纯 CSS 实现 */
export function StageBars({ data, emptyText }: { data: StageDatum[]; emptyText: string }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return <div className={styles.chartEmpty}>{emptyText}</div>;
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className={styles.stageBars}>
      {data.map((item) => (
        <div key={item.stage} className={styles.stageRow}>
          <span className={styles.stageLabel}>{item.label}</span>
          <div className={styles.stageTrack}>
            <div className={styles.stageFill} style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
          <span className={styles.stageCount}>{item.count}</span>
        </div>
      ))}
    </div>
  );
}

/** 近 6 个月订单趋势：SVG 折线 + 面积图，viewBox 自适应宽度 */
export function TrendLine({ data, emptyText, unitText }: { data: TrendDatum[]; emptyText: string; unitText: string }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return <div className={styles.chartEmpty}>{emptyText}</div>;

  const width = 560;
  const height = 190;
  const pad = { top: 20, right: 16, bottom: 28, left: 30 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(2, ...data.map((item) => item.count)); // 至少 2，避免数值全 1 时折线贴顶
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = data.map((item, index) => ({
    ...item,
    x: pad.left + index * stepX,
    y: pad.top + innerH - (item.count / max) * innerH,
  }));
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const areaPath = `${linePath} L${pad.left + (data.length - 1) * stepX},${pad.top + innerH} L${pad.left},${pad.top + innerH} Z`;
  const formatTick = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

  return (
    <svg className={styles.trendSvg} viewBox={`0 0 ${width} ${height}`} role="img">
      {[0, 0.5, 1].map((ratio) => {
        const y = pad.top + innerH - ratio * innerH;
        return (
          <g key={ratio}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className={styles.trendGrid} />
            <text x={pad.left - 7} y={y + 4} textAnchor="end" className={styles.trendTick}>{formatTick(max * ratio)}</text>
          </g>
        );
      })}
      <path d={areaPath} className={styles.trendArea} />
      <path d={linePath} className={styles.trendLine} />
      {points.map((point) => (
        <g key={point.month}>
          <circle cx={point.x} cy={point.y} r={3.5} className={styles.trendDot}>
            <title>{`${point.label} · ${point.count} ${unitText}`}</title>
          </circle>
          <text x={point.x} y={point.y - 8} textAnchor="middle" className={styles.trendValue}>{point.count}</text>
          <text x={point.x} y={height - 8} textAnchor="middle" className={styles.trendTick}>{point.label}</text>
        </g>
      ))}
    </svg>
  );
}
