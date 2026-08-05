import dayjs, { type Dayjs } from "dayjs";
import { getDb } from "@/db/client";
import { handleApiError, ok, requireApiUser } from "@/lib/api";
import { customerScope } from "@/lib/permissions";

export type TrendGranularity = "year" | "month" | "week";

// 各粒度的桶数：年 5、月 12、周 12
const BUCKET_COUNTS: Record<TrendGranularity, number> = { year: 5, month: 12, week: 12 };

// SQL 分桶表达式，需与 JS 侧 bucketKey 的格式一致
const BUCKET_EXPRS: Record<TrendGranularity, string> = {
  year: "strftime('%Y', ord.order_date)",
  month: "strftime('%Y-%m', ord.order_date)",
  // 'weekday 0' 前进到本周日，再回退 6 天得到周一：按周一至周日归周
  week: "date(ord.order_date, 'weekday 0', '-6 days')",
};

function bucketKey(date: Dayjs, granularity: TrendGranularity) {
  if (granularity === "year") return date.format("YYYY");
  if (granularity === "month") return date.format("YYYY-MM");
  return date.format("YYYY-MM-DD");
}

// 从当前时间往回生成完整桶序列（缺单的桶补零），并给出查询下界
function buildBuckets(granularity: TrendGranularity) {
  const count = BUCKET_COUNTS[granularity];
  let cursor: Dayjs;
  let step: "year" | "month" | "week";
  if (granularity === "year") {
    cursor = dayjs().startOf("year");
    step = "year";
  } else if (granularity === "month") {
    cursor = dayjs().startOf("month");
    step = "month";
  } else {
    // dayjs().day()：0 为周日；换算为距周一的天数
    cursor = dayjs().subtract((dayjs().day() + 6) % 7, "day");
    step = "week";
  }
  const starts = Array.from({ length: count }, (_, index) => cursor.subtract(count - 1 - index, step));
  return { keys: starts.map((start) => bucketKey(start, granularity)), rangeStart: starts[0].format("YYYY-MM-DD") };
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const scope = customerScope(user, "c");

    const raw = new URL(request.url).searchParams.get("granularity");
    const granularity: TrendGranularity = raw === "year" || raw === "week" ? raw : "month";

    const { keys, rangeStart } = buildBuckets(granularity);
    // 单数与金额一次查出，工作台的「订单趋势」与「金额趋势」共用这份数据。
    // 已取消的订单不计入金额，否则趋势会被废单抬高。
    const rows = db
      .prepare(`
        SELECT ${BUCKET_EXPRS[granularity]} AS bucket, COUNT(*) AS count,
          COALESCE(SUM(CASE WHEN ord.status <> 'cancelled' THEN ord.quantity * ord.price END), 0) AS amount
        FROM orders ord
        JOIN customers c ON c.id = ord.customer_id
        WHERE ord.deleted_at IS NULL
          AND ord.order_date >= ?
          AND ${scope.sql}
        GROUP BY bucket
      `)
      .all(rangeStart, ...scope.params) as Array<{ bucket: string; count: number; amount: number }>;

    const trend = keys.map((bucket) => {
      const row = rows.find((item) => item.bucket === bucket);
      return {
        bucket,
        count: row?.count ?? 0,
        amount: Math.round(row?.amount ?? 0),
      };
    });

    return ok({ granularity, trend });
  } catch (error) {
    return handleApiError(error);
  }
}
